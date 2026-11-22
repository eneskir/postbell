//! Serves files under registered brand folders to the webview; on Windows the URL is `http://postbell-file.localhost/<encoded path>`.
use crate::packages::Registry;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::http::{header, Method, Response, StatusCode};

pub const SCHEME: &str = "postbell-file";

const CHUNK: u64 = 4 * 1024 * 1024;
/// The largest file sent whole, to a request without a Range header (an image preview). The package author picks the
/// file, so without a limit one huge file would be read into this process's memory.
const WHOLE_MAX: u64 = 64 * 1024 * 1024;

pub fn resolve(registry: &Registry, uri_path: &str) -> Result<PathBuf, StatusCode> {
    let raw = decode(uri_path.strip_prefix('/').unwrap_or(uri_path)).ok_or(StatusCode::BAD_REQUEST)?;
    let path = Path::new(&raw);
    if !path.is_absolute() {
        return Err(StatusCode::BAD_REQUEST);
    }
    match std::fs::canonicalize(path) {
        Ok(c) if registry.contains(&c) => {
            if c.is_file() {
                Ok(c)
            } else {
                Err(StatusCode::NOT_FOUND)
            }
        }
        Ok(_) => Err(StatusCode::FORBIDDEN),
        Err(_) => Err(StatusCode::NOT_FOUND),
    }
}

fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Parses `bytes=a-b`, `bytes=a-` and `bytes=-n` (first range only); `Ok(None)` without a header.
fn range(value: Option<&str>, size: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(v) = value else { return Ok(None) };
    let spec = v.trim().strip_prefix("bytes=").ok_or(())?.split(',').next().ok_or(())?.trim();
    let (a, b) = spec.split_once('-').ok_or(())?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => {
            let n: u64 = n.parse().map_err(|_| ())?;
            if n == 0 {
                return Err(());
            }
            (size.saturating_sub(n), size.saturating_sub(1))
        }
        (s, "") => (s.parse().map_err(|_| ())?, size.saturating_sub(1)),
        (s, e) => {
            let (s, e): (u64, u64) = (s.parse().map_err(|_| ())?, e.parse().map_err(|_| ())?);
            if e < s {
                return Err(());
            }
            (s, e.min(size.saturating_sub(1)))
        }
    };
    if size == 0 || start >= size {
        return Err(());
    }
    Ok(Some((start, end.min(start + CHUNK - 1))))
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "application/octet-stream",
    }
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(code).body(Vec::new()).unwrap_or_default()
}

pub fn respond(path: Result<PathBuf, StatusCode>, method: &Method, range_header: Option<&str>) -> Response<Vec<u8>> {
    if method != Method::GET && method != Method::HEAD {
        return status(StatusCode::METHOD_NOT_ALLOWED);
    }
    let path = match path {
        Ok(p) => p,
        Err(code) => return status(code),
    };
    match serve(&path, method == Method::HEAD, range_header) {
        Ok(r) => r,
        Err(_) => status(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

fn serve(path: &Path, head: bool, range_header: Option<&str>) -> std::io::Result<Response<Vec<u8>>> {
    let mut f = File::open(path)?;
    let size = f.metadata()?.len();
    let builder = Response::builder()
        .header(header::CONTENT_TYPE, mime(path))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-cache");
    let (builder, start, len) = match range(range_header, size) {
        Err(()) => {
            let r = Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE).header(header::CONTENT_RANGE, format!("bytes */{size}"));
            return Ok(r.body(Vec::new()).unwrap_or_default());
        }
        Ok(None) if size > WHOLE_MAX => return Ok(status(StatusCode::PAYLOAD_TOO_LARGE)),
        Ok(None) => (builder.status(StatusCode::OK), 0, size),
        Ok(Some((s, e))) => (builder.status(StatusCode::PARTIAL_CONTENT).header(header::CONTENT_RANGE, format!("bytes {s}-{e}/{size}")), s, e - s + 1),
    };
    let builder = builder.header(header::CONTENT_LENGTH, len);
    if head {
        return Ok(builder.body(Vec::new()).unwrap_or_default());
    }
    f.seek(SeekFrom::Start(start))?;
    let mut body = Vec::with_capacity(len as usize);
    f.take(len).read_to_end(&mut body)?;
    Ok(builder.body(body).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // brand/package/main.mp4 (10 bytes), and secret.txt outside.
    fn tree(name: &str) -> (PathBuf, Registry) {
        let d = std::env::temp_dir().join(format!("postbell-media-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("brand").join("package")).unwrap();
        fs::write(d.join("brand").join("package").join("main.mp4"), b"0123456789").unwrap();
        fs::write(d.join("secret.txt"), b"outside").unwrap();
        let mut r = Registry::default();
        r.set(vec![d.join("brand").to_string_lossy().to_string()]);
        (d, r)
    }

    // Encodes like the UI's `convertFileSrc` (`encodeURIComponent`).
    fn uri(p: &Path) -> String {
        let mut s = String::from("/");
        for b in p.to_string_lossy().bytes() {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                s.push(b as char);
            } else {
                s.push_str(&format!("%{b:02X}"));
            }
        }
        s
    }

    #[test]
    fn serves_registered_file_in_ranges() {
        let (d, r) = tree("range");
        let p = resolve(&r, &uri(&d.join("brand").join("package").join("main.mp4"))).unwrap();
        let full = respond(Ok(p.clone()), &Method::GET, None);
        assert_eq!((full.status(), full.body().as_slice()), (StatusCode::OK, b"0123456789".as_slice()));
        assert_eq!(full.headers()[header::CONTENT_TYPE], "video/mp4");
        let part = respond(Ok(p.clone()), &Method::GET, Some("bytes=2-5"));
        assert_eq!((part.status(), part.body().as_slice()), (StatusCode::PARTIAL_CONTENT, b"2345".as_slice()));
        assert_eq!(part.headers()[header::CONTENT_RANGE], "bytes 2-5/10");
        let open = respond(Ok(p.clone()), &Method::GET, Some("bytes=7-"));
        assert_eq!(open.body().as_slice(), b"789");
        let tail = respond(Ok(p.clone()), &Method::GET, Some("bytes=-3"));
        assert_eq!(tail.headers()[header::CONTENT_RANGE], "bytes 7-9/10");
        let head = respond(Ok(p.clone()), &Method::HEAD, Some("bytes=0-0"));
        assert_eq!((head.status(), head.body().len()), (StatusCode::PARTIAL_CONTENT, 0));
        assert_eq!(head.headers()[header::CONTENT_RANGE], "bytes 0-0/10");
        assert_eq!(respond(Ok(p.clone()), &Method::GET, Some("bytes=10-")).status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(respond(Ok(p), &Method::POST, None).status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[test]
    fn a_file_too_big_to_send_whole_is_only_sent_in_ranges() {
        let (d, _) = tree("big");
        let big = d.join("big.png");
        // set_len extends without writing, so the test does not fill the disk.
        File::create(&big).unwrap().set_len(WHOLE_MAX + 1).unwrap();
        let r = respond(Ok(big.clone()), &Method::GET, None);
        assert_eq!((r.status(), r.body().len()), (StatusCode::PAYLOAD_TOO_LARGE, 0));
        assert_eq!(respond(Ok(big.clone()), &Method::HEAD, None).status(), StatusCode::PAYLOAD_TOO_LARGE);
        let r = respond(Ok(big), &Method::GET, Some("bytes=0-"));
        assert_eq!((r.status(), r.body().len() as u64), (StatusCode::PARTIAL_CONTENT, CHUNK));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn refuses_paths_outside_registered_folders() {
        let (d, r) = tree("outside");
        assert_eq!(resolve(&r, &uri(&d.join("secret.txt"))), Err(StatusCode::FORBIDDEN));
        assert_eq!(resolve(&r, &uri(&d.join("brand").join("..").join("secret.txt"))), Err(StatusCode::FORBIDDEN));
        assert_eq!(resolve(&r, &uri(&d.join("brand").join("package").join("missing.mp4"))), Err(StatusCode::NOT_FOUND));
        assert_eq!(resolve(&r, &uri(&d.join("brand").join("package"))), Err(StatusCode::NOT_FOUND));
        assert_eq!(resolve(&r, "/brand%2Fpackage%2Fmain.mp4"), Err(StatusCode::BAD_REQUEST));
        assert_eq!(resolve(&r, "/C%3"), Err(StatusCode::BAD_REQUEST));
        assert_eq!(resolve(&Registry::default(), &uri(&d.join("brand").join("package").join("main.mp4"))), Err(StatusCode::FORBIDDEN));
    }

    #[test]
    fn range_rules() {
        assert_eq!(range(None, 10), Ok(None));
        assert_eq!(range(Some("bytes=0-0"), 10), Ok(Some((0, 0))));
        assert_eq!(range(Some("bytes=5-100"), 10), Ok(Some((5, 9))));
        assert_eq!(range(Some("bytes=-20"), 10), Ok(Some((0, 9))));
        assert_eq!(range(Some("bytes=0-"), 0), Err(()));
        assert_eq!(range(Some("bytes=5-2"), 10), Err(()));
        assert_eq!(range(Some("bytes=-0"), 10), Err(()));
        assert_eq!(range(Some("items=0-1"), 10), Err(()));
        assert_eq!(range(Some("bytes=0-"), 10 * CHUNK), Ok(Some((0, CHUNK - 1))));
    }
}
