import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

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

export async function fetchTranslations(): Promise<TranslationRecord[]> {
  const { data, error } = await supabase
    .from("translations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as TranslationRecord[];
}

export async function insertTranslation(
  record: Omit<TranslationRecord, "id" | "created_at" | "is_favorite">
): Promise<TranslationRecord | null> {
  const { data, error } = await supabase
    .from("translations")
    .insert(record)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data as TranslationRecord | null;
}

export async function toggleFavorite(id: string, fav: boolean): Promise<void> {
  const { error } = await supabase
    .from("translations")
    .update({ is_favorite: fav })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTranslation(id: string): Promise<void> {
  const { error } = await supabase.from("translations").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchSettings(): Promise<UserSettings | null> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as UserSettings | null;
}

export async function upsertSettings(
  settings: Partial<UserSettings>
): Promise<UserSettings | null> {
  const existing = await fetchSettings();
  if (existing) {
    const { data, error } = await supabase
      .from("user_settings")
      .update(settings)
      .eq("id", existing.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data as UserSettings | null;
  } else {
    const { data, error } = await supabase
      .from("user_settings")
      .insert(settings)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data as UserSettings | null;
  }
}

export async function incrementQuota(used: number): Promise<void> {
  const existing = await fetchSettings();
  if (existing) {
    await supabase
      .from("user_settings")
      .update({ monthly_quota_used: existing.monthly_quota_used + used })
      .eq("id", existing.id);
  }
}
