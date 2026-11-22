import { useId, useState, type FormEvent } from "react";
import { brandProblems, type BrandDraft } from "../core/brands.ts";
import { NAME_MAX } from "../core/names.ts";
import type { PortErrorCode, PortResult } from "../core/port.ts";
import type { StoreFile } from "../core/store.ts";
import { Button } from "./components.tsx";
import { SettingRow, SettingsGroup, TextField } from "./settings.tsx";
import { StickerPicker } from "./sticker-picker.tsx";
import { freeSticker } from "./stickers.ts";
import { text } from "./text.ts";

type Props = {
  readonly store: StoreFile;
  readonly pickFolder: () => Promise<PortResult<string | null>>;
  readonly onCreate: (draft: BrandDraft) => void;
  readonly onCancel: () => void;
};

export function BrandNewPage({ store, pickFolder, onCreate, onCancel }: Props) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [sticker, setSticker] = useState(() => freeSticker(store.brands));
  const [folder, setFolder] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<PortErrorCode | null>(null);
  const draft: BrandDraft = { name, sticker, folder };
  const problems = brandProblems(store, draft);
  const nameTaken = problems.some((p) => p.field === "name" && p.code === "taken");
  const folderTaken = problems.find((p) => p.field === "folder" && p.code === "taken");

  const choose = async () => {
    const r = await pickFolder();
    if (!r.ok) return setDialogError(r.error.code);
    setDialogError(null);
    if (r.value !== null) setFolder(r.value);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problems.length === 0) onCreate(draft);
  };

  const folderNote = dialogError ? text.brandForm.dialogError(dialogError) : folderTaken && "by" in folderTaken ? text.brandForm.folderTaken(folderTaken.by) : null;
  return (
    <div className="page-body">
      <form className="settings" onSubmit={submit} noValidate>
        <SettingsGroup label={text.brandForm.groupBrand}>
          <SettingRow title={text.brandForm.name} fieldId={nameId} error={nameTaken ? text.brandForm.nameTaken : null}>
            <TextField id={nameId} size="name" value={name} onChange={setName} invalid={nameTaken} maxLength={NAME_MAX} autoFocus />
          </SettingRow>
          <SettingRow title={text.brandForm.sticker}>
            <StickerPicker value={sticker} onChange={setSticker} />
          </SettingRow>
          <SettingRow title={text.brandForm.folder} description={text.brandForm.folderHelp} error={folderNote}>
            <span className="setting-value" title={folder ?? undefined}>
              {folder ?? text.brandForm.folderNone}
            </span>
            <Button variant="tertiary" onClick={() => void choose()}>
              {folder === null ? text.brandForm.folderPick : text.brandForm.folderChange}
            </Button>
          </SettingRow>
        </SettingsGroup>
        <SettingsGroup label={text.brandForm.groupAccounts}>
          <SettingRow title={text.brandForm.accountsLater} muted />
        </SettingsGroup>
        <div className="settings-actions">
          <Button variant="primary" submit disabled={problems.length > 0}>
            {text.brandForm.create}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {text.brandForm.cancel}
          </Button>
        </div>
      </form>
    </div>
  );
}
