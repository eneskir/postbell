# Runs the release postbell.exe in self-test mode against temp data folders: python -I -X utf8 apps/desktop/tools/self-test/store-run.py <evidence file>
import hashlib, json, pathlib, subprocess, sys, tempfile, time

APP = pathlib.Path(__file__).resolve().parents[2]

EXE = APP / "src-tauri/target/release/postbell.exe"
SOURCES = [p for d in ("src", "src-tauri/src") for p in (APP / d).rglob("*") if p.is_file() and not p.name.endswith(".test.ts")]
if not EXE.exists() or EXE.stat().st_mtime < max(p.stat().st_mtime for p in SOURCES):
    print("postbell.exe is missing or older than its sources: run `npm run build` and `npx tauri build --no-bundle` first (cargo must be on PATH)")
    sys.exit(2)
FIX = (APP.parents[1] / "contracts/fixtures/initech").as_posix()
base = pathlib.Path(tempfile.gettempdir()) / f"postbell-store-run-{int(time.time())}"
base.mkdir()
log = []
def say(*a):
    line = " ".join(str(x) for x in a); log.append(line); print(line)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()[:16] if p.exists() else None
def wait_file(p, sec=60):
    t = time.time()
    while time.time() - t < sec:
        if p.exists() and p.stat().st_size > 0: return True
        time.sleep(0.2)
    return False
def rendered(p): return json.loads(p.read_text(encoding="utf-8"))["rendered"].replace("\n", " | ")
def run(args, sec=60):
    r = subprocess.run([str(EXE), *args], capture_output=True, text=True, timeout=sec)
    return r.returncode

seed = {"version": 1, "brands": [{"id": "initech", "name": "Initech", "sticker": "camera", "folder": FIX}],
        "groups": [], "accounts": [], "records": [], "settings": {}, "sidebar": {"collapsed": False, "width": 240, "openBrands": []}}
ok = True
def check(cond, what):
    global ok
    ok &= bool(cond); say("  [" + ("pass" if cond else "FAIL") + "]", what)

a = base / "a"; a.mkdir(); seed_text = json.dumps(seed, indent=2); (a / "store.json").write_text(seed_text, encoding="utf-8")
say("1. write, force kill, reopen; data folder", a)
r1 = base / "r1.json"
p = subprocess.Popen([str(EXE), "--self-test", str(r1), "--self-test-add-record", "--self-test-stay", "--data-dir", str(a)])
check(wait_file(r1), "report written (process stayed open)")
say("  dump:", rendered(r1))
h1 = sha(a / "store.json"); rec = json.loads((a / "store.json").read_text(encoding="utf-8"))["records"]
say("  store hash:", h1, "records:", rec)
check(json.loads((a / "store.json").read_text(encoding="utf-8"))["version"] == 4, "the version 1 seed was written back as version 4")
check((a / "store.v1.json").exists() and (a / "store.v1.json").read_text(encoding="utf-8") == seed_text, "the version 1 file was kept as store.v1.json, unchanged")
check(p.poll() is None, f"process {p.pid} is still running")
k = subprocess.run(["taskkill", "/F", "/PID", str(p.pid)], capture_output=True, text=True)
say("  taskkill:", k.returncode, k.stdout.strip())
p.wait(10)
check(p.returncode != 0, f"process was force killed (exit {p.returncode})")
check(not (a / "store.json.tmp").exists() and sha(a / "store.json") == h1, "after the kill the file is unchanged and no temp file is left")
r2 = base / "r2.json"
rc = run(["--self-test", str(r2), "--data-dir", str(a)])
d2 = rendered(r2); say("  reopen exit", rc, "dump:", d2)
check("ready, 1 kayıt" in d2 and sha(a / "store.json") == h1, "after reopening 1 record, same file hash")
check("3 paket, 4 reddedildi" in d2, "3 packages read from the fixture folder, 4 rejected")
check("Klasör dışı okuma | folder-not-registered" in d2, "reading the store folder gives folder-not-registered")
check("Önizleme | 160 x 90" in d2, "the fixture package image loaded from a postbell-file address (160 x 90)")
check("Klasör dışı önizleme | not loaded" in d2, "the store file did not load from a postbell-file address")

b = base / "b"; b.mkdir(); (b / "store.json").write_text("{broken", encoding="utf-8")
say("2. corrupt store; data folder", b)
r3 = base / "r3.json"; rc = run(["--self-test", str(r3), "--self-test-add-record", "--data-dir", str(b)])
d3 = rendered(r3); say("  exit", rc, "dump:", d3)
copies = sorted(x.name for x in b.glob("store.unreadable-*.json"))
check("unreadable" in d3 and (b / "store.json").read_text(encoding="utf-8") == "{broken", "unreadable state, file not overwritten")
check("Daralt" not in d3, "no collapse button drawn for an unreadable store (its menu setting cannot be saved)")
check(len(copies) == 1 and (b / copies[0]).read_text(encoding="utf-8") == "{broken", f"copy taken: {copies}")

c = base / "c"; c.mkdir(); newer = '{"version": 5, "future": true}'; (c / "store.json").write_text(newer, encoding="utf-8")
say("3. store from a newer version; data folder", c)
r4 = base / "r4.json"; rc = run(["--self-test", str(r4), "--self-test-add-record", "--data-dir", str(c)])
d4 = rendered(r4); say("  exit", rc, "dump:", d4)
check("newer-version" in d4 and (c / "store.json").read_text(encoding="utf-8") == newer, "newer-version state, file unchanged")

s = base / "s"; s.mkdir()
FIX2 = (APP.parents[1] / "contracts/fixtures/globex").as_posix()
side = {**seed, "brands": [*seed["brands"], {"id": "globex", "name": "Globex", "sticker": "night", "folder": FIX2}],
        "groups": [{"id": "musteri-a", "name": "Müşteri A", "open": False, "brands": ["globex"]}],
        "accounts": [{"id": "initech-instagram-tr", "brand": "initech", "network": "instagram", "handle": "@initech.tr", "language": "tr",
                      "times": {"instagram-reels": "09:00", "instagram-post": "12:00"}}],
        "sidebar": {"collapsed": True, "width": 262, "openBrands": ["initech"]}}
(s / "store.json").write_text(json.dumps(side, indent=2), encoding="utf-8")
say("4. sidebar state; data folder", s)
r5 = base / "r5.json"; rc = run(["--self-test", str(r5), "--self-test-add-record", "--data-dir", str(s)])
d5 = rendered(r5); say("  exit", rc, "dump:", d5)
check(" MA " in f" {d5} " and "Müşteri A" not in d5, "narrow menu came from the store: the group shows as MA")
nav5 = d5.split(" | Genişlet | ")[0]
check(" | Genişlet | " in d5 and "Globex" not in nav5, "the closed group's brand is not drawn in the sidebar")
check("İçerikler" in d5, "the open brand's (Initech) pages are drawn")
after = json.loads((s / "store.json").read_text(encoding="utf-8"))
say("  rewritten store: sidebar", after["sidebar"], "groups", after["groups"], "records", len(after["records"]))
check(len(after["records"]) == 1 and after["sidebar"] == side["sidebar"] and after["groups"] == side["groups"],
      "the UI writer rewrote the store with the same sidebar and group fields")
say("  rewritten accounts:", after["accounts"])
check(after["accounts"] == side["accounts"], "the account's network, language and format times survive the rewrite")
say("  rewritten brands:", after["brands"])
check(after["brands"] == side["brands"], "brand names, stickers and folders survive the rewrite")

m = base / "m"; m.mkdir(); empty_dir = base / "empty-folder"; empty_dir.mkdir()
gone = (base / "moved").as_posix()
miss = {**seed, "brands": [{"id": "moved", "name": "Moved", "sticker": "camera", "folder": gone},
                           {"id": "empty-folder", "name": "Empty", "sticker": "night", "folder": empty_dir.as_posix()}]}
(m / "store.json").write_text(json.dumps(miss, indent=2), encoding="utf-8")
say("5. folder states; data folder", m)
r6 = base / "r6.json"; rc = run(["--self-test", str(r6), "--data-dir", str(m)])
d6 = rendered(r6); say("  exit", rc, "dump:", d6)
check(f"folder-missing: folder missing: {gone}" in d6, "a folder missing on disk comes as folder-missing")
check("0 paket, 0 reddedildi" in d6 and d6.count("folder-") == 2, "an empty folder is no error; only the moved folder and the outside read fail")

import shutil, statistics, re
src = APP.parents[1] / "contracts/fixtures/initech/2026-11-12/hidden-dog"
proto = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
big = base / "bench"
for i in range(500):
    day = f"2026-{11 + i // 300:02d}-{1 + (i // 10) % 28:02d}"
    d = big / day / f"p{i:04d}"; (d / "images").mkdir(parents=True)
    shutil.copy(src / "main.mp4", d / "main.mp4"); shutil.copy(src / "images/card-16x9.png", d / "images/card-16x9.png")
    (d / "manifest.json").write_text(json.dumps({**proto, "id": f"bench-{day}-p{i:04d}", "brand": "bench", "date": day}, indent=2), encoding="utf-8")
q = base / "q"; q.mkdir()
(q / "store.json").write_text(json.dumps({**seed, "brands": [{"id": "bench", "name": "Bench", "sticker": "camera", "folder": big.as_posix()}]}, indent=2), encoding="utf-8")
say("6. read time for 500 packages; data folder", q)
times = []
for k in range(5):
    r7 = base / f"r7-{k}.json"; run(["--self-test", str(r7), "--data-dir", str(q)])
    d7 = rendered(r7); m7 = re.search(r"([0-9]+) paket, ([0-9]+) reddedildi, ([0-9]+) ms", d7)
    say(f"  run {k + 1}:", m7.group(0) if m7 else d7)
    if m7 and m7.group(1) == "500" and m7.group(2) == "0": times.append(int(m7.group(3)))
check(len(times) == 5, "all five runs read 500 packages, 0 rejected")
if times:
    say(f"  times {times} ms; median {statistics.median(times)}, range {min(times)}-{max(times)}")
    check(statistics.median(times) < 1000, "median under 1000 ms (budget)")

say("RESULT:", "pass" if ok else "FAIL")
pathlib.Path(sys.argv[1]).write_text("\n".join(log) + "\n", encoding="utf-8")
sys.exit(0 if ok else 1)
