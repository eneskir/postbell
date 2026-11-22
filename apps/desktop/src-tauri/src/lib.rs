mod alarms;
mod dialog;
mod log;
mod media;
mod open;
mod packages;
mod restore;
#[cfg(windows)]
mod setup;
#[cfg(windows)]
mod setup_win;
mod store;
mod tray;
mod vault;

use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use store::PortErr;
use tauri::{AppHandle, Manager, State};

/// Sent to the UI; the shape is a contract with `parseAppInfo` in `src/core/app-info.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

/// Command-line flags:
/// - `--self-test <file>`: never shows the window; writes the rendered text and `AppInfo` to the file, then exits.
/// - `--self-test-add-record`: the UI adds a trial record during self-test.
/// - `--self-test-stay`: keeps running, hidden, after the report.
/// - `--data-dir <folder>`: keeps the store here instead of the app data folder.
#[derive(Debug, Default, PartialEq)]
pub struct Options {
    pub self_test: Option<PathBuf>,
    pub add_record: bool,
    pub stay: bool,
    pub data_dir: Option<PathBuf>,
}

pub fn parse_args(args: &[String]) -> Result<Options, String> {
    let value = |flag: &str, code: &str| -> Result<Option<PathBuf>, String> {
        match args.iter().position(|a| a == flag) {
            None => Ok(None),
            Some(i) => match args.get(i + 1) {
                Some(p) if !p.starts_with("--") => Ok(Some(PathBuf::from(p))),
                _ => Err(format!("{code}: {flag} needs a path")),
            },
        }
    };
    let o = Options {
        self_test: value("--self-test", "SELF_TEST_PATH_MISSING")?,
        add_record: args.iter().any(|a| a == "--self-test-add-record"),
        stay: args.iter().any(|a| a == "--self-test-stay"),
        data_dir: value("--data-dir", "DATA_DIR_MISSING")?,
    };
    if (o.add_record || o.stay) && o.self_test.is_none() {
        return Err("SELF_TEST_FLAG_ALONE: --self-test-add-record and --self-test-stay need --self-test".into());
    }
    Ok(o)
}

struct DataDir(PathBuf);
struct Registry(Mutex<packages::Registry>);

impl Registry {
    fn allow_list(&self) -> Result<MutexGuard<'_, packages::Registry>, PortErr> {
        self.0.lock().map_err(|_| PortErr::new("FOLDER_READ", "allow list is locked"))
    }
}

#[derive(Serialize)]
struct SelfTestReport<'a> {
    app_info: &'a AppInfo,
    rendered: &'a str,
}

#[derive(Serialize)]
struct SelfTestOptions {
    active: bool,
    add_record: bool,
}

#[derive(Serialize)]
struct StoreText {
    path: String,
    text: Option<String>,
}

fn info(app: &AppHandle) -> AppInfo {
    let p = app.package_info();
    AppInfo { name: p.name.clone(), version: p.version.to_string() }
}

fn remember_folders(registry: &Registry, text: &str) {
    if let Ok(mut r) = registry.0.lock() {
        r.set(store::brand_folders(text));
    }
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    info(&app)
}

#[tauri::command]
fn self_test_options(options: State<Options>) -> SelfTestOptions {
    SelfTestOptions { active: options.self_test.is_some(), add_record: options.add_record }
}

#[tauri::command]
fn store_load(dir: State<DataDir>, registry: State<Registry>) -> Result<StoreText, PortErr> {
    let text = store::load(&dir.0)?;
    if let Some(t) = &text {
        remember_folders(&registry, t);
    }
    Ok(StoreText { path: store::path(&dir.0).to_string_lossy().into_owned(), text })
}

#[tauri::command]
fn store_save(text: String, dir: State<DataDir>, registry: State<Registry>) -> Result<(), PortErr> {
    store::save(&dir.0, &text)?;
    remember_folders(&registry, &text);
    Ok(())
}

#[tauri::command]
fn store_backup(dir: State<DataDir>) -> Result<String, PortErr> {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    store::backup(&dir.0, secs).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn packages_read(folder: String, registry: State<Registry>) -> Result<Vec<packages::PackageDir>, PortErr> {
    packages::read(&*registry.allow_list()?, &folder)
}

#[tauri::command]
fn file_reveal(folder: String, path: String, registry: State<Registry>) -> Result<(), PortErr> {
    let target = open::reveal_target(&*registry.allow_list()?, &folder, &path)?;
    open::reveal(&target)
}

/// The target is resolved again after the dialog, because the store may change while it is open.
#[tauri::command]
async fn file_restore(app: AppHandle, folder: String, path: String) -> Result<&'static str, PortErr> {
    let target = || restore::restore_target(&*app.state::<Registry>().allow_list()?, &folder, &path);
    let Some(first) = target()? else { return Ok("present") };
    let name = first.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let owner = dialog_owner(&app)?;
    let picked = tauri::async_runtime::spawn_blocking(move || dialog::pick_file(owner, &name))
        .await
        .map_err(|e| PortErr::new("DIALOG_FAILED", e))??;
    let Some(source) = picked else { return Ok("cancelled") };
    let Some(dest) = target()? else { return Ok("present") };
    tauri::async_runtime::spawn_blocking(move || restore::copy_into(std::path::Path::new(&source), &dest))
        .await
        .map_err(|e| PortErr::new("FILE_WRITE", e))??;
    Ok("copied")
}

#[tauri::command]
fn share_page_open(platform: String, text: String) -> Result<&'static str, PortErr> {
    let (url, dropped) = open::share_url(&platform, &text).ok_or_else(|| PortErr::new("OPEN_FAILED", format!("unknown platform: {platform}")))?;
    open::open_url(&url)?;
    Ok(if dropped { "text-dropped" } else { "opened" })
}

/// Parses a command's JSON text argument. Errors name only the kind and position: serde's own message can quote values, which must not reach the log.
fn parse_json<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, String> {
    serde_json::from_str(text).map_err(|e| format!("{:?}, line {}, column {}", e.classify(), e.line(), e.column()))
}

/// The plan arrives as JSON text because Tauri never calls a command whose typed argument fails to parse, so the failure would not be logged.
#[tauri::command]
fn alarms_set(plan: String, service: State<Arc<alarms::Service>>, log: State<Arc<log::Log>>) -> Result<(), PortErr> {
    match parse_json::<alarms::Plan>(&plan) {
        Ok(plan) => {
            let n = service.set(plan);
            log.line(&format!("alarms: {n}"));
            Ok(())
        }
        Err(e) => {
            log.line(&format!("ALARMS_REJECTED: {e}"));
            Err(PortErr::new("ALARMS_REJECTED", e))
        }
    }
}

/// Texts arrive as JSON text for the same reason as `alarms_set`.
#[tauri::command]
fn tray_set(app: AppHandle, texts: String, tray: State<tray::Tray>, options: State<Options>, log: State<Arc<log::Log>>) -> Result<(), PortErr> {
    let texts = parse_json::<tray::Texts>(&texts).map_err(|e| {
        log.line(&format!("TRAY_REJECTED: {e}"));
        PortErr::new("TRAY_REJECTED", e)
    })?;
    if options.self_test.is_some() {
        log.line("tray: off (self-test)");
        return Ok(());
    }
    tray::set(&app, &tray, texts).map_err(|e| {
        log.line(&format!("TRAY_FAILED: {e}"));
        PortErr::new("TRAY_FAILED", e)
    })?;
    log.line("tray: on");
    Ok(())
}

/// A vault failure is logged with its code and detail, which never carry a secret (`vault::port_err`).
fn logged<T>(log: &log::Log, r: Result<T, PortErr>) -> Result<T, PortErr> {
    if let Err(e) = &r {
        log.line(&format!("{}: {}", e.code, e.detail));
    }
    r
}

#[tauri::command]
fn vault_status(accounts: Vec<String>, vault: State<vault::Vault>, log: State<Arc<log::Log>>) -> Result<Vec<vault::Status>, PortErr> {
    logged(&log, vault.status(&accounts))
}

#[tauri::command]
fn vault_write(
    account: String,
    password: Option<vault::Secret>,
    codes: Option<Vec<vault::Secret>>,
    replace: bool,
    vault: State<vault::Vault>,
    log: State<Arc<log::Log>>,
) -> Result<(), PortErr> {
    logged(&log, vault.write(&account, password, codes, replace))
}

/// The only command that hands a secret to the UI, which shows it for 30 seconds.
#[tauri::command]
fn vault_password(account: String, vault: State<vault::Vault>, log: State<Arc<log::Log>>) -> Result<vault::Secret, PortErr> {
    logged(&log, vault.password(&account))
}

#[tauri::command]
fn vault_copy(account: String, vault: State<vault::Vault>, log: State<Arc<log::Log>>) -> Result<(), PortErr> {
    logged(&log, vault.password(&account).and_then(|p| vault::copy(p, vault::CLEAR_AFTER)))
}

#[tauri::command]
fn vault_delete(account: String, vault: State<vault::Vault>, log: State<Arc<log::Log>>) -> Result<(), PortErr> {
    logged(&log, vault.delete(&account))
}

#[tauri::command]
async fn dialog_pick_folder(app: AppHandle) -> Result<Option<String>, PortErr> {
    let owner = dialog_owner(&app)?;
    tauri::async_runtime::spawn_blocking(move || dialog::pick_folder(owner))
        .await
        .map_err(|e| PortErr::new("DIALOG_FAILED", e))?
}

/// The main window's handle, which owns the pickers.
#[cfg(windows)]
fn dialog_owner(app: &AppHandle) -> Result<isize, PortErr> {
    let window = app.get_webview_window("main").ok_or_else(|| PortErr::new("DIALOG_FAILED", "WINDOW_MISSING"))?;
    window.hwnd().map(|h| h.0 as isize).map_err(|e| PortErr::new("DIALOG_FAILED", e))
}

/// The pickers are Windows-only, so they need no owner here.
#[cfg(not(windows))]
fn dialog_owner(_app: &AppHandle) -> Result<isize, PortErr> {
    Ok(0)
}

#[tauri::command]
fn ready(app: AppHandle, window: tauri::WebviewWindow, rendered: String, options: State<Options>) -> Result<(), String> {
    match &options.self_test {
        Some(path) => {
            let i = info(&app);
            let report = serde_json::to_string_pretty(&SelfTestReport { app_info: &i, rendered: &rendered })
                .map_err(|e| format!("SELF_TEST_SERIALIZE: {e}"))?;
            std::fs::write(path, report).map_err(|e| format!("SELF_TEST_WRITE: {e}"))?;
            if !options.stay {
                app.exit(0);
            }
            Ok(())
        }
        None => {
            let r = window
                .show()
                .map_err(|e| format!("WINDOW_SHOW: {e}"))
                .and_then(|()| window.set_focus().map_err(|e| format!("WINDOW_FOCUS: {e}")));
            // The window may still be hidden, so the UI cannot show this error; the log keeps it.
            if let (Err(e), Some(log)) = (&r, app.try_state::<Arc<log::Log>>()) {
                log.line(e);
            }
            r
        }
    }
}

/// Each step runs even if an earlier one failed, so a window that cannot be unminimized still shows.
pub(crate) fn show_main(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    for (code, result) in [("WINDOW_UNMINIMIZE", w.unminimize()), ("WINDOW_SHOW", w.show()), ("WINDOW_FOCUS", w.set_focus())] {
        if let (Err(e), Some(log)) = (result, app.try_state::<Arc<log::Log>>()) {
            log.line(&format!("{code}: {e}"));
        }
    }
}

/// `--quit` is honored only from the same exe, so a test copy cannot close the installed app.
fn second_instance(app: &AppHandle, argv: Vec<String>) {
    if argv.iter().any(|a| a == "--quit") {
        #[cfg(windows)]
        if std::env::current_exe().ok().zip(argv.first()).is_some_and(|(me, sender)| setup_win::same_path(&me, std::path::Path::new(sender))) {
            app.exit(0);
        }
        return;
    }
    let options = app.state::<Options>();
    if let Some(report) = &options.self_test {
        let mut mark = report.clone().into_os_string();
        mark.push(".second-instance.json");
        if let (Err(e), Some(log)) = (std::fs::write(PathBuf::from(mark), serde_json::to_string_pretty(&argv).unwrap_or_default()), app.try_state::<Arc<log::Log>>()) {
            log.line(&format!("SELF_TEST_WRITE: {e}"));
        }
        return;
    }
    show_main(app);
}

/// The main window has `create: false` in `tauri.conf.json` so that setup mode never builds it.
fn open_main(app: &tauri::App, log: &log::Log) -> Result<(), Box<dyn std::error::Error>> {
    let config = app.config().app.windows.iter().find(|w| w.label == "main").cloned().ok_or("WINDOW_CONFIG_MISSING")?;
    if let Err(e) = tauri::WebviewWindowBuilder::from_config(app.handle(), &config).and_then(|b| b.build()) {
        log.line(&format!("WINDOW_CREATE_FAILED: {e}"));
        #[cfg(windows)]
        setup::webview_missing(&e.to_string());
        #[cfg(not(windows))]
        return Err(e.into());
    }
    Ok(())
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let options = match parse_args(&args) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    // `generate_context!` embeds the frontend assets, so it runs once for both modes.
    let context = tauri::generate_context!();
    #[cfg(windows)]
    {
        let release = !cfg!(debug_assertions);
        let at_install = args.len() > 1 || !release || setup::at_install_path(&context.config().identifier);
        match setup::mode_of(&args, at_install, release) {
            setup::Mode::UninstallRelaunch => setup::relaunch_from_temp(&args),
            mode @ (setup::Mode::Setup | setup::Mode::Uninstall) => return run_setup(&args, options, context, mode),
            setup::Mode::Quit => return run_app(options, context, true),
            setup::Mode::App => {}
        }
    }
    run_app(options, context, false)
}

#[cfg(windows)]
fn run_setup(args: &[String], options: Options, context: tauri::Context<tauri::Wry>, mode: setup::Mode) {
    let config = context.config();
    let made = setup::context(args, mode, &context.package_info().version.to_string(), &config.identifier, setup::PUBLISHER);
    let ctx = match made {
        Ok(c) => Arc::new(c),
        Err(e) => {
            setup_win::message_box(&e, "Postbell", false);
            std::process::exit(2);
        }
    };
    let app = tauri::Builder::default()
        .manage(options)
        .manage(ctx.clone())
        .setup(|app| {
            let ctx = app.state::<Arc<setup::Ctx>>();
            if let (Some(asset), Ok(mut slot)) = (app.asset_resolver().get(setup::NOTICES.into()), ctx.notices.lock()) {
                *slot = Some(asset.bytes);
            }
            let title = if ctx.mode == setup::Mode::Uninstall { "Postbell'i kaldır" } else { "Postbell kurulumu" };
            let built = tauri::WebviewWindowBuilder::new(app, "setup", tauri::WebviewUrl::App("index.html".into()))
                .title(title)
                .inner_size(560.0, 360.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .shadow(true)
                .center()
                .visible(false)
                .background_color(tauri::window::Color(0x19, 0x19, 0x19, 0xff))
                .data_directory(ctx.webview_dir.clone())
                .build();
            if let Err(e) = built {
                setup::webview_missing(&e.to_string());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            ready,
            self_test_options,
            setup::setup_state,
            setup::setup_install,
            setup::setup_uninstall,
            setup::setup_close_app,
            setup::setup_open_app
        ])
        .build(context)
        .expect("failed to start the setup window");
    app.run(move |_, event| {
        if let tauri::RunEvent::Exit = event {
            setup::cleanup_on_exit(&ctx);
        }
    });
}

/// With `quit`, the single-instance plugin hands `--quit` to a running instance and ends this process; with none running, setup exits at once.
fn run_app(options: Options, context: tauri::Context<tauri::Wry>, quit: bool) {
    let data_dir = options.data_dir.clone();
    let mut builder = tauri::Builder::default();
    // One instance per real data folder keeps a single store writer; a `--data-dir` copy owns its own folder.
    if data_dir.is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| second_instance(app, argv)));
    }
    builder
        .setup(move |app| {
            if quit {
                std::process::exit(0);
            }
            let dir = match data_dir {
                Some(d) => d,
                None => app.path().app_data_dir()?,
            };
            store::cleanup(&dir)?;
            let log = Arc::new(log::Log::new(&dir));
            log.line(&format!("start {}", info(app.handle()).version));
            let service = alarms::Service::new(log::now_ms());
            if app.state::<Options>().self_test.is_none() {
                alarms::spawn(app.handle().clone(), service.clone(), log.clone());
            }
            app.manage(service);
            app.manage(log.clone());
            app.manage(tray::Tray::new(&dir));
            // A test copy (`--data-dir`, `--self-test`) keeps its entries apart from the real ones.
            let options = app.state::<Options>();
            let test = options.data_dir.is_some() || options.self_test.is_some();
            app.manage(vault::Vault::open(if test { "Postbell test" } else { "Postbell" }));
            app.manage(DataDir(dir));
            open_main(app, &log)
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if let (Some(tray), Some(log)) = (app.try_state::<tray::Tray>(), app.try_state::<Arc<log::Log>>()) {
                    if window.label() == "main" && tray::close_requested(window, &tray, &log) {
                        api.prevent_close();
                    }
                }
            }
        })
        .manage(options)
        .manage(Registry(Mutex::new(packages::Registry::default())))
        .register_asynchronous_uri_scheme_protocol(media::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let path = match app.state::<Registry>().0.lock() {
                    Ok(r) => media::resolve(&r, request.uri().path()),
                    Err(_) => Err(tauri::http::StatusCode::INTERNAL_SERVER_ERROR),
                };
                let range = request.headers().get(tauri::http::header::RANGE).and_then(|v| v.to_str().ok());
                responder.respond(media::respond(path, request.method(), range, &app.state::<Arc<log::Log>>()));
            });
        })
        .invoke_handler(tauri::generate_handler![app_info, ready, self_test_options, store_load, store_save, store_backup, packages_read, dialog_pick_folder, file_reveal, file_restore, share_page_open, alarms_set, tray_set, vault_status, vault_write, vault_password, vault_copy, vault_delete])
        .run(context)
        .expect("failed to start Postbell");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn app_info_serializes_to_contract() {
        // Must match `src/core/app-info.test.ts`.
        let v = serde_json::to_value(AppInfo { name: "Postbell".into(), version: "0.1.0".into() }).unwrap();
        assert_eq!(v, serde_json::json!({ "name": "Postbell", "version": "0.1.0" }));
    }

    #[test]
    fn port_error_serializes_to_contract() {
        // Must match `src/core/port.test.ts`.
        let v = serde_json::to_value(PortErr::new("STORE_NEWER_VERSION", "store on disk is version 2")).unwrap();
        assert_eq!(v, serde_json::json!({ "code": "STORE_NEWER_VERSION", "detail": "store on disk is version 2" }));
    }

    #[test]
    fn flags_need_their_values() {
        assert_eq!(parse_args(&args(&["postbell"])), Ok(Options::default()));
        assert_eq!(parse_args(&args(&["postbell", "--self-test", "C:/x.json"])).unwrap().self_test, Some(PathBuf::from("C:/x.json")));
        assert!(parse_args(&args(&["postbell", "--self-test"])).is_err());
        assert!(parse_args(&args(&["postbell", "--self-test", "--other"])).is_err());
        assert!(parse_args(&args(&["postbell", "--data-dir"])).is_err());
        assert!(parse_args(&args(&["postbell", "--self-test-stay"])).is_err());
        let o = parse_args(&args(&["postbell", "--self-test", "r.json", "--self-test-add-record", "--self-test-stay", "--data-dir", "D:/v"])).unwrap();
        assert_eq!(o, Options { self_test: Some("r.json".into()), add_record: true, stay: true, data_dir: Some("D:/v".into()) });
    }
}
