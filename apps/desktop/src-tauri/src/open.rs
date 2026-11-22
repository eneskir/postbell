use crate::packages::Registry;
use crate::store::PortErr;
use std::path::{Path, PathBuf};

/// Only X's intent URL is documented; Instagram has no create URL, and the TikTok and Pinterest pages are undocumented and may change.
pub fn share_page(platform: &str) -> Option<&'static str> {
    Some(match platform {
        "x" => "https://x.com/intent/tweet",
        "instagram-reels" | "instagram-post" => "https://www.instagram.com/",
        "tiktok" => "https://www.tiktok.com/tiktokstudio/upload",
        "youtube-shorts" => "https://studio.youtube.com/",
        "pinterest" => "https://www.pinterest.com/pin-creation-tool/",
        _ => return None,
    })
}

/// Stays under WinINet's documented `INTERNET_MAX_URL_LENGTH` (2083), since which layer would cut a longer URL is unknown.
const URL_MAX: usize = 2048;

/// Returns the URL and whether the text was dropped; only X's intent takes text, and only while it fits.
pub fn share_url(platform: &str, text: &str) -> Option<(String, bool)> {
    let base = share_page(platform)?;
    if platform != "x" || text.trim().is_empty() {
        return Some((base.to_string(), false));
    }
    let url = format!("{base}?text={}", encode(text));
    Some(if url.len() <= URL_MAX { (url, false) } else { (base.to_string(), true) })
}

/// Percent-encodes per RFC 3986; a space is `%20`, not `+`.
fn encode(s: &str) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

pub fn reveal_target(registry: &Registry, folder: &str, path: &str) -> Result<PathBuf, PortErr> {
    let joined = Path::new(folder).join(path);
    let real = std::fs::canonicalize(&joined).map_err(|_| PortErr::new("FILE_MISSING", joined.display()))?;
    if !registry.contains(&real) {
        return Err(PortErr::new("FOLDER_NOT_REGISTERED", folder));
    }
    if !real.is_file() {
        return Err(PortErr::new("FILE_MISSING", joined.display()));
    }
    Ok(plain(real))
}

/// Strips the `\\?\` prefix from `canonicalize`, because Explorer does not accept it.
fn plain(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    p
}

/// Uses `SHOpenFolderAndSelectItems`, because `explorer.exe /select,` does not select the file in a newly opened folder and always opens a new window.
#[cfg(windows)]
pub fn reveal(file: &Path) -> Result<(), PortErr> {
    use windows::core::HSTRING;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName};
    let path = HSTRING::from(file.as_os_str());
    crate::setup_win::com(|| {
        // SAFETY: the Shell allocates the ID list, and it is freed with the same allocator after use.
        unsafe {
            let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
            SHParseDisplayName(&path, None, &mut pidl, 0, None)?;
            let shown = SHOpenFolderAndSelectItems(pidl, None, 0);
            CoTaskMemFree(Some(pidl as *const _));
            shown
        }
    })
    .map_err(|e| PortErr::new("OPEN_FAILED", e))
}

/// Opens the default browser through the Windows URL handler; unlike `cmd /c start`, it does not interpret `&`.
#[cfg(windows)]
pub fn open_url(url: &str) -> Result<(), PortErr> {
    let mut command = url_command(url).ok_or_else(|| PortErr::new("OPEN_FAILED", "no system folder"))?;
    command.spawn().map(|_| ()).map_err(|e| PortErr::new("OPEN_FAILED", e))
}

#[cfg(windows)]
fn url_command(url: &str) -> Option<std::process::Command> {
    let mut command = std::process::Command::new(crate::setup_win::system_exe("rundll32.exe")?);
    command.args(["url.dll,FileProtocolHandler", url]);
    Some(command)
}

#[cfg(not(windows))]
pub fn reveal(_file: &Path) -> Result<(), PortErr> {
    Err(PortErr::new("OPEN_FAILED", "Windows-only"))
}

#[cfg(not(windows))]
pub fn open_url(_url: &str) -> Result<(), PortErr> {
    Err(PortErr::new("OPEN_FAILED", "Windows-only"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn share_pages_are_https_and_cover_every_platform() {
        for p in ["x", "instagram-reels", "instagram-post", "tiktok", "youtube-shorts", "pinterest"] {
            let url = share_page(p).unwrap_or_else(|| panic!("{p}"));
            assert!(url.starts_with("https://") && !url.contains(['"', ' ', '&']), "{url}");
        }
        assert_eq!(share_page("threads"), None);
        assert_eq!(share_page("https://bad.example"), None);
    }

    #[test]
    fn x_opens_with_the_text_others_without() {
        let (url, dropped) = share_url("x", "Köpek 🐶 here\n#postbell & ?=+%").unwrap();
        assert_eq!(url, "https://x.com/intent/tweet?text=K%C3%B6pek%20%F0%9F%90%B6%20here%0A%23postbell%20%26%20%3F%3D%2B%25");
        assert!(!dropped);
        assert_eq!(share_url("x", "a-b_c.d~e").unwrap().0, "https://x.com/intent/tweet?text=a-b_c.d~e");
        assert_eq!(share_url("x", "  \n").unwrap(), ("https://x.com/intent/tweet".to_string(), false));
        assert_eq!(share_url("tiktok", "text").unwrap(), ("https://www.tiktok.com/tiktokstudio/upload".to_string(), false));
        assert_eq!(share_url("threads", "text"), None);
    }

    #[test]
    fn text_that_does_not_fit_opens_the_page_without_it() {
        // A 280-character post fits even if every letter is Turkish (6 bytes encoded) or half are emoji (12).
        assert!(!share_url("x", &"ğ".repeat(280)).unwrap().1);
        assert!(!share_url("x", &"🐶".repeat(140)).unwrap().1);
        let (url, dropped) = share_url("x", &"ğ".repeat(5000)).unwrap();
        assert_eq!((url.as_str(), dropped), ("https://x.com/intent/tweet", true));
        let edge = "a".repeat(URL_MAX - "https://x.com/intent/tweet?text=".len());
        assert_eq!(share_url("x", &edge).unwrap().0.len(), URL_MAX);
        assert!(share_url("x", &format!("{edge}a")).unwrap().1);
    }

    #[cfg(windows)]
    #[test]
    fn helpers_start_from_the_system_folder() {
        let url = url_command("https://example.com").unwrap();
        let delete = crate::setup_win::delete_command(&[], &[]).unwrap();
        let in_system32 = |d: Option<&Path>| d.and_then(|d| d.file_name()).is_some_and(|n| n.eq_ignore_ascii_case("system32"));
        for p in [Path::new(url.get_program()), Path::new(delete.get_program())] {
            assert!(p.is_absolute() && p.is_file() && in_system32(p.parent()), "{}", p.display());
        }
        // The cleanup line runs `ping`, which cmd looks for in its working folder first.
        let dir = delete.get_current_dir().unwrap();
        assert!(dir.is_absolute() && in_system32(Some(dir)) && dir.join("PING.EXE").is_file(), "{}", dir.display());
    }

    #[test]
    fn reveal_target_stays_inside_registered_folder() {
        let d = std::env::temp_dir().join(format!("postbell-open-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("brand").join("package")).unwrap();
        fs::write(d.join("brand").join("package").join("main.mp4"), "0").unwrap();
        fs::write(d.join("secret.txt"), "x").unwrap();
        let folder = d.join("brand").to_string_lossy().to_string();
        let mut r = Registry::default();
        r.set(vec![folder.clone()]);
        let ok = reveal_target(&r, &folder, "package/main.mp4").unwrap();
        assert!(!ok.to_string_lossy().starts_with(r"\\?\"), "{}", ok.display());
        assert!(ok.ends_with(Path::new("package").join("main.mp4")));
        assert_eq!(reveal_target(&r, &folder, "../secret.txt").unwrap_err().code, "FOLDER_NOT_REGISTERED");
        assert_eq!(reveal_target(&r, &folder, "package/missing.mp4").unwrap_err().code, "FILE_MISSING");
        assert_eq!(reveal_target(&r, &folder, "package").unwrap_err().code, "FILE_MISSING");
        assert_eq!(reveal_target(&Registry::default(), &folder, "package/main.mp4").unwrap_err().code, "FOLDER_NOT_REGISTERED");
    }

    #[test]
    fn plain_drops_verbatim_prefix() {
        assert_eq!(plain(PathBuf::from(r"\\?\C:\a\b.mp4")), PathBuf::from(r"C:\a\b.mp4"));
        assert_eq!(plain(PathBuf::from(r"\\?\UNC\server\share\b.mp4")), PathBuf::from(r"\\server\share\b.mp4"));
        assert_eq!(plain(PathBuf::from(r"C:\a")), PathBuf::from(r"C:\a"));
    }
}
