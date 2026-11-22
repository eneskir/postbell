use crate::log::Log;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window};

const ID: &str = "main";
const OPEN: &str = "open";
const QUIT: &str = "quit";

pub const NOTICE_MARK: &str = "background-notice-shown";

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Texts {
    pub open: String,
    pub quit: String,
    pub tooltip: String,
    pub hidden_title: String,
    pub hidden_body: String,
}

/// `texts` is `None` until the tray icon exists.
pub struct Tray {
    texts: Mutex<Option<Texts>>,
    mark: PathBuf,
}

impl Tray {
    pub fn new(data_dir: &Path) -> Self {
        Tray { texts: Mutex::new(None), mark: data_dir.join(NOTICE_MARK) }
    }

    fn texts(&self) -> Option<Texts> {
        self.texts.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

pub fn set(app: &AppHandle, tray: &Tray, texts: Texts) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[&MenuItem::with_id(app, OPEN, &texts.open, true, None::<&str>)?, &MenuItem::with_id(app, QUIT, &texts.quit, true, None::<&str>)?],
    )?;
    match app.tray_by_id(ID) {
        Some(icon) => {
            icon.set_menu(Some(menu))?;
            icon.set_tooltip(Some(&texts.tooltip))?;
        }
        None => {
            let mut b = TrayIconBuilder::with_id(ID)
                .menu(&menu)
                .tooltip(&texts.tooltip)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id().as_ref() {
                    OPEN => crate::show_main(app),
                    QUIT => {
                        app.state::<Arc<Log>>().line("quit: tray");
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|icon, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        crate::show_main(icon.app_handle());
                    }
                });
            if let Some(image) = icon_image() {
                b = b.icon(image);
            }
            b.build(app)?;
        }
    }
    *tray.texts.lock().unwrap_or_else(|e| e.into_inner()) = Some(texts);
    Ok(())
}

/// Takes the exe's icon at the system small-icon size, so Windows picks the matching ICO entry instead of a blurred larger one.
#[cfg(windows)]
fn icon_image() -> Option<tauri::image::Image<'static>> {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSMICON};
    // SAFETY: a system query without side effects.
    let size = u32::try_from(unsafe { GetSystemMetrics(SM_CXSMICON) }).ok().filter(|&s| s > 0).unwrap_or(16);
    tauri::image::Image::from_app_icon_resource(size).ok()
}

#[cfg(not(windows))]
fn icon_image() -> Option<tauri::image::Image<'static>> {
    None
}

/// Hides the window instead of closing it while the tray icon exists; Tauri also routes the UI's `close` here.
pub fn close_requested(window: &Window, tray: &Tray, log: &Arc<Log>) -> bool {
    let Some(texts) = tray.texts() else { return false };
    if let Err(e) = window.hide() {
        log.line(&format!("WINDOW_HIDE: {e}"));
        return false;
    }
    log.line("window: hidden");
    if !tray.mark.exists() {
        // Toasts need their own COM thread, as in the alarms, so the window event does not wait.
        let (app, thread_log, mark) = (window.app_handle().clone(), log.clone(), tray.mark.clone());
        let spawned = std::thread::Builder::new().name("notice".into()).spawn(move || {
            crate::alarms::init_thread();
            let line = match crate::alarms::notice(&app, &texts.hidden_title, &texts.hidden_body) {
                Ok(()) => match std::fs::write(&mark, b"") {
                    Ok(()) => "notice: hidden".to_string(),
                    Err(e) => format!("NOTICE_MARK: {e}"),
                },
                Err(e) => format!("NOTICE_FAILED: {e}"),
            };
            thread_log.line(&line);
        });
        if let Err(e) = spawned {
            log.line(&format!("NOTICE_THREAD: {e}"));
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texts_parse_the_ui_contract() {
        // Must match `src/ui/notify.test.ts` (`text.tray`).
        let raw = r#"{"open":"Postbell'i aç","quit":"Çık","tooltip":"Postbell","hiddenTitle":"Postbell arka planda çalışıyor","hiddenBody":"Bildirimler gelmeye devam eder. Kapatmak için simgedeki menüden Çık'ı seç."}"#;
        let t = crate::parse_json::<Texts>(raw).unwrap();
        assert_eq!((t.open.as_str(), t.quit.as_str(), t.hidden_title.as_str()), ("Postbell'i aç", "Çık", "Postbell arka planda çalışıyor"));
        let extra = r#"{"open":"","quit":"","tooltip":"","hiddenTitle":"","hiddenBody":"","extra":1}"#;
        assert!(crate::parse_json::<Texts>(extra).is_err());
        let e = crate::parse_json::<Texts>(r#"{"open":1,"quit":"secret"}"#).unwrap_err();
        assert!(e.starts_with("Data, line 1"), "{e}");
        assert!(!e.contains("secret"), "{e}");
    }
}
