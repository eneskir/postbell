import { useId, useState, type FormEvent, type ReactNode } from "react";
import { accountProblems, HANDLE_MAX, type AccountDraft, type AccountRow } from "../core/accounts.ts";
import { LANGUAGES, type Language } from "../core/manifest.ts";
import { NETWORKS, TWO_STEP, type Account, type AccountId, type BrandId, type Network, type TwoStep } from "../core/shares.ts";
import { EMAIL_MAX, NOTE_MAX, type StoreFile } from "../core/store.ts";
import { Button, EmptyState } from "./components.tsx";
import { text } from "./text.ts";

type MissingRow = Extract<AccountRow, { kind: "missing" }>;

export type AccountSelection = { readonly kind: "account"; readonly id: AccountId } | { readonly kind: "missing"; readonly network: Network; readonly language: Language } | null;

type PageProps = {
  readonly rows: readonly AccountRow[];
  readonly selected: AccountSelection;
  readonly openAccount: (id: AccountId) => void;
  readonly addMissing: (row: MissingRow) => void;
  readonly addAny: () => void;
};

export function AccountsPage({ rows, selected, openAccount, addMissing, addAny }: PageProps) {
  if (rows.length === 0) return <EmptyState drawing="whirl-5" title={text.accounts.emptyTitle} body={text.accounts.emptyBody} action={{ label: text.accounts.add, onClick: addAny }} />;
  const missing = rows.filter((r) => r.kind === "missing").length;
  // A network with more than one row names each row's language, as the add rows already do.
  const many = (n: Network) => rows.filter((r) => (r.kind === "account" ? r.account.network : r.network) === n).length > 1;
  return (
    <div className="page-body accounts">
      <p className="page-summary">{text.accounts.summary(rows.length, missing)}</p>
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
            <span role="columnheader" className="account-two-step">
              {text.accounts.head.twoStep}
            </span>
            <span role="columnheader" className="account-action" />
          </div>
        </div>
        <div role="rowgroup">
          {rows.map((r) =>
            r.kind === "account" ? (
              <AccountLine key={r.account.id} row={r} languageShown={many(r.account.network)} selected={selected?.kind === "account" && selected.id === r.account.id} open={openAccount} />
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

function AccountLine({ row: { account: a }, languageShown, selected, open }: { row: Extract<AccountRow, { kind: "account" }>; languageShown: boolean; selected: boolean; open: (id: AccountId) => void }) {
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

export function AccountDetail({ account: a, onEdit }: { account: Account; onEdit: () => void }) {
  const rows: readonly (readonly [string, string])[] = [
    [text.accounts.detail.language, text.accounts.language(a.language)],
    [text.accounts.detail.email, a.email ?? text.accounts.none],
    [text.accounts.detail.twoStep, a.twoStep === undefined ? text.accounts.none : text.accounts.twoStepName(a.twoStep)],
    [text.accounts.detail.recoveryEmail, a.recoveryEmail ?? text.accounts.none],
    [text.accounts.detail.note, a.note ?? text.accounts.none],
  ];
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
  readonly onSave: (d: AccountDraft) => void;
  readonly onCancel: () => void;
  readonly onRemove?: () => void;
};

export function AccountForm({ store, brand, initial, self, networkFixed, title, onSave, onCancel, onRemove }: FormProps) {
  const id = { network: useId(), handle: useId(), language: useId(), email: useId(), twoStep: useId(), recoveryEmail: useId(), note: useId() };
  const [draft, setDraft] = useState(initial);
  const [tried, setTried] = useState(false);
  const problems = accountProblems(store, brand, draft, self);
  const handle = problems.find((p) => p.field === "handle");
  const language = problems.find((p) => p.field === "language");
  const handleError = handle?.code === "taken" ? text.accounts.handleTaken : handle && tried ? text.accounts.handleEmpty : null;
  const languageError = language && "by" in language ? text.accounts.languageTaken(draft.network, language.by) : null;
  const set = (patch: Partial<AccountDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problems.length === 0) onSave(draft);
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
      <FormField id={id.twoStep} label={text.accounts.fieldTwoStep}>
        <Select<TwoStep | "">
          id={id.twoStep}
          value={draft.twoStep ?? ""}
          options={[["", text.accounts.twoStepUnset], ...TWO_STEP.map((t) => [t, text.accounts.twoStepName(t)] as const)]}
          onChange={(t) => set({ twoStep: t === "" ? undefined : t })}
        />
      </FormField>
      <FormField id={id.recoveryEmail} label={text.accounts.fieldRecoveryEmail}>
        <TextInput id={id.recoveryEmail} type="email" value={draft.recoveryEmail} max={EMAIL_MAX} onChange={(recoveryEmail) => set({ recoveryEmail })} />
      </FormField>
      <FormField id={id.note} label={text.accounts.fieldNote}>
        <TextInput id={id.note} value={draft.note} max={NOTE_MAX} placeholder={text.accounts.optional} onChange={(note) => set({ note })} />
      </FormField>
      <div className="account-form-actions">
        <Button variant="primary" submit>
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
