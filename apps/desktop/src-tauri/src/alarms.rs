use crate::log::{iso, now_ms, Log};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub brand: String,
    pub share: String,
}

/// `at` is a Unix millisecond instant; the UI handles time zones.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Alarm {
    pub id: String,
    pub at: i64,
    pub title: String,
    pub body: String,
    pub brand: String,
    pub label: String,
    pub target: Target,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Texts {
    pub open: String,
    pub open_home: String,
    pub many: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub alarms: Vec<Alarm>,
    pub texts: Texts,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Toast {
    pub ids: Vec<String>,
    pub at: i64, // latest due time in the toast, for the log
    pub title: String,
    pub body: String,
    pub action: String,
    pub target: Option<Target>,
}

pub struct Schedule {
    plan: Option<Plan>,
    mark: i64, // alarms due up to this instant were shown or predate launch
}

impl Schedule {
    pub fn new(now: i64) -> Self {
        Schedule { plan: None, mark: now }
    }

    pub fn set(&mut self, plan: Plan) -> usize {
        let n = plan.alarms.len();
        self.plan = Some(plan);
        n
    }

    /// Before the first list arrives the mark stays put, so alarms due in that gap still show.
    pub fn take(&mut self, now: i64) -> Option<Toast> {
        let plan = self.plan.as_ref()?;
        let from = self.mark;
        self.mark = self.mark.max(now);
        let batch: Vec<&Alarm> = plan.alarms.iter().filter(|a| a.at > from && a.at <= now).collect();
        toast_of(&batch, &plan.texts)
    }

    pub fn next(&self) -> Option<i64> {
        self.plan.as_ref()?.alarms.iter().map(|a| a.at).filter(|&at| at > self.mark).min()
    }
}

/// A share's due and reminder alarms in one look count once; the later one wins.
fn toast_of(batch: &[&Alarm], texts: &Texts) -> Option<Toast> {
    let mut unique: Vec<&Alarm> = Vec::new();
    for &a in batch {
        match unique.iter().position(|u| u.target == a.target) {
            Some(i) => unique[i] = a,
            None => unique.push(a),
        }
    }
    let at = unique.iter().map(|a| a.at).max()?;
    let ids = unique.iter().map(|a| a.id.clone()).collect();
    if let [one] = unique.as_slice() {
        return Some(Toast { ids, at, title: one.title.clone(), body: one.body.clone(), action: texts.open.clone(), target: Some(one.target.clone()) });
    }
    let mut groups: Vec<(&str, Vec<&str>)> = Vec::new();
    for a in &unique {
        match groups.iter_mut().find(|g| g.0 == a.brand) {
            Some(g) => g.1.push(&a.label),
            None => groups.push((&a.brand, vec![&a.label])),
        }
    }
    let body = groups.iter().map(|(b, labels)| format!("{b}: {}.", labels.join(", "))).collect::<Vec<_>>().join(" ");
    Some(Toast { ids, at, title: texts.many.replace("{n}", &unique.len().to_string()), body, action: texts.open_home.clone(), target: None })
}

/// `action` is the label of the one button; a toast without it has no button.
pub fn toast_xml(title: &str, body: &str, action: Option<&str>) -> String {
    let actions = action
        .map(|a| format!("<actions><action content=\"{}\" arguments=\"open\" activationType=\"foreground\"/></actions>", xml(a)))
        .unwrap_or_default();
    format!(
        "<toast activationType=\"foreground\" launch=\"open\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual>{actions}</toast>",
        xml(title),
        xml(body)
    )
}

/// Drops characters XML 1.0 forbids, because Windows rejects the whole toast if one remains.
fn xml(s: &str) -> String {
    let allowed = |c: char| matches!(c, '\t' | '\n' | '\r' | '\u{20}'..='\u{D7FF}' | '\u{E000}'..='\u{FFFD}' | '\u{10000}'..);
    s.chars()
        .filter(|&c| allowed(c))
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub struct Service {
    schedule: Mutex<Schedule>,
    wake: Condvar,
}

impl Service {
    pub fn new(now: i64) -> Arc<Self> {
        Arc::new(Service { schedule: Mutex::new(Schedule::new(now)), wake: Condvar::new() })
    }

    pub fn set(&self, plan: Plan) -> usize {
        let n = lock(&self.schedule).set(plan);
        self.wake.notify_one();
        n
    }
}

fn lock(m: &Mutex<Schedule>) -> MutexGuard<'_, Schedule> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Longest wait: the wall clock jumps after sleep but a timed wait does not, so missed alarms show within this.
const CHECK_MS: i64 = 5_000;

pub fn spawn(app: AppHandle, service: Arc<Service>, log: Arc<Log>) {
    let thread_log = log.clone();
    let started = std::thread::Builder::new().name("alarms".into()).spawn(move || {
        let log = thread_log;
        init_thread();
        let mut guard = lock(&service.schedule);
        loop {
            let now = now_ms();
            if let Some(t) = guard.take(now) {
                drop(guard);
                show(&app, &log, &t);
                guard = lock(&service.schedule);
                continue;
            }
            let wait = guard.next().map_or(CHECK_MS, |at| at - now).clamp(1, CHECK_MS);
            guard = match service.wake.wait_timeout(guard, Duration::from_millis(wait as u64)) {
                Ok((g, _)) => g,
                Err(e) => e.into_inner().0,
            };
        }
    });
    if let Err(e) = started {
        log.line(&format!("ALARMS_THREAD: {e}"));
    }
}

fn show(app: &AppHandle, log: &Log, t: &Toast) {
    let ids = t.ids.join(",");
    match platform_show(app, t) {
        Ok(()) => log.line(&format!("toast: {ids} due={} shown={}", iso(t.at), iso(now_ms()))),
        Err(e) => log.line(&format!("TOAST_FAILED: {ids} {e}")),
    }
}

pub fn open(app: &AppHandle, target: Option<Target>) {
    crate::show_main(app);
    if let (Err(e), Some(log)) = (app.emit_to("main", "alarm-open", target), app.try_state::<Arc<Log>>()) {
        log.line(&format!("ALARM_OPEN: {e}"));
    }
}

/// Call once at the start of any thread that shows toasts.
pub fn init_thread() {
    #[cfg(windows)]
    winrt::init_thread();
}

/// A toast without a button; the calling thread must have run `init_thread`.
#[cfg(windows)]
pub fn notice(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    winrt::notice(app, title, body).map_err(|e| format!("{:#010x} {}", e.code().0, e.message()))
}

#[cfg(not(windows))]
pub fn notice(_app: &AppHandle, _title: &str, _body: &str) -> Result<(), String> {
    Err("TOAST_UNSUPPORTED".into())
}

#[cfg(windows)]
fn platform_show(app: &AppHandle, t: &Toast) -> Result<(), String> {
    winrt::show(app, t).map_err(|e| format!("{:#010x} {}", e.code().0, e.message()))
}

#[cfg(not(windows))]
fn platform_show(_app: &AppHandle, _t: &Toast) -> Result<(), String> {
    Err("TOAST_UNSUPPORTED".into())
}

#[cfg(windows)]
mod winrt {
    use super::{open, toast_xml, Toast};
    use std::collections::VecDeque;
    use std::sync::Mutex;
    use tauri::AppHandle;
    use windows::core::{IInspectable, HSTRING};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Foundation::TypedEventHandler;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    // The click event fires only while the toast object lives, so recent toasts are kept.
    static LIVE: Mutex<VecDeque<ToastNotification>> = Mutex::new(VecDeque::new());
    const KEEP: usize = 20;

    pub fn init_thread() {
        // SAFETY: called once per thread; "already initialized" is fine too.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    }

    pub fn show(app: &AppHandle, t: &Toast) -> windows::core::Result<()> {
        let (handle, target) = (app.clone(), t.target.clone());
        show_xml(app, &toast_xml(&t.title, &t.body, Some(&t.action)), move || open(&handle, target.clone()))
    }

    pub fn notice(app: &AppHandle, title: &str, body: &str) -> windows::core::Result<()> {
        let handle = app.clone();
        show_xml(app, &toast_xml(title, body, None), move || crate::show_main(&handle))
    }

    /// Windows shows toasts only for an app id carried by a Start menu shortcut; without one it may accept them silently.
    fn show_xml(app: &AppHandle, xml: &str, activated: impl Fn() + Send + 'static) -> windows::core::Result<()> {
        let doc = XmlDocument::new()?;
        doc.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&doc)?;
        toast.Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, _| {
            activated();
            Ok(())
        }))?;
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app.config().identifier.as_str()))?;
        notifier.Show(&toast)?;
        let mut live = LIVE.lock().unwrap_or_else(|e| e.into_inner());
        live.push_back(toast);
        while live.len() > KEEP {
            live.pop_front();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60_000;
    const T0: i64 = 1_794_482_400_000; // 2026-11-12 11:20 UTC

    fn alarm(id: &str, at: i64, brand: &str, label: &str, share: &str) -> Alarm {
        Alarm {
            id: id.into(),
            at,
            title: format!("title {id}"),
            body: format!("body {id}"),
            brand: brand.into(),
            label: label.into(),
            target: Target { brand: brand.to_lowercase(), share: share.into() },
        }
    }

    fn texts() -> Texts {
        Texts { open: "Aç".into(), open_home: "Ana sayfayı aç".into(), many: "{n} paylaşımın saati geldi".into() }
    }

    fn plan(alarms: Vec<Alarm>) -> Plan {
        Plan { alarms, texts: texts() }
    }

    #[test]
    fn plan_parses_the_ui_contract() {
        // Must match `src/ui/notify.test.ts`.
        let raw = serde_json::json!({
            "alarms": [{ "id": "initech/a/x#due", "at": T0, "title": "Saati geldi: @initech · X", "body": "Body",
                         "brand": "Initech", "label": "X", "target": { "brand": "initech", "share": "initech/a/x" } }],
            "texts": { "open": "Aç", "openHome": "Ana sayfayı aç", "many": "{n} paylaşımın saati geldi" }
        });
        let p: Plan = serde_json::from_value(raw).unwrap();
        assert_eq!(p.alarms[0].target, Target { brand: "initech".into(), share: "initech/a/x".into() });
        assert_eq!(p.texts.open_home, "Ana sayfayı aç");
        let extra = serde_json::json!({ "alarms": [], "texts": { "open": "", "openHome": "", "many": "", "extra": 1 } });
        assert!(serde_json::from_value::<Plan>(extra).is_err());
    }

    #[test]
    fn lone_surrogate_breaks_the_whole_plan() {
        // serde rejects an unpaired surrogate and drops the whole plan, which is why `src/core/manifest.ts` refuses such text.
        let bad = r#"{"alarms":[],"texts":{"open":"\ud83d","openHome":"","many":""}}"#;
        assert!(serde_json::from_str::<Plan>(bad).is_err());
        let paired = r#"{"alarms":[],"texts":{"open":"🐶","openHome":"","many":""}}"#;
        assert_eq!(crate::parse_json::<Plan>(paired).unwrap().texts.open, "🐶");
    }

    #[test]
    fn rejected_plan_names_kind_and_place_but_no_content() {
        let bad = r#"{"alarms":[],"texts":{"open":"\ud83d secret","openHome":"","many":""}}"#;
        let e = crate::parse_json::<Plan>(bad).unwrap_err();
        assert!(e.starts_with("Syntax, line 1, column "), "{e}");
        assert!(!e.contains("secret"), "{e}");
        let wrong = r#"{"alarms":[{"id":"a","at":"secret title","title":"","body":"","brand":"","label":"","target":{"brand":"","share":""}}],"texts":{"open":"","openHome":"","many":""}}"#;
        let e = crate::parse_json::<Plan>(wrong).unwrap_err();
        assert!(e.starts_with("Data, line 1"), "{e}");
        assert!(!e.contains("secret"), "{e}");
        assert!(serde_json::from_str::<Plan>(wrong).unwrap_err().to_string().contains("secret"), "serde's own message quotes the value");
    }

    #[test]
    fn same_list_twice_shows_once() {
        let mut s = Schedule::new(T0);
        let list = vec![alarm("a#due", T0 + 2 * MIN, "Initech", "X", "a")];
        s.set(plan(list.clone()));
        assert_eq!(s.next(), Some(T0 + 2 * MIN));
        assert_eq!(s.take(T0 + MIN), None);
        let t = s.take(T0 + 2 * MIN + 300).unwrap();
        assert_eq!((t.title.as_str(), t.action.as_str(), t.target.clone()), ("title a#due", "Aç", Some(Target { brand: "initech".into(), share: "a".into() })));
        s.set(plan(list));
        assert_eq!(s.take(T0 + 3 * MIN), None);
        assert_eq!(s.next(), None);
    }

    #[test]
    fn alarms_before_launch_are_not_shown() {
        let mut s = Schedule::new(T0);
        s.set(plan(vec![alarm("a#due", T0 - 30 * MIN, "Initech", "X", "a"), alarm("a#reminder", T0, "Initech", "X", "a")]));
        assert_eq!(s.take(T0 + MIN), None);
    }

    #[test]
    fn alarm_due_before_the_first_list_still_shows() {
        let mut s = Schedule::new(T0);
        assert_eq!(s.take(T0 + 2 * MIN), None);
        s.set(plan(vec![alarm("a#due", T0 + MIN, "Initech", "X", "a")]));
        assert_eq!(s.take(T0 + 2 * MIN).map(|t| t.ids), Some(vec!["a#due".to_string()]));
    }

    #[test]
    fn same_minute_is_one_toast_grouped_by_brand() {
        let mut s = Schedule::new(T0);
        s.set(plan(vec![
            alarm("p1#due", T0 + MIN, "Initech", "X", "p1"),
            alarm("p2#due", T0 + MIN, "Initech", "Instagram Reels", "p2"),
            alarm("g1#due", T0 + MIN, "Gece Dosyası", "TikTok", "g1"),
        ]));
        let t = s.take(T0 + MIN).unwrap();
        assert_eq!(t.title, "3 paylaşımın saati geldi");
        assert_eq!(t.body, "Initech: X, Instagram Reels. Gece Dosyası: TikTok.");
        assert_eq!((t.action.as_str(), t.target), ("Ana sayfayı aç", None));
    }

    #[test]
    fn missed_while_asleep_is_one_toast_and_a_share_counts_once() {
        let mut s = Schedule::new(T0);
        s.set(plan(vec![
            alarm("a#due", T0 + MIN, "Initech", "X", "a"),
            alarm("b#due", T0 + 10 * MIN, "Initech", "TikTok", "b"),
            alarm("a#reminder", T0 + 31 * MIN, "Initech", "X", "a"),
            alarm("c#due", T0 + 90 * MIN, "Initech", "Pinterest", "c"),
        ]));
        let t = s.take(T0 + 40 * MIN).unwrap();
        assert_eq!(t.ids, vec!["a#reminder".to_string(), "b#due".to_string()]);
        assert_eq!((t.title.as_str(), t.body.as_str()), ("2 paylaşımın saati geldi", "Initech: X, TikTok."));
        assert_eq!(t.at, T0 + 31 * MIN);
        assert_eq!(s.next(), Some(T0 + 90 * MIN));
    }

    #[test]
    fn one_share_due_and_reminded_in_one_look_is_a_single_toast() {
        let mut s = Schedule::new(T0);
        s.set(plan(vec![alarm("a#due", T0 + MIN, "Initech", "X", "a"), alarm("a#reminder", T0 + 31 * MIN, "Initech", "X", "a")]));
        let t = s.take(T0 + 40 * MIN).unwrap();
        assert_eq!((t.ids, t.title, t.action), (vec!["a#reminder".to_string()], "title a#reminder".to_string(), "Aç".to_string()));
    }

    #[test]
    fn a_new_list_replaces_the_old_one() {
        let mut s = Schedule::new(T0);
        s.set(plan(vec![alarm("a#due", T0 + MIN, "Initech", "X", "a")]));
        s.set(plan(vec![])); // share marked done or notifications turned off
        assert_eq!(s.take(T0 + 2 * MIN), None);
        assert_eq!(s.next(), None);
    }

    #[test]
    fn clock_going_back_does_not_repeat() {
        let mut s = Schedule::new(T0);
        s.set(plan(vec![alarm("a#due", T0 + MIN, "Initech", "X", "a")]));
        assert!(s.take(T0 + MIN).is_some());
        assert_eq!(s.take(T0 - 10 * MIN), None);
        assert_eq!(s.take(T0 + 2 * MIN), None);
    }

    #[test]
    fn xml_escapes_text() {
        let x = toast_xml("Saati geldi: @a · X", "Tom & Jerry <\"'>", Some("Aç"));
        assert!(x.contains("<text>Saati geldi: @a · X</text><text>Tom &amp; Jerry &lt;&quot;&apos;&gt;</text>"));
        assert!(x.contains("content=\"Aç\""));
    }

    #[test]
    fn xml_drops_characters_xml_forbids() {
        // An invisible control character must not drop the toast; tab, newlines and other planes stay.
        let x = toast_xml("a\u{0}b\u{1}c\u{8}d\u{B}e\u{C}f\u{1F}g\u{FFFE}h\u{FFFF}i", "1\t2\n3\r4 \u{D7FF}\u{E000}\u{FFFD}🐶", Some("Aç\u{7}"));
        assert!(x.contains("<text>abcdefghi</text><text>1\t2\n3\r4 \u{D7FF}\u{E000}\u{FFFD}🐶</text>"), "{x}");
        assert!(x.contains("content=\"Aç\""));
    }

    #[test]
    fn notice_has_no_button() {
        let x = toast_xml("Postbell arka planda çalışıyor", "Kapatmak için simgedeki menüden Çık'ı seç.", None);
        assert!(x.contains("<text>Postbell arka planda çalışıyor</text><text>Kapatmak için simgedeki menüden Çık&apos;ı seç.</text>"), "{x}");
        assert!(!x.contains("<actions>"));
    }
}
