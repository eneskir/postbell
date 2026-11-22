import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { accountRows, addAccount, draftFor, draftOf, removeAccount, setupStepOf, updateAccount, type AccountDraft } from "../core/accounts.ts";
import { alarmsOf, DEFAULT_NOTIFY } from "../core/alarms.ts";
import type { AppInfo, ParseResult } from "../core/app-info.ts";
import { addBrand, removeBrand, type BrandDraft } from "../core/brands.ts";
import type { Port, PortError, PortErrorCode } from "../core/port.ts";
import { dateOf } from "../core/time.ts";
import { loadStore, storeScreenOf, type Screen, type StoreScreenError } from "../core/screen.ts";
import { markShare } from "../core/panel-steps.ts";
import { contentRowOf, contentsView, skipLeft, type ContentRow } from "../core/contents.ts";
import { contentKeyOf, fileKeyOf, formatsOf, lateCount, networkOf, type Account, type AccountId, type BrandId, type ContentId, type Share, type ShareId, type ShareRecord } from "../core/shares.ts";
import { openBrand, sidebarOrder, toggleCollapsed } from "../core/sidebar.ts";
import { withoutRecord, withRecord, type StoreFile } from "../core/store.ts";
import { hasSecrets, vaultChangeOf, type VaultDraft } from "../core/vault.ts";
import { AccountDetail, AccountForm, AccountsPage, type AccountSelection, type VaultView } from "./accounts-page.tsx";
import { CalendarPage } from "./calendar-page.tsx";
import { HistoryPage } from "./history-page.tsx";
import { ContentPanel, ContentsPage, type ContentActions } from "./contents-page.tsx";
import { brandStatesOf, loadBrandPackages, readingOf, sharesOf, type BrandPackages } from "./brand-data.ts";
import { BrandNewPage } from "./brand-new.tsx";
import { BrandSettingsPage } from "./brand-settings.tsx";
import { instantOf, localNow, useNow } from "./clock.ts";
import { focusBack, Notice, SkeletonList, type Action, type ToastView } from "./components.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { loadDump, type Dump, type ImageProbe } from "./dev-dump.ts";
import { HomePage } from "./home-page.tsx";
import { alarmPlan } from "./notify.ts";
import { PageContent } from "./pages.tsx";
import { isRefreshKey } from "./refresh-keys.ts";
import { HOME, rowPick, viewOf, type PanelState, type Route } from "./route.ts";
import { SharePanel, type ShareActions } from "./share-panel.tsx";
import { Shell, type PanelView } from "./shell.tsx";
import { Sidebar } from "./sidebar.tsx";
import { stickerOf } from "./stickers.ts";
import { text } from "./text.ts";
import { TodayPage } from "./today-page.tsx";

type Dev = { readonly info: ParseResult<AppInfo>; readonly dump: Dump };

// The shell reads only folders already saved in the store, so packages are reread after the write.
const foldersOf = (s: StoreFile) => JSON.stringify(s.brands.map((b) => [b.id, b.folder]));

let readySent = false;

const probeImage: ImageProbe = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(`${img.naturalWidth} x ${img.naturalHeight}`);
    img.onerror = () => resolve(null);
    img.src = url;
  });

export function App({ port }: { port: Port }) {
  const [screen, setScreen] = useState<Screen<StoreFile, StoreScreenError>>({ kind: "loading" });
  // The ref holds the latest store so back-to-back updates do not overwrite each other.
  const [store, setStore] = useState<StoreFile | null>(null);
  const storeRef = useRef<StoreFile | null>(null);
  const [packages, setPackages] = useState<BrandPackages | null>(null);
  const [saveError, setSaveError] = useState<PortErrorCode | null>(null);
  const [vault, setVault] = useState<VaultView>({ kind: "loading" });
  const [vaultAttempt, setVaultAttempt] = useState(0);
  const [dev, setDev] = useState<Dev | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [route, setRoute] = useState<Route>(HOME);
  const before = useRef<Route>(HOME);
  const reading = useRef(0);
  const [panel, setPanel] = useState<PanelState>({ kind: "closed" });
  const [toast, setToast] = useState<ToastView | null>(null);
  const toastId = useRef(0);
  const say = useCallback((message: string, action?: Action) => setToast({ id: ++toastId.current, text: message, action }), []);
  const dismissToast = useCallback((id: number) => setToast((t) => (t?.id === id ? null : t)), []);
  const [removing, setRemoving] = useState<{ readonly brand: BrandId; readonly back: HTMLElement | null } | null>(null);
  const [removingAccount, setRemovingAccount] = useState<{ readonly id: AccountId; readonly back: HTMLElement | null } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const now = useNow();

  useEffect(() => {
    let live = true;
    setScreen({ kind: "loading" });
    (async () => {
      const selfTest = await port.selfTest();
      const dump = async () => ({ info: await port.appInfo(), dump: await loadDump(port, localNow(), selfTest.addRecord && attempt === 0, probeImage) });
      const early = selfTest.active ? await dump() : null;
      const loaded = await port.store.load();
      if (!live) return;
      const r = loadStore(loaded);
      setDev(early);
      setScreen(r.screen);
      setStore(r.store);
      storeRef.current = r.store;
      if (r.store) {
        const n = ++reading.current;
        const p = await loadBrandPackages(port, r.store);
        if (live && n === reading.current) setPackages(p);
      }
      if (!early && import.meta.env.DEV) {
        const late = await dump();
        if (live) setDev(late);
      }
    })();
    return () => {
      live = false;
    };
  }, [port, attempt]);

  // The shell shows the window only after the first real frame, which avoids a white flash.
  // `ready` errors are not shown here: the window may still be hidden, so the shell logs them; the tray icon still opens the window.
  useEffect(() => {
    if (screen.kind === "loading" || readySent) return;
    readySent = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const rendered = document.getElementById("root")?.innerText ?? "";
        void port.ready(rendered);
      }),
    );
  }, [screen, port]);

  const reloadPackages = useCallback(async () => {
    const s = storeRef.current;
    if (!s) return;
    const n = ++reading.current;
    const p = await loadBrandPackages(port, s);
    if (n === reading.current) setPackages(p);
  }, [port]);

  useEffect(() => {
    const onFocus = () => void reloadPackages();
    const onKey = (e: KeyboardEvent) => {
      if (!isRefreshKey(e)) return;
      e.preventDefault();
      void reloadPackages();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("keydown", onKey);
    };
  }, [reloadPackages]);

  const update = useCallback(
    (change: (s: StoreFile) => StoreFile) => {
      const prev = storeRef.current;
      if (!prev) return;
      const next = change(prev);
      if (next === prev) return;
      storeRef.current = next;
      setStore(next);
      setScreen(storeScreenOf(next));
      void port.store.save(next).then((r) => {
        setSaveError(r.ok ? null : r.error.code);
        if (r.ok && foldersOf(next) !== foldersOf(prev)) void reloadPackages();
      });
    },
    [port, reloadPackages],
  );

  const go = useCallback(
    (r: Route) => {
      setRoute((now) => {
        if (r.kind === "brand-new" && now.kind !== "brand-new") before.current = now;
        return r;
      });
      setPanel({ kind: "closed" });
      if (r.kind === "brand" || r.kind === "brand-settings") update((s) => openBrand(s, r.brand));
    },
    [update],
  );

  const lastRoute = useRef(route);
  useEffect(() => {
    if (lastRoute.current === route) return;
    lastRoute.current = route;
    const a = document.activeElement;
    if (!a || a === document.body) document.querySelector<HTMLElement>("main.page")?.focus();
  }, [route]);

  const shares = useMemo(() => (store && packages ? sharesOf(store, packages.packages, now) : []), [store, packages, now]);
  const late = useCallback((b: BrandId) => lateCount(shares, b), [shares]);
  const contents = useMemo(() => (route.kind === "brand" && route.page === "contents" ? contentsView(shares, route.brand, dateOf(now)) : null), [route, shares, now]);

  const showPanel = useCallback((next: PanelState) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(next);
  }, []);
  const openPanel = useCallback((share: ShareId) => showPanel({ kind: "share", share }), [showPanel]);
  const openAccountNew = useCallback((draft: AccountDraft, row: { readonly languageShown: boolean } | null) => showPanel({ kind: "account-new", draft, row }), [showPanel]);

  const closePanel = useCallback(() => {
    setPanel({ kind: "closed" });
    focusBack(opener.current);
  }, []);

  const pickRow = useCallback(
    (next: PanelState) => {
      const result = rowPick(panel, next);
      if (result.kind === "closed") closePanel();
      else showPanel(result);
    },
    [panel, closePanel, showPanel],
  );
  const pickShare = useCallback((share: ShareId) => pickRow({ kind: "share", share }), [pickRow]);

  useEffect(() => {
    if (panel.kind === "share" && store && packages && !shares.some((s) => s.id === panel.share)) closePanel();
    if (panel.kind === "account" && store && !store.accounts.some((a) => a.id === panel.account)) closePanel();
    if (panel.kind === "content" && packages && !(contents && contentRowOf(contents, panel.content))) closePanel();
  }, [panel, store, packages, shares, contents, closePanel]);

  const accountIds = store?.accounts.map((a) => a.id).join(" ") ?? null;
  useEffect(() => {
    if (accountIds === null) return;
    let live = true;
    void port.vault.status(accountIds === "" ? [] : (accountIds.split(" ") as AccountId[])).then((r) => {
      if (live) setVault(r.ok ? { kind: "ready", status: new Map(r.value.map((v) => [v.account, v])) } : { kind: "error", code: r.error.code });
    });
    return () => {
      live = false;
    };
  }, [port, accountIds, vaultAttempt]);
  const reloadVault = useCallback(() => setVaultAttempt((n) => n + 1), []);
  // A failed vault call may mean the vault itself is gone; the status says so on the page.
  const vaultFailed = useCallback(
    (e: PortError) => {
      if (e.code === "vault-unavailable") reloadVault();
    },
    [reloadVault],
  );

  // Not sent before packages load: an empty list moves the shell's last-check time and an alarm due meanwhile is lost.
  const sentPlan = useRef("");
  useEffect(() => {
    if (!store || !packages) return;
    const names = new Map(store.brands.map((b) => [b.id, b.name]));
    const order = sidebarOrder(store).map((b) => b.id);
    const plan = alarmPlan(alarmsOf(shares, order, DEFAULT_NOTIFY), shares, (b) => names.get(b) ?? b, instantOf);
    const key = JSON.stringify(plan);
    if (key === sentPlan.current) return;
    sentPlan.current = key;
    void port.alarms.set(plan).then((r) => {
      if (!r.ok && sentPlan.current === key) sentPlan.current = "";
    });
  }, [store, packages, shares, port]);

  useEffect(() => {
    void port.tray.set(text.tray);
  }, [port]);

  useEffect(
    () =>
      port.alarms.onOpen((target) => {
        if (target && storeRef.current?.brands.some((b) => b.id === target.brand)) {
          go({ kind: "brand", brand: target.brand, page: "today" });
          openPanel(target.share);
        } else go(HOME);
      }),
    [port, go, openPanel],
  );

  useEffect(() => {
    if (panel.kind === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel.kind, closePanel]);

  const createBrand = useCallback(
    (draft: BrandDraft, group?: string) => {
      const s = storeRef.current;
      const r = s && addBrand(s, draft, group);
      if (!r?.ok) return;
      update(() => r.store);
      go({ kind: "brand", brand: r.id, page: "today" });
    },
    [update, go],
  );

  const askRemove = useCallback((brand: BrandId, back: HTMLElement | null) => setRemoving({ brand, back }), []);
  const confirmRemove = () => {
    if (!removing) return;
    const id = removing.brand;
    setRemoving(null);
    const ofBrand = (r: Route) => (r.kind === "brand" || r.kind === "brand-settings") && r.brand === id;
    if (ofBrand(before.current)) before.current = HOME;
    if (ofBrand(route)) go(HOME);
    else if (panel.kind === "share" && panel.share.startsWith(`${id}/`)) setPanel({ kind: "closed" });
    removeSecrets(storeRef.current?.accounts.filter((a) => a.brand === id) ?? []);
    update((s) => removeBrand(s, id));
    document.querySelector<HTMLElement>("main.page")?.focus();
  };
  const cancelRemove = () => {
    setRemoving(null);
    focusBack(removing?.back);
  };

  const focusAccount = (id: AccountId) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-account="${id}"]`)?.focus());
  const vaultWriteError = (e: PortError) => (e.code === "vault-too-large" ? text.accounts.vaultTooLarge : text.accounts.vaultWriteFailed(e.code));
  // The vault is written first, so an account is never saved without the password typed for it.
  const createAccount = async (brand: BrandId, d: AccountDraft, secrets: VaultDraft): Promise<string | null> => {
    const s = storeRef.current;
    const r = s && addAccount(s, brand, d);
    if (!r?.ok) return null;
    const change = vaultChangeOf(secrets, true);
    if (change && hasSecrets(change)) {
      const w = await port.vault.write(r.id, change);
      if (!w.ok) {
        vaultFailed(w.error);
        return vaultWriteError(w.error);
      }
    } else if (change) {
      // Clears what an earlier account with the same id may have left in the vault.
      void port.vault.write(r.id, change);
    }
    update((cur) => {
      const again = addAccount(cur, brand, d);
      return again.ok ? again.store : cur;
    });
    reloadVault();
    setPanel({ kind: "closed" });
    focusAccount(r.id);
    const added = r.store.accounts.find((a) => a.id === r.id);
    if (added) say(text.accounts.added(added.handle));
    return null;
  };
  const saveAccount = async (id: AccountId, d: AccountDraft, secrets: VaultDraft): Promise<string | null> => {
    const s = storeRef.current;
    const r = s && updateAccount(s, id, d);
    if (!r?.ok) return null;
    const change = vaultChangeOf(secrets, false);
    if (change) {
      const w = await port.vault.write(id, change);
      if (!w.ok) {
        vaultFailed(w.error);
        return vaultWriteError(w.error);
      }
      reloadVault();
    }
    update((cur) => {
      const again = updateAccount(cur, id, d);
      return again.ok ? again.store : cur;
    });
    showDetail(id);
    return null;
  };
  const removeSecrets = (accounts: readonly Account[]) => {
    if (accounts.length === 0) return;
    void Promise.all(accounts.map((a) => port.vault.remove(a.id))).then((results) => {
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) say(text.accounts.vaultRemoveFailed(failed.error.code));
      reloadVault();
    });
  };
  const revealPassword = async (id: AccountId): Promise<string | null> => {
    const r = await port.vault.password(id);
    if (r.ok) return r.value;
    vaultFailed(r.error);
    say(text.accounts.revealFailed(r.error.code));
    return null;
  };
  const copyPassword = (id: AccountId) => {
    void port.vault.copy(id).then((r) => {
      if (r.ok) say(text.accounts.copied);
      else {
        vaultFailed(r.error);
        say(text.accounts.copyFailed(r.error.code));
      }
    });
  };
  // The network's first format's page; it asks the user to sign in when needed.
  const openNetworkOf = (a: Account) => {
    const first = formatsOf(a.network)[0];
    if (first === undefined) return null;
    return () =>
      void port.links.openSharePage(first, "").then((r) => {
        if (!r.ok) say(text.accounts.openFailed(r.error.code));
      });
  };
  // Back from the form to the account's details; focus goes to «Bilgileri düzenle».
  const showDetail = (id: AccountId) => {
    setPanel({ kind: "account", account: id });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".account-detail-end button")?.focus());
  };
  const askRemoveAccount = (id: AccountId) => setRemovingAccount({ id, back: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  const confirmRemoveAccount = () => {
    if (!removingAccount) return;
    const gone = storeRef.current?.accounts.find((a) => a.id === removingAccount.id);
    setRemovingAccount(null);
    setPanel({ kind: "closed" });
    if (gone) removeSecrets([gone]);
    update((s) => removeAccount(s, removingAccount.id));
    document.querySelector<HTMLElement>("main.page")?.focus();
    if (gone) say(text.accounts.removed(gone.handle));
  };
  const cancelRemoveAccount = () => {
    setRemovingAccount(null);
    focusBack(removingAccount?.back);
  };
  const addAccountFor = (s: Share) => {
    const network = networkOf(s.platform);
    go({ kind: "brand", brand: s.brand, page: "accounts" });
    openAccountNew({ network, handle: "", language: s.content.language }, { languageShown: (storeRef.current?.accounts ?? []).some((a) => a.brand === s.brand && a.network === network) });
  };
  const accountSelection: AccountSelection =
    panel.kind === "account" ? { kind: "account", id: panel.account } : panel.kind === "account-new" && panel.row ? { kind: "missing", network: panel.draft.network, language: panel.draft.language } : null;

  const brandOf = (id: BrandId) => {
    const b = store?.brands.find((x) => x.id === id);
    return { name: b?.name ?? id, sticker: stickerOf(b ?? { id, sticker: "" }) };
  };
  const view = viewOf(route, brandOf);
  const brandReading = (b: BrandId) => (packages ? readingOf(packages, b) : null);
  const settingsOf = route.kind === "brand-settings" ? store?.brands.find((b) => b.id === route.brand) : undefined;
  const page =
    route.kind === "brand-new" && store ? (
      <BrandNewPage store={store} pickFolder={() => port.dialogs.pickFolder()} onCreate={(d) => createBrand(d, route.group)} onCancel={() => go(before.current)} />
    ) : store && settingsOf ? (
      <BrandSettingsPage key={settingsOf.id} store={store} brand={settingsOf} pickFolder={() => port.dialogs.pickFolder()} update={update} onRemove={(back) => askRemove(settingsOf.id, back)} />
    ) : route.kind === "home" && store ? (
      <HomePage
        brands={packages ? brandStatesOf(store, packages) : null}
        shares={shares}
        now={now}
        selected={panel.kind === "share" ? panel.share : null}
        openPanel={pickShare}
        undo={(id) => update((s) => withoutRecord(s, id))}
        reread={() => void reloadPackages()}
        brandOf={brandOf}
      />
    ) : route.kind === "brand" && route.page === "accounts" && store ? (
      !packages && !store.accounts.some((a) => a.brand === route.brand) ? (
        <div className="page-body">
          <SkeletonList label={text.accounts.loading} groups={1} />
        </div>
      ) : (
        <AccountsPage
          rows={accountRows(store.accounts, route.brand, shares)}
          selected={accountSelection}
          openAccount={(account) => pickRow({ kind: "account", account })}
          addMissing={(r) => pickRow({ kind: "account-new", draft: { network: r.network, handle: "", language: r.language }, row: { languageShown: r.languageShown } })}
          addAny={() => openAccountNew(draftFor(store.accounts, route.brand, shares), null)}
          vault={vault}
          retryVault={reloadVault}
        />
      )
    ) : route.kind === "brand" && route.page === "contents" && store ? (
      <ContentsPage
        brand={route.brand}
        reading={brandReading(route.brand)}
        view={contents ?? contentsView(shares, route.brand, dateOf(now))}
        today={dateOf(now)}
        selected={panel.kind === "content" ? panel.content : null}
        thumbUrl={(r) => urlOf(placeOfFile(r.brand, r.content.id as ContentId, r.file.path))}
        openPanel={(content) => pickRow({ kind: "content", content })}
        go={go}
        reread={() => void reloadPackages()}
      />
    ) : route.kind === "history" && store ? (
      <HistoryPage
        records={store.records}
        shares={packages ? shares : null}
        today={dateOf(now)}
        brandOf={brandOf}
        undo={(id) => {
          update((st) => withoutRecord(st, id));
          say(text.history.undone);
        }}
      />
    ) : route.kind === "brand" && route.page === "calendar" ? (
      <CalendarPage
        key={route.brand}
        brand={route.brand}
        reading={brandReading(route.brand)}
        shares={shares}
        today={dateOf(now)}
        selected={panel.kind === "share" ? panel.share : null}
        compact={panel.kind !== "closed"}
        openPanel={pickShare}
        go={go}
        reread={() => void reloadPackages()}
      />
    ) : route.kind === "brand" && route.page === "today" ? (
      <TodayPage
        brand={route.brand}
        reading={brandReading(route.brand)}
        setup={store ? setupStepOf(store.accounts, route.brand) : null}
        shares={shares}
        now={now}
        selected={panel.kind === "share" ? panel.share : null}
        openPanel={pickShare}
        undo={(id) => update((s) => withoutRecord(s, id))}
        go={go}
        reread={() => void reloadPackages()}
      />
    ) : null;
  const unrecord = (id: ShareId) => {
    update((st) => withoutRecord(st, id));
    setToast(null);
  };
  const record = (s: Share, status: ShareRecord["status"]) => {
    // The mark time is the current whole minute (`localNow`), not `now`, which waits for the clock to advance.
    const r = markShare(s, status, localNow());
    if (!r.ok) return;
    update((st) => withRecord(st, r.record));
    say(status === "done" ? text.toast.done : text.toast.skipped, { label: text.toast.undo, onClick: () => unrecord(s.id) });
  };
  const placeOfFile = (brand: BrandId, content: ContentId, path: string) => {
    const folder = store?.brands.find((b) => b.id === brand)?.folder;
    const dir = packages?.packages.dirs.get(contentKeyOf(brand, content));
    if (folder === undefined || dir === undefined) return null;
    return { folder, path: `${dir}/${path}`, size: packages?.packages.sizes.get(fileKeyOf(brand, content, path)) ?? null };
  };
  const placeOf = (s: Share) => placeOfFile(s.brand, s.content.id as ContentId, s.file.path);
  const urlOf = (place: ReturnType<typeof placeOfFile>) => (place && place.size !== null ? port.files.url(place.folder, place.path) : null);
  const actionsOf = (s: Share, place: ReturnType<typeof placeOf>): ShareActions => ({
    copy: () =>
      navigator.clipboard.writeText(s.text).then(
        () => true,
        () => {
          say(text.toast.copyFailed);
          return false;
        },
      ),
    reveal: () => {
      if (!place) return say(text.toast.fileMissing);
      void port.files.reveal(place.folder, place.path).then((r) => {
        if (!r.ok) say(r.error.code === "file-missing" ? text.toast.fileMissing : text.toast.revealFailed);
      });
    },
    restore: () => {
      if (!place) return;
      void port.files.restore(place.folder, place.path).then((r) => {
        if (!r.ok) return say(r.error.code === "file-type" ? text.toast.fileType(r.error.detail) : text.toast.restoreFailed);
        if (r.value === "cancelled") return;
        say(r.value === "copied" ? text.toast.restored : text.toast.present);
        void reloadPackages();
      });
    },
    open: () =>
      void port.links.openSharePage(s.platform, s.text).then((r) => {
        if (!r.ok) say(text.toast.openFailed);
        else if (r.value === "text-dropped") say(text.toast.textDropped);
      }),
    mark: () => record(s, "done"),
    skip: () => record(s, "skipped"),
    undo: () => unrecord(s.id),
    addAccount: () => addAccountFor(s),
  });
  const removingBrand = removing && store?.brands.find((b) => b.id === removing.brand);
  const removedAccount = removingAccount && store?.accounts.find((a) => a.id === removingAccount.id);
  const shownAccount = panel.kind === "account" ? store?.accounts.find((a) => a.id === panel.account) : undefined;
  const selectedShare = panel.kind === "share" ? shares.find((s) => s.id === panel.share) : undefined;
  const place = selectedShare ? placeOf(selectedShare) : null;
  const selectedContent = panel.kind === "content" && contents ? contentRowOf(contents, panel.content) : null;
  const contentPlace = selectedContent ? placeOfFile(selectedContent.brand, selectedContent.content.id as ContentId, selectedContent.file.path) : null;
  const contentActionsOf = (r: ContentRow): ContentActions => ({
    reveal: () => {
      if (!contentPlace) return say(text.toast.fileMissing);
      void port.files.reveal(contentPlace.folder, contentPlace.path).then((x) => {
        if (!x.ok) say(x.error.code === "file-missing" ? text.toast.fileMissing : text.toast.revealFailed);
      });
    },
    goTo: (s) => {
      go({ kind: "brand", brand: s.brand, page: "today" });
      openPanel(s.id);
    },
    skipLeft: () => {
      // Same mark time as a single skip: the current whole minute.
      const skips = skipLeft(r, localNow());
      if (skips.length === 0) return;
      update((st) => skips.reduce(withRecord, st));
      // The skip button goes away with the shares left; focus moves to the content's row.
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-content="${CSS.escape(r.key)}"]`)?.focus());
      say(text.toast.skippedMany(skips.length), { label: text.toast.undo, onClick: () => {
          update((st) => skips.reduce((acc, x) => withoutRecord(acc, x.share), st));
          setToast(null);
        },
      });
    },
  });
  const panelView: PanelView | null = selectedShare
    ? {
        eyebrow: text.share.eyebrow(selectedShare),
        content: (
          <SharePanel
            key={selectedShare.id}
            share={selectedShare}
            size={place?.size ?? null}
            url={urlOf(place)}
            go={go}
            actions={actionsOf(selectedShare, place)}
          />
        ),
        onClose: closePanel,
      }
    : selectedContent
      ? {
          eyebrow: text.contents.eyebrow(selectedContent.file),
          content: <ContentPanel key={selectedContent.key} row={selectedContent} size={contentPlace?.size ?? null} url={urlOf(contentPlace)} actions={contentActionsOf(selectedContent)} />,
          onClose: closePanel,
        }
    : shownAccount && store
      ? panel.kind === "account" && panel.editing
        ? {
            eyebrow: text.accounts.eyebrowEdit,
            content: (
              <AccountForm
                key={shownAccount.id}
                store={store}
                brand={shownAccount.brand}
                initial={draftOf(shownAccount)}
                self={shownAccount.id}
                networkFixed
                title={() => text.accounts.editTitle(shownAccount.handle, shownAccount.network)}
                stored={vault.kind === "ready" ? vault.status.get(shownAccount.id) : undefined}
                onSave={(d, secrets) => saveAccount(shownAccount.id, d, secrets)}
                onCancel={() => showDetail(shownAccount.id)}
                onRemove={() => askRemoveAccount(shownAccount.id)}
              />
            ),
            onClose: closePanel,
          }
        : {
            eyebrow: text.accounts.eyebrowView,
            content: (
              <AccountDetail
                key={shownAccount.id}
                account={shownAccount}
                vault={vault}
                onEdit={() => setPanel({ kind: "account", account: shownAccount.id, editing: true })}
                reveal={() => revealPassword(shownAccount.id)}
                copy={() => copyPassword(shownAccount.id)}
                openNetwork={openNetworkOf(shownAccount)}
              />
            ),
            onClose: closePanel,
          }
      : panel.kind === "account-new" && store && route.kind === "brand"
        ? {
            eyebrow: text.accounts.eyebrowNew,
            content: (
              <AccountForm
                key={JSON.stringify(panel)}
                store={store}
                brand={route.brand}
                initial={panel.draft}
                networkFixed={panel.row !== null}
                title={(d) => text.accounts.newTitle(d.network, panel.row?.languageShown ? d.language : null)}
                onSave={(d, secrets) => createAccount(route.brand, d, secrets)}
                onCancel={closePanel}
              />
            ),
            onClose: closePanel,
          }
        : null;
  const collapsed = store?.sidebar.collapsed ?? false;
  const nav = <Sidebar store={store} collapsed={collapsed} route={route} go={go} late={late} update={update} onToggleCollapsed={() => update((s) => ({ ...s, sidebar: toggleCollapsed(s.sidebar) }))} onRemoveBrand={askRemove} />;

  return (
    <Shell port={port} nav={nav} sidebar={store?.sidebar ?? null} onSidebar={(next) => update((s) => ({ ...s, sidebar: next }))} view={view} now={text.nowLine(now)} panel={panelView} toast={toast && { view: toast, onDismiss: dismissToast }}>
      {saveError && (
        <div className="page-body">
          <Notice tone="danger">{text.nav.saveError(saveError)}</Notice>
        </div>
      )}
      <PageContent route={route} view={view} screen={screen} go={go} retry={() => setAttempt((a) => a + 1)} reading={brandReading} reread={() => void reloadPackages()}>
        {page}
      </PageContent>
      {route.kind === "home" && dev && <DevDump dev={dev} />}
      {removingBrand && (
        <ConfirmDialog
          title={text.removeBrand.title(removingBrand.name)}
          body={text.removeBrand.body(store?.accounts.filter((a) => a.brand === removingBrand.id).length ?? 0)}
          confirm={text.removeBrand.confirm}
          cancel={text.removeBrand.cancel}
          onConfirm={confirmRemove}
          onCancel={cancelRemove}
        />
      )}
      {removedAccount && (
        <ConfirmDialog
          title={text.removeAccount.title(removedAccount.handle, removedAccount.network)}
          body={text.removeAccount.body(removedAccount.network, Object.keys(removedAccount.times).length > 0, secretOf(vault, removedAccount.id))}
          confirm={text.removeAccount.confirm}
          cancel={text.removeAccount.cancel}
          onConfirm={confirmRemoveAccount}
          onCancel={cancelRemoveAccount}
        />
      )}
    </Shell>
  );
}

function secretOf(vault: VaultView, id: AccountId): "password" | "codes" | null {
  const st = vault.kind === "ready" ? vault.status.get(id) : undefined;
  return st?.password ? "password" : st && st.codes > 0 ? "codes" : null;
}

function DevDump({ dev: { info, dump } }: { dev: Dev }) {
  return (
    <div className="page-body">
      <dl className="dev-dump">
        <dt>{text.dev.app}</dt>
        <dd className={info.ok ? undefined : "danger"}>{info.ok ? `${info.value.name} · ${text.version(info.value.version)}` : text.appInfoError(info.code)}</dd>
        <dt>{text.dev.store}</dt>
        <dd>{dump.storePath}</dd>
        <dt>{text.dev.state}</dt>
        <dd>{text.dev.stateLine(dump.state, dump.records)}</dd>
        <dt>{text.dev.contents}</dt>
        <dd>{text.dev.contentsLine(dump.contents, dump.rejected, dump.readMs)}</dd>
        <dt>{text.dev.outside}</dt>
        <dd>{dump.outsideRead}</dd>
        <dt>{text.dev.preview}</dt>
        <dd>{dump.preview}</dd>
        <dt>{text.dev.previewOutside}</dt>
        <dd>{dump.previewOutside}</dd>
        {dump.backup && (
          <>
            <dt>{text.dev.backup}</dt>
            <dd>{dump.backup}</dd>
          </>
        )}
        {dump.errors.map((e, i) => (
          <dd key={i} className="danger">{`${e.code}: ${e.detail}`}</dd>
        ))}
      </dl>
    </div>
  );
}
