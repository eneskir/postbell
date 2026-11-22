import type { ContentFile, Language, Platform } from "../core/manifest.ts";
import type { SetupStep } from "../core/accounts.ts";
import type { ContentGroup, ContentTag } from "../core/contents.ts";
import type { HistoryFilter } from "../core/history.ts";
import { networkOf, plannedDate, type Network, type Share, type ShareRecord, type TodayGroups, type TwoStep } from "../core/shares.ts";
import { DAY, dateOf, formatTime, timeOf, type LocalDate, type LocalMs, type TimeOfDay } from "../core/time.ts";
import type { PackageRejection } from "../core/packages.ts";
import type { BrandProblem } from "../core/today.ts";
import type { StickerName } from "./assets.gen.ts";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const SHORT_DAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

function dayAfter(day: LocalDate, today: LocalDate): string {
  const ms = Date.parse(`${day}T00:00:00Z`);
  const d = new Date(ms);
  return Math.round((ms - Date.parse(`${today}T00:00:00Z`)) / DAY) === 1 ? "yarın" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${DAYS[d.getUTCDay()]}`;
}

// The day of a content's next share: «Sıradaki» for today, «Dün», «Yarın», the weekday within the next week, else «24 Kasım».
function dayWord(day: LocalDate, today: LocalDate): string {
  const ms = Date.parse(`${day}T00:00:00Z`);
  const diff = Math.round((ms - Date.parse(`${today}T00:00:00Z`)) / DAY);
  const d = new Date(ms);
  if (diff === 0) return "Sıradaki";
  if (diff === -1) return "Dün";
  if (diff === 1) return "Yarın";
  return diff > 1 && diff < 7 ? (DAYS[d.getUTCDay()] ?? "") : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// Possessive suffix after a number, by how its last word is read: «1'i», «2'si», «6'sı», «10'u», «100'ü».
const UNITS = ["", "i", "si", "ü", "ü", "i", "sı", "si", "i", "u"];
const TENS = ["", "u", "si", "u", "ı", "si", "ı", "i", "i", "ı"];
export function possessive(n: number): string {
  const a = Math.abs(Math.trunc(n));
  if (a === 0) return "ı";
  if (a % 10) return UNITS[a % 10] ?? "";
  if (a % 100) return TENS[(a % 100) / 10] ?? "";
  if (a % 1000) return "ü";
  if (a % 1_000_000) return "i";
  return "u";
}

// Dative suffix after a number, by how its last word is read: «1'e», «2'ye», «6'ya», «10'a», «20'ye», «100'e».
// For a version the last part is read: «0.1.1'e», «0.2.0'a».
const DATIVE_UNITS = ["a", "e", "ye", "e", "e", "e", "ya", "ye", "e", "a"]; // units 0-9
const DATIVE_TENS = ["", "a", "ye", "a", "a", "ye", "a", "e", "e", "a"]; // tens 10-90
export function dative(n: number): string {
  const a = Math.abs(Math.trunc(n));
  if (a === 0) return "a";
  if (a % 10) return DATIVE_UNITS[a % 10] ?? "e";
  if (a % 100) return DATIVE_TENS[(a % 100) / 10] ?? "a";
  if (a % 1_000_000) return "e";
  return "a";
}
const versionDative = (v: string) => `${v}'${dative(Number(v.split(".").at(-1)))}`;

const SETUP_ERRORS: Readonly<Record<string, readonly [title: string, fix: string]>> = {
  SETUP_APP_RUNNING: ["Postbell kapanmadı", "Postbell'i kapatıp yeniden dene."],
  SETUP_WRITE_FAILED: ["Dosyalar yazılamadı", "Diskte yer olduğuna bak, sonra yeniden dene."],
  SETUP_DATA_MOVE_FAILED: ["Postbell'in verisi taşınamadı", "Klasörü açık tutan pencereyi kapatıp yeniden dene."],
  SETUP_SHORTCUT_FAILED: ["Kısayol oluşturulamadı", "Yeniden dene; sürerse bilgisayarı yeniden başlat."],
  SETUP_REGISTRY_FAILED: ["Windows kaydı yazılamadı", "Yeniden dene; sürerse bilgisayarı yeniden başlat."],
  SETUP_OPEN_FAILED: ["Postbell açılmadı", "Postbell'i Başlat menüsünden aç."],
  UNINSTALL_DIR_LOCKED: ["Kurulum klasörü silinemedi", "Klasörü açık tutan pencereyi kapatıp yeniden dene."],
  UNINSTALL_DATA_LOCKED: ["Postbell'in verisi silinemedi", "Klasörü açık tutan pencereyi kapatıp yeniden dene."],
  UNINSTALL_VAULT_FAILED: ["Kayıtlı şifreler silinemedi", "Yeniden dene."],
  UNINSTALL_SHORTCUT_FAILED: ["Kısayol silinemedi", "Yeniden dene."],
  UNINSTALL_REGISTRY_FAILED: ["Windows kaydı silinemedi", "Yeniden dene."],
};

// Genitive after the possessive: «1'inin», «2'sinin», «6'sının», «10'unun».
export function possessiveGenitive(n: number): string {
  const p = possessive(n);
  const v = p.at(-1) ?? "ı";
  return `${p}n${v}n`;
}

// Locative suffix after a time: the minutes are read unless zero, else the hour: «09:00'da», «14:15'te», «18:40'ta».
const AT_UNITS = ["da", "de", "de", "te", "te", "te", "da", "de", "de", "da"]; // units 0-9
const AT_TENS = ["", "da", "de", "da", "ta", "de"]; // tens 10-50
export function atSuffix(t: TimeOfDay): string {
  const n = t % 60 || Math.floor(t / 60);
  return (n % 10 || n === 0 ? AT_UNITS[n % 10] : AT_TENS[n / 10]) ?? "da";
}

const atTime = (t: TimeOfDay) => `${formatTime(t)}'${atSuffix(t)}`;

const NO_TIME = "--:--";

function delay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} dk`;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

const interval = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} saat` : `${minutes} dakika`);

const FORMATS = {
  x: "X",
  "instagram-reels": "Instagram Reels",
  "instagram-post": "Instagram Gönderi",
  tiktok: "TikTok",
  "youtube-shorts": "YouTube Shorts",
  pinterest: "Pinterest",
} satisfies Record<Platform, string>;

// Network name with its locative suffix, by pronunciation: X is read «eks», Threads «treds», YouTube «yutub».
const NETWORK_NAMES = {
  x: ["X", "te"],
  instagram: ["Instagram", "da"],
  threads: ["Threads", "te"],
  tiktok: ["TikTok", "ta"],
  youtube: ["YouTube", "da"],
  pinterest: ["Pinterest", "te"],
} satisfies Record<Network, readonly [string, string]>;
const networkName = (p: Platform) => NETWORK_NAMES[networkOf(p)][0];
const networkAtOf = (n: Network) => `${NETWORK_NAMES[n][0]}'${NETWORK_NAMES[n][1]}`;
// The accusative suffix, as in «Instagram'ı aç».
const NETWORK_ACCUSATIVE = { x: "i", instagram: "ı", threads: "i", tiktok: "u", youtube: "u", pinterest: "i" } satisfies Record<Network, string>;

const LANGUAGE_NAMES = { en: "İngilizce", tr: "Türkçe" } satisfies Record<Language, string>;
const TWO_STEP_NAMES: Record<TwoStep, string> = { none: "Yok", app: "Doğrulama uygulaması", sms: "SMS", email: "E-posta", key: "Güvenlik anahtarı" };

const removedParts = (hasTimes: boolean, secret: "password" | "codes" | null) => {
  const parts = ["Hesap", ...(hasTimes ? ["paylaşım saatleri"] : []), ...(secret ? [secret === "password" ? "kasadaki şifresi" : "kasadaki yedek kodları"] : [])];
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} ve ${parts.at(-1)}`;
};

const accountLabel = (n: Network, language: Language | null) => (language ? `${NETWORK_NAMES[n][0]} (${LANGUAGE_NAMES[language]})` : NETWORK_NAMES[n][0]);

// File size in base 1024 like Windows Explorer; one decimal below 10.
const SIZE_UNITS = [
  ["GB", 1024 ** 3],
  ["MB", 1024 ** 2],
  ["KB", 1024],
] as const;
export function fileSize(bytes: number): string {
  for (const [unit, factor] of SIZE_UNITS) {
    if (bytes < factor) continue;
    const v = bytes / factor;
    const n = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
    return `${String(n).replace(".", ",")} ${unit}`;
  }
  return `${bytes} bayt`;
}

export function duration(seconds: number): string {
  const t = Math.round(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(t % 60)}` : `${m}:${pad(t % 60)}`;
}

export const text = {
  loading: "Yükleniyor",
  sharesLoading: "Paylaşımlar yükleniyor…",
  version: (v: string) => `Sürüm ${v}`,
  appInfoError: (code: string) => `Sürüm okunamadı. Uygulamayı kapatıp yeniden açın. (${code})`,
  delay,
  lateBadge: (n: number) => `${n} gecikti`,
  todaySummary: (total: number, late: number, unscheduled = 0) => {
    const parts = [`${total} paylaşım`];
    if (late) parts.push(`${late}'${possessive(late)} gecikti`);
    if (unscheduled) parts.push(`${unscheduled}'${possessiveGenitive(unscheduled)} saati yok`);
    return `${parts.join(", ")}.`;
  },
  page: {
    home: "Ana sayfa",
    today: "Bugün",
    contents: "İçerikler",
    calendar: "Takvim",
    accounts: "Hesaplar",
    history: "Geçmiş",
    settings: "Ayarlar",
    brandNew: "Marka ekle",
    brandSettings: "Marka ayarları",
  },
  nav: {
    label: "Gezinme",
    collapse: "Daralt",
    expand: "Genişlet",
    resize: "Menü genişliği",
    groupAdd: (group: string) => `${group} grubuna marka ekle`,
    groupMenu: (group: string) => `${group} grubunun menüsü`,
    brandMenu: (brand: string) => `${brand} menüsü`,
    groupName: "Grup adı",
    rename: "Yeniden adlandır",
    newGroup: "Yeni grup",
    removeGroup: "Grubu sil",
    moveToGroup: "Gruba taşı",
    ungroup: "Gruptan çıkar",
    removeBrand: "Markayı kaldır…",
    saveError: (code: string) => `Değişiklik kaydedilemedi; Postbell kapanınca kaybolur. (${code})`,
  },
  crumbs: "Konum",
  window: { minimize: "Küçült", maximize: "Büyüt", close: "Kapat" },
  panel: { label: "Ayrıntı", close: "Paneli kapat" },
  nowLine: (ms: LocalMs) => {
    const d = new Date(ms);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${DAYS[d.getUTCDay()]} · ${formatTime(timeOf(ms))}`;
  },
  store: {
    errorTag: "Yüklenemedi",
    errorTitle: "Paylaşım kayıtları açılamıyor",
    errorBody: (code: string) => `Postbell'in kayıt dosyası okunamadı. Yeniden dene; sürerse Postbell'i kapatıp aç. (${code})`,
    newerBody: "Kayıt dosyasını Postbell'in daha yeni bir sürümü yazmış. Postbell'i güncelleyip yeniden aç. (store-newer-version)",
    retry: "Yeniden dene",
    emptyTitle: "Henüz marka yok",
    emptyBody: "Marka ekle ve içerik klasörünü seç; paylaşımlar burada görünür.",
  },
  brandForm: {
    groupBrand: "Marka",
    name: "Ad",
    sticker: "Çıkartma",
    stickerCurrent: (name: string) => `Seçili çıkartma: ${name}`,
    stickerPick: "Başka seç",
    stickerMenu: "Çıkartmalar",
    folder: "İçerik klasörü",
    folderHelp: "Hazır içeriklerin durduğu klasör. Seçmeden marka oluşmaz.",
    folderNone: "Seçilmedi",
    folderPick: "Klasör seç",
    folderChange: "Değiştir",
    groupAccounts: "Hesaplar",
    accountsLater: "Hesaplar sonra eklenir.",
    create: "Markayı oluştur",
    cancel: "Vazgeç",
    nameTaken: "Bu adla bir marka var.",
    folderTaken: (brand: string) => `Bu klasörü ${brand} markası kullanıyor.`,
    dialogError: (code: string) => `Klasör penceresi açılamadı. Yeniden dene. (${code})`,
    folderHelpSettings: "Hazır içeriklerin durduğu klasör.",
    groupTimes: "Paylaşım saatleri",
    timeRow: (handle: string, format: string) => `${handle} · ${format}`,
    timeEmpty: NO_TIME,
    timeInvalid: "Saat 00:00 ile 23:59 arasında olmalı.",
    timesNoAccounts: "Hesap eklenince saatleri burada girilir.",
    groupRemove: "Kaldırma",
    remove: "Markayı kaldır",
    removeHelp: "Postbell'deki kayıtlar silinir, dosyalarına dokunulmaz.",
    removeOpen: "Kaldır…",
  },
  removeBrand: {
    title: (brand: string) => `${brand} kaldırılsın mı?`,
    body: (accounts: number) =>
      `${accounts > 0 ? `Marka, ${accounts} hesabı ve paylaşım kayıtları` : "Marka ve paylaşım kayıtları"} Postbell'den silinir. İçerik klasörüne ve dosyalarına dokunulmaz. Bu işlem geri alınamaz.`,
    confirm: "Markayı kaldır",
    cancel: "Vazgeç",
  },
  accounts: {
    summary: (total: number, missing: number) =>
      missing === 0 ? `${total} hesap.` : missing === total ? `${total} hesap eklenmedi.` : `${total} hesap, ${missing}'${possessive(missing)} eklenmedi.`,
    loading: "Hesaplar yükleniyor…",
    head: { network: "Platform", handle: "Kullanıcı adı", email: "E-posta", passwordLabel: "Şifre", twoStep: "2 adımlı" },
    network: (n: Network) => NETWORK_NAMES[n][0],
    language: (l: Language) => LANGUAGE_NAMES[l],
    label: accountLabel,
    none: "–",
    // Table cell: whether the account has 2-step verification; empty when the user has not said.
    twoStepShort: (t: TwoStep | undefined) => (t === undefined ? "–" : t === "none" ? "Yok" : "Var"),
    twoStepName: (t: TwoStep) => TWO_STEP_NAMES[t],
    twoStepUnset: "Belirtilmedi",
    passwordHidden: "••••••••",
    withInstagram: "Instagram ile",
    unreadable: "Okunamadı",
    codesStored: (n: number) => `${n} kod, kasada`,
    vaultError: "Şifre kasası açılamıyor. Hesaplar görünür, şifreler okunamıyor.",
    retry: "Yeniden dene",
    stepPassword: "1 · Şifreyi al",
    stepOpen: "2 · Platformu aç",
    open: "Platformu aç",
    copy: "Şifreyi kopyala",
    show: "Şifreyi göster",
    hide: "Şifreyi gizle",
    openNetwork: (n: Network) => `${NETWORK_NAMES[n][0]}'${NETWORK_ACCUSATIVE[n]} aç`,
    revealNote: "30 sn sonra gizlenir; kopya da panodan silinir.",
    vaultErrorNote: "Kasa açılınca şifre yeniden kopyalanabilir. Platformu şifresiz açabilirsin.",
    copied: "Şifre kopyalandı; 30 sn sonra panodan silinir.",
    copyFailed: (code: string) => `Şifre kopyalanamadı. (${code})`,
    revealFailed: (code: string) => `Şifre okunamadı. (${code})`,
    openFailed: (code: string) => `Platform açılamadı. (${code})`,
    add: "Hesap ekle",
    emptyTitle: "İlk hesabını ekle",
    emptyBody: "İlk hesabı ekle; paylaşımlar hesaplarına düşer.",
    eyebrowNew: "Hesap ekle",
    eyebrowEdit: "Hesabı düzenle",
    eyebrowView: "Hesap",
    detail: { language: "Dil", email: "E-posta", passwordLabel: "Şifre", twoStep: "2 adımlı", codes: "Yedek kod", recoveryEmail: "Kurtarma", note: "Not" },
    editDetails: "Bilgileri düzenle",
    openLabel: (n: Network, handle: string) => `${NETWORK_NAMES[n][0]} ${handle}`,
    newTitle: (n: Network, language: Language | null) => `${accountLabel(n, language)} hesabı ekle`,
    editTitle: (handle: string, n: Network) => `${handle} · ${NETWORK_NAMES[n][0]}`,
    fieldNetwork: "Platform",
    fieldHandle: "Kullanıcı adı",
    fieldLanguage: "İçerik dili",
    fieldEmail: "E-posta",
    fieldPassword: "Şifre",
    fieldCodes: "Yedek kodlar",
    passwordKeep: "Değiştirmek için yenisini yaz",
    codesKeep: (n: number) => `${n} kod kasada. Değiştirmek için yenilerini yaz.`,
    codesPlaceholder: "Her satıra bir kod",
    vaultNote: "Şifre ve kodlar bu bilgisayarın kasasında durur.",
    vaultWriteFailed: (code: string) => `Şifre kasaya yazılamadı; hesap kaydedilmedi. (${code})`,
    vaultTooLarge: "Şifre ve kodlar kasaya sığmıyor; kodları kısalt.",
    vaultRemoveFailed: (code: string) => `Hesap kaldırıldı ama kasadaki şifresi silinemedi. (${code})`,
    fieldTwoStep: "2 adımlı doğrulama",
    fieldRecoveryEmail: "Kurtarma e-postası",
    fieldNote: "Not",
    optional: "İsteğe bağlı",
    handleEmpty: "Kullanıcı adını yaz; hesabı Postbell'de bu adla görürsün.",
    handleTaken: "Bu hesap zaten ekli.",
    languageTaken: (n: Network, by: string) => `${networkAtOf(n)} bu dilde ${by} var; her dilde tek hesap olur.`,
    save: "Hesabı kaydet",
    saveEdit: "Kaydet",
    cancel: "Vazgeç",
    removeOpen: "Hesabı kaldır…",
    added: (handle: string) => `${handle} eklendi.`,
    removed: (handle: string) => `${handle} kaldırıldı.`,
  },
  removeAccount: {
    title: (handle: string, n: Network) => `${handle} · ${NETWORK_NAMES[n][0]} kaldırılsın mı?`,
    body: (n: Network, hasTimes: boolean, secret: "password" | "codes" | null) =>
      `${removedParts(hasTimes, secret)} Postbell'den silinir. ${networkAtOf(n)}ki hesabına dokunulmaz. Bu işlem geri alınamaz.`,
    confirm: "Hesabı kaldır",
    cancel: "Vazgeç",
  },
  // Ayarlar › Şifre kasası and its two dialogs (`settings/V1 · backup-dialog`, `· restore-dialog`, `· restore-error`).
  backup: {
    group: "Şifre kasası",
    row: "Kasa",
    rowNote: "Şifreler yalnız bu bilgisayarda durur.",
    // «Son yedek: 3 Kasım»; another year adds it.
    last: (at: LocalMs, today: LocalDate) => {
      const day = dateOf(at);
      const d = new Date(`${day}T00:00:00Z`);
      const year = day.slice(0, 4) === today.slice(0, 4) ? "" : ` ${d.getUTCFullYear()}`;
      return `Son yedek: ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`;
    },
    never: "Henüz yedek yok",
    save: "Yedek al",
    restore: "Yedekten yükle",
    saveTitle: "Kasanın yedeğini al",
    saveBody: "Parolayı unutursan yedek açılmaz; Postbell onu saklamaz.",
    passphrase: "Yedek parolası",
    passphraseHint: "En az 12 karakter.",
    passphraseAgain: "Parolayı yeniden yaz",
    mismatch: "Parolalar aynı değil.",
    empty: "Kasada yedeklenecek şifre yok.",
    saveButton: "Yedeği kaydet…",
    saved: (n: number) => `${n} hesabın şifresi yedeğe alındı.`,
    saveFailed: (code: string) => `Yedek kaydedilemedi. (${code})`,
    restoreTitle: "Yedekten yükle",
    restoreBody: "Aynı hesabın buradaki şifresi yedektekiyle değişir.",
    file: "Yedek dosyası",
    restoreButton: "Yükle",
    unreadable: "Yedek açılamadı: parola yanlış ya da dosya bozuk. Kasada hiçbir şey değişmedi.",
    restored: (n: number, skipped: number) => `${n} hesabın şifresi yüklendi${skipped > 0 ? `; ${skipped} hesap bu bilgisayarda yok` : ""}.`,
    restoreFailed: (code: string) => `Yedek yüklenemedi; kasada hiçbir şey değişmedi. (${code})`,
    pickFailed: (code: string) => `Yedek dosyası seçilemedi. (${code})`,
    cancel: "Vazgeç",
    // `accounts/V1 · backup-reminder`
    reminder: (kind: "new-account" | "changed-password") =>
      kind === "new-account" ? "Yeni hesabın şifresi yedekte yok. Bilgisayar değişirse kaybolur." : "Değişen şifre yedekte yok. Bilgisayar değişirse kaybolur.",
    later: "Sonra",
  },
  folder: {
    tag: "Yüklenemedi",
    missingTitle: "İçerik klasörüne ulaşılamıyor",
    missingBody: "Klasör taşınmış ya da disk bağlı değil.",
    unreadableTitle: "İçerik klasörü okunamıyor",
    unreadableBody: (code: string) => `Postbell klasörü açamadı; klasörün Windows izinlerine bak ya da başka klasör seç. (${code})`,
    retry: "Yeniden dene",
    settings: "Marka ayarlarını aç",
    emptyTitle: "İçerik bekleniyor",
    emptyBody: "Onayladığın içerikler buraya düşer.",
    rejected: (count: number) => (count === 1 ? "Bir paket okunamadı." : `${count} paket okunamadı.`),
    rejectedItem: (dir: string, why: PackageRejection) => `${dir}: ${rejectionText(why)}`,
  },
  today: {
    groups: { late: "Gecikti", upcoming: "Sırada", unscheduled: "Saat yok", finished: "Bitenler" } satisfies Record<keyof TodayGroups, string>,
    noTime: NO_TIME,
    due: "Saati geldi",
    skipped: "Atlandı",
    fileMissing: "Dosya yok",
    undo: "Geri al",
    undoLabel: (title: string, format: string) => `Geri al: ${title}, ${format}`,
    emptyTitle: "Bugün boş",
    next: (at: LocalMs, today: LocalDate) => `Sıradaki ${dayAfter(dateOf(at), today)} ${atTime(timeOf(at))}.`,
    later: (contents: number, first: LocalDate, today: LocalDate) => `Klasörde ${contents} içerik var; ilki ${dayAfter(first, today)}.`,
    noNext: "Planlanmış başka paylaşım yok.",
    openCalendar: "Takvimi aç",
    setupNotice: "Bildirim için hesap ve paylaşım saati gerekiyor.",
    setupAction: { "add-account": "Hesap ekle", "enter-times": "Saatleri gir" } satisfies Record<SetupStep, string>,
  },
  contents: {
    summary: (total: number, today: number) => (today ? `${total} içerik, ${today}'${possessive(today)} bugün.` : `${total} içerik.`),
    loading: "İçerikler yükleniyor…",
    groups: { today: "Bugün", planned: "Planlı", done: "Bitenler" } satisfies Record<ContentGroup, string>,
    shared: (done: number, total: number) => `${done} / ${total} paylaşıldı`,
    next: (s: Share, today: LocalDate) => {
      const time = s.plannedAt.kind === "at" ? formatTime(timeOf(s.plannedAt.at)) : NO_TIME;
      return `${dayWord(plannedDate(s), today)} ${time}`;
    },
    none: "–",
    tag: (t: ContentTag) => (t.kind === "late" ? `${t.count} gecikti` : t.kind === "file-missing" ? text.today.fileMissing : t.kind === "due" ? text.today.due : text.today.skipped),
    eyebrow: (file: ContentFile) =>
      file.kind === "video" ? ["İçerik", "Video", ...(file.durationSec === undefined ? [] : [duration(file.durationSec)])].join(" · ") : "İçerik · Görsel",
    sharesTitle: (done: number, total: number) => `Paylaşımlar · ${done} / ${total}`,
    shareLine: (s: Share) => (s.account ? `${s.account.handle} · ${FORMATS[s.platform]}` : `${FORMATS[s.platform]} · hesap eklenmedi`),
    late: "Gecikti",
    done: "Paylaşıldı",
    goLate: (p: Platform) => `Geciken paylaşıma git: ${FORMATS[p]}`,
    goNext: (p: Platform) => `Sıradaki paylaşıma git: ${FORMATS[p]}`,
    skipLeft: "Kalan paylaşımları atla",
    skipLeftNote: "Geçmiş'ten geri alınır.",
  },
  calendar: {
    summary: (total: number, finished: number) => `Bu hafta ${total} paylaşım, ${finished}'${possessive(finished)} tamam.`,
    loading: "Takvim yükleniyor…",
    range: (first: LocalDate, last: LocalDate) => {
      const [a, b] = [new Date(`${first}T00:00:00Z`), new Date(`${last}T00:00:00Z`)];
      const [ay, by] = [a.getUTCFullYear(), b.getUTCFullYear()];
      const [am, bm] = [MONTHS[a.getUTCMonth()], MONTHS[b.getUTCMonth()]];
      if (ay !== by) return `${a.getUTCDate()} ${am} ${ay}-${b.getUTCDate()} ${bm} ${by}`;
      if (am !== bm) return `${a.getUTCDate()} ${am}-${b.getUTCDate()} ${bm} ${by}`;
      return `${a.getUTCDate()}-${b.getUTCDate()} ${bm} ${by}`;
    },
    day: (date: LocalDate) => {
      const d = new Date(`${date}T00:00:00Z`);
      return `${SHORT_DAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
    },
    today: "bugün",
    previous: "Önceki hafta",
    next: "Sonraki hafta",
    thisWeek: "Bugün",
    emptyTitle: "Bu hafta boş",
    emptyBody: "Başka haftaya oklarla geç.",
    noTime: "Saat yok",
    status: { late: "gecikti", due: "saati geldi", done: "paylaşıldı", skipped: "atlandı" } satisfies Record<Exclude<Share["status"]["kind"], "upcoming">, string>,
    shortFormats: {
      x: "X",
      "instagram-reels": "Reels",
      "instagram-post": "Gönderi",
      tiktok: "TikTok",
      "youtube-shorts": "Shorts",
      pinterest: "Pinterest",
    } satisfies Record<Platform, string>,
  },
  history: {
    summary: (total: number, skipped: number) => {
      const n = total.toLocaleString("tr-TR");
      return skipped ? `${n} paylaşım, ${skipped.toLocaleString("tr-TR")}'${possessive(skipped)} atlandı.` : `${n} paylaşım.`;
    },
    loading: "Geçmiş yükleniyor…",
    emptyTitle: "Geçmiş boş",
    emptyBody: "Paylaştığın ya da atladığın paylaşımlar burada birikir.",
    filterLabel: "Durum",
    filters: { all: "Tüm durumlar", done: "Paylaşılanlar", skipped: "Atlananlar" } satisfies Record<HistoryFilter, string>,
    noMatch: { all: "", done: "Paylaşılan yok.", skipped: "Atlanan yok." } satisfies Record<HistoryFilter, string>,
    // «Bugün», «Dün · 10 Kasım Salı», else «9 Kasım Pazartesi».
    day: (day: LocalDate, today: LocalDate) => {
      const ms = Date.parse(`${day}T00:00:00Z`);
      const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - ms) / DAY);
      const d = new Date(ms);
      const full = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${DAYS[d.getUTCDay()]}`;
      return diff === 0 ? "Bugün" : diff === 1 ? `Dün · ${full}` : full;
    },
    marked: (status: ShareRecord["status"], at: LocalMs) => {
      const d = new Date(at);
      return `${status === "done" ? "Paylaşıldı" : "Atlandı"} olarak işaretlendi: ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${formatTime(timeOf(at))}`;
    },
    gone: "İçerik klasörde yok; geri alınamaz.",
    undone: "Geri alındı.",
    more: (hidden: number) => `Daha eskileri göster (${hidden.toLocaleString("tr-TR")} kayıt)`,
  },
  home: {
    emptyTitle: "Bugün paylaşım yok",
    emptyBody: "Haftaya bakmak için markanın takvimini aç.",
    problem: (p: BrandProblem) => (p.kind === "missing" ? "klasör bulunamadı" : p.kind === "unreadable" ? "klasör okunamadı" : `${p.count} paket okunamadı`),
    problems: (items: readonly (readonly [name: string, reason: string])[]) => {
      const [only] = items;
      return items.length === 1 && only ? `${only[0]}: ${only[1]}.` : `${items.length} marka gösterilemiyor: ${items.map(([n]) => n).join(", ")}.`;
    },
    problemsDetail: (items: readonly (readonly [name: string, reason: string])[]) => items.map(([n, r]) => `${n}: ${r}`).join("\n"),
  },
  // `many`: the shell fills {n}; several alarms can land at once, e.g. after sleep.
  notify: {
    due: (handle: string, platform: Platform) => `Saati geldi: ${handle} · ${FORMATS[platform]}`,
    late: (minutes: number, handle: string, platform: Platform) => `${interval(minutes)} gecikti: ${handle} · ${FORMATS[platform]}`,
    format: (platform: Platform) => FORMATS[platform],
    open: "Aç",
    openHome: "Ana sayfayı aç",
    many: "{n} paylaşımın saati geldi",
  },
  tray: {
    open: "Postbell'i aç",
    quit: "Çık",
    tooltip: "Postbell",
    hiddenTitle: "Postbell arka planda çalışıyor",
    hiddenBody: "Bildirimler gelmeye devam eder. Kapatmak için simgedeki menüden Çık'ı seç.",
  },
  share: {
    eyebrow: (s: Share) =>
      [
        ...(s.account ? [s.account.handle, FORMATS[s.platform]] : [FORMATS[s.platform], "hesap eklenmedi"]),
        s.plannedAt.kind === "at" ? formatTime(timeOf(s.plannedAt.at)) : "saat yok",
      ].join(" · "),
    late: (minutes: number) => `${delay(minutes)} gecikti`,
    noTime: "Saat yok",
    done: (t: TimeOfDay) => `Paylaşıldı · ${formatTime(t)}`,
    skipped: (t: TimeOfDay) => `Atlandı · ${formatTime(t)}`,
    noTimeNotice: (platform: Platform) => `${FORMATS[platform]} için saat girilmemiş.`,
    addTime: "Saat ekle",
    fileLine: (file: ContentFile, size: number | null) => {
      const name = file.path.slice(file.path.lastIndexOf("/") + 1);
      if (size === null) return `${name} · bulunamadı`;
      const shape = file.kind === "video" && file.durationSec !== undefined ? duration(file.durationSec) : `${file.width} x ${file.height}`;
      return [name, shape, fileSize(size)].join(" · ");
    },
    steps: { prepare: "1 · Hazırla", share: "2 · Paylaş", mark: "3 · İşaretle" },
    copy: "Metni kopyala",
    reveal: "Dosyayı göster",
    open: (handle: string, platform: Platform) => `${handle} olarak ${networkAtOf(networkOf(platform))} aç`,
    accountCheck: (handle: string, platform: Platform) => `${networkAtOf(networkOf(platform))} açık hesap ${handle} mu, bir bak.`,
    addAccount: (platform: Platform) => `${networkName(platform)} hesabını ekle`,
    noAccount: (platform: Platform) => `Bu markada ${networkName(platform)} hesabı yok.`,
    fileWait: "Dosya bulununca açılır.",
    missingNotice: "Dosya taşınmış ya da silinmiş.",
    restore: "Dosyayı seç",
    mark: "Paylaşıldı olarak işaretle",
    undo: "Geri al",
    skip: "Bu paylaşımı atla",
    skipNote: "Geçmiş'ten geri alınır.",
  },
  toast: {
    copied: "Metin kopyalandı.",
    copyFailed: "Metin kopyalanamadı.",
    done: "Paylaşıldı olarak işaretlendi.",
    skipped: "Paylaşım atlandı.",
    skippedMany: (n: number) => `${n} paylaşım atlandı.`,
    fileMissing: "Dosya bulunamadı.",
    revealFailed: "Gezgin açılamadı.",
    openFailed: "Tarayıcı açılamadı.",
    textDropped: "Metin uzun olduğu için X'e eklenmedi; kopyalayıp yapıştır.",
    restored: "Dosya paketin klasörüne kopyalandı.",
    present: "Dosya yerinde.",
    fileType: (ext: string) => `Dosya türü farklı: ${ext} seçilmeli.`,
    restoreFailed: "Dosya kopyalanamadı.",
    undo: "Geri al",
  },
  formats: FORMATS,
  // Sticker names: not shown; used by screen readers and the picker tooltip.
  stickerNames: {
    camera: "Kamera",
    night: "Ay",
    crown: "Taç",
    guitar: "Gitar",
    "movie-clapper": "Klaket",
    "paint-brush": "Fırça",
    balloon: "Balon",
    anchor: "Çapa",
    tv: "Televizyon",
    flashlight: "El feneri",
    frame: "Çerçeve",
    rocket: "Roket",
    fire: "Ateş",
    trophy: "Kupa",
    bot: "Robot",
    plane: "Uçak",
    "coffee-cup-1": "Kahve",
    "hot-air-balloon": "Sıcak hava balonu",
    pizza: "Pizza",
    "ice-cream": "Dondurma",
    cake: "Pasta",
    sunny: "Güneş",
    snowflake: "Kar tanesi",
    thunderstorm: "Fırtına",
  } satisfies Record<StickerName, string>,
  setup: {
    welcome: "Postbell'i kur",
    version: (v: string) => `Sürüm ${v}`,
    desktop: "Masaüstüne kısayol",
    install: "Kur",
    installing: "Kuruluyor…",
    updateTitle: (from: string) => (from ? `Postbell ${from} kurulu` : "Postbell'in eski bir sürümü kurulu"),
    updateLine: (to: string) => `${versionDative(to)} güncellenir. Markaların ve kayıtların yerinde kalır.`,
    update: "Güncelle",
    updating: "Güncelleniyor…",
    sameTitle: (v: string) => `Postbell ${v} zaten kurulu`,
    reinstall: "Yeniden kur",
    newerTitle: "Daha yeni bir Postbell kurulu",
    newerLine: (installed: string, file: string) => `Kurulu sürüm ${installed}; bu dosya ${file}.`,
    installed: "Postbell kuruldu",
    updated: "Postbell güncellendi",
    open: "Postbell'i aç",
    close: "Kapat",
    confirmTitle: "Postbell kaldırılsın mı?",
    confirmLine: "Marka klasörlerindeki dosyalar silinmez.",
    removeData: "Markaları, hesapları ve kayıtları da sil",
    remove: "Kaldır",
    removing: "Kaldırılıyor…",
    cancel: "Vazgeç",
    removed: "Postbell kaldırıldı",
    removedLine: (dataRemoved: boolean) => (dataRemoved ? "Markaların, hesapların ve kayıtların da silindi." : "Markaların ve kayıtların yerinde kaldı; yeniden kurunca geri gelir."),
    retry: "Yeniden dene",
    forceClose: "Postbell'i kapat",
    progress: "İlerleme",
    tag: { install: "Kurulamadı", update: "Güncellenemedi", uninstall: "Kaldırılamadı", open: "Açılamadı" },
    stateCode: "SETUP_STATE_INVALID",
    stateTitle: "Kurulum başlamadı",
    error: (uninstall: boolean, code: string) => {
      const [title, fix] = SETUP_ERRORS[code] ?? (uninstall ? ["Kaldırma tamamlanmadı", "Yeniden dene."] : ["Kurulum tamamlanmadı", "Yeniden dene; sürerse kurulum dosyasını yeniden indir."]);
      return { title, line: `${fix} (${code})` };
    },
    stateLine: (code: string) => `Kurulum dosyasını yeniden indir. (${code})`,
  },
  placeholder: {
    body: "Bu sayfa henüz hazır değil.",
  },
  dev: {
    app: "Uygulama",
    store: "Kayıt dosyası",
    state: "Kayıt",
    contents: "İçerik",
    backup: "Okunamayan kaydın kopyası",
    outside: "Klasör dışı okuma",
    preview: "Önizleme",
    previewOutside: "Klasör dışı önizleme",
    stateLine: (state: string, records: number) => `${state}, ${records} kayıt`,
    contentsLine: (contents: number, rejected: number, ms: number) => `${contents} paket, ${rejected} reddedildi, ${ms} ms`,
  },
} as const;

function rejectionText(r: PackageRejection): string {
  switch (r.code) {
    case "manifest-unreadable":
      return "manifest okunamadı";
    case "manifest":
      return "manifest geçersiz";
    case "brand-mismatch":
      return `başka markanın paketi: ${r.brand}`;
    case "duplicate-id":
      return `aynı içerik iki kez: ${r.id}`;
  }
}
