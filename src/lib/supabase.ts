import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

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
  if (!isSupabaseConfigured) return [];
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
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from("translations")
    .insert(record)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data as TranslationRecord | null;
}

export async function toggleFavorite(id: string, fav: boolean): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase
    .from("translations")
    .update({ is_favorite: fav })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTranslation(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.from("translations").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchSettings(): Promise<UserSettings | null> {
  if (!isSupabaseConfigured) return null;
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
  if (!isSupabaseConfigured) return null;
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
  if (!isSupabaseConfigured) return;
  const existing = await fetchSettings();
  if (existing) {
    await supabase
      .from("user_settings")
      .update({ monthly_quota_used: existing.monthly_quota_used + used })
      .eq("id", existing.id);
  }
}

export interface CustomPromptRecord {
  id: string;
  name: string;
  domain: string;
  base_override: string | null;
  domain_override: string | null;
  style_override: string | null;
  output_override: string | null;
  terminology: Record<string, string> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function fetchCustomPrompts(): Promise<CustomPromptRecord[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from("custom_prompts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CustomPromptRecord[];
}

export async function insertCustomPrompt(
  record: Omit<CustomPromptRecord, "id" | "created_at" | "updated_at">
): Promise<CustomPromptRecord | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from("custom_prompts")
    .insert(record)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data as CustomPromptRecord | null;
}

export async function updateCustomPrompt(
  id: string,
  updates: Partial<CustomPromptRecord>
): Promise<CustomPromptRecord | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from("custom_prompts")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data as CustomPromptRecord | null;
}

export async function deleteCustomPrompt(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.from("custom_prompts").delete().eq("id", id);
  if (error) throw error;
}

export async function setActivePrompt(id: string, active: boolean): Promise<void> {
  if (!isSupabaseConfigured) return;
  if (active) {
    await supabase.from("custom_prompts").update({ is_active: false }).neq("id", id);
  }
  await supabase
    .from("custom_prompts")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id);
}
