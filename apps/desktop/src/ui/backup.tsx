import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { passphraseLongEnough } from "../core/backup.ts";
import type { BackupState } from "../core/store.ts";
import type { LocalDate } from "../core/time.ts";
import { Button } from "./components.tsx";
import { SettingRow, SettingsGroup } from "./settings.tsx";
import { text } from "./text.ts";

// Ayarlar holds only the vault group until the settings phase adds the others (`settings/V1 · default`).
export function SettingsPage({ backup, today, openSave, openRestore }: { backup: BackupState; today: LocalDate; openSave: () => void; openRestore: () => void }) {
  return (
    <div className="page-body">
      <div className="settings">
        <SettingsGroup label={text.backup.group}>
          <SettingRow title={text.backup.row} description={text.backup.rowNote}>
            <span className="setting-value">{backup.last === undefined ? text.backup.never : text.backup.last(backup.last, today)}</span>
            <Button variant="tertiary" onClick={openSave}>
              {text.backup.save}
            </Button>
            <Button variant="tertiary" onClick={openRestore}>
              {text.backup.restore}
            </Button>
          </SettingRow>
        </SettingsGroup>
      </div>
    </div>
  );
}

// What a dialog's action reports back: null when done (the dialog closes), else where to show the error.
export type DialogResult = null | { readonly field: "passphrase" | "form"; readonly message: string };

export function SaveDialog({ save, onClose }: { save: (passphrase: string) => Promise<DialogResult | "stay">; onClose: () => void }) {
  const [first, setFirst] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<{ field: "first" | "again" | "form"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = { first: useId(), again: useId() };

  const submit = async () => {
    if (!passphraseLongEnough(first)) return fail({ field: "first", message: text.backup.passphraseHint });
    if (again !== first) return fail({ field: "again", message: text.backup.mismatch });
    setError(null);
    setBusy(true);
    const r = await save(first);
    setBusy(false);
    if (r === "stay") return false;
    if (r === null) return true;
    return fail({ field: r.field === "passphrase" ? "first" : "form", message: r.message });
  };
  const fail = (e: { field: "first" | "again" | "form"; message: string }) => {
    setError(e);
    return false;
  };

  return (
    <FormDialog title={text.backup.saveTitle} body={text.backup.saveBody} onClose={onClose} onSubmit={submit} formError={error?.field === "form" ? error.message : null}
      actions={<Button variant="secondary" submit disabled={busy}>{text.backup.saveButton}</Button>}>
      <PassField id={id.first} label={text.backup.passphrase} value={first} onChange={setFirst} first
        error={error?.field === "first" ? error.message : null} hint={text.backup.passphraseHint} />
      <PassField id={id.again} label={text.backup.passphraseAgain} value={again} onChange={setAgain} error={error?.field === "again" ? error.message : null} />
    </FormDialog>
  );
}

export function RestoreDialog({ path, pick, restore, onClose }: { path: string; pick: () => Promise<void>; restore: (passphrase: string) => Promise<DialogResult>; onClose: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<{ field: "passphrase" | "form"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = { file: useId(), passphrase: useId() };

  const submit = async () => {
    setError(null);
    setBusy(true);
    const r = await restore(passphrase);
    setBusy(false);
    if (r === null) return true;
    setError(r);
    return false;
  };

  return (
    <FormDialog title={text.backup.restoreTitle} body={text.backup.restoreBody} onClose={onClose} onSubmit={submit} formError={error?.field === "form" ? error.message : null}
      actions={<Button variant="secondary" submit disabled={busy || passphrase === ""}>{text.backup.restoreButton}</Button>}>
      <div className="form-field">
        <label className="form-field-label" htmlFor={id.file}>
          {text.backup.file}
        </label>
        {/* The path is only shown; another pick goes through the Windows file dialog. */}
        <button id={id.file} type="button" className="field field-block field-file" title={path} onClick={() => void pick()}>
          {path}
        </button>
      </div>
      <PassField id={id.passphrase} label={text.backup.passphrase} value={passphrase} onChange={setPassphrase} first error={error?.field === "passphrase" ? error.message : null} />
    </FormDialog>
  );
}

type FormDialogProps = {
  readonly title: string;
  readonly body: string;
  readonly onClose: () => void;
  // True when the action is done and the dialog closes.
  readonly onSubmit: () => Promise<boolean>;
  readonly formError: string | null;
  readonly actions: ReactNode;
  readonly children: ReactNode;
};

function FormDialog({ title, body, onClose, onSubmit, formError, actions, children }: FormDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    // showModal focuses the first control; the passphrase is what the person types first.
    d.querySelector<HTMLElement>("[data-first]")?.focus();
    return () => d.close();
  }, []);

  const close = () => {
    ref.current?.close();
    onClose();
  };
  // A modal dialog blocks focus to the rest of the page, so it closes before focus goes back.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSubmit().then((done) => {
      if (done) close();
    });
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // Prevent Esc so the window-level handler does not also close the panel.
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        close();
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-text">
        <h2 className="dialog-title" id={titleId}>
          {title}
        </h2>
        <p className="dialog-body" id={bodyId}>
          {body}
        </p>
      </div>
      <form className="dialog-form" onSubmit={submit} noValidate>
        <div className="dialog-fields">
          {children}
          {formError && (
            <span className="form-field-error" role="alert">
              {formError}
            </span>
          )}
        </div>
        <div className="dialog-actions">
          {actions}
          <Button variant="ghost" onClick={close}>
            {text.backup.cancel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

type PassFieldProps = { id: string; label: string; value: string; onChange: (v: string) => void; error: string | null; hint?: string; first?: boolean };

function PassField({ id, label, value, onChange, error, hint, first = false }: PassFieldProps) {
  const note = error ?? hint;
  return (
    <div className="form-field">
      <label className="form-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field field-block"
        type="password"
        value={value}
        data-first={first || undefined}
        spellCheck={false}
        autoComplete="new-password"
        aria-invalid={error !== null || undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {note && (
        <span className={error ? "form-field-error" : "form-field-hint"} id={`${id}-note`} role={error ? "alert" : undefined}>
          {note}
        </span>
      )}
    </div>
  );
}
