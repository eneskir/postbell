import { useId, useState } from "react";
import { brandProblems, updateBrand, type BrandPatch } from "../core/brands.ts";
import { NAME_MAX } from "../core/names.ts";
import type { PortResult } from "../core/port.ts";
import { readTimeInput, scheduleRows, setTime, type ScheduleRow } from "../core/schedule.ts";
import type { Brand, StoreFile } from "../core/store.ts";
import { formatTime } from "../core/time.ts";
import { Button } from "./components.tsx";
import { SettingRow, SettingsGroup, TextField } from "./settings.tsx";
import { StickerPicker } from "./sticker-picker.tsx";
import { stickerOf } from "./stickers.ts";
import { text } from "./text.ts";

type Update = (change: (s: StoreFile) => StoreFile) => void;

type Props = {
  readonly store: StoreFile;
  readonly brand: Brand;
  readonly pickFolder: () => Promise<PortResult<string | null>>;
  readonly update: Update;
  readonly onRemove: (back: HTMLElement | null) => void;
};

export function BrandSettingsPage({ store, brand, pickFolder, update, onRemove }: Props) {
  const patch = (p: BrandPatch) =>
    update((s) => {
      const r = updateBrand(s, brand.id, p);
      return r.ok ? r.store : s;
    });
  const rows = scheduleRows(store, brand.id);

  return (
    <div className="page-body">
      <div className="settings">
        <SettingsGroup label={text.brandForm.groupBrand}>
          <NameRow store={store} brand={brand} patch={patch} />
          <SettingRow title={text.brandForm.sticker}>
            <StickerPicker value={stickerOf(brand)} onChange={(sticker) => patch({ sticker })} />
          </SettingRow>
          <FolderRow store={store} brand={brand} pickFolder={pickFolder} patch={patch} />
        </SettingsGroup>
        <SettingsGroup label={text.brandForm.groupTimes}>
          {rows.length === 0 ? (
            <SettingRow title={text.brandForm.timesNoAccounts} muted />
          ) : (
            rows.map((r) => <TimeRow key={`${r.account.id}/${r.format}`} row={r} update={update} />)
          )}
        </SettingsGroup>
        <SettingsGroup label={text.brandForm.groupRemove}>
          <SettingRow title={text.brandForm.remove} description={text.brandForm.removeHelp}>
            <Button variant="tertiary" danger onClick={() => onRemove(document.activeElement instanceof HTMLElement ? document.activeElement : null)}>
              {text.brandForm.removeOpen}
            </Button>
          </SettingRow>
        </SettingsGroup>
      </div>
    </div>
  );
}

function NameRow({ store, brand, patch }: { store: StoreFile; brand: Brand; patch: (p: BrandPatch) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const problem = draft === null ? undefined : brandProblems(store, { name: draft, sticker: brand.sticker, folder: brand.folder }, brand.id).find((p) => p.field === "name");
  const taken = problem?.code === "taken";
  const change = (name: string) => {
    setDraft(name);
    patch({ name });
  };
  return (
    <SettingRow title={text.brandForm.name} fieldId={id} error={taken ? text.brandForm.nameTaken : null}>
      <TextField id={id} size="name" value={draft ?? brand.name} onChange={change} invalid={taken} maxLength={NAME_MAX} onBlur={() => setDraft(null)} />
    </SettingRow>
  );
}

function FolderRow({ store, brand, pickFolder, patch }: { store: StoreFile; brand: Brand; pickFolder: Props["pickFolder"]; patch: (p: BrandPatch) => void }) {
  const [note, setNote] = useState<string | null>(null);
  const choose = async () => {
    const r = await pickFolder();
    if (!r.ok) return setNote(text.brandForm.dialogError(r.error.code));
    if (r.value === null) return setNote(null);
    const taken = brandProblems(store, { name: brand.name, sticker: brand.sticker, folder: r.value }, brand.id).find((p) => p.field === "folder" && p.code === "taken");
    setNote(taken && "by" in taken ? text.brandForm.folderTaken(taken.by) : null);
    if (!taken) patch({ folder: r.value });
  };
  return (
    <SettingRow title={text.brandForm.folder} description={text.brandForm.folderHelpSettings} error={note}>
      <span className="setting-value" title={brand.folder}>
        {brand.folder}
      </span>
      <Button variant="tertiary" onClick={() => void choose()}>
        {text.brandForm.folderChange}
      </Button>
    </SettingRow>
  );
}

function TimeRow({ row, update }: { row: ScheduleRow; update: Update }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const value = draft ?? (row.time === null ? "" : formatTime(row.time));
  const input = readTimeInput(value);
  const invalid = draft !== null && (input.kind === "invalid" || (entered && input.kind === "partial"));
  const write = (time: ScheduleRow["time"]) => update((s) => setTime(s, row.account.id, row.format, time));
  const change = (t: string) => {
    setDraft(t);
    setEntered(false);
    const r = readTimeInput(t);
    if (r.kind === "time") write(r.time);
  };
  const settle = (keep: boolean) => {
    if (input.kind === "empty") write(null);
    if (keep && (input.kind === "partial" || input.kind === "invalid")) return setEntered(true);
    setDraft(null);
    setEntered(false);
  };
  return (
    <SettingRow title={text.brandForm.timeRow(row.account.handle, text.formats[row.format])} fieldId={id} error={invalid ? text.brandForm.timeInvalid : null}>
      <TextField id={id} size="time" value={value} onChange={change} invalid={invalid} maxLength={5} placeholder={text.brandForm.timeEmpty} onBlur={() => settle(false)} onEnter={() => settle(true)} />
    </SettingRow>
  );
}
