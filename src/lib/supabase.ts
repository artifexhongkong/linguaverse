/**
 * Local-first persistence layer for 译境 LinguaVerse.
 *
 * Uses localStorage so the Android APK works out-of-the-box without
 * any backend configuration.
 *
 * Revenue model: ad-supported.
 *   - Users get 3 free translations per day.
 *   - After 3 free translations, they must watch an ad to continue.
 *   - Users can pay to remove ads permanently (isAdFree).
 */

const TRANSLATIONS_KEY = "linguaverse.translations.v1";
const SETTINGS_KEY = "linguaverse.settings.v1";
const DAILY_USAGE_KEY = "linguaverse.daily_usage.v1";
const AD_FREE_KEY = "linguaverse.ad_free.v1";
const MAX_HISTORY = 200;

export const isSupabaseConfigured = true;

export interface TranslationRecord {
  id: string;
  source_text: string;
  translated_text: string;
  source_lang: string;
  target_lang: string;
  context_mode: string;
  confidence: number;
  is_favorite: boolean;
  created_at: string;
}

export interface UserSettings {
  id: string;
  default_source_lang: string;
  default_target_lang: string;
  default_context: string;
  created_at: string;
}

// --- Translation history ---

function readTranslations(): TranslationRecord[] {
  try {
    const raw = localStorage.getItem(TRANSLATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeTranslations(list: TranslationRecord[]): void {
  try {
    const trimmed = list.slice(0, MAX_HISTORY);
    localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify(trimmed));
  } catch {
    try { localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify(list.slice(0, 50))); } catch {}
  }
}

export async function fetchTranslations(): Promise<TranslationRecord[]> {
  return readTranslations().sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function insertTranslation(
  record: Omit<TranslationRecord, "id" | "created_at" | "is_favorite">
): Promise<TranslationRecord | null> {
  const list = readTranslations();
  const newRow: TranslationRecord = {
    id: uid(),
    created_at: new Date().toISOString(),
    is_favorite: false,
    ...record,
  };
  list.unshift(newRow);
  writeTranslations(list);
  return newRow;
}

export async function toggleFavorite(id: string, fav: boolean): Promise<void> {
  const list = readTranslations();
  const idx = list.findIndex((r) => r.id === id);
  if (idx >= 0) { list[idx].is_favorite = fav; writeTranslations(list); }
}

export async function deleteTranslation(id: string): Promise<void> {
  const list = readTranslations();
  writeTranslations(list.filter((r) => r.id !== id));
}

// --- Settings (language preferences only — no plan/quota) ---

function readSettings(): UserSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserSettings;
  } catch { return null; }
}

function writeSettings(s: UserSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function fetchSettings(): Promise<UserSettings | null> {
  return readSettings();
}

export async function upsertSettings(
  updates: Partial<UserSettings>
): Promise<UserSettings | null> {
  const existing = readSettings();
  const merged: UserSettings = existing ?? {
    id: uid(),
    default_source_lang: "auto",
    default_target_lang: "en",
    default_context: "general",
    created_at: new Date().toISOString(),
  };
  Object.assign(merged, updates);
  writeSettings(merged);
  return merged;
}

// --- Daily usage tracking (resets every day) ---

interface DailyUsage {
  date: string;       // YYYY-MM-DD
  count: number;
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function readDailyUsage(): DailyUsage {
  try {
    const raw = localStorage.getItem(DAILY_USAGE_KEY);
    if (!raw) return { date: getToday(), count: 0 };
    return JSON.parse(raw) as DailyUsage;
  } catch { return { date: getToday(), count: 0 }; }
}

function writeDailyUsage(d: DailyUsage): void {
  try { localStorage.setItem(DAILY_USAGE_KEY, JSON.stringify(d)); } catch {}
}

/**
 * If the stored date != today, reset the counter. Call this on app
 * startup and before checking usage.
 */
export async function resetDailyIfNeeded(): Promise<void> {
  const usage = readDailyUsage();
  if (usage.date !== getToday()) {
    writeDailyUsage({ date: getToday(), count: 0 });
  }
}

export function getDailyUsage(): number {
  const usage = readDailyUsage();
  if (usage.date !== getToday()) return 0;
  return usage.count;
}

export function recordTranslation(): void {
  const usage = readDailyUsage();
  const today = getToday();
  const count = usage.date === today ? usage.count + 1 : 1;
  writeDailyUsage({ date: today, count });
}

// --- Ad-free status (one-time purchase) ---

export function isAdFree(): boolean {
  try {
    return localStorage.getItem(AD_FREE_KEY) === "true";
  } catch { return false; }
}

export function setAdFree(value: boolean): void {
  try { localStorage.setItem(AD_FREE_KEY, value ? "true" : "false"); } catch {}
}
