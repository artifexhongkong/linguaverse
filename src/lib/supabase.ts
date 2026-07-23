/**
 * Local-first persistence layer for 译境 LinguaVerse.
 *
 * This module previously wrapped Supabase; it now uses localStorage so the
 * Android APK works out-of-the-box without any backend configuration.
 * The exported function signatures are unchanged so all callers (App.tsx,
 * TranslatePage, HistoryPage, SettingsPage) keep working untouched.
 *
 * If you later want to sync to a backend, swap the bodies of these
 * functions — the contracts stay the same.
 */

const TRANSLATIONS_KEY = "linguaverse.translations.v1";
const SETTINGS_KEY = "linguaverse.settings.v1";
const MAX_HISTORY = 200;

export const isSupabaseConfigured = true; // always true — we are local-first now

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
  plan: string;
  monthly_quota_used: number;
  quota_reset_at: string;
  created_at: string;
}

function readTranslations(): TranslationRecord[] {
  try {
    const raw = localStorage.getItem(TRANSLATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTranslations(list: TranslationRecord[]): void {
  try {
    // Keep only the most recent MAX_HISTORY records to avoid unbounded growth.
    const trimmed = list.slice(0, MAX_HISTORY);
    localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded — drop oldest and retry once.
    try {
      localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify(list.slice(0, 50)));
    } catch { /* give up silently */ }
  }
}

function readSettings(): UserSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserSettings;
  } catch {
    return null;
  }
}

function writeSettings(s: UserSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function fetchTranslations(): Promise<TranslationRecord[]> {
  return readTranslations().sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
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
  if (idx >= 0) {
    list[idx].is_favorite = fav;
    writeTranslations(list);
  }
}

export async function deleteTranslation(id: string): Promise<void> {
  const list = readTranslations();
  writeTranslations(list.filter((r) => r.id !== id));
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
    plan: "free",
    monthly_quota_used: 0,
    quota_reset_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    created_at: new Date().toISOString(),
  };
  Object.assign(merged, updates);
  writeSettings(merged);
  return merged;
}

export async function incrementQuota(used: number): Promise<void> {
  const s = readSettings();
  if (!s) return;
  s.monthly_quota_used += used;
  writeSettings(s);
}
