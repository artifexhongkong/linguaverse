import { useState } from "react";
import { LANGUAGES, CONTEXT_MODES, getLanguage } from "../lib/languages";
import { scheduleTranslation, type SchedulerResult } from "../service/translator-scheduler";
import { insertTranslation, incrementQuota } from "../lib/supabase";
import { BottomSheet, SheetItem } from "../components/BottomSheet";

interface TranslatePageProps {
  sourceLang: string;
  targetLang: string;
  context: string;
  onLangChange: (source: string, target: string) => void;
  onContextChange: (context: string) => void;
  onToast: (msg: string) => void;
  onQuotaUpdate: () => void;
  quotaUsed: number;
  quotaLimit: number;
}

export function TranslatePage({
  sourceLang, targetLang, context, onLangChange, onContextChange, onToast, onQuotaUpdate, quotaUsed, quotaLimit,
}: TranslatePageProps) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<SchedulerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sheet, setSheet] = useState<null | "source" | "target">(null);
  const [saved, setSaved] = useState(false);

  const charLimit = 500;
  const remaining = quotaLimit - quotaUsed;
  const canTranslate = input.trim().length > 0 && !loading && remaining > 0;

  const handleTranslate = async () => {
    if (!canTranslate) return;
    setLoading(true);
    setResult(null);
    setSaved(false);
    try {
      const res = await scheduleTranslation(input, sourceLang, targetLang, context);
      setResult(res);
      await insertTranslation({
        source_text: input.trim(), translated_text: res.text,
        source_lang: res.detectedLang ?? sourceLang, target_lang: targetLang,
        context_mode: context, confidence: res.confidence,
      });
      await incrementQuota(1);
      onQuotaUpdate();
      setSaved(true);
    } catch {
      onToast("翻譯失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  };

  const handleSwap = () => {
    if (sourceLang === "auto") { onToast("自動偵測無法設為目標語言"); return; }
    onLangChange(targetLang, sourceLang);
  };

  const handleCopy = async () => {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.text); onToast("已複製到剪貼簿"); } catch { onToast("複製失敗"); }
  };

  const handleClear = () => { setInput(""); setResult(null); setSaved(false); };

  const confidenceLevel = result
    ? result.confidence >= 0.85 ? "high" : result.confidence >= 0.6 ? "mid" : "low"
    : "high";

  return (
    <div className="page translate-page">
      <div className="lang-bar">
        <button className="lang-select" onClick={() => setSheet("source")}>
          <span className="lang-flag">{getLanguage(sourceLang).flag}</span>
          <span className="lang-name">{getLanguage(sourceLang).nativeName}</span>
        </button>
        <button className="lang-arrow" onClick={handleSwap} aria-label="交換語言">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
        <button className="lang-select" onClick={() => setSheet("target")}>
          <span className="lang-flag">{getLanguage(targetLang).flag}</span>
          <span className="lang-name">{getLanguage(targetLang).nativeName}</span>
        </button>
      </div>

      <div className="context-section">
        <div className="context-label">語境模式</div>
        <div className="context-chips">
          {CONTEXT_MODES.map((c) => (
            <button key={c.code} className={`context-chip ${context === c.code ? "active" : ""}`} onClick={() => onContextChange(c.code)}>
              <span className="context-chip-icon">{c.icon}</span>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="translate-input-card">
        <textarea
          className="translate-textarea"
          placeholder="輸入要翻譯的文字…"
          value={input}
          onChange={(e) => {
            const val = e.target.value.slice(0, charLimit);
            setInput(val);
            if (result) { setResult(null); setSaved(false); }
          }}
          maxLength={charLimit}
        />
        <div className="input-footer">
          <span className={`char-count ${input.length > charLimit * 0.8 ? "warn" : ""}`}>
            {input.length} / {charLimit}
          </span>
          <div className="input-actions">
            <button className="icon-btn" onClick={handleClear} disabled={!input && !result} aria-label="清除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <button className={`translate-btn ${loading ? "loading" : ""}`} onClick={handleTranslate} disabled={!canTranslate}>
        {loading ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            AI 語境分析中…
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            翻譯
          </>
        )}
      </button>

      {result && (
        <div className={`result-card anim-up ${result.engine === "machine-fallback" ? "result-fallback" : ""}`}>
          <div className="result-header">
            <div className="result-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {result.engine === "machine-fallback" ? "機器兜底翻譯" : "AI 智能翻譯"} {saved && "· 已儲存"}
            </div>
          </div>
          {result.fallbackNotice && (
            <div className="fallback-notice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
                <path d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
              {result.fallbackNotice}
            </div>
          )}
          <div className="result-text">{result.text}</div>
          {result.contextNote && (
            <div className="context-note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
                <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {result.contextNote}
            </div>
          )}
          <div className="result-footer">
            <div className="confidence-badge">
              <span className={`confidence-dot ${confidenceLevel}`} />
              信心指數 {Math.round(result.confidence * 100)}%
            </div>
            <div className="result-actions">
              <button className="icon-btn" onClick={handleCopy} aria-label="複製">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {sheet && (
        <BottomSheet
          title={sheet === "source" ? "選擇來源語言" : "選擇目標語言"}
          onClose={() => setSheet(null)}
        >
          {LANGUAGES.filter((l) => (sheet === "target" ? l.code !== "auto" : true)).map((l) => (
            <SheetItem
              key={l.code}
              flag={l.flag}
              name={l.name}
              nativeName={l.nativeName}
              selected={(sheet === "source" && sourceLang === l.code) || (sheet === "target" && targetLang === l.code)}
              onClick={() => {
                if (sheet === "source") onLangChange(l.code, targetLang);
                else onLangChange(sourceLang, l.code);
                setSheet(null);
              }}
            />
          ))}
        </BottomSheet>
      )}
    </div>
  );
}
