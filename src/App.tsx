import { useEffect, useState, useCallback } from "react";
import { BottomNav, type Tab } from "./components/BottomNav";
import { TranslatePage } from "./pages/TranslatePage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdOverlay } from "./components/AdOverlay";
import {
  fetchSettings, upsertSettings,
  getDailyUsage, recordTranslation, resetDailyIfNeeded,
  isAdFree, setAdFree,
  type UserSettings,
} from "./lib/supabase";
import "./styles/app.css";

const DAILY_FREE_LIMIT = 3;

export default function App() {
  const [tab, setTab] = useState<Tab>("translate");
  const [toast, setToast] = useState<string | null>(null);
  const [toastKey, setToastKey] = useState(0);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("en");
  const [historyRefresh, setHistoryRefresh] = useState(0);

  // Ad / quota state
  const [dailyUsed, setDailyUsed] = useState(0);
  const [adFree, setAdFreeState] = useState(false);
  const [showAd, setShowAd] = useState(false);
  const [adCallback, setAdCallback] = useState<(() => void) | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setToastKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast, toastKey]);

  // Init: load settings + daily usage + ad-free status
  useEffect(() => {
    (async () => {
      try {
        const s = await fetchSettings();
        if (s) {
          setSettings(s);
          setSourceLang(s.default_source_lang);
          setTargetLang(s.default_target_lang);
        } else {
          const created = await upsertSettings({
            default_source_lang: "auto", default_target_lang: "en",
            default_context: "general",
          });
          if (created) setSettings(created);
        }
      } catch { /* use defaults */ }

      // Reset daily quota if it's a new day, then load usage
      await resetDailyIfNeeded();
      setDailyUsed(getDailyUsage());
      setAdFreeState(isAdFree());
    })();
  }, []);

  const handleLangChange = (source: string, target: string) => {
    setSourceLang(source);
    setTargetLang(target);
    upsertSettings({ default_source_lang: source, default_target_lang: target }).catch(() => {});
  };

  /**
   * Called when the user taps "翻譯". Returns true if the translation
   * should proceed, false if blocked (ad required or showing).
   *
   * Logic:
   *   - Ad-free users: always proceed
   *   - Free users: 3 free translations per day, then watch ad
   */
  const handleTranslateRequest = (callback: () => void): boolean => {
    if (adFree) {
      callback();
      return true;
    }

    if (dailyUsed < DAILY_FREE_LIMIT) {
      callback();
      return true;
    }

    // Quota exhausted — show ad, then run callback after ad completes
    setAdCallback(() => callback);
    setShowAd(true);
    return false;
  };

  const handleAdComplete = () => {
    setShowAd(false);
    if (adCallback) {
      adCallback();
      setAdCallback(null);
    }
  };

  const handleAdSkip = () => {
    setShowAd(false);
    setAdCallback(null);
    showToast("需觀看廣告才能繼續翻譯");
  };

  const handleTranslationDone = () => {
    recordTranslation();
    setDailyUsed(getDailyUsage());
    setHistoryRefresh((r) => r + 1);
  };

  const handleRemoveAds = () => {
    setAdFree(true);
    setAdFreeState(true);
    showToast("已移除廣告，享受無限翻譯！");
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <b>译境 LinguaVerse</b>
        </div>
        <div className="header-quota-badge">
          {adFree ? "無廣告" : `今日 ${Math.max(DAILY_FREE_LIMIT - dailyUsed, 0)}/${DAILY_FREE_LIMIT}`}
        </div>
      </header>

      <main className="app-content">
        {tab === "translate" && (
          <TranslatePage
            sourceLang={sourceLang} targetLang={targetLang}
            onLangChange={handleLangChange}
            onToast={showToast}
            onTranslateRequest={handleTranslateRequest}
            onTranslationDone={handleTranslationDone}
            dailyUsed={dailyUsed}
            dailyLimit={DAILY_FREE_LIMIT}
            adFree={adFree}
          />
        )}
        {tab === "history" && <HistoryPage refreshKey={historyRefresh} onToast={showToast} />}
        {tab === "settings" && (
          <SettingsPage settings={settings} onToast={showToast}
            adFree={adFree} onRemoveAds={handleRemoveAds}
            dailyUsed={dailyUsed} dailyLimit={DAILY_FREE_LIMIT} />
        )}
      </main>

      <BottomNav active={tab} onChange={setTab} />

      {showAd && (
        <AdOverlay
          onComplete={handleAdComplete}
          onSkip={handleAdSkip}
        />
      )}

      {toast && <div className="toast" key={toastKey}>{toast}</div>}
    </div>
  );
}
