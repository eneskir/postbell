import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { accountProblems, HANDLE_MAX, type AccountDraft, type AccountRow } from "../core/accounts.ts";
import { LANGUAGES, type Language } from "../core/manifest.ts";
import { NETWORKS, TWO_STEP, type Account, type AccountId, type BrandId, type Network, type TwoStep } from "../core/shares.ts";
import { EMAIL_MAX, NOTE_MAX, type StoreFile } from "../core/store.ts";
import { CODES_MAX, EMPTY_VAULT_DRAFT, PASSWORD_MAX, signsInWithInstagram, type VaultDraft, type VaultStatus } from "../core/vault.ts";
import { Button, EmptyState, Notice } from "./components.tsx";
import { text } from "./text.ts";

type MissingRow = Extract<AccountRow, { kind: "missing" }>;

// The vault as the UI knows it: which accounts have a password and how many codes, never the values.
export type VaultView =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly status: ReadonlyMap<AccountId, VaultStatus> }
  | { readonly kind: "error"; readonly code: string };

const statusOf = (v: VaultView, id: AccountId) => (v.kind === "ready" ? v.status.get(id) : undefined);

function passwordText(a: Account, v: VaultView): string {
  const st = statusOf(v, a.id);
  if (v.kind !== "loading" && signsInWithInstagram(a.network, st)) return text.accounts.withInstagram;
  if (v.kind === "error") return text.accounts.unreadable;
  if (v.kind === "loading") return "";
  return st?.password ? text.accounts.passwordHidden : text.accounts.none;
}

export type AccountSelection = { readonly kind: "account"; readonly id: AccountId } | { readonly kind: "missing"; readonly network: Network; readonly language: Language } | null;

type PageProps = {
  readonly rows: readonly AccountRow[];
  readonly selected: AccountSelection;
  readonly openAccount: (id: AccountId) => void;
  readonly addMissing: (row: MissingRow) => void;
  readonly addAny: () => void;
  readonly vault: VaultView;
  readonly retryVault: () => void;
};

export function AccountsPage({ rows, selected, openAccount, addMissing, addAny, vault, retryVault }: PageProps) {
  if (rows.length === 0) return <EmptyState drawing="whirl-5" title={text.accounts.emptyTitle} body={text.accounts.emptyBody} action={{ label: text.accounts.add, onClick: addAny }} />;
  const missing = rows.filter((r) => r.kind === "missing").length;
  // A network with more than one row names each row's language, as the add rows already do.
  const many = (n: Network) => rows.filter((r) => (r.kind === "account" ? r.account.network : r.network) === n).length > 1;
  return (
    <div className="page-body accounts">
      <p className="page-summary">{text.accounts.summary(rows.length, missing)}</p>
      {vault.kind === "error" && (
        <Notice tone="danger" detail={vault.code} action={{ label: text.accounts.retry, onClick: retryVault }}>
          {text.accounts.vaultError}
        </Notice>
      )}
      <div className="account-table" role="table" aria-label={text.page.accounts}>
        <div role="rowgroup">
          <div role="row" className="account-head">
            <span role="columnheader" className="account-network">
              {text.accounts.head.network}
            </span>
            <span role="columnheader" className="account-handle">
              {text.accounts.head.handle}
            </span>
            <span role="columnheader" className="account-email">
              {text.accounts.head.email}
            </span>
            <span role="columnheader" className="account-password">
              {text.accounts.head.passwordLabel}
            </span>
            <span role="columnheader" className="account-two-step">
              {text.accounts.head.twoStep}
            </span>
            <span role="columnheader" className="account-action" />
          </div>
        </div>
        <div role="rowgroup">
          {rows.map((r) =>
            r.kind === "account" ? (
              <AccountLine key={r.account.id} row={r} vault={vault} languageShown={many(r.account.network)} selected={selected?.kind === "account" && selected.id === r.account.id} open={openAccount} />
            ) : (
              <MissingLine key={`${r.network}/${r.language}`} row={r} selected={selected?.kind === "missing" && selected.network === r.network && selected.language === r.language} add={addMissing} />
            ),
          )}
        </div>
      </div>
      <Button variant="ghost" onClick={addAny}>
        {text.accounts.add}
      </Button>
    </div>
  );
}

function AccountLine({ row: { account: a }, vault, languageShown, selected, open }: { row: Extract<AccountRow, { kind: "account" }>; vault: VaultView; languageShown: boolean; selected: boolean; open: (id: AccountId) => void }) {
  return (
    <div role="row" className={`account-row${selected ? " account-row-selected" : ""}`}>
      <span role="cell" className="account-network">
        <button type="button" className="account-row-main" data-account={a.id} aria-current={selected ? "true" : undefined} aria-label={text.accounts.openLabel(a.network, a.handle)} onClick={() => open(a.id)}>
          {text.accounts.label(a.network, languageShown ? a.language : null)}
        </button>
      </span>
      <span role="cell" className="account-handle">
        {a.handle}
      </span>
      <span role="cell" className="account-email">
        {a.email ?? text.accounts.none}
      </span>
      <span role="cell" className="account-password">
        {passwordText(a, vault)}
      </span>
      <span role="cell" className="account-two-step">
        {text.accounts.twoStepShort(a.twoStep)}
      </span>
      <span role="cell" className="account-action" />
    </div>
  );
}

function MissingLine({ row, selected, add }: { row: MissingRow; selected: boolean; add: (row: MissingRow) => void }) {
  return (
    <div role="row" className={`account-row account-row-missing${selected ? " account-row-selected" : ""}`}>
      <span role="cell" className="account-network">
        {text.accounts.label(row.network, row.languageShown ? row.language : null)}
      </span>
      <span role="cell" className="account-handle">
        {text.accounts.none}
      </span>
      <span role="cell" className="account-email">
        {text.accounts.none}
      </span>
      <span role="cell" className="account-password">
        {text.accounts.none}
      </span>
      <span role="cell" className="account-two-step">
        {text.accounts.none}
      </span>
      <span role="cell" className="account-action">
        <button type="button" className="account-row-main account-add" aria-current={selected ? "true" : undefined} onClick={() => add(row)}>
          {text.accounts.add}
        </button>
      </span>
    </div>
  );
}

export const REVEAL_MS = 30_000;

type DetailProps = {
  readonly account: Account;
  readonly vault: VaultView;
  readonly onEdit: () => void;
  // The password for 30 seconds; null when it could not be read (the caller says why).
  readonly reveal: () => Promise<string | null>;
  readonly copy: () => void;
  // Null when Postbell has no page for the network (Threads).
  readonly openNetwork: (() => void) | null;
};

export function AccountDetail({ account: a, vault, onEdit, reveal, copy, openNetwork }: DetailProps) {
  const [shown, setShown] = useState<string | null>(null);
  // Hidden after 30 seconds, and at once when the window is hidden or minimized.
  useEffect(() => {
    if (shown === null) return;
    const timer = setTimeout(() => setShown(null), REVEAL_MS);
    const onHide = () => document.hidden && setShown(null);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [shown]);
  const st = statusOf(vault, a.id);
  const error = vault.kind === "error";
  const hasPassword = st?.password === true;
  const codes = error ? text.accounts.unreadable : st && st.codes > 0 ? text.accounts.codesStored(st.codes) : text.accounts.none;
  const rows: readonly (readonly [string, string])[] = [
    [text.accounts.detail.language, text.accounts.language(a.language)],
    [text.accounts.detail.email, a.email ?? text.accounts.none],
    [text.accounts.detail.passwordLabel, shown ?? passwordText(a, vault)],
    [text.accounts.detail.twoStep, a.twoStep === undefined ? text.accounts.none : text.accounts.twoStepName(a.twoStep)],
    [text.accounts.detail.codes, codes],
    [text.accounts.detail.recoveryEmail, a.recoveryEmail ?? text.accounts.none],
    [text.accounts.detail.note, a.note ?? text.accounts.none],
  ];
  const passwordStep = hasPassword || (error && !signsInWithInstagram(a.network, undefined));
  const toggle = () => {
    if (shown !== null) setShown(null);
    else void reveal().then(setShown);
  };
  return (
    <>
      <h2 className="panel-heading">{text.accounts.editTitle(a.handle, a.network)}</h2>
      <dl className="account-detail">
        {rows.map(([label, value]) => (
          <div key={label} className="account-detail-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {(passwordStep || openNetwork) && (
        <>
          <hr className="share-divider" />
          {passwordStep && (
            <section className="share-step">
              <h3 className="share-step-title">{text.accounts.stepPassword}</h3>
              <div className="share-actions">
                <Button variant="tertiary" disabled={!hasPassword} onClick={copy}>
                  {text.accounts.copy}
                </Button>
                <Button variant="tertiary" disabled={!hasPassword} onClick={toggle}>
                  {shown === null ? text.accounts.show : text.accounts.hide}
                </Button>
              </div>
            </section>
          )}
          {openNetwork && (
            <section className="share-step">
              <h3 className="share-step-title">{passwordStep ? text.accounts.stepOpen : text.accounts.open}</h3>
              <Button variant="primary" onClick={openNetwork}>
                {text.accounts.openNetwork(a.network)}
              </Button>
              {passwordStep && <p className="share-hint">{error ? text.accounts.vaultErrorNote : text.accounts.revealNote}</p>}
            </section>
          )}
        </>
      )}
      <div className="account-detail-end">
        <Button variant="ghost" onClick={onEdit}>
          {text.accounts.editDetails}
        </Button>
      </div>
    </>
  );
}

type FormProps = {
  readonly store: StoreFile;
  readonly brand: BrandId;
  readonly initial: AccountDraft;
  readonly self?: AccountId;
  readonly networkFixed: boolean;
  readonly title: (d: AccountDraft) => string;
  // What is in the vault now, for the edit placeholders; undefined for a new account.
  readonly stored?: VaultStatus;
  // Resolves to an error text when the account was not saved.
  readonly onSave: (d: AccountDraft, secrets: VaultDraft) => Promise<string | null>;
  readonly onCancel: () => void;
  readonly onRemove?: () => void;
};

export function AccountForm({ store, brand, initial, self, networkFixed, title, stored, onSave, onCancel, onRemove }: FormProps) {
  const id = { network: useId(), handle: useId(), language: useId(), email: useId(), password: useId(), twoStep: useId(), codes: useId(), recoveryEmail: useId(), note: useId() };
  const [draft, setDraft] = useState(initial);
  const [secrets, setSecrets] = useState<VaultDraft>(EMPTY_VAULT_DRAFT);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const problems = accountProblems(store, brand, draft, self);
  const handle = problems.find((p) => p.field === "handle");
  const language = problems.find((p) => p.field === "language");
  const handleError = handle?.code === "taken" ? text.accounts.handleTaken : handle && tried ? text.accounts.handleEmpty : null;
  const languageError = language && "by" in language ? text.accounts.languageTaken(draft.network, language.by) : null;
  const set = (patch: Partial<AccountDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problems.length > 0 || saving) return;
    setSaving(true);
    void onSave(draft, secrets).then((error) => {
      setSaving(false);
      setSaveError(error);
    });
  };
  return (
    <form className="account-form" onSubmit={submit} noValidate>
      <h2 className="panel-heading">{title(draft)}</h2>
      {!networkFixed && self === undefined && (
        <FormField id={id.network} label={text.accounts.fieldNetwork}>
          <Select id={id.network} value={draft.network} options={NETWORKS.map((n) => [n, text.accounts.network(n)])} onChange={(network) => set({ network })} />
        </FormField>
      )}
      <FormField id={id.handle} label={text.accounts.fieldHandle} error={handleError}>
        <input
          id={id.handle}
          className="field field-block"
          type="text"
          value={draft.handle}
          maxLength={HANDLE_MAX}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          aria-invalid={handleError ? true : undefined}
          aria-describedby={handleError ? `${id.handle}-note` : undefined}
          onChange={(e) => set({ handle: e.target.value })}
        />
      </FormField>
      <FormField id={id.language} label={text.accounts.fieldLanguage} error={languageError}>
        <Select id={id.language} value={draft.language} invalid={languageError !== null} options={LANGUAGES.map((l) => [l, text.accounts.language(l)])} onChange={(l) => set({ language: l })} />
      </FormField>
      <FormField id={id.email} label={text.accounts.fieldEmail}>
        <TextInput id={id.email} type="email" value={draft.email} max={EMAIL_MAX} onChange={(email) => set({ email })} />
      </FormField>
      <FormField id={id.password} label={text.accounts.fieldPassword}>
        <input
          id={id.password}
          className="field field-block"
          type="password"
          value={secrets.password}
          maxLength={PASSWORD_MAX}
          placeholder={stored?.password ? text.accounts.passwordKeep : undefined}
          spellCheck={false}
          autoComplete="new-password"
          onChange={(e) => setSecrets((v) => ({ ...v, password: e.target.value }))}
        />
      </FormField>
      <FormField id={id.twoStep} label={text.accounts.fieldTwoStep}>
        <Select<TwoStep | "">
          id={id.twoStep}
          value={draft.twoStep ?? ""}
          options={[["", text.accounts.twoStepUnset], ...TWO_STEP.map((t) => [t, text.accounts.twoStepName(t)] as const)]}
          onChange={(t) => set({ twoStep: t === "" ? undefined : t })}
        />
      </FormField>
      <FormField id={id.codes} label={text.accounts.fieldCodes}>
        <textarea
          id={id.codes}
          className="field field-block field-area"
          value={secrets.codes}
          maxLength={CODES_MAX}
          placeholder={stored && stored.codes > 0 ? text.accounts.codesKeep(stored.codes) : text.accounts.codesPlaceholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setSecrets((v) => ({ ...v, codes: e.target.value }))}
        />
      </FormField>
      <FormField id={id.recoveryEmail} label={text.accounts.fieldRecoveryEmail}>
        <TextInput id={id.recoveryEmail} type="email" value={draft.recoveryEmail} max={EMAIL_MAX} onChange={(recoveryEmail) => set({ recoveryEmail })} />
      </FormField>
      <FormField id={id.note} label={text.accounts.fieldNote}>
        <TextInput id={id.note} value={draft.note} max={NOTE_MAX} placeholder={text.accounts.optional} onChange={(note) => set({ note })} />
      </FormField>
      <p className="share-note">{text.accounts.vaultNote}</p>
      {saveError && (
        <p className="form-field-error" role="alert">
          {saveError}
        </p>
      )}
      <div className="account-form-actions">
        <Button variant="primary" submit disabled={saving}>
          {self === undefined ? text.accounts.save : text.accounts.saveEdit}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {text.accounts.cancel}
        </Button>
        {onRemove && (
          <span className="account-form-end">
            <Button variant="ghost" danger onClick={onRemove}>
              {text.accounts.removeOpen}
            </Button>
          </span>
        )}
      </div>
    </form>
  );
}

function TextInput({ id, value, max, onChange, type = "text", placeholder }: { id: string; value: string | undefined; max: number; onChange: (v: string) => void; type?: "text" | "email"; placeholder?: string }) {
  return <input id={id} className="field field-block" type={type} value={value ?? ""} maxLength={max} placeholder={placeholder} spellCheck={false} autoComplete="off" onChange={(e) => onChange(e.target.value)} />;
}

function FormField({ id, label, error = null, children }: { id: string; label: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="form-field">
      <label className="form-field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error && (
        <span className="form-field-error" id={`${id}-note`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

// A transparent native select sits on top, so focus, keys and the dropdown stay native.
function Select<T extends string>({ id, value, options, onChange, invalid = false }: { id: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; invalid?: boolean }) {
  const label = options.find(([v]) => v === value)?.[1] ?? "";
  return (
    <span className="field field-block field-select" data-invalid={invalid || undefined}>
      <span className="field-select-value" aria-hidden="true">
        {label}
        <span className="field-select-glyph">▾</span>
      </span>
      <select id={id} value={value} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-note` : undefined} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </span>
  );
}
