import { useState } from "react";
import type { PortErrorCode, PortResult } from "../core/port.ts";
import { REMINDER_INTERVALS, START_SCREENS, type Settings } from "../core/settings.ts";
import type { BackupState } from "../core/store.ts";
import type { LocalDate } from "../core/time.ts";
import { Button } from "./components.tsx";
import { SettingRow, SettingSelect, SettingsGroup, Switch } from "./settings.tsx";
import { text } from "./text.ts";

type Props = {
  readonly settings: Settings;
  readonly change: (patch: Partial<Settings>) => void;
  readonly changeLaunch: (on: boolean) => Promise<PortResult<void>>;
  // Each returns the row's error text, or null.
  readonly exportData: () => Promise<string | null>;
  readonly importData: () => Promise<string | null>;
  readonly backup: BackupState;
  readonly today: LocalDate;
  readonly openSave: () => void;
  readonly openRestore: () => void;
};

const t = text.settings;

// `settings/V1 · default`; every value applies as soon as it changes, there is no save button.
export function SettingsPage({ settings, change, changeLaunch, exportData, importData, backup, today, openSave, openRestore }: Props) {
  const [launchError, setLaunchError] = useState<PortErrorCode | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const data = (run: () => Promise<string | null>) => async () => setDataError(await run());
  const launch = async (on: boolean) => {
    const r = await changeLaunch(on);
    setLaunchError(r.ok ? null : r.error.code);
  };
  return (
    <div className="page-body">
      <div className="settings">
        <SettingsGroup label={t.notifyGroup}>
          <SettingRow title={t.notifyOnTime} fieldId="setting-notify">
            <Switch id="setting-notify" on={settings.notifyOnTime} onChange={(notifyOnTime) => change({ notifyOnTime })} />
          </SettingRow>
          <SettingRow title={t.reminder} description={t.reminderNote} fieldId="setting-reminder">
            <SettingSelect
              id="setting-reminder"
              label={t.reminder}
              value={settings.reminderInterval}
              options={REMINDER_INTERVALS.map((value) => ({ value, label: t.reminderOption(value) }))}
              onChange={(reminderInterval) => change({ reminderInterval })}
            />
          </SettingRow>
        </SettingsGroup>
        <SettingsGroup label={t.appGroup}>
          <SettingRow title={t.startScreen} fieldId="setting-start">
            <SettingSelect
              id="setting-start"
              label={t.startScreen}
              value={settings.startScreen}
              options={START_SCREENS.map((value) => ({ value, label: t.startScreenOption[value] }))}
              onChange={(startScreen) => change({ startScreen })}
            />
          </SettingRow>
          <SettingRow title={t.launchAtLogin} description={t.launchAtLoginNote} error={launchError && t.launchAtLoginFailed(launchError)} fieldId="setting-launch">
            <Switch id="setting-launch" on={settings.launchAtLogin} onChange={(on) => void launch(on)} />
          </SettingRow>
          <SettingRow title={t.closeToTray} description={t.closeToTrayNote} fieldId="setting-tray">
            <Switch id="setting-tray" on={settings.closeToTray} onChange={(closeToTray) => change({ closeToTray })} />
          </SettingRow>
        </SettingsGroup>
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
        <SettingsGroup label={t.dataGroup}>
          <SettingRow title={t.data} description={t.dataNote} error={dataError}>
            <Button variant="tertiary" onClick={data(exportData)}>
              {t.export}
            </Button>
            <Button variant="tertiary" onClick={data(importData)}>
              {t.import}
            </Button>
          </SettingRow>
        </SettingsGroup>
      </div>
    </div>
  );
}
