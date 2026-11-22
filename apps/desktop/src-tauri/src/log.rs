use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 512 * 1024;

pub struct Log {
    dir: PathBuf,
    lock: Mutex<()>,
}

impl Log {
    pub fn new(data_dir: &Path) -> Self {
        Log { dir: data_dir.join("logs"), lock: Mutex::new(()) }
    }

    pub fn line(&self, message: &str) {
        if let Err(e) = self.append(message) {
            eprintln!("LOG_WRITE: {e}");
        }
    }

    fn append(&self, message: &str) -> std::io::Result<()> {
        let line = format!("{} {}\n", iso(now_ms()), message.replace(['\r', '\n'], " "));
        // The lock guards only ordering, so a poisoned lock is safe to reuse.
        let _turn = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        fs::create_dir_all(&self.dir)?;
        let file = self.dir.join("postbell.log");
        let rotated = if fs::metadata(&file).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
            fs::rename(&file, self.dir.join("postbell.old.log"))
        } else {
            Ok(())
        };
        OpenOptions::new().create(true).append(true).open(&file)?.write_all(line.as_bytes())?;
        rotated
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Unix milliseconds to an ISO 8601 UTC string; the date math is the `civil_from_days` algorithm.
pub fn iso(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rest = ms.rem_euclid(86_400_000);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    let (h, mi, s, milli) = (rest / 3_600_000, rest / 60_000 % 60, rest / 1000 % 60, rest % 1000);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{milli:03}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_formats_utc() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        // 2026-11-12 11:20:00.120 UTC (Date.UTC(2026, 10, 12, 11, 20, 0, 120))
        assert_eq!(iso(1_794_482_400_120), "2026-11-12T11:20:00.120Z");
        assert_eq!(iso(951_782_400_000), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn line_appends_and_rotates() {
        let dir = std::env::temp_dir().join(format!("postbell-log-{}", now_ms()));
        let log = Log::new(&dir);
        log.line("alarms: 2");
        log.line("two\nlines");
        let text = fs::read_to_string(dir.join("logs").join("postbell.log")).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with(" alarms: 2"));
        assert!(lines[1].ends_with(" two lines"));
        fs::write(dir.join("logs").join("postbell.log"), vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();
        log.line("new");
        assert!(dir.join("logs").join("postbell.old.log").exists());
        assert!(fs::read_to_string(dir.join("logs").join("postbell.log")).unwrap().ends_with(" new\n"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn failed_rotation_still_writes_the_line() {
        // Something that cannot move into the old file's place (here a non-empty folder; in practice a file open elsewhere).
        let dir = std::env::temp_dir().join(format!("postbell-log-rot-{}", now_ms()));
        let log = Log::new(&dir);
        fs::create_dir_all(dir.join("logs").join("postbell.old.log")).unwrap();
        fs::write(dir.join("logs").join("postbell.old.log").join("x"), b"x").unwrap();
        fs::write(dir.join("logs").join("postbell.log"), vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();
        log.line("one");
        log.line("two");
        let text = fs::read_to_string(dir.join("logs").join("postbell.log")).unwrap();
        let last: Vec<&str> = text.lines().rev().take(2).collect();
        assert!(last[1].ends_with(" one") && last[0].ends_with(" two"), "{last:?}");
        assert!(text.len() > MAX_BYTES as usize, "rotation failed, so the lines went to the end of the same file");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lines_from_many_threads_stay_whole() {
        let dir = std::env::temp_dir().join(format!("postbell-log-thr-{}", now_ms()));
        let log = std::sync::Arc::new(Log::new(&dir));
        let threads: Vec<_> = (0..8)
            .map(|t| {
                let log = log.clone();
                std::thread::spawn(move || (0..100).for_each(|n| log.line(&format!("t{t} n{n} {}", "y".repeat(200)))))
            })
            .collect();
        threads.into_iter().for_each(|h| h.join().unwrap());
        let text = fs::read_to_string(dir.join("logs").join("postbell.log")).unwrap();
        // Each line is whole: a 24-character time, a space, "tX nY" and 200 "y"; each (X, Y) appears once.
        let tail = "y".repeat(200);
        let mut seen = std::collections::HashSet::new();
        for l in text.lines() {
            assert!(l.len() > 25 && l.as_bytes()[24] == b' ' && l.ends_with(&tail), "split line: {l:.60}");
            let mid = &l[25..l.len() - 201];
            assert!(mid.starts_with('t') && !mid.contains('y'), "mixed line: {l:.60}");
            assert!(seen.insert(mid.to_string()), "twice: {mid}");
        }
        assert_eq!(seen.len(), 800);
        fs::remove_dir_all(&dir).unwrap();
    }
}
