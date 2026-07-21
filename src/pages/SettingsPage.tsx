import { type UserSettings } from "../lib/supabase";
import { getLanguage, getContextMode } from "../lib/languages";

interface SettingsPageProps {
  settings: UserSettings | null;
  quotaUsed: number;
  quotaLimit: number;
  onUpgrade: () => void;
  onToast: (msg: string) => void;
}

export function SettingsPage({ settings, quotaUsed, quotaLimit, onUpgrade, onToast }: SettingsPageProps) {
  const plan = settings?.plan ?? "free";
  const usagePct = Math.min((quotaUsed / quotaLimit) * 100, 100);
  const sourceLang = settings?.default_source_lang ?? "auto";
  const targetLang = settings?.default_target_lang ?? "en";
  const context = settings?.default_context ?? "general";

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
          <div className="settings-row" onClick={() => onToast("LinguaVerse v1.0.0")}>
            <div className="settings-row-label">
              <div className="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div className="settings-row-text"><div className="settings-row-title">版本</div><div className="settings-row-desc">LinguaVerse v1.0.0</div></div>
            </div>
            <span className="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
          </div>
          <div className="settings-row" onClick={() => onToast("AI 語境翻譯引擎")}>
            <div className="settings-row-label">
              <div className="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
              </div>
              <div className="settings-row-text"><div className="settings-row-title">翻譯引擎</div><div className="settings-row-desc">AI 語境感知翻譯 v2</div></div>
            </div>
            <span className="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
          </div>
        </div>
      </div>
    </div>
  );
}
