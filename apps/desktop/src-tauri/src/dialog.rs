//! Windows pickers (`IFileOpenDialog`) run on their own thread: COM needs a single-threaded apartment there, and the main event loop must not block.
use crate::store::PortErr;

/// Returns the chosen folder, or `None` if cancelled; `owner` is the parent window handle as an integer so it can cross threads.
#[cfg(windows)]
pub fn pick_folder(owner: isize) -> Result<Option<String>, PortErr> {
    use windows::Win32::UI::Shell::{FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS};
    // SAFETY: `show` runs this on the COM thread before the dialog closes.
    show(owner, |dialog| unsafe { dialog.SetOptions(dialog.GetOptions()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM) })
}

/// Returns the chosen file, or `None` if cancelled; `name` is prefilled and limits the list to its extension.
#[cfg(windows)]
pub fn pick_file(owner: isize, name: &str) -> Result<Option<String>, PortErr> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST};
    let ext = std::path::Path::new(name).extension().map(|e| e.to_string_lossy().into_owned());
    let file = HSTRING::from(name);
    let spec = ext.as_ref().map(|e| (HSTRING::from(format!("{} (*.{e})", e.to_uppercase())), HSTRING::from(format!("*.{e}"))));
    // SAFETY: the filter strings in `spec` outlive the dialog, and `show` runs this with COM initialized.
    show(owner, |dialog| unsafe {
        dialog.SetOptions(dialog.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST)?;
        if let Some((label, pattern)) = &spec {
            dialog.SetFileTypes(&[COMDLG_FILTERSPEC { pszName: PCWSTR(label.as_ptr()), pszSpec: PCWSTR(pattern.as_ptr()) }])?;
        }
        dialog.SetFileName(&file)
    })
}

#[cfg(windows)]
fn show(owner: isize, configure: impl FnOnce(&windows::Win32::UI::Shell::IFileOpenDialog) -> windows::core::Result<()>) -> Result<Option<String>, PortErr> {
    use windows::core::HRESULT;
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, SIGDN_FILESYSPATH};

    let fail = |e: windows::core::Error| PortErr::new("DIALOG_FAILED", e.message());
    // SAFETY: COM starts and ends on this thread, the interfaces drop inside the closure first, and the `GetDisplayName` buffer is freed after copying.
    let picked = unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).ok().map_err(fail)?;
        let picked = (|| -> windows::core::Result<Option<Vec<u16>>> {
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            configure(&dialog)?;
            if let Err(e) = dialog.Show(Some(HWND(owner as *mut _))) {
                return if e.code() == HRESULT::from_win32(ERROR_CANCELLED.0) { Ok(None) } else { Err(e) };
            }
            let raw = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
            let wide = raw.as_wide().to_vec();
            CoTaskMemFree(Some(raw.0 as *const _));
            Ok(Some(wide))
        })();
        CoUninitialize();
        picked.map_err(fail)?
    };
    picked.map(|w| String::from_utf16(&w).map_err(|_| PortErr::new("DIALOG_FAILED", "path is not valid UTF-16"))).transpose()
}

#[cfg(not(windows))]
pub fn pick_folder(_owner: isize) -> Result<Option<String>, PortErr> {
    Err(PortErr::new("DIALOG_FAILED", "folder picker is Windows-only"))
}

#[cfg(not(windows))]
pub fn pick_file(_owner: isize, _name: &str) -> Result<Option<String>, PortErr> {
    Err(PortErr::new("DIALOG_FAILED", "file picker is Windows-only"))
}
