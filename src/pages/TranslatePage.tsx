import { useState } from "react";
import { LANGUAGES, getLanguage } from "../lib/languages";
import { scheduleTranslationStream, type TranslationOutput } from "../service/translator-scheduler";
import { insertTranslation, incrementQuota } from "../lib/supabase";
import { BottomSheet, SheetItem } from "../components/BottomSheet";
import { VoiceInput } from "../components/VoiceInput";

interface TranslatePageProps {
  sourceLang: string;
  targetLang: string;
  onLangChange: (source: string, target: string) => void;
  onToast: (msg: string) => void;
  onQuotaUpdate: () => void;
  quotaUsed: number;
  quotaLimit: number;
}

export function TranslatePage({
  sourceLang, targetLang, onLangChange, onToast, onQuotaUpdate, quotaUsed, quotaLimit,
}: TranslatePageProps) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<TranslationOutput | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sheet, setSheet] = useState<null | "source" | "target">(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);

  const charLimit = 500;
  const remaining = Math.max(quotaLimit - quotaUsed, 0);
  const canTranslate = input.trim().length > 0 && !loading && remaining > 0;

  const handleTranslate = async () => {
    if (!canTranslate) return;
    setLoading(true);
    setResult(null);
    setStreamingText("");
    setSaved(false);
    try {
      const res = await scheduleTranslationStream(
        input, sourceLang, targetLang, "general",
        (_delta, fullSoFar) => setStreamingText(fullSoFar),
      );
      setResult(res);
      setStreamingText("");
      await insertTranslation({
        source_text: input.trim(),
        translated_text: res.text,
        source_lang: res.detectedLang ?? sourceLang,
        target_lang: targetLang,
        context_mode: "general",
        confidence: 0.95,
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
    const text = result.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onToast("已複製到剪貼簿");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onToast("複製失敗");
    }
  };

  const handleClear = () => {
    setInput(""); setResult(null); setStreamingText(""); setSaved(false); setCopied(false);
  };

  // VoiceInput callback — append the recognised text to the input box
  const handleVoiceTranscribed = (text: string) => {
    setInput((prev) => {
      const base = prev.trim();
      const merged = base ? `${base} ${text}` : text;
      return merged.slice(0, charLimit);
    });
    // Clear any previous result so the user sees the new text fresh
    if (result) { setResult(null); setSaved(false); setCopied(false); }
  };

  // VoiceInput state changes — toggles the textarea placeholder
  const handleVoiceStateChange = (s: "idle" | "recording" | "transcribing") => {
    setVoiceActive(s !== "idle");
  };

  const displayText = result ? result.text : (loading && streamingText ? streamingText : "");

  return (
    <div className="page translate-page">
      <div className="lang-bar">
        <button className="lang-select" onClick={() => setSheet("source")}>
          <span className="lang-select-meta">來源</span>
          <span className="lang-select-current">
            <span className="lang-flag">{getLanguage(sourceLang).flag}</span>
            <span className="lang-name">{getLanguage(sourceLang).nativeName}</span>
          </span>
        </button>
        <button className="lang-swap" onClick={handleSwap} aria-label="交換語言">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
        <button className="lang-select" onClick={() => setSheet("target")}>
          <span className="lang-select-meta">目標</span>
          <span className="lang-select-current">
            <span className="lang-flag">{getLanguage(targetLang).flag}</span>
            <span className="lang-name">{getLanguage(targetLang).nativeName}</span>
          </span>
        </button>
      </div>

      <div className="input-card">
        <textarea
          className="translate-textarea"
          placeholder={voiceActive ? "正在錄音…" : "輸入要翻譯的文字，或點擊麥克風語音輸入…"}
          value={input}
          onChange={(e) => {
            const val = e.target.value.slice(0, charLimit);
            setInput(val);
            if (result) { setResult(null); setSaved(false); setCopied(false); }
          }}
          maxLength={charLimit}
        />
        <div className="input-footer">
          <span className={`char-count ${input.length > charLimit * 0.85 ? "warn" : ""}`}>
            {input.length} / {charLimit}
          </span>
          <div className="input-actions">
            <VoiceInput
              onTranscribed={handleVoiceTranscribed}
              onToast={onToast}
              onStateChange={handleVoiceStateChange}
              disabled={loading}
            />
            <button className="icon-btn" onClick={handleClear} disabled={!input && !result} aria-label="清除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <button
        className={`translate-btn ${loading ? "loading" : ""}`}
        onClick={handleTranslate}
        disabled={!canTranslate}
      >
        {loading ? (
          <>
            翻譯中
            <span className="btn-dots"><span /><span /><span /></span>
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

      {!loading && !result && remaining > 0 && (
        <div className="quota-hint">本月剩餘 <b>{remaining}</b> 次翻譯</div>
      )}
      {!loading && remaining <= 0 && (
        <div className="quota-hint">本月配額已用完，升級 Pro 享受無限翻譯</div>
      )}

      {loading && !streamingText && (
        <div className="result-card anim-up">
          <div className="result-head">
            <div className="result-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              翻譯結果
            </div>
          </div>
          <div className="result-skeleton">
            <div className="sk-line shimmer" style={{ width: "92%", height: 16 }} />
            <div className="sk-line shimmer" style={{ width: "78%", height: 16 }} />
            <div className="sk-line shimmer" style={{ width: "60%", height: 16 }} />
          </div>
        </div>
      )}

      {(result || streamingText) && (
        <div className="result-card anim-up">
          <div className="result-head">
            <div className="result-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              翻譯結果{loading && <span className="streaming-cursor">▍</span>}
            </div>
            <button className={`copy-btn ${copied ? "copied" : ""}`} onClick={handleCopy} aria-label="複製譯文" disabled={loading}>
              {copied ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                  已複製
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 012-2h10" />
                  </svg>
                  複製
                </>
              )}
            </button>
          </div>

          <div className="result-text">{displayText}</div>

          {saved && (
            <div className="result-meta">
              <span className="result-saved">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
                已儲存
              </span>
            </div>
          )}
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
