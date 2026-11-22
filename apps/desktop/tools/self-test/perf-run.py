# Measures launch time (5 runs) and idle CPU and memory of postbell.exe in self-test mode, with no other load:
#   python -I -X utf8 apps/desktop/tools/self-test/perf-run.py <evidence folder> [--exe <postbell.exe>] [--idle <seconds, 600>]
# Launch time ends at the report file's mtime: in self-test mode `ready` writes the report where it would show the window.
import json, pathlib, statistics, subprocess, sys, tempfile, time

APP = pathlib.Path(__file__).resolve().parents[2]
args = sys.argv[1:]
if not args:
    print("usage: perf-run.py <evidence folder> [--exe <postbell.exe>] [--idle <seconds>]"); sys.exit(2)
OUT = pathlib.Path(args[0]); OUT.mkdir(parents=True, exist_ok=True)
EXE = pathlib.Path(args[args.index("--exe") + 1]) if "--exe" in args else APP / "src-tauri/target/release/postbell.exe"
IDLE = int(args[args.index("--idle") + 1]) if "--idle" in args else 600
if not EXE.exists():
    print(f"no exe: {EXE}"); sys.exit(2)
FIX = (APP.parents[1] / "contracts/fixtures/initech").as_posix()
base = pathlib.Path(tempfile.gettempdir()) / f"postbell-perf-run-{int(time.time())}"
data = base / "data"; data.mkdir(parents=True)
seed = {"version": 1, "brands": [{"id": "initech", "name": "Initech", "sticker": "camera", "folder": FIX}], "groups": [],
        "accounts": [{"id": "initech-x", "brand": "initech", "network": "x", "handle": "@initech", "language": "en", "times": {"x": "09:00"}}],
        "records": [], "settings": {}, "sidebar": {"collapsed": False, "width": 240, "openBrands": ["initech"]}}
(data / "store.json").write_text(json.dumps(seed, indent=2), encoding="utf-8")
lines = [f"exe {EXE} ({EXE.stat().st_size} bytes); data {data}"]
def say(s):
    lines.append(s); print(s, flush=True)

say("1. launch, 5 runs")
runs = []
for i in range(1, 6):
    report = base / f"launch-{i}.json"
    t0 = time.time()
    p = subprocess.Popen([str(EXE), "--self-test", str(report), "--data-dir", str(data)])
    while not report.exists() and time.time() - t0 < 30:
        time.sleep(0.005)
    ms = round((report.stat().st_mtime - t0) * 1000) if report.exists() else None
    code = p.wait(30)
    say(f"  run {i}: {ms} ms, exit {code}")
    if ms is not None: runs.append(ms)
    time.sleep(2)
if runs:
    say(f"  median {statistics.median(runs)} ms, range {min(runs)}-{max(runs)} ms ({len(runs)} runs); budget 1500 ms")

say(f"2. idle, {IDLE} s")
report = base / "idle.json"
p = subprocess.Popen([str(EXE), "--self-test", str(report), "--self-test-stay", "--data-dir", str(data)])
t0 = time.time()
while not report.exists() and time.time() - t0 < 30:
    time.sleep(0.1)
time.sleep(5)
csv = OUT / "idle.csv"
r = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(APP / "tools/self-test/idle.ps1"),
                    "-Kok", str(p.pid), "-Cikti", str(csv), "-Sure", str(IDLE)], capture_output=True, text=True)
subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], capture_output=True, text=True)
if r.returncode != 0:
    say(f"  the sampling script failed: {r.stderr[-400:]}")
rows = [l.split(";") for l in csv.read_text(encoding="utf-8-sig").splitlines()[1:] if l[:2].isdigit()] if csv.exists() else []
if rows:
    cpu = [float(x[2]) for x in rows]; priv = [float(x[3]) for x in rows]; ws = [float(x[4]) for x in rows]
    say(f"  {len(rows)} samples, {rows[0][0]}-{rows[-1][0]}, process counts {sorted({x[1] for x in rows})}")
    say(f"  CPU percent: mean {statistics.mean(cpu):.3f}, max {max(cpu):.3f}; budget 1")
    say(f"  private memory MB: median {statistics.median(priv):.1f}, range {min(priv):.1f}-{max(priv):.1f}; budget 250")
    say(f"  working set MB: median {statistics.median(ws):.1f} (pages shared between processes count in each)")
ok = bool(runs) and statistics.median(runs) < 1500 and bool(rows) and statistics.mean(cpu) < 1 and statistics.median(priv) < 250
say(f"RESULT: {'pass' if ok else 'FAIL (over budget or not measured)'}")
(OUT / "perf-run.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
sys.exit(0 if ok else 1)
