/*
# Create custom_prompts table (single-tenant, no auth)

1. New Tables
- `custom_prompts`
  - `id` (uuid, primary key)
  - `name` (text, not null) — 模板名稱
  - `domain` (text, not null default 'custom') — 領域代碼
  - `base_override` (text, nullable) — 基礎規則覆蓋
  - `domain_override` (text, nullable) — 領域約束覆蓋
  - `style_override` (text, nullable) — 語言風格覆蓋
  - `output_override` (text, nullable) — 輸出格式覆蓋
  - `terminology` (jsonb, nullable) — 術語對照表
  - `is_active` (boolean, default false) — 是否啟用
  - `created_at` (timestamptz, default now())
  - `updated_at` (timestamptz, default now())

2. Security
- Enable RLS on `custom_prompts`.
- Allow anon + authenticated CRUD because the data is intentionally shared/public (no-auth app).
*/

CREATE TABLE IF NOT EXISTS custom_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text NOT NULL DEFAULT 'custom',
  base_override text,
  domain_override text,
  style_override text,
  output_override text,
  terminology jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE custom_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_custom_prompts" ON custom_prompts;
CREATE POLICY "anon_select_custom_prompts" ON custom_prompts FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_custom_prompts" ON custom_prompts;
CREATE POLICY "anon_insert_custom_prompts" ON custom_prompts FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_custom_prompts" ON custom_prompts;
CREATE POLICY "anon_update_custom_prompts" ON custom_prompts FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_custom_prompts" ON custom_prompts;
CREATE POLICY "anon_delete_custom_prompts" ON custom_prompts FOR DELETE
  TO anon, authenticated USING (true);
