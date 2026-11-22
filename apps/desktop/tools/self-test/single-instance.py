# Checks the single-instance lock of the release postbell.exe in self-test mode: python -I -X utf8 apps/desktop/tools/self-test/single-instance.py <evidence file>
# The first instance opens the real data folder, read-only.
import json, pathlib, subprocess, sys, tempfile, time

APP = pathlib.Path(__file__).resolve().parents[2]

EXE = str(APP / "src-tauri/target/release/postbell.exe")
base = pathlib.Path(tempfile.gettempdir()) / f"postbell-single-instance-{int(time.time())}"
base.mkdir()
log, ok = [], True
def say(*a):
    s = " ".join(str(x) for x in a); log.append(s); print(s)
def check(c, what):
    global ok
    ok &= bool(c); say("  [" + ("pass" if c else "FAIL") + "]", what)
def wait(p, sec=60):
    t = time.time()
    while time.time() - t < sec:
        if p.exists() and p.stat().st_size > 0: return True
        time.sleep(0.2)
    return False
def procs():
    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq postbell.exe", "/FO", "CSV", "/NH"], capture_output=True, text=True).stdout
    return [l.split('","')[1] for l in out.splitlines() if l.startswith('"postbell.exe"')]

check(procs() == [], f"no Postbell running at the start: {procs()}")
r1, r2, r3 = base / "r1.json", base / "r2.json", base / "r3.json"
first = subprocess.Popen([EXE, "--self-test", str(r1), "--self-test-stay"])
check(wait(r1), f"the first instance opened (PID {first.pid}), wrote its report and stayed open")
say("  processes:", procs())
t = time.time()
second = subprocess.run([EXE, "--self-test", str(r2)], capture_output=True, text=True, timeout=60)
say(f"  the second launch exited after {time.time() - t:.1f} s, exit {second.returncode}")
mark = pathlib.Path(str(r1) + ".second-instance.json")
check(wait(mark, 10), "the first instance got the second launch (marker file)")
if mark.exists(): say("  marker file:", json.loads(mark.read_text(encoding="utf-8")))
check(not r2.exists(), "the second launch opened no UI and wrote no report")
check(procs() == [str(first.pid)], f"only the first instance runs: {procs()}")
third = subprocess.run([EXE, "--self-test", str(r3), "--data-dir", str(base / "copy")], capture_output=True, text=True, timeout=60)
check(third.returncode == 0 and r3.exists(), "a test copy with --data-dir was not blocked and wrote its report")
subprocess.run(["taskkill", "/F", "/PID", str(first.pid)], capture_output=True)
first.wait(10)
check(procs() == [], "no Postbell running at the end")
say("RESULT:", "pass" if ok else "FAIL")
pathlib.Path(sys.argv[1]).write_text("\n".join(log) + "\n", encoding="utf-8")
sys.exit(0 if ok else 1)
