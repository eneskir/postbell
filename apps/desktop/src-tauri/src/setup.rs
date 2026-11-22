use crate::setup_win::{self as win, RegValue};
use crate::store::PortErr;
use serde::Serialize;
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

pub const EXE: &str = "postbell.exe";
pub const LINK: &str = "Postbell.lnk";
pub const NOTICES: &str = "THIRD_PARTY_NOTICES.md";
const PRODUCT_DIR: &str = "Postbell";
const QUIT_SINCE: &str = "0.1.1";
/// Set by `build.rs`, because Tauri leaves `bundle.publisher` empty in the embedded config (tauri-utils `impl ToTokens for BundleConfig`).
pub const PUBLISHER: &str = env!("POSTBELL_PUBLISHER");
/// Identifier used before 0.1.2, kept only to migrate and remove its data.
pub const LEGACY_IDENTIFIER: &str = "app.rae.postbell";
const TEST_REG_PREFIX: &str = r"Software\Postbell setup test\";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    App,
    Setup,
    /// Uninstall window, run from a temp copy.
    Uninstall,
    /// Copies the exe to a temp folder and runs the uninstaller there, because a running exe cannot be deleted.
    UninstallRelaunch,
    /// Tells a running instance to quit through the single-instance plugin, then exits.
    Quit,
}

/// Any launch with flags is the app; a debug build never opens setup on its own.
pub fn mode_of(args: &[String], at_install_path: bool, release: bool) -> Mode {
    let has = |flag: &str| args.iter().skip(1).any(|a| a == flag);
    if has("--quit") {
        Mode::Quit
    } else if has("--uninstall-ui") {
        Mode::Uninstall
    } else if has("--uninstall") {
        Mode::UninstallRelaunch
    } else if has("--setup") {
        Mode::Setup
    } else if release && args.len() <= 1 && !at_install_path {
        Mode::Setup
    } else {
        Mode::App
    }
}

/// `--setup-root <folder>` puts every path and registry key under a test root.
pub fn root_of(args: &[String]) -> Result<Option<PathBuf>, String> {
    match args.iter().position(|a| a == "--setup-root") {
        None => Ok(None),
        Some(i) => match args.get(i + 1) {
            Some(p) if !p.starts_with("--") => Ok(Some(PathBuf::from(p))),
            _ => Err("SETUP_ROOT_MISSING: --setup-root needs a path".into()),
        },
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Places {
    /// `%LOCALAPPDATA%\Postbell`, the same place the NSIS installer used.
    pub install_dir: PathBuf,
    pub start_menu: PathBuf,
    pub desktop: PathBuf,
    /// `%APPDATA%\<identifier>`: the store and log (Tauri's app data folder).
    pub data_roaming: PathBuf,
    /// `%LOCALAPPDATA%\<identifier>`: WebView2 data.
    pub data_local: PathBuf,
    pub legacy_roaming: PathBuf,
    pub legacy_local: PathBuf,
    pub reg_prefix: String,
}

impl Places {
    pub fn real(identifier: &str) -> Option<Places> {
        let local = win::known_folder(&win::FOLDERID_LocalAppData)?;
        let roaming = win::known_folder(&win::FOLDERID_RoamingAppData)?;
        Some(Places {
            install_dir: local.join(PRODUCT_DIR),
            start_menu: win::known_folder(&win::FOLDERID_Programs)?,
            desktop: win::known_folder(&win::FOLDERID_Desktop)?,
            data_roaming: roaming.join(identifier),
            data_local: local.join(identifier),
            legacy_roaming: roaming.join(LEGACY_IDENTIFIER),
            legacy_local: local.join(LEGACY_IDENTIFIER),
            reg_prefix: String::new(),
        })
    }

    pub fn under(root: &Path, identifier: &str) -> Places {
        Places {
            install_dir: root.join("Local").join(PRODUCT_DIR),
            start_menu: root.join("StartMenu"),
            desktop: root.join("Desktop"),
            data_roaming: root.join("Roaming").join(identifier),
            data_local: root.join("Local").join(identifier),
            legacy_roaming: root.join("Roaming").join(LEGACY_IDENTIFIER),
            legacy_local: root.join("Local").join(LEGACY_IDENTIFIER),
            reg_prefix: TEST_REG_PREFIX.into(),
        }
    }

    pub fn exe(&self) -> PathBuf {
        self.install_dir.join(EXE)
    }

    pub fn uninstall_key(&self) -> String {
        format!(r"{}Software\Microsoft\Windows\CurrentVersion\Uninstall\Postbell", self.reg_prefix)
    }

    /// The start-at-login setting writes a "Postbell" value here.
    pub fn run_key(&self) -> String {
        format!(r"{}Software\Microsoft\Windows\CurrentVersion\Run", self.reg_prefix)
    }

    pub fn notification_key(&self, aumid: &str) -> String {
        format!(r"{}Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\{aumid}", self.reg_prefix)
    }

    /// Where the old NSIS installer kept its settings; the name must stay to find those leftovers.
    pub fn nsis_key(&self) -> String {
        format!(r"{}Software\Rae Software\Postbell", self.reg_prefix)
    }
}

/// Ignores the fourth part of a Windows file version.
fn parts(v: &str) -> Option<[u64; 3]> {
    let mut it = v.trim().split('.');
    let mut out = [0u64; 3];
    for slot in out.iter_mut() {
        *slot = it.next()?.parse().ok()?;
    }
    Some(out)
}

pub fn compare(a: &str, b: &str) -> Option<Ordering> {
    Some(parts(a)?.cmp(&parts(b)?))
}

/// An installed exe whose version cannot be read counts as older, so it is overwritten.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Installed {
    None,
    Older { version: String },
    Same { version: String },
    Newer { version: String },
}

pub fn installed(this: &str, found: Option<&str>) -> Installed {
    let Some(v) = found else { return Installed::None };
    let version = v.to_string();
    match compare(v, this) {
        Some(Ordering::Equal) => Installed::Same { version },
        Some(Ordering::Greater) => Installed::Newer { version },
        _ => Installed::Older { version },
    }
}

fn knows_quit(version: &str) -> bool {
    compare(version, QUIT_SINCE).is_some_and(|o| o != Ordering::Less)
}

/// Install steps in order; there is deliberately no step that deletes data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallStep {
    CloseApp,
    /// Moves the legacy identifier's data and notification setting; never deletes.
    LegacyData,
    WriteExe,
    WriteNotices,
    StartShortcut,
    DesktopShortcut,
    UninstallEntry,
    NsisLeftovers,
}

pub fn install_steps(desktop: bool) -> Vec<InstallStep> {
    use InstallStep::*;
    let mut steps = vec![CloseApp, LegacyData, WriteExe, WriteNotices, StartShortcut];
    if desktop {
        steps.push(DesktopShortcut);
    }
    steps.extend([UninstallEntry, NsisLeftovers]);
    steps
}

/// Uninstall steps in order; shortcuts go before the install folder because their targets are read to delete only ours.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UninstallStep {
    CloseApp,
    Shortcuts,
    RunValue,
    UninstallEntry,
    NsisLeftovers,
    InstallDir,
    Data,
}

pub fn uninstall_steps(remove_data: bool) -> Vec<UninstallStep> {
    use UninstallStep::*;
    let mut steps = vec![CloseApp, Shortcuts, RunValue, UninstallEntry, NsisLeftovers, InstallDir];
    if remove_data {
        steps.push(Data);
    }
    steps
}

pub fn entry(places: &Places, version: &str, publisher: &str, size_kb: u32) -> Vec<(&'static str, RegValue)> {
    let exe = places.exe().display().to_string();
    vec![
        ("DisplayName", RegValue::Str("Postbell".into())),
        ("DisplayIcon", RegValue::Str(format!("\"{exe}\""))),
        ("DisplayVersion", RegValue::Str(version.into())),
        ("Publisher", RegValue::Str(publisher.into())),
        ("InstallLocation", RegValue::Str(places.install_dir.display().to_string())),
        ("UninstallString", RegValue::Str(format!("\"{exe}\" --uninstall"))),
        ("NoModify", RegValue::Dword(1)),
        ("NoRepair", RegValue::Dword(1)),
        ("EstimatedSize", RegValue::Dword(size_kb)),
    ]
}

pub struct Ctx {
    pub mode: Mode,
    pub places: Places,
    /// The running exe: the downloaded file in setup, a temp copy in uninstall.
    pub this_exe: PathBuf,
    pub version: String,
    pub identifier: String,
    pub publisher: String,
    /// Under a test root, "Open Postbell" writes a marker file instead of starting the app.
    pub test_root: Option<PathBuf>,
    /// The notices file from the embedded frontend assets (stored compressed, kept decompressed here).
    pub notices: Mutex<Option<Vec<u8>>>,
    /// The window's WebView2 data, in a temp folder so uninstall can delete `data_local`.
    pub webview_dir: PathBuf,
}

fn err(code: &'static str, detail: impl std::fmt::Display) -> PortErr {
    PortErr::new(code, detail)
}

/// Without `force` it only sends `--quit`, which releases before 0.1.1 do not know; with `force` it kills the process.
fn close_app(places: &Places, force: bool) -> Result<(), PortErr> {
    let exe = places.exe();
    let running = win::processes_with_image(&exe);
    if running.is_empty() {
        return Ok(());
    }
    if force {
        running.into_iter().for_each(|pid| {
            win::terminate(pid);
        });
    } else if win::file_version(&exe).is_some_and(|v| knows_quit(&v)) {
        ask_quit(&exe);
    } else {
        return Err(err("SETUP_APP_RUNNING", exe.display()));
    }
    if wait_gone(&exe, Duration::from_secs(5)) {
        Ok(())
    } else {
        Err(err("SETUP_APP_RUNNING", exe.display()))
    }
}

/// The single-instance plugin hands `--quit` to the running instance, which exits cleanly and removes its tray icon.
fn ask_quit(exe: &Path) {
    if let Ok(mut child) = std::process::Command::new(exe).arg("--quit").spawn() {
        let until = Instant::now() + Duration::from_secs(5);
        while Instant::now() < until {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
    }
}

fn wait_gone(exe: &Path, timeout: Duration) -> bool {
    let until = Instant::now() + timeout;
    loop {
        if win::processes_with_image(exe).is_empty() {
            return true;
        }
        if Instant::now() >= until {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn write_atomic(path: &Path, write: impl FnOnce(&Path) -> std::io::Result<()>) -> Result<(), PortErr> {
    let dir = path.parent().ok_or_else(|| err("SETUP_WRITE_FAILED", path.display()))?;
    std::fs::create_dir_all(dir).map_err(|e| err("SETUP_WRITE_FAILED", format!("{}: {e}", dir.display())))?;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".new");
    let tmp = PathBuf::from(tmp);
    write(&tmp).map_err(|e| err("SETUP_WRITE_FAILED", format!("{}: {e}", tmp.display())))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        err("SETUP_WRITE_FAILED", format!("{}: {e}", path.display()))
    })
}

fn write_exe(src: &Path, places: &Places) -> Result<(), PortErr> {
    let dest = places.exe();
    if win::same_path(src, &dest) {
        return Ok(());
    }
    write_atomic(&dest, |tmp| std::fs::copy(src, tmp).map(|_| ()))
}

fn link(ctx: &Ctx, dir: &Path) -> Result<(), PortErr> {
    std::fs::create_dir_all(dir).map_err(|e| err("SETUP_SHORTCUT_FAILED", format!("{}: {e}", dir.display())))?;
    win::create_shortcut(&dir.join(LINK), &ctx.places.exe(), &ctx.places.install_dir, &ctx.identifier).map_err(|e| err("SETUP_SHORTCUT_FAILED", e))
}

fn is_our_link(lnk: &Path, exe: &Path) -> bool {
    lnk.exists() && win::shortcut_target(lnk).is_some_and(|t| win::same_path(&t, exe))
}

fn remove_link_if_ours(lnk: &Path, exe: &Path) -> Result<(), PortErr> {
    if !is_our_link(lnk, exe) {
        return Ok(());
    }
    std::fs::remove_file(lnk).map_err(|e| err("UNINSTALL_SHORTCUT_FAILED", format!("{}: {e}", lnk.display())))
}

/// Moves without overwriting and removes `from` only if empty; retries for 3 s because WebView2 helpers may still hold the folder.
fn move_legacy(from: &Path, to: &Path) -> Result<(), PortErr> {
    let fail = |e: std::io::Error, p: &Path| err("SETUP_DATA_MOVE_FAILED", format!("{}: {e}", p.display()));
    if from == to || !from.exists() {
        return Ok(());
    }
    let retry = |src: &Path, dest: &Path| -> Result<(), PortErr> {
        let until = Instant::now() + Duration::from_secs(3);
        loop {
            match std::fs::rename(src, dest) {
                Ok(()) => return Ok(()),
                Err(e) if Instant::now() >= until => return Err(fail(e, src)),
                Err(_) => std::thread::sleep(Duration::from_millis(200)),
            }
        }
    };
    if !to.exists() {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent).map_err(|e| fail(e, parent))?;
        }
        return retry(from, to);
    }
    for entry in std::fs::read_dir(from).map_err(|e| fail(e, from))? {
        let entry = entry.map_err(|e| fail(e, from))?;
        let dest = to.join(entry.file_name());
        if !dest.exists() {
            retry(&entry.path(), &dest)?;
        }
    }
    let _ = std::fs::remove_dir(from); // succeeds only if empty
    Ok(())
}

fn legacy_data(ctx: &Ctx) -> Result<(), PortErr> {
    let p = &ctx.places;
    move_legacy(&p.legacy_roaming, &p.data_roaming)?;
    move_legacy(&p.legacy_local, &p.data_local)?;
    if ctx.identifier != LEGACY_IDENTIFIER {
        win::reg_copy_tree_if_missing(&p.notification_key(LEGACY_IDENTIFIER), &p.notification_key(&ctx.identifier))
            .map_err(|e| err("SETUP_REGISTRY_FAILED", e))?;
    }
    Ok(())
}

fn nsis_leftovers(places: &Places) -> Result<(), PortErr> {
    let old = places.install_dir.join("uninstall.exe");
    if old.exists() {
        std::fs::remove_file(&old).map_err(|e| err("SETUP_WRITE_FAILED", format!("{}: {e}", old.display())))?;
    }
    win::reg_delete_tree(&places.nsis_key()).map_err(|e| err("SETUP_REGISTRY_FAILED", e))
}

/// Deletes only a folder with the expected name, so a wrong path cannot reach another folder; retries for 3 s like `move_legacy`.
fn remove_dir(dir: &Path, expected: &str, code: &'static str) -> Result<(), PortErr> {
    if dir.file_name().and_then(|n| n.to_str()) != Some(expected) {
        return Err(err(code, format!("unexpected folder: {}", dir.display())));
    }
    let until = Instant::now() + Duration::from_secs(3);
    loop {
        match std::fs::remove_dir_all(dir) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) if Instant::now() >= until => return Err(err(code, format!("{}: {e}", dir.display()))),
            Err(_) => std::thread::sleep(Duration::from_millis(200)),
        }
    }
}

type Progress<'a> = &'a dyn Fn(usize, usize);

fn install(ctx: &Ctx, desktop: bool, progress: Progress) -> Result<(), PortErr> {
    let p = &ctx.places;
    // An existing desktop shortcut of ours is rewritten too, so it does not keep the old app id.
    let steps = install_steps(desktop || is_our_link(&p.desktop.join(LINK), &p.exe()));
    let total = steps.len();
    for (i, step) in steps.into_iter().enumerate() {
        match step {
            InstallStep::CloseApp => close_app(p, false)?,
            InstallStep::LegacyData => legacy_data(ctx)?,
            InstallStep::WriteExe => write_exe(&ctx.this_exe, p)?,
            InstallStep::WriteNotices => {
                let bytes = ctx.notices.lock().ok().and_then(|n| n.clone()).ok_or_else(|| err("SETUP_NOTICES_MISSING", NOTICES))?;
                write_atomic(&p.install_dir.join(NOTICES), |tmp| std::fs::write(tmp, &bytes))?
            }
            InstallStep::StartShortcut => link(ctx, &p.start_menu)?,
            InstallStep::DesktopShortcut => link(ctx, &p.desktop)?,
            InstallStep::UninstallEntry => {
                let size = [p.exe(), p.install_dir.join(NOTICES)].iter().filter_map(|f| std::fs::metadata(f).ok()).map(|m| m.len()).sum::<u64>();
                let values = entry(p, &ctx.version, &ctx.publisher, (size / 1024) as u32);
                win::reg_write(&p.uninstall_key(), &values).map_err(|e| err("SETUP_REGISTRY_FAILED", e))?
            }
            InstallStep::NsisLeftovers => nsis_leftovers(p)?,
        }
        progress(i + 1, total);
    }
    Ok(())
}

fn uninstall(ctx: &Ctx, remove_data: bool, progress: Progress) -> Result<(), PortErr> {
    let p = &ctx.places;
    let steps = uninstall_steps(remove_data);
    let total = steps.len();
    for (i, step) in steps.into_iter().enumerate() {
        match step {
            UninstallStep::CloseApp => close_app(p, false)?,
            UninstallStep::Shortcuts => {
                remove_link_if_ours(&p.start_menu.join(LINK), &p.exe())?;
                remove_link_if_ours(&p.desktop.join(LINK), &p.exe())?
            }
            UninstallStep::RunValue => win::reg_delete_value(&p.run_key(), "Postbell").map_err(|e| err("UNINSTALL_REGISTRY_FAILED", e))?,
            UninstallStep::UninstallEntry => win::reg_delete_tree(&p.uninstall_key()).map_err(|e| err("UNINSTALL_REGISTRY_FAILED", e))?,
            UninstallStep::NsisLeftovers => nsis_leftovers(p)?,
            UninstallStep::InstallDir => remove_dir(&p.install_dir, PRODUCT_DIR, "UNINSTALL_DIR_LOCKED")?,
            UninstallStep::Data => {
                remove_dir(&p.data_roaming, &ctx.identifier, "UNINSTALL_DATA_LOCKED")?;
                remove_dir(&p.data_local, &ctx.identifier, "UNINSTALL_DATA_LOCKED")?;
                remove_dir(&p.legacy_roaming, LEGACY_IDENTIFIER, "UNINSTALL_DATA_LOCKED")?;
                remove_dir(&p.legacy_local, LEGACY_IDENTIFIER, "UNINSTALL_DATA_LOCKED")?
            }
        }
        progress(i + 1, total);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct SetupInfo {
    mode: &'static str,
    version: String,
    installed: Installed,
}

#[tauri::command]
pub fn setup_state(ctx: State<Arc<Ctx>>) -> SetupInfo {
    let found = ctx.places.exe().exists().then(|| win::file_version(&ctx.places.exe()).unwrap_or_default());
    SetupInfo {
        mode: if ctx.mode == Mode::Uninstall { "uninstall" } else { "setup" },
        version: ctx.version.clone(),
        installed: installed(&ctx.version, found.as_deref()),
    }
}

async fn blocking(ctx: Arc<Ctx>, want: Mode, f: impl FnOnce(&Ctx) -> Result<(), PortErr> + Send + 'static) -> Result<(), PortErr> {
    if ctx.mode != want {
        return Err(err("SETUP_WRONG_MODE", format!("{:?}", ctx.mode)));
    }
    tauri::async_runtime::spawn_blocking(move || f(&ctx)).await.map_err(|e| err("SETUP_FAILED", e))?
}

/// Must match `parseProgress` in `src/core/setup.ts`.
#[derive(Clone, Serialize)]
struct ProgressEvent {
    done: usize,
    total: usize,
}

fn emitter(app: AppHandle) -> impl Fn(usize, usize) {
    move |done, total| {
        let _ = app.emit_to("setup", "setup-progress", ProgressEvent { done, total });
    }
}

#[tauri::command]
pub async fn setup_install(app: AppHandle, desktop: bool, ctx: State<'_, Arc<Ctx>>) -> Result<(), PortErr> {
    blocking(ctx.inner().clone(), Mode::Setup, move |c| install(c, desktop, &emitter(app))).await
}

#[tauri::command]
pub async fn setup_uninstall(app: AppHandle, remove_data: bool, ctx: State<'_, Arc<Ctx>>) -> Result<(), PortErr> {
    blocking(ctx.inner().clone(), Mode::Uninstall, move |c| uninstall(c, remove_data, &emitter(app))).await
}

#[tauri::command]
pub async fn setup_close_app(ctx: State<'_, Arc<Ctx>>) -> Result<(), PortErr> {
    let ctx = ctx.inner().clone();
    tauri::async_runtime::spawn_blocking(move || close_app(&ctx.places, true)).await.map_err(|e| err("SETUP_FAILED", e))?
}

#[tauri::command]
pub fn setup_open_app(app: AppHandle, ctx: State<Arc<Ctx>>) -> Result<(), PortErr> {
    match &ctx.test_root {
        Some(root) => std::fs::write(root.join("opened.txt"), ctx.places.exe().display().to_string()).map_err(|e| err("SETUP_OPEN_FAILED", e))?,
        None => {
            std::process::Command::new(ctx.places.exe()).current_dir(&ctx.places.install_dir).spawn().map_err(|e| err("SETUP_OPEN_FAILED", e))?;
        }
    }
    app.exit(0);
    Ok(())
}

pub fn relaunch_from_temp(args: &[String]) -> ! {
    let run = || -> std::io::Result<()> {
        let me = std::env::current_exe()?;
        let tmp = std::env::temp_dir().join(format!("Postbell-uninstall-{}.exe", std::process::id()));
        std::fs::copy(&me, &tmp)?;
        let rest = args.iter().skip(1).map(|a| if a == "--uninstall" { "--uninstall-ui" } else { a.as_str() });
        std::process::Command::new(&tmp).args(rest).spawn().map(|_| ())
    };
    match run() {
        Ok(()) => std::process::exit(0),
        Err(e) => {
            win::message_box(&format!("Postbell kaldırılamadı: geçici kopya açılmadı.\n\nUNINSTALL_RELAUNCH_FAILED: {e}"), "Postbell", false);
            std::process::exit(1)
        }
    }
}

pub fn cleanup_on_exit(ctx: &Ctx) {
    let files: Vec<PathBuf> = if ctx.mode == Mode::Uninstall { vec![ctx.this_exe.clone()] } else { vec![] };
    win::delete_after_exit(&[ctx.webview_dir.clone()], &files);
}

pub fn webview_missing(detail: &str) -> ! {
    let text = format!(
        "Postbell'in penceresi açılamadı. Microsoft Edge WebView2 Runtime kurulu olmayabilir.\n\nİndirme sayfası açılsın mı?\n\nWINDOW_CREATE_FAILED: {detail}"
    );
    if win::message_box(&text, "Postbell", true) {
        let _ = crate::open::open_url("https://developer.microsoft.com/microsoft-edge/webview2/");
    }
    std::process::exit(1)
}

pub fn context(args: &[String], mode: Mode, version: &str, identifier: &str, publisher: &str) -> Result<Ctx, String> {
    let test_root = root_of(args)?;
    let places = match &test_root {
        Some(root) => Places::under(root, identifier),
        None => Places::real(identifier).ok_or("SETUP_FOLDERS_MISSING: Windows'un bilinen klasörleri okunamadı")?,
    };
    Ok(Ctx {
        mode,
        places,
        this_exe: std::env::current_exe().map_err(|e| format!("SETUP_EXE_MISSING: {e}"))?,
        version: version.into(),
        identifier: identifier.into(),
        publisher: publisher.into(),
        test_root,
        notices: Mutex::new(None),
        webview_dir: std::env::temp_dir().join(format!("Postbell-setup-{}", std::process::id())),
    })
}

/// Counts as installed when the known folders cannot be read, so a normal launch never turns into setup.
pub fn at_install_path(identifier: &str) -> bool {
    match (Places::real(identifier), std::env::current_exe()) {
        (Some(p), Ok(me)) => win::same_path(&me, &p.exe()),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn identifier() -> String {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        conf["identifier"].as_str().unwrap().to_string()
    }

    #[test]
    fn mode_follows_flags_then_place() {
        assert_eq!(mode_of(&args(&["x"]), false, true), Mode::Setup);
        assert_eq!(mode_of(&args(&["x"]), true, true), Mode::App);
        // A debug build launched without flags is the app, not setup.
        assert_eq!(mode_of(&args(&["x"]), false, false), Mode::App);
        // A launch with flags (self-test, data folder) is the app anywhere.
        assert_eq!(mode_of(&args(&["x", "--self-test", "r.json"]), false, true), Mode::App);
        assert_eq!(mode_of(&args(&["x", "--setup"]), true, false), Mode::Setup);
        assert_eq!(mode_of(&args(&["x", "--uninstall"]), true, true), Mode::UninstallRelaunch);
        assert_eq!(mode_of(&args(&["x", "--uninstall-ui"]), false, true), Mode::Uninstall);
        assert_eq!(mode_of(&args(&["x", "--quit"]), true, true), Mode::Quit);
    }

    #[test]
    fn root_needs_its_value() {
        assert_eq!(root_of(&args(&["x"])), Ok(None));
        assert_eq!(root_of(&args(&["x", "--setup-root", "C:/t"])), Ok(Some(PathBuf::from("C:/t"))));
        assert!(root_of(&args(&["x", "--setup-root"])).is_err());
        assert!(root_of(&args(&["x", "--setup-root", "--setup"])).is_err());
    }

    #[test]
    fn installed_compares_versions() {
        assert_eq!(installed("0.1.1", None), Installed::None);
        assert_eq!(installed("0.1.1", Some("0.1.0")), Installed::Older { version: "0.1.0".into() });
        assert_eq!(installed("0.1.1", Some("0.1.1")), Installed::Same { version: "0.1.1".into() });
        assert_eq!(installed("0.1.1", Some("0.2.0")), Installed::Newer { version: "0.2.0".into() });
        assert_eq!(installed("0.1.1", Some("0.1.10")), Installed::Newer { version: "0.1.10".into() });
        // An installed exe with an unreadable version counts as older.
        assert_eq!(installed("0.1.1", Some("")), Installed::Older { version: "".into() });
        assert!(!knows_quit("0.1.0") && knows_quit("0.1.1") && knows_quit("1.0.0") && !knows_quit(""));
    }

    #[test]
    fn installed_serializes_to_contract() {
        // Must match `src/core/setup.test.ts`.
        let v = serde_json::to_value(Installed::Older { version: "0.1.0".into() }).unwrap();
        assert_eq!(v, serde_json::json!({ "kind": "older", "version": "0.1.0" }));
        assert_eq!(serde_json::to_value(Installed::None).unwrap(), serde_json::json!({ "kind": "none" }));
    }

    #[test]
    fn steps_keep_data_out_of_install() {
        use InstallStep::*;
        assert_eq!(install_steps(false), vec![CloseApp, LegacyData, WriteExe, WriteNotices, StartShortcut, UninstallEntry, NsisLeftovers]);
        assert!(install_steps(true).contains(&DesktopShortcut));
        assert!(!uninstall_steps(false).contains(&UninstallStep::Data));
        assert_eq!(uninstall_steps(true).last(), Some(&UninstallStep::Data));
        assert_eq!(uninstall_steps(true).first(), Some(&UninstallStep::CloseApp));
    }

    #[test]
    fn publisher_matches_config() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["bundle"]["publisher"], PUBLISHER);
    }

    #[test]
    fn entry_points_uninstall_at_installed_exe() {
        let p = Places::under(Path::new(r"C:\t"), &identifier());
        let e = entry(&p, "0.1.1", PUBLISHER, 3712);
        let get = |name: &str| e.iter().find(|(n, _)| *n == name).map(|(_, v)| v.clone());
        assert_eq!(get("UninstallString"), Some(RegValue::Str(r#""C:\t\Local\Postbell\postbell.exe" --uninstall"#.into())));
        assert_eq!(get("DisplayVersion"), Some(RegValue::Str("0.1.1".into())));
        assert_eq!(get("EstimatedSize"), Some(RegValue::Dword(3712)));
        assert!(p.uninstall_key().starts_with(TEST_REG_PREFIX));
        assert!(p.run_key().starts_with(TEST_REG_PREFIX) && p.nsis_key().starts_with(TEST_REG_PREFIX));
        assert!(p.notification_key("x").starts_with(TEST_REG_PREFIX));
    }

    #[test]
    fn identifier_left_the_legacy_one() {
        let id = identifier();
        assert_ne!(id, LEGACY_IDENTIFIER);
        let p = Places::under(Path::new(r"C:\t"), &id);
        assert_eq!(p.legacy_roaming, Path::new(r"C:\t\Roaming").join(LEGACY_IDENTIFIER));
        assert_eq!(p.legacy_local.parent(), p.data_local.parent());
    }

    /// No legacy folder; only legacy (renamed); both (new wins, missing items move, non-empty legacy stays); a second run.
    #[test]
    fn legacy_folder_moves_without_overwriting() {
        let root = std::env::temp_dir().join(format!("postbell-legacy-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (old, new) = (root.join("old"), root.join("Roaming").join("new"));
        move_legacy(&old, &new).unwrap();
        assert!(!new.exists(), "nothing to do without a legacy folder");

        std::fs::create_dir_all(old.join("logs")).unwrap();
        std::fs::write(old.join("logs").join("a.log"), b"old").unwrap();
        std::fs::write(old.join("flag"), b"1").unwrap();
        move_legacy(&old, &new).unwrap();
        assert!(!old.exists() && std::fs::read(new.join("logs").join("a.log")).unwrap() == b"old" && new.join("flag").exists());

        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("flag"), b"legacy").unwrap();
        std::fs::write(old.join("only-old"), b"x").unwrap();
        move_legacy(&old, &new).unwrap();
        assert_eq!(std::fs::read(new.join("flag")).unwrap(), b"1", "the new copy is not overwritten");
        assert!(new.join("only-old").exists() && old.join("flag").exists() && !old.join("only-old").exists());
        move_legacy(&old, &new).unwrap();
        assert_eq!(std::fs::read(new.join("flag")).unwrap(), b"1");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Real Windows calls under a test root, writing to HKCU only under `TEST_REG_PREFIX`; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn install_and_uninstall_under_test_root() {
        let root = std::env::temp_dir().join(format!("postbell-setup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let src = root.join("Downloads").join("Postbell_0.1.1_x64-setup.exe");
        std::fs::create_dir_all(src.parent().unwrap()).unwrap();
        std::fs::copy(std::env::current_exe().unwrap(), &src).unwrap();
        let mut ctx = context(&args(&["x", "--setup-root", &root.to_string_lossy()]), Mode::Setup, "0.1.1", &identifier(), PUBLISHER).unwrap();
        ctx.this_exe = src.clone();
        *ctx.notices.lock().unwrap() = Some(b"notices".to_vec());
        let p = ctx.places.clone();
        // NSIS leftovers: the old uninstaller and key.
        std::fs::create_dir_all(&p.install_dir).unwrap();
        std::fs::write(p.install_dir.join("uninstall.exe"), b"old").unwrap();
        win::reg_write(&p.nsis_key(), &[("Installer Language", RegValue::Str("1055".into()))]).unwrap();
        // Store data: setup leaves it alone.
        std::fs::create_dir_all(&p.data_roaming).unwrap();
        std::fs::write(p.data_roaming.join("store.json"), b"{}").unwrap();
        // Legacy data and notification setting: setup moves them.
        std::fs::create_dir_all(p.legacy_local.join("EBWebView")).unwrap();
        win::reg_write(&p.notification_key(LEGACY_IDENTIFIER), &[("Enabled", RegValue::Dword(0))]).unwrap();

        // Progress once per step, the last one (total, total).
        let seen = std::cell::RefCell::new(Vec::new());
        let record = |done, total| seen.borrow_mut().push((done, total));
        install(&ctx, true, &record).unwrap();
        assert_eq!(*seen.borrow(), (1..=8).map(|d| (d, 8)).collect::<Vec<_>>());
        install(&ctx, false, &|_, _| {}).unwrap();
        assert_eq!(std::fs::read(p.exe()).unwrap(), std::fs::read(&src).unwrap());
        assert_eq!(std::fs::read(p.install_dir.join(NOTICES)).unwrap(), b"notices");
        assert!(!p.install_dir.join("uninstall.exe").exists());
        assert!(win::same_path(&win::shortcut_target(&p.start_menu.join(LINK)).unwrap(), &p.exe()));
        assert!(p.desktop.join(LINK).exists());
        assert!(p.data_roaming.join("store.json").exists());
        assert!(!p.legacy_local.exists() && p.data_local.join("EBWebView").exists(), "legacy WebView2 folder moved");
        assert!(win::reg_copy_tree_if_missing(&p.notification_key(LEGACY_IDENTIFIER), &p.notification_key(&ctx.identifier)) == Ok(false), "notification setting copied");
        assert_eq!(installed("0.1.1", win::file_version(&p.exe()).as_deref()), installed("0.1.1", win::file_version(&src).as_deref()));

        let mut un = context(&args(&["x", "--setup-root", &root.to_string_lossy()]), Mode::Uninstall, "0.1.1", &identifier(), PUBLISHER).unwrap();
        un.this_exe = src.clone();
        uninstall(&un, false, &|_, _| {}).unwrap();
        assert!(!p.install_dir.exists() && !p.start_menu.join(LINK).exists() && !p.desktop.join(LINK).exists());
        assert!(p.data_roaming.join("store.json").exists(), "the store stays when data removal is off");
        uninstall(&un, true, &|_, _| {}).unwrap();
        assert!(!p.data_roaming.exists());
        win::reg_delete_tree(TEST_REG_PREFIX.trim_end_matches('\\')).unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }
}
