import { useState, useEffect, useCallback } from "react";
import { type UserSettings } from "../lib/supabase";
import {
  fetchCustomPrompts, insertCustomPrompt, updateCustomPrompt,
  deleteCustomPrompt, setActivePrompt, isSupabaseConfigured,
  type CustomPromptRecord,
} from "../lib/supabase";
import { getLanguage, getContextMode } from "../lib/languages";
import { DOMAIN_TEMPLATES, DOMAIN_LIST } from "../prompts/domain-templates";
import { DEFAULT_BASE_PROMPT } from "../prompts/base-rules";
import { DEFAULT_STYLE_PROMPT } from "../prompts/style-rules";
import { DEFAULT_OUTPUT_PROMPT } from "../prompts/output-format";
import { assemblePrompt } from "../prompts/prompt-assembler";
import type { DomainCode } from "../prompts/types";

interface SettingsPageProps {
  settings: UserSettings | null;
  quotaUsed: number;
  quotaLimit: number;
  onUpgrade: () => void;
  onToast: (msg: string) => void;
}

export function SettingsPage({ settings, quotaUsed, quotaLimit, onUpgrade, onToast }: SettingsPageProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [machineFallbackEnabled, setMachineFallbackEnabled] = useState(true);
  const [customPrompts, setCustomPrompts] = useState<CustomPromptRecord[]>([]);
  const [editingPrompt, setEditingPrompt] = useState<CustomPromptRecord | null>(null);
  const [promptDraft, setPromptDraft] = useState({
    name: "",
    domain: "custom" as string,
    base_override: "",
    domain_override: "",
    style_override: "",
    output_override: "",
    terminology: "",
  });
  const plan = settings?.plan ?? "free";
  const usagePct = Math.min((quotaUsed / quotaLimit) * 100, 100);
  const sourceLang = settings?.default_source_lang ?? "auto";
  const targetLang = settings?.default_target_lang ?? "en";
  const context = settings?.default_context ?? "general";

  const loadPrompts = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const data = await fetchCustomPrompts();
      setCustomPrompts(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadPrompts(); }, [loadPrompts]);

  const startNewPrompt = () => {
    setEditingPrompt(null);
    setPromptDraft({ name: "", domain: "custom", base_override: "", domain_override: "", style_override: "", output_override: "", terminology: "" });
    setShowPromptEditor(true);
  };

  const startEditPrompt = (p: CustomPromptRecord) => {
    setEditingPrompt(p);
    setPromptDraft({
      name: p.name,
      domain: p.domain,
      base_override: p.base_override ?? "",
      domain_override: p.domain_override ?? "",
      style_override: p.style_override ?? "",
      output_override: p.output_override ?? "",
      terminology: p.terminology ? Object.entries(p.terminology).map(([k, v]) => `${k}=${v}`).join("\n") : "",
    });
    setShowPromptEditor(true);
  };

  const parseTerminology = (text: string): Record<string, string> | null => {
    const lines = text.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    const map: Record<string, string> = {};
    for (const line of lines) {
      const idx = line.indexOf("=");
      if (idx > 0) map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return Object.keys(map).length > 0 ? map : null;
  };

  const handleSavePrompt = async () => {
    if (!promptDraft.name.trim()) { onToast("請輸入模板名稱"); return; }
    const term = parseTerminology(promptDraft.terminology);
    const payload = {
      name: promptDraft.name.trim(),
      domain: promptDraft.domain,
      base_override: promptDraft.base_override.trim() || null,
      domain_override: promptDraft.domain_override.trim() || null,
      style_override: promptDraft.style_override.trim() || null,
      output_override: promptDraft.output_override.trim() || null,
      terminology: term,
      is_active: false,
    };
    try {
      if (editingPrompt) {
        await updateCustomPrompt(editingPrompt.id, payload);
        onToast("模板已更新");
      } else {
        await insertCustomPrompt(payload);
        onToast("模板已建立");
      }
      setShowPromptEditor(false);
      loadPrompts();
    } catch { onToast("儲存失敗"); }
  };

  const handleDeletePrompt = async (id: string) => {
    try { await deleteCustomPrompt(id); onToast("已刪除"); loadPrompts(); } catch { onToast("刪除失敗"); }
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    try { await setActivePrompt(id, active); onToast(active ? "已啟用模板" : "已停用模板"); loadPrompts(); } catch { onToast("操作失敗"); }
  };

  const handleExportPrompt = (p: CustomPromptRecord) => {
    const json = JSON.stringify(p, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `prompt-${p.name}.json`; a.click();
    URL.revokeObjectURL(url);
    onToast("已匯出");
  };

  const handleImportPrompt = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await insertCustomPrompt({
          name: data.name || "匯入模板",
          domain: data.domain || "custom",
          base_override: data.base_override ?? null,
          domain_override: data.domain_override ?? null,
          style_override: data.style_override ?? null,
          output_override: data.output_override ?? null,
          terminology: data.terminology ?? null,
          is_active: false,
        });
        onToast("匯入成功");
        loadPrompts();
      } catch { onToast("匯入失敗"); }
    };
    input.click();
  };

  const previewPrompt = () => {
    const assembled = assemblePrompt({
      domain: promptDraft.domain as DomainCode | "custom",
      customBase: promptDraft.base_override || null,
      customDomain: promptDraft.domain_override || null,
      customStyle: promptDraft.style_override || null,
      customOutput: promptDraft.output_override || null,
      terminology: parseTerminology(promptDraft.terminology),
    });
    return assembled.fullPrompt;
  };

  return (
    <div className="page settings-page">
      <h1 className="settings-title">設定</h1>

      <div className="usage-card">
        <div className="usage-header">
          <div className="usage-plan">{plan === "free" ? "免費方案" : plan === "pro" ? "Pro 方案" : "Enterprise"}</div>
          <div className="header-plan-badge">{plan === "free" ? "FREE" : plan === "pro" ? "PRO" : "ENTERPRISE"}</div>
        </div>
        <div className="usage-bar"><div className="usage-bar-fill" style={{ width: `${usagePct}%` }} /></div>
        <div className="usage-stats">
          <span className="usage-used">{quotaUsed} 次</span>
          <span className="usage-total">/ {quotaLimit} 次月度配額</span>
        </div>
        {plan === "free" && (
          <button className="upgrade-btn" onClick={onUpgrade}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l3.5 7.5L21 12l-7.5 3.5L10 23l-3.5-7.5L-1 12l7.5-3.5L10 1z" transform="translate(2 0)" />
            </svg>
            升級 Pro 解鎖更多功能
          </button>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-label">預設語言</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-label">
              <div className="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h12M9 3v2M5 9l1.5 9.5a2 2 0 002 1.5h7a2 2 0 002-1.5L19 9" /></svg>
              </div>
              <div className="settings-row-text"><div className="settings-row-title">來源語言</div><div className="settings-row-desc">翻譯時的預設來源</div></div>
            </div>
            <div className="settings-row-value">
              {getLanguage(sourceLang).flag} {getLanguage(sourceLang).nativeName}
              <span className="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              <div className="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div className="settings-row-text"><div className="settings-row-title">目標語言</div><div className="settings-row-desc">翻譯時的預設目標</div></div>
            </div>
            <div className="settings-row-value">
              {getLanguage(targetLang).flag} {getLanguage(targetLang).nativeName}
              <span className="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              <div className="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div className="settings-row-text"><div className="settings-row-title">預設語境</div><div className="settings-row-desc">翻譯時的語境模式</div></div>
            </div>
            <div className="settings-row-value">
              {getContextMode(context).icon} {getContextMode(context).name}
              <span className="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">關於</div>
        <div className="settings-card">
          <div className="settings-row" onClick={() => onToast("LinguaVerse v1.2.0")}>
            <div className="settings-row-label">
              <div className="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div className="settings-row-text"><div className="settings-row-title">版本</div><div className="settings-row-desc">LinguaVerse v1.2.0</div></div>
            </div>
            <span className="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
          </div>
          <div className="settings-row" onClick={() => onToast("AI 智能翻譯引擎")}>
            <div className="settings-row-label">
              <div className="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
              </div>
              <div className="settings-row-text"><div className="settings-row-title">翻譯引擎</div><div className="settings-row-desc">AI 智能翻譯（LLM 主通道）</div></div>
            </div>
            <span className="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
          </div>
          <div className="settings-row" onClick={() => setShowAdvanced((v) => !v)}>
            <div className="settings-row-label">
              <div className="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </div>
              <div className="settings-row-text"><div className="settings-row-title">進階選項</div><div className="settings-row-desc">傳統機器翻譯設定</div></div>
            </div>
            <span className="chevron" style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.25s var(--ease-out)" }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
          </div>
        </div>
      </div>

      {showAdvanced && (
        <div className="settings-section anim-fade">
          <div className="settings-section-label">進階 · 傳統機器翻譯</div>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <div className="settings-row-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <div className="settings-row-text"><div className="settings-row-title">機器翻譯兜底</div><div className="settings-row-desc">LLM 失敗時自動切換至 Google/DeepL</div></div>
              </div>
              <button
                className={`toggle-switch ${machineFallbackEnabled ? "on" : ""}`}
                onClick={() => {
                  const next = !machineFallbackEnabled;
                  setMachineFallbackEnabled(next);
                  onToast(next ? "已啟用機器翻譯兜底" : "已停用機器翻譯兜底");
                }}
              >
                <span className="toggle-knob" />
              </button>
            </div>
            <div className="settings-row" onClick={() => onToast("目前預設：Google 翻譯")}>
              <div className="settings-row-label">
                <div className="settings-row-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>
                </div>
                <div className="settings-row-text"><div className="settings-row-title">兜底翻譯引擎</div><div className="settings-row-desc">Google 翻譯（預設）</div></div>
              </div>
              <span className="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
            </div>
          </div>

          <div className="settings-section-label" style={{ marginTop: 20 }}>進階 · 翻譯模板管理</div>
          <div className="settings-card">
            <div className="settings-row" onClick={() => setShowPromptEditor((v) => !v)}>
              <div className="settings-row-label">
                <div className="settings-row-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </div>
                <div className="settings-row-text"><div className="settings-row-title">Prompt 編輯器</div><div className="settings-row-desc">管理翻譯提示詞模板</div></div>
              </div>
              <span className="chevron" style={{ transform: showPromptEditor ? "rotate(90deg)" : "none", transition: "transform 0.25s var(--ease-out)" }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
            </div>
          </div>

          {showPromptEditor && (
            <div className="prompt-editor anim-fade">
              <div className="prompt-section-label">內建領域模板</div>
              <div className="domain-template-grid">
                {DOMAIN_LIST.map((d) => (
                  <div key={d.code} className="domain-template-card" onClick={() => {
                    const template = DOMAIN_TEMPLATES.find((t) => t.code === d.code);
                    if (template) {
                      setPromptDraft({
                        name: template.name,
                        domain: template.code,
                        base_override: "",
                        domain_override: template.rules.map((r) => `  • ${r}`).join("\n"),
                        style_override: "",
                        output_override: "",
                        terminology: template.terminology
                          ? Object.entries(template.terminology).map(([k, v]) => `${k}=${v}`).join("\n")
                          : "",
                      });
                      setEditingPrompt(null);
                    }
                  }}>
                    <div className="domain-template-icon">{d.icon}</div>
                    <div className="domain-template-name">{d.name}</div>
                    <div className="domain-template-desc">{d.desc}</div>
                  </div>
                ))}
              </div>

              <div className="prompt-section-label" style={{ marginTop: 16 }}>我的自訂模板</div>
              <div className="prompt-actions-bar">
                <button className="prompt-btn primary" onClick={startNewPrompt}>+ 新建模板</button>
                <button className="prompt-btn secondary" onClick={handleImportPrompt}>匯入 JSON</button>
              </div>
              {customPrompts.length === 0 ? (
                <div className="prompt-empty">尚無自訂模板</div>
              ) : (
                <div className="prompt-list">
                  {customPrompts.map((p) => (
                    <div key={p.id} className="prompt-item">
                      <div className="prompt-item-info">
                        <div className="prompt-item-name">{p.name}</div>
                        <div className="prompt-item-meta">
                          {p.domain !== "custom" && <span className="prompt-item-tag">{DOMAIN_TEMPLATES.find((t) => t.code === p.domain)?.name ?? p.domain}</span>}
                          {p.is_active && <span className="prompt-item-tag active">使用中</span>}
                        </div>
                      </div>
                      <div className="prompt-item-actions">
                        <button className="prompt-icon-btn" onClick={() => handleToggleActive(p.id, !p.is_active)} title="啟用/停用">
                          <svg viewBox="0 0 24 24" fill={p.is_active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                        </button>
                        <button className="prompt-icon-btn" onClick={() => startEditPrompt(p)} title="編輯">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button className="prompt-icon-btn" onClick={() => handleExportPrompt(p)} title="匯出">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        </button>
                        <button className="prompt-icon-btn danger" onClick={() => handleDeletePrompt(p.id)} title="刪除">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(showPromptEditor && (editingPrompt || promptDraft.name)) && (
                <div className="prompt-edit-form anim-fade">
                  <div className="prompt-edit-section">
                    <label className="prompt-edit-label">模板名稱</label>
                    <input className="prompt-edit-input" type="text" value={promptDraft.name} onChange={(e) => setPromptDraft({ ...promptDraft, name: e.target.value })} placeholder="例如：我的法律翻譯模板" />
                  </div>
                  <div className="prompt-edit-section">
                    <label className="prompt-edit-label">領域</label>
                    <select className="prompt-edit-select" value={promptDraft.domain} onChange={(e) => setPromptDraft({ ...promptDraft, domain: e.target.value })}>
                      <option value="custom">自訂</option>
                      {DOMAIN_LIST.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="prompt-edit-section">
                    <label className="prompt-edit-label">基礎規則層（留空使用預設）</label>
                    <textarea className="prompt-edit-textarea" rows={3} value={promptDraft.base_override} onChange={(e) => setPromptDraft({ ...promptDraft, base_override: e.target.value })} placeholder={DEFAULT_BASE_PROMPT.slice(0, 80) + "…"} />
                  </div>
                  <div className="prompt-edit-section">
                    <label className="prompt-edit-label">領域約束層</label>
                    <textarea className="prompt-edit-textarea" rows={4} value={promptDraft.domain_override} onChange={(e) => setPromptDraft({ ...promptDraft, domain_override: e.target.value })} placeholder="領域特定翻譯規則…" />
                  </div>
                  <div className="prompt-edit-section">
                    <label className="prompt-edit-label">語言風格層（留空使用預設）</label>
                    <textarea className="prompt-edit-textarea" rows={2} value={promptDraft.style_override} onChange={(e) => setPromptDraft({ ...promptDraft, style_override: e.target.value })} placeholder={DEFAULT_STYLE_PROMPT.slice(0, 80) + "…"} />
                  </div>
                  <div className="prompt-edit-section">
                    <label className="prompt-edit-label">輸出格式層（留空使用預設）</label>
                    <textarea className="prompt-edit-textarea" rows={2} value={promptDraft.output_override} onChange={(e) => setPromptDraft({ ...promptDraft, output_override: e.target.value })} placeholder={DEFAULT_OUTPUT_PROMPT.slice(0, 80) + "…"} />
                  </div>
                  <div className="prompt-edit-section">
                    <label className="prompt-edit-label">術語對照表（每行一條，格式：原文=譯文）</label>
                    <textarea className="prompt-edit-textarea" rows={4} value={promptDraft.terminology} onChange={(e) => setPromptDraft({ ...promptDraft, terminology: e.target.value })} placeholder={"liability=責任\nbreach=違約"} />
                  </div>
                  <div className="prompt-edit-section">
                    <label className="prompt-edit-label">預覽</label>
                    <pre className="prompt-preview">{previewPrompt().slice(0, 500)}…</pre>
                  </div>
                  <div className="prompt-edit-actions">
                    <button className="prompt-btn primary" onClick={handleSavePrompt}>{editingPrompt ? "更新" : "儲存"}</button>
                    <button className="prompt-btn secondary" onClick={() => { setShowPromptEditor(false); setEditingPrompt(null); }}>取消</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
