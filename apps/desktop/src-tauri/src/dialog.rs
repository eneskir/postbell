//! Windows pickers (`IFileOpenDialog`, `IFileSaveDialog`) run on their own thread: COM needs a single-threaded apartment there, and the main event loop must not block.
use crate::store::PortErr;

/// Returns the chosen folder, or `None` if cancelled; `owner` is the parent window handle as an integer so it can cross threads.
#[cfg(windows)]
pub fn pick_folder(owner: isize) -> Result<Option<String>, PortErr> {
    use windows::Win32::UI::Shell::{FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS};
    // SAFETY: `show` runs this on the COM thread before the dialog closes.
    show(owner, false, |dialog| unsafe { dialog.SetOptions(dialog.GetOptions()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM) })
}

/// Returns the chosen file, or `None` if cancelled; `name` is prefilled and limits the list to its extension.
#[cfg(windows)]
pub fn pick_file(owner: isize, name: &str) -> Result<Option<String>, PortErr> {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::{FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST};
    let ext = std::path::Path::new(name).extension().map(|e| e.to_string_lossy().into_owned());
    let file = HSTRING::from(name);
    // SAFETY: `show` runs this with COM initialized.
    show(owner, false, |dialog| unsafe {
        dialog.SetOptions(dialog.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST)?;
        if let Some(e) = &ext {
            only(dialog, e)?;
        }
        dialog.SetFileName(&file)
    })
}

/// Returns an existing file with the extension `ext`, or `None` if cancelled.
#[cfg(windows)]
pub fn open_file(owner: isize, ext: &str) -> Result<Option<String>, PortErr> {
    use windows::Win32::UI::Shell::{FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST};
    // SAFETY: `show` runs this with COM initialized.
    show(owner, false, |dialog| unsafe {
        dialog.SetOptions(dialog.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST)?;
        only(dialog, ext)
    })
}

/// Returns where to save a new file, `name` prefilled; Windows asks before replacing a file.
#[cfg(windows)]
pub fn save_file(owner: isize, name: &str) -> Result<Option<String>, PortErr> {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::{FOS_FORCEFILESYSTEM, FOS_OVERWRITEPROMPT, FOS_PATHMUSTEXIST};
    let ext = std::path::Path::new(name).extension().map(|e| e.to_string_lossy().into_owned());
    let file = HSTRING::from(name);
    // SAFETY: `show` runs this with COM initialized.
    show(owner, true, |dialog| unsafe {
        dialog.SetOptions(dialog.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_OVERWRITEPROMPT)?;
        if let Some(e) = &ext {
            only(dialog, e)?;
            dialog.SetDefaultExtension(&HSTRING::from(e.as_str()))?;
        }
        dialog.SetFileName(&file)
    })
}

/// Limits the list to one extension.
/// SAFETY: call on the dialog's COM thread; the filter strings are copied by `SetFileTypes`.
#[cfg(windows)]
unsafe fn only(dialog: &windows::Win32::UI::Shell::IFileDialog, ext: &str) -> windows::core::Result<()> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    let label = HSTRING::from(format!("{} (*.{ext})", ext.to_uppercase()));
    let pattern = HSTRING::from(format!("*.{ext}"));
    unsafe { dialog.SetFileTypes(&[COMDLG_FILTERSPEC { pszName: PCWSTR(label.as_ptr()), pszSpec: PCWSTR(pattern.as_ptr()) }]) }
}

#[cfg(windows)]
fn show(owner: isize, save: bool, configure: impl FnOnce(&windows::Win32::UI::Shell::IFileDialog) -> windows::core::Result<()>) -> Result<Option<String>, PortErr> {
    use windows::core::HRESULT;
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::{FileOpenDialog, FileSaveDialog, IFileDialog, SIGDN_FILESYSPATH};

    let fail = |e: windows::core::Error| PortErr::new("DIALOG_FAILED", e.message());
    // SAFETY: COM starts and ends on this thread, the interfaces drop inside the closure first, and the `GetDisplayName` buffer is freed after copying.
    let picked = unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).ok().map_err(fail)?;
        let picked = (|| -> windows::core::Result<Option<Vec<u16>>> {
            let dialog: IFileDialog = CoCreateInstance(if save { &FileSaveDialog } else { &FileOpenDialog }, None, CLSCTX_INPROC_SERVER)?;
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

#[cfg(not(windows))]
pub fn open_file(_owner: isize, _ext: &str) -> Result<Option<String>, PortErr> {
    Err(PortErr::new("DIALOG_FAILED", "file picker is Windows-only"))
}

#[cfg(not(windows))]
pub fn save_file(_owner: isize, _name: &str) -> Result<Option<String>, PortErr> {
    Err(PortErr::new("DIALOG_FAILED", "file picker is Windows-only"))
}
