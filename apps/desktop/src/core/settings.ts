import type { BrandId } from "./shares.ts";

export type ReminderInterval = 15 | 30 | 60 | 120;
export const REMINDER_INTERVALS: readonly ReminderInterval[] = [15, 30, 60, 120];

export type StartScreen = "home" | "last";
export const START_SCREENS: readonly StartScreen[] = ["home", "last"];

// The Ayarlar values; each one applies as soon as it changes.
export type Settings = {
  // Off: no alarm is set, reminders included.
  readonly notifyOnTime: boolean;
  // Minutes after its time a share counts as late and is notified again.
  readonly reminderInterval: ReminderInterval;
  readonly startScreen: StartScreen;
  readonly launchAtLogin: boolean;
  // On: closing the window leaves the app running in the tray, so notifications keep coming.
  readonly closeToTray: boolean;
};

export const DEFAULT_SETTINGS: Settings = { notifyOnTime: true, reminderInterval: 30, startScreen: "home", launchAtLogin: false, closeToTray: true };

export type BrandPage = "today" | "contents" | "calendar" | "accounts";
export const BRAND_PAGES: readonly BrandPage[] = ["today", "contents", "calendar", "accounts"];

// A page the app can open on. The brand form is not one: it is left for the page it was opened from.
export type Place =
  | { readonly kind: "home" }
  | { readonly kind: "history" }
  | { readonly kind: "settings" }
  | { readonly kind: "brand"; readonly brand: BrandId; readonly page: BrandPage }
  | { readonly kind: "brand-settings"; readonly brand: BrandId };

export const HOME: Place = { kind: "home" };
