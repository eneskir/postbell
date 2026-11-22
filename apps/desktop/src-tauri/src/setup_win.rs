use std::path::{Path, PathBuf};
use windows::core::{Interface, GUID, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteKeyValueW, RegDeleteTreeW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_DWORD,
    REG_OPTION_NON_VOLATILE, REG_SZ,
};

pub use windows::Win32::UI::Shell::{FOLDERID_Desktop, FOLDERID_LocalAppData, FOLDERID_Programs, FOLDERID_RoamingAppData, FOLDERID_System};

#[derive(Debug, Clone, PartialEq)]
pub enum RegValue {
    Str(String),
    Dword(u32),
}

/// Follows folder redirection, so a moved Desktop is found.
pub fn known_folder(id: &GUID) -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    // SAFETY: the returned buffer is copied, then freed with the COM allocator.
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        s.map(PathBuf::from)
    }
}

/// A Windows program by full path. A bare name would be looked up in the running exe's folder first, and the setup
/// exe runs from wherever it was downloaded.
pub fn system_exe(name: &str) -> Option<PathBuf> {
    known_folder(&FOLDERID_System).map(|d| d.join(name))
}

fn check(e: WIN32_ERROR, what: &str) -> Result<(), String> {
    if e == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("{what}: {}", e.0))
    }
}

pub fn reg_write(key: &str, values: &[(&str, RegValue)]) -> Result<(), String> {
    let wide = |s: &str| -> Vec<u8> { s.encode_utf16().chain(Some(0)).flat_map(|u| u.to_le_bytes()).collect() };
    // SAFETY: the key handle is closed in this block, and the data slices live through each call.
    unsafe {
        let mut h = HKEY::default();
        check(
            RegCreateKeyExW(HKEY_CURRENT_USER, &HSTRING::from(key), None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, None, &mut h, None),
            "RegCreateKeyExW",
        )?;
        let r = values.iter().try_for_each(|(name, v)| {
            let (kind, data) = match v {
                RegValue::Str(s) => (REG_SZ, wide(s)),
                RegValue::Dword(d) => (REG_DWORD, d.to_le_bytes().to_vec()),
            };
            check(RegSetValueExW(h, &HSTRING::from(*name), None, kind, Some(&data)), name)
        });
        let _ = RegCloseKey(h);
        r
    }
}

pub fn reg_delete_tree(key: &str) -> Result<(), String> {
    // SAFETY: only strings are passed.
    let e = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(key)) };
    if e == ERROR_FILE_NOT_FOUND {
        return Ok(());
    }
    check(e, "RegDeleteTreeW")
}

pub fn reg_copy_tree_if_missing(from: &str, to: &str) -> Result<bool, String> {
    use windows::Win32::System::Registry::{RegCopyTreeW, RegOpenKeyExW, KEY_ALL_ACCESS, KEY_READ};
    // SAFETY: every opened handle is closed in this block.
    unsafe {
        let mut probe = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(to), None, KEY_READ, &mut probe) == ERROR_SUCCESS {
            let _ = RegCloseKey(probe);
            return Ok(false);
        }
        let mut src = HKEY::default();
        let e = RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(from), None, KEY_READ, &mut src);
        if e == ERROR_FILE_NOT_FOUND {
            return Ok(false);
        }
        check(e, "RegOpenKeyExW")?;
        // `RegCopyTreeW` returns ERROR_ACCESS_DENIED when the target is opened with `KEY_WRITE`; it needs `KEY_ALL_ACCESS`.
        let mut dst = HKEY::default();
        let r = check(
            RegCreateKeyExW(HKEY_CURRENT_USER, &HSTRING::from(to), None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_ALL_ACCESS, None, &mut dst, None),
            "RegCreateKeyExW",
        )
        .and_then(|()| {
            let r = check(RegCopyTreeW(src, PCWSTR::null(), dst), "RegCopyTreeW");
            let _ = RegCloseKey(dst);
            r
        });
        let _ = RegCloseKey(src);
        r.map(|()| true)
    }
}

pub fn reg_delete_value(key: &str, name: &str) -> Result<(), String> {
    // SAFETY: only strings are passed.
    let e = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(key), &HSTRING::from(name)) };
    if e == ERROR_FILE_NOT_FOUND {
        return Ok(());
    }
    check(e, "RegDeleteKeyValueW")
}

/// Initializes COM for `f` and uninitializes only if this call did; a thread already in the MTA can still use COM.
pub(crate) fn com<T>(f: impl FnOnce() -> windows::core::Result<T>) -> Result<T, String> {
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    // SAFETY: init and uninit happen here, and the interfaces drop inside `f` first.
    unsafe {
        let started = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).is_ok();
        let r = f();
        if started {
            CoUninitialize();
        }
        r.map_err(|e| e.message().to_string())
    }
}

/// The shortcut's `System.AppUserModel.ID` must match the toast app id in `alarms.rs`, or Windows does not show toasts.
pub fn create_shortcut(lnk: &Path, target: &Path, workdir: &Path, aumid: &str) -> Result<(), String> {
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER};
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    com(|| unsafe {
        // SAFETY: `id` outlives `SetValue`, which copies it. Dropping a PROPVARIANT calls `PropVariantClear`,
        // which would free the Rust-owned string with the COM allocator, hence `ManuallyDrop`.
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        link.SetPath(&HSTRING::from(target.as_os_str()))?;
        link.SetWorkingDirectory(&HSTRING::from(workdir.as_os_str()))?;
        link.SetIconLocation(&HSTRING::from(target.as_os_str()), 0)?;
        let store: IPropertyStore = link.cast()?;
        let mut id: Vec<u16> = aumid.encode_utf16().chain(Some(0)).collect();
        let mut value = std::mem::ManuallyDrop::new(PROPVARIANT::default());
        (*value.Anonymous.Anonymous).vt = VT_LPWSTR;
        (*value.Anonymous.Anonymous).Anonymous.pwszVal = PWSTR(id.as_mut_ptr());
        store.SetValue(&PKEY_AppUserModel_ID, &*value)?;
        store.Commit()?;
        let file: IPersistFile = link.cast()?;
        file.Save(&HSTRING::from(lnk.as_os_str()), true)
    })
}

pub fn shortcut_target(lnk: &Path) -> Option<PathBuf> {
    use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    com(|| unsafe {
        // SAFETY: the buffer lives through the call, and no find data is requested (null pointer).
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        let file: IPersistFile = link.cast()?;
        file.Load(&HSTRING::from(lnk.as_os_str()), STGM_READ)?;
        let mut buf = vec![0u16; 32768];
        link.GetPath(&mut buf, std::ptr::null_mut(), 0)?;
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Ok(PathBuf::from(String::from_utf16_lossy(&buf[..len])))
    })
    .ok()
    .filter(|p| !p.as_os_str().is_empty())
}

/// The installed version comes from the exe, not the registry: an uninstall entry can be missing while the exe is always there.
pub fn file_version(exe: &Path) -> Option<String> {
    use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO};
    let name = HSTRING::from(exe.as_os_str());
    // SAFETY: the buffer has the size the system reported, and the returned pointer points into it while it lives.
    unsafe {
        let size = GetFileVersionInfoSizeW(&name, None);
        if size == 0 {
            return None;
        }
        let mut buf = vec![0u8; size as usize];
        GetFileVersionInfoW(&name, None, size, buf.as_mut_ptr() as *mut _).ok()?;
        let mut ptr = std::ptr::null_mut();
        let mut len = 0u32;
        if !VerQueryValueW(buf.as_ptr() as *const _, windows::core::w!("\\"), &mut ptr, &mut len).as_bool() || ptr.is_null() {
            return None;
        }
        let info = &*(ptr as *const VS_FIXEDFILEINFO);
        Some(format!("{}.{}.{}", info.dwFileVersionMS >> 16, info.dwFileVersionMS & 0xffff, info.dwFileVersionLS >> 16))
    }
}

/// Windows paths are case-insensitive; only ASCII is lowered, because full Unicode lowering can change the length.
pub fn same_path(a: &Path, b: &Path) -> bool {
    let n = |p: &Path| p.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
    n(a) == n(b)
}

pub fn processes_with_image(exe: &Path) -> Vec<u32> {
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let Some(name) = exe.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()) else { return vec![] };
    let me = std::process::id();
    let mut out = vec![];
    // SAFETY: the snapshot handle is closed in this block, and the entry starts with the size the system expects.
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snap, &mut e).is_ok();
        while more {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            if e.th32ProcessID != me && String::from_utf16_lossy(&e.szExeFile[..len]).to_ascii_lowercase() == name {
                if image_path(e.th32ProcessID).is_some_and(|p| same_path(&p, exe)) {
                    out.push(e.th32ProcessID);
                }
            }
            more = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}

fn image_path(pid: u32) -> Option<PathBuf> {
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    // SAFETY: the handle is closed in this block, and the buffer length goes to the call.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 32768];
        let mut len = buf.len() as u32;
        let r = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(h);
        r.ok()?;
        Some(PathBuf::from(String::from_utf16_lossy(&buf[..len as usize])))
    }
}

/// A killed process can leave its tray icon until hovered, so `setup::close_app` tries `--quit` first.
pub fn terminate(pid: u32) -> bool {
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE};
    // SAFETY: the handle is closed in this block.
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, false, pid) else { return false };
        let ok = TerminateProcess(h, 1).is_ok();
        let _ = WaitForSingleObject(h, 3000);
        let _ = CloseHandle(h);
        ok
    }
}

/// Shown when the UI cannot render; returns `true` if the user chose Yes.
pub fn message_box(text: &str, caption: &str, ask: bool) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_OK, MB_YESNO};
    let style = if ask { MB_YESNO | MB_ICONERROR } else { MB_OK | MB_ICONERROR };
    // SAFETY: only strings are passed.
    unsafe { MessageBoxW(None, &HSTRING::from(text), &HSTRING::from(caption), style) == IDYES }
}

/// The running exe and WebView2's folder stay locked while this process lives, so a hidden `cmd` deletes them later.
/// The paths are the app's own, and Windows paths cannot contain quotes.
pub fn delete_after_exit(dirs: &[PathBuf], files: &[PathBuf]) {
    if let Some(mut command) = delete_command(dirs, files) {
        // Runs as the process exits, with no log or window left to report to; a leftover in the temp folder does no harm.
        let _ = command.spawn();
    }
}

/// Runs from the System folder: `cmd` looks for `ping` in its working folder before PATH, and this process's working
/// folder is usually the download folder the setup exe was started from.
pub fn delete_command(dirs: &[PathBuf], files: &[PathBuf]) -> Option<std::process::Command> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let cmd = system_exe("cmd.exe")?;
    let mut line = String::from("/d /c ping -n 3 127.0.0.1 >nul");
    for d in dirs {
        line.push_str(&format!(" & rmdir /s /q \"{}\"", d.display()));
    }
    for f in files {
        line.push_str(&format!(" & del /f /q \"{}\"", f.display()));
    }
    let mut command = std::process::Command::new(&cmd);
    command.raw_arg(line).creation_flags(CREATE_NO_WINDOW).current_dir(cmd.parent()?);
    Some(command)
}
