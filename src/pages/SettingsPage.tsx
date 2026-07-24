import { useEffect, useState } from "react";
import { type UserSettings } from "../lib/supabase";
import { getLanguage } from "../lib/languages";
import {
  isOfflineSTTAvailable,
  checkModels,
  downloadModels,
  deleteModels,
  type DownloadProgress,
} from "../lib/offline-stt";

interface SettingsPageProps {
  settings: UserSettings | null;
  quotaUsed: number;
  quotaLimit: number;
  onUpgrade: () => void;
  onToast: (msg: string) => void;
}

const APP_VERSION = "1.1.0";

export function SettingsPage({ settings, quotaUsed, quotaLimit, onUpgrade, onToast }: SettingsPageProps) {
  const plan = settings?.plan ?? "free";
  const usagePct = Math.min((quotaUsed / quotaLimit) * 100, 100);
  const sourceLang = settings?.default_source_lang ?? "auto";
  const targetLang = settings?.default_target_lang ?? "en";

  const src = getLanguage(sourceLang);
  const tgt = getLanguage(targetLang);
  const planLabel = plan === "free" ? "免費方案" : plan === "pro" ? "Pro 方案" : "Enterprise 方案";
  const planBadge = plan === "free" ? "FREE" : plan === "pro" ? "PRO" : "ENTERPRISE";

  // Offline STT model state
  const sttAvailable = isOfflineSTTAvailable();
  const [modelsDownloaded, setModelsDownloaded] = useState(false);
  const [modelBytes, setModelBytes] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  // Check model status on mount + when settings page becomes active
  useEffect(() => {
    if (!sttAvailable) return;
    let cancelled = false;
    const check = async () => {
      const state = await checkModels();
      if (!cancelled) {
        setModelsDownloaded(state.downloaded);
        setModelBytes(state.totalBytes);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [sttAvailable]);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setProgress(null);
    try {
      await downloadModels((p) => setProgress(p));
      const state = await checkModels();
      setModelsDownloaded(state.downloaded);
      setModelBytes(state.totalBytes);
      onToast("語音模型下載完成");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "下載失敗");
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  const handleDelete = async () => {
    if (downloading) return;
    try {
      await deleteModels();
      setModelsDownloaded(false);
      setModelBytes(0);
      onToast("已刪除語音模型");
    } catch {
      onToast("刪除失敗");
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatProgress = (p: DownloadProgress) => {
    if (p.phase === "downloading" && p.total && p.total > 0) {
      const recv = formatBytes(p.received || 0);
      const tot = formatBytes(p.total);
      return `${p.percent}% · ${recv} / ${tot}`;
    }
    if (p.phase === "downloading") {
      return formatBytes(p.received || 0);
    }
    return "";
  };

  return (
    <div className="page settings-page">
      <h1 className="page-title">設定</h1>

      <div className="usage-card">
        <div className="usage-head">
          <div className="usage-plan">{planLabel}</div>
          <div className="header-plan-badge">{planBadge}</div>
        </div>
        <div className="usage-bar"><div className="usage-bar-fill" style={{ width: `${usagePct}%` }} /></div>
        <div className="usage-stats">
          <span className="usage-used">{quotaUsed} 次</span>
          <span className="usage-total">/ {plan === "free" ? quotaLimit : "無限"} 月度配額</span>
        </div>
        {plan === "free" && (
          <button className="upgrade-btn" onClick={onUpgrade}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l3.5 7.5L21 12l-7.5 3.5L10 23l-3.5-7.5L-1 12l7.5-3.5L10 1z" transform="translate(2 0)" />
            </svg>
            升級 Pro 解鎖無限翻譯
          </button>
        )}
      </div>

      <div className="settings-section">
        <div className="section-label">語音輸入</div>
        <div className="settings-card">
          {sttAvailable ? (
            <>
              <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "12px" }}>
                <div className="row-label" style={{ width: "100%" }}>
                  <div className="row-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0014 0v-2" /><path d="M12 19v3" /></svg>
                  </div>
                  <div className="row-text" style={{ flex: 1 }}>
                    <div className="row-title">離線語音模型</div>
                    <div className="row-desc">
                      {modelsDownloaded
                        ? `已下載 · ${formatBytes(modelBytes)} · 支援粵語/國語/英語`
                        : "未下載 · 約 236MB · 支援粵語/國語/英語"}
                    </div>
                  </div>
                </div>

                {downloading && progress && (
                  <div className="stt-progress">
                    <div className="stt-progress-bar">
                      <div className="stt-progress-fill" style={{ width: `${progress.percent || 0}%` }} />
                    </div>
                    <div className="stt-progress-text">{formatProgress(progress)}</div>
                  </div>
                )}

                <div className="stt-actions">
                  {!modelsDownloaded && !downloading && (
                    <button className="stt-btn stt-btn-primary" onClick={handleDownload}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                      下載語音模型 (236MB)
                    </button>
                  )}
                  {downloading && (
                    <button className="stt-btn" disabled>下載中…</button>
                  )}
                  {modelsDownloaded && !downloading && (
                    <button className="stt-btn stt-btn-danger" onClick={handleDelete}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                      刪除模型
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="settings-row">
              <div className="row-label">
                <div className="row-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0014 0v-2" /><path d="M12 19v3" /></svg>
                </div>
                <div className="row-text"><div className="row-title">離線語音模型</div><div className="row-desc">僅 Android App 支援</div></div>
              </div>
            </div>
          )}
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
