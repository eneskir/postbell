# Checks that the release postbell.exe receives the UI's alarm list and tray texts in self-test mode: python -I -X utf8 apps/desktop/tools/self-test/alarms-run.py <evidence file>
import json, pathlib, re, subprocess, sys, tempfile, time

APP = pathlib.Path(__file__).resolve().parents[2]
EXE = APP / "src-tauri/target/release/postbell.exe"
SOURCES = [p for d in ("src", "src-tauri/src") for p in (APP / d).rglob("*") if p.is_file() and not p.name.endswith(".test.ts")]
if not EXE.exists() or EXE.stat().st_mtime < max(p.stat().st_mtime for p in SOURCES):
    print("postbell.exe is missing or older than its sources: run `npm run build` and `npx tauri build --no-bundle` first (cargo must be on PATH)")
    sys.exit(2)
FIX = (APP.parents[1] / "contracts/fixtures/initech").as_posix()
base = pathlib.Path(tempfile.gettempdir()) / f"postbell-alarms-run-{int(time.time())}"
base.mkdir()
out = []
ok = True
def say(*a):
    line = " ".join(str(x) for x in a); out.append(line); print(line)
def check(cond, what):
    global ok
    ok &= bool(cond); say("  [" + ("pass" if cond else "FAIL") + "]", what)

seed = {"version": 1, "brands": [{"id": "initech", "name": "Initech", "sticker": "camera", "folder": FIX}], "groups": [],
        "accounts": [{"id": "initech-x", "brand": "initech", "network": "x", "handle": "@initech", "language": "en", "times": {"x": "09:00"}}],
        "records": [], "settings": {}, "sidebar": {"collapsed": False, "width": 240, "openBrands": []}}

def alarms_logged(name, store, sec=30):
    d = base / name; d.mkdir(); (d / "store.json").write_text(json.dumps(store, indent=2), encoding="utf-8")
    report = base / f"{name}.json"; logf = d / "logs" / "postbell.log"
    p = subprocess.Popen([str(EXE), "--self-test", str(report), "--self-test-stay", "--data-dir", str(d)])
    found, t = None, time.time()
    try:
        while time.time() - t < sec and found is None:
            if logf.exists():
                m = re.findall(r" alarms: (\d+)$", logf.read_text(encoding="utf-8"), re.M)
                if m: found = int(m[-1])
            time.sleep(0.2)
        time.sleep(1)
    finally:
        subprocess.run(["taskkill", "/F", "/PID", str(p.pid)], capture_output=True, text=True); p.wait(10)
    text = logf.read_text(encoding="utf-8") if logf.exists() else "(no log)"
    say("  log:", " | ".join(text.splitlines()))
    m = re.findall(r" alarms: (\d+)$", text, re.M)
    return [int(x) for x in m], text

say("1. three pending X shares; data folder", base / "a")
counts, text = alarms_logged("a", seed)
check(counts and counts[-1] == 6, f"the shell got the list: alarms: {counts}")
check(re.search(r"^\S+ start \d+\.\d+\.\d+$", text, re.M), "the start line has the version")
check("toast:" not in text and "TOAST_FAILED" not in text, "no notification shown in self-test")
check(" tray: off (self-test)" in text and "TRAY_" not in text and " tray: on" not in text, "tray texts arrived, no tray icon in self-test")

say("2. one marked as shared; data folder", base / "b")
done = {**seed, "records": [{"share": "initech/initech-2026-11-12-hidden-dog/x", "status": "done", "at": "2026-11-12T09:05"}]}
counts, _ = alarms_logged("b", done)
check(counts and counts[-1] == 4, f"the marked share has no alarms: alarms: {counts}")

v4 = {**seed, "version": 4, "backup": {}}
say("3. «Saati gelince bildir» off; data folder", base / "c")
counts, _ = alarms_logged("c", {**v4, "settings": {"notifyOnTime": False}})
check(counts and counts[-1] == 0, f"no alarms with notifications off: alarms: {counts}")

say("4. «Açılış ekranı: Son açık sayfa» on Initech's Takvim; data folder", base / "d")
counts, _ = alarms_logged("d", {**v4, "settings": {"startScreen": "last"}, "lastPage": {"kind": "brand", "brand": "initech", "page": "calendar"}})
shown = json.loads((base / "d.json").read_text(encoding="utf-8"))["rendered"]
say("  rendered:", " | ".join(shown.splitlines())[:400])
check("Takvim yükleniyor" in shown or "Bu hafta" in shown, "the app opened on the last page, Initech's Takvim")
check(counts and counts[-1] == 6, f"the alarm list is unchanged: alarms: {counts}")

say("RESULT:", "pass" if ok else "FAIL")
if len(sys.argv) > 1:
    pathlib.Path(sys.argv[1]).write_text("\n".join(out) + "\n", encoding="utf-8")
sys.exit(0 if ok else 1)
