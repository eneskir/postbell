# Builds fixture data for a visible window check in the temp folder: python -I -X utf8 apps/desktop/tools/visual/visible-data.py [--window-folder <path>]
# `--window-folder` also copies globex there, since the screen tool cannot type a path into a Windows folder window.
import json, pathlib, shutil, sys, tempfile, time

REPO = pathlib.Path(__file__).resolve().parents[4]
root = pathlib.Path(tempfile.gettempdir()) / f"postbell-visible-{int(time.time())}"
(root / "data").mkdir(parents=True)
for name in ("initech", "globex"):
    shutil.copytree(REPO / "contracts/fixtures" / name, root / "brands" / name)
if "--window-folder" in sys.argv:
    target = pathlib.Path(sys.argv[sys.argv.index("--window-folder") + 1]) / "globex"
    shutil.copytree(REPO / "contracts/fixtures/globex", target)
    print("for the folder window:", target)

store = {
    "version": 1,
    "brands": [{"id": "initech", "name": "Initech", "sticker": "camera", "folder": (root / "brands/initech").as_posix()}],
    "groups": [
        {"id": "musteri-a", "name": "Müşteri A", "open": True, "brands": []},
        {"id": "musteri-b", "name": "Müşteri B", "open": False, "brands": []},
    ],
    "accounts": [{"id": "initech-instagram-tr", "brand": "initech", "network": "instagram", "handle": "@initech.tr",
                  "language": "tr", "times": {"instagram-reels": "09:00", "instagram-post": "12:00"}}],
    "records": [],
    "settings": {},
    "sidebar": {"collapsed": False, "width": 240, "openBrands": ["initech"]},
}
(root / "data/store.json").write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
for d in (root / "brands").iterdir():
    print(d.name, sum(1 for p in d.rglob("*") if p.is_file()), "files")
print(root)
print("open:", (REPO / "apps/desktop/src-tauri/target/release/postbell.exe"), "--data-dir", (root / "data").as_posix())
