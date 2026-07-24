import { type UserSettings } from "../lib/supabase";
import { getLanguage } from "../lib/languages";

interface SettingsPageProps {
  settings: UserSettings | null;
  onToast: (msg: string) => void;
  adFree: boolean;
  onRemoveAds: () => void;
  dailyUsed: number;
  dailyLimit: number;
}

const APP_VERSION = "2.0.0";

export function SettingsPage({ settings, onToast, adFree, onRemoveAds, dailyUsed, dailyLimit }: SettingsPageProps) {
  const sourceLang = settings?.default_source_lang ?? "auto";
  const targetLang = settings?.default_target_lang ?? "en";
  const src = getLanguage(sourceLang);
  const tgt = getLanguage(targetLang);

  return (
    <div className="page settings-page">
      <h1 className="page-title">設定</h1>

      {/* Ad status / remove ads */}
      <div className="settings-section">
        <div className="section-label">廣告</div>
        <div className="settings-card">
          <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "12px" }}>
            <div className="row-label" style={{ width: "100%" }}>
              <div className="row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 11l18-5v12L3 14v-3z" />
                  <path d="M11.6 16.8a3 3 0 11-5.8-1.6" />
                </svg>
              </div>
              <div className="row-text" style={{ flex: 1 }}>
                <div className="row-title">{adFree ? "無廣告版" : "廣告支援版"}</div>
                <div className="row-desc">
                  {adFree
                    ? "已移除廣告 · 享受無限翻譯"
                    : `每日 ${dailyLimit} 次免費 · 已用 ${dailyUsed} 次`}
                </div>
              </div>
            </div>
            {!adFree && (
              <button className="stt-btn stt-btn-primary" onClick={() => { onRemoveAds(); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l3.5 7.5L21 12l-7.5 3.5L10 23l-3.5-7.5L-1 12l7.5-3.5L10 1z" transform="translate(2 0)" />
                </svg>
                移除廣告
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="section-label">預設語言</div>
        <div className="settings-card">
          <div className="settings-row" onClick={() => onToast("於翻譯頁面切換語言即可更新預設值")}>
            <div className="row-label">
              <div className="row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h12M9 3v2M5 9l1.5 9.5a2 2 0 002 1.5h7a2 2 0 002-1.5L19 9" /></svg>
              </div>
              <div className="row-text"><div className="row-title">預設語言組</div><div className="row-desc">翻譯頁面開啟時的來源與目標</div></div>
            </div>
            <div className="row-value">{src.flag} {src.nativeName} → {tgt.flag} {tgt.nativeName}</div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="section-label">關於</div>
        <div className="settings-card">
          <div className="settings-row" onClick={() => onToast(`译境 LinguaVerse v${APP_VERSION}`)}>
            <div className="row-label">
              <div className="row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div className="row-text"><div className="row-title">版本</div><div className="row-desc">译境 LinguaVerse v{APP_VERSION}</div></div>
            </div>
            <span className="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
          </div>
          <div className="settings-row" onClick={() => onToast("服務運作正常")}>
            <div className="row-label">
              <div className="row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
              </div>
              <div className="row-text"><div className="row-title">服務狀態</div><div className="row-desc">運作正常</div></div>
            </div>
            <span className="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
          </div>
        </div>
      </div>

      <div className="about-foot">
        <b>译境 LinguaVerse</b><br />
        AI 智能翻譯 · 讓每句話都恰到好處
      </div>
    </div>
  );
}
