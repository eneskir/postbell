fn main() {
    // Undocumented MSVC linker flag: hash the content instead of timestamps, so the same source builds a byte-identical exe.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg=/Brepro");
        // LOAD_LIBRARY_SEARCH_SYSTEM32 for the exe's own imports: the setup exe runs from the download folder, where a
        // planted DLL would otherwise be found before the system one.
        println!("cargo:rustc-link-arg=/DEPENDENTLOADFLAG:0x800");
    }
    let conf = std::fs::read_to_string("tauri.conf.json").expect("cannot read tauri.conf.json");
    let key = "\"publisher\": \"";
    let start = conf.find(key).expect("tauri.conf.json: bundle.publisher missing") + key.len();
    let end = start + conf[start..].find('"').expect("tauri.conf.json: bundle.publisher is not closed");
    println!("cargo:rustc-env=POSTBELL_PUBLISHER={}", &conf[start..end]);
    println!("cargo:rerun-if-changed=tauri.conf.json");
    tauri_build::build()
}
