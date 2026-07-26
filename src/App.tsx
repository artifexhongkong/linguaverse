import { useEffect, useState, useCallback } from "react";
import { BottomNav, type Tab } from "./components/BottomNav";
import { TranslatePage } from "./pages/TranslatePage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdOverlay } from "./components/AdOverlay";
import { initAds } from "./lib/ads";
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

      // Initialize AdMob (international users only; China uses simulated ad)
      initAds().catch((err) => console.warn("[App] AdMob init failed:", err));
    })();
  }, []);

  const handleLangChange = (source: string, target: string) => {
    setSourceLang(source);
    setTargetLang(target);
    upsertSettings({ default_source_lang: source, default_target_lang: target }).catch(() => {});
  };

  /**
   * Called when the user taps "翻譯".
   *
   * Key optimization: when an ad is needed, the translation starts
   * IMMEDIATELY in parallel with the ad — so by the time the ad
   * finishes, the translation result is already ready. This saves
   * the user from waiting twice (ad duration + translation duration).
   */
  const handleTranslateRequest = (callback: () => void): boolean => {
    if (adFree || dailyUsed < DAILY_FREE_LIMIT) {
      callback();
      return true;
    }

    // Quota exhausted — start translation NOW + show ad simultaneously.
    // The callback (doTranslate) runs in parallel with the ad overlay.
    // When the ad completes, we just hide the overlay — the translation
    // result is already visible underneath.
    callback();
    setShowAd(true);
    return false;
  };

  const handleAdComplete = () => {
    setShowAd(false);
    // Translation already completed (or is streaming) in the background.
  };

  const handleAdSkip = () => {
    setShowAd(false);
    // Translation was already running in parallel — just close the ad.
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
          <b>AI譯通</b>
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
