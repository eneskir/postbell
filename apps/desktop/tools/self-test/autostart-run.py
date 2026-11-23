# Checks «Bilgisayar açılınca başlat» on the release postbell.exe: python -I -X utf8 apps/desktop/tools/self-test/autostart-run.py <evidence file>
# Test copies write under `autostart::TEST_PREFIX`; the real Run key is only read, to show it is untouched.
import ctypes, json, pathlib, re, subprocess, sys, tempfile, time, winreg
from ctypes import wintypes

APP = pathlib.Path(__file__).resolve().parents[2]
EXE = APP / "src-tauri/target/release/postbell.exe"
SOURCES = [p for d in ("src", "src-tauri/src") for p in (APP / d).rglob("*") if p.is_file() and not p.name.endswith(".test.ts")]
if not EXE.exists() or EXE.stat().st_mtime < max(p.stat().st_mtime for p in SOURCES):
    print("postbell.exe is missing or older than its sources: run `npm run build` and `npx tauri build --no-bundle` first (cargo must be on PATH)")
    sys.exit(2)
RUN = "Software\\Microsoft\\Windows\\CurrentVersion\\Run"
TEST_ROOT = "Software\\Postbell autostart test"
base = pathlib.Path(tempfile.gettempdir()) / f"postbell-autostart-run-{int(time.time())}"
base.mkdir()
out = []
ok = True
def say(*a):
    line = " ".join(str(x) for x in a); out.append(line); print(line)
def check(cond, what):
    global ok
    ok &= bool(cond); say("  [" + ("pass" if cond else "FAIL") + "]", what)

def run_value(key):
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
            return winreg.QueryValueEx(k, "Postbell")[0]
    except FileNotFoundError:
        return None

def delete_tree(key):
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
            while True:
                try:
                    delete_tree(key + "\\" + winreg.EnumKey(k, 0))
                except OSError:
                    break
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key)
    except FileNotFoundError:
        pass

# Counts the app's own windows; tao's 16 x 16 "Tao Thread Event Target" is always visible and never on screen.
def visible_windows(pid):
    user32 = ctypes.windll.user32
    found = []
    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def each(hwnd, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, cls, 64)
        if owner.value == pid and user32.IsWindowVisible(hwnd) and cls.value == "Tauri Window":
            found.append(hwnd)
        return True
    user32.EnumWindows(each, 0)
    return len(found)

store = {"version": 4, "brands": [], "groups": [], "accounts": [], "records": [], "backup": {}, "settings": {},
         "sidebar": {"collapsed": False, "width": 240, "openBrands": []}}

def start(name, settings, args, wait_for, sec=30):
    d = base / name; d.mkdir(); (d / "store.json").write_text(json.dumps({**store, "settings": settings}, indent=2), encoding="utf-8")
    logf = d / "logs" / "postbell.log"
    p = subprocess.Popen([str(EXE), "--data-dir", str(d), *[str(a).replace("{report}", str(base / f"{name}.json")) for a in args]])
    t, text, windows = time.time(), "", None
    try:
        while time.time() - t < sec and not re.search(wait_for, text, re.M):
            text = logf.read_text(encoding="utf-8") if logf.exists() else ""
            time.sleep(0.2)
        time.sleep(1.5)
        windows = visible_windows(p.pid)
    finally:
        subprocess.run(["taskkill", "/F", "/PID", str(p.pid)], capture_output=True, text=True); p.wait(10)
    text = logf.read_text(encoding="utf-8") if logf.exists() else "(no log)"
    say("  log:", " | ".join(text.splitlines()))
    return text, windows

real_before = run_value(RUN)
delete_tree(TEST_ROOT)
test_run = TEST_ROOT + "\\" + RUN
want = f'"{EXE}" --background'

say("1. «Bilgisayar açılınca başlat» on; data folder", base / "a")
text, _ = start("a", {"launchAtLogin": True}, ["--self-test", "{report}", "--self-test-stay"], r" autostart: ")
check(re.search(r" autostart: on \(test key\)$", text, re.M) and "AUTOSTART_FAILED" not in text, "the shell wrote the Run value at start: autostart: on (test key)")
got = run_value(test_run)
say("  test key value:", got)
check(got == want, "the value starts this exe with --background")

say("2. «Bilgisayar açılınca başlat» off; data folder", base / "b")
text, _ = start("b", {"launchAtLogin": False}, ["--self-test", "{report}", "--self-test-stay"], r" autostart: ")
check(re.search(r" autostart: off \(test key\)$", text, re.M), "the shell removed the Run value at start: autostart: off (test key)")
check(run_value(test_run) is None, "the test key has no Postbell value")

say("3. started with --background, as Windows does at sign-in; data folder", base / "c")
text, windows = start("c", {}, ["--background"], r" window: hidden at start")
check(" window: hidden at start (--background)" in text, "the log says the window stayed hidden")
check(windows == 0, f"visible app windows (class \"Tauri Window\"): {windows}")

check(run_value(RUN) == real_before, f"the real Run key is unchanged: {real_before!r}")
delete_tree(TEST_ROOT)

say("RESULT:", "pass" if ok else "FAIL")
if len(sys.argv) > 1:
    pathlib.Path(sys.argv[1]).write_text("\n".join(out) + "\n", encoding="utf-8")
sys.exit(0 if ok else 1)
