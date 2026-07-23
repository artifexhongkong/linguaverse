import { useEffect, useState, useCallback } from "react";
import { BottomNav, type Tab } from "./components/BottomNav";
import { TranslatePage } from "./pages/TranslatePage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PricingPage } from "./pages/PricingPage";
import { Paywall } from "./components/Paywall";
import { fetchSettings, upsertSettings, type UserSettings, isSupabaseConfigured } from "./lib/supabase";
import "./styles/app.css";

const FREE_QUOTA = 30;
const PRO_QUOTA = 999999;

export default function App() {
  const [tab, setTab] = useState<Tab>("translate");
  const [showPricing, setShowPricing] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastKey, setToastKey] = useState(0);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("en");
  const [context, setContext] = useState("general");
  const [quotaUsed, setQuotaUsed] = useState(0);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const plan = settings?.plan ?? "free";
  const quotaLimit = plan === "free" ? FREE_QUOTA : PRO_QUOTA;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setToastKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast, toastKey]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    (async () => {
      try {
        const s = await fetchSettings();
        if (s) {
          setSettings(s);
          setSourceLang(s.default_source_lang);
          setTargetLang(s.default_target_lang);
          setContext(s.default_context);
          setQuotaUsed(s.monthly_quota_used);
        } else {
          const created = await upsertSettings({
            default_source_lang: "auto", default_target_lang: "en",
            default_context: "general", plan: "free", monthly_quota_used: 0,
          });
          if (created) setSettings(created);
        }
      } catch { /* 使用預設值 */ }
    })();
  }, []);

  const handleLangChange = (source: string, target: string) => {
    setSourceLang(source);
    setTargetLang(target);
    if (isSupabaseConfigured) upsertSettings({ default_source_lang: source, default_target_lang: target }).catch(() => {});
  };

  const handleContextChange = (ctx: string) => {
    setContext(ctx);
    if (isSupabaseConfigured) upsertSettings({ default_context: ctx }).catch(() => {});
  };

  const handleQuotaUpdate = () => {
    setQuotaUsed((q) => q + 1);
    setHistoryRefresh((r) => r + 1);
  };

  const handleUpgrade = (newPlan: string) => {
    if (newPlan === "enterprise") { showToast("已為您建立聯絡請求，專員將與您聯繫"); return; }
    setShowPricing(false);
    showToast(`已升級至 ${newPlan === "pro" ? "Pro" : "Enterprise"} 方案`);
    if (isSupabaseConfigured) {
      upsertSettings({ plan: newPlan })
        .then((s) => {
          if (s) { setSettings(s); setQuotaUsed(0); }
          setShowPaywall(false);
        })
        .catch(() => showToast("升級失敗，請稍後再試"));
    } else {
      setShowPaywall(false);
    }
  };

  const handleTabChange = (newTab: Tab) => {
    if (newTab === "translate" && plan === "free" && quotaUsed >= FREE_QUOTA) {
      setShowPaywall(true);
      return;
    }
    setTab(newTab);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <div className="header-logo">译</div>
          <div className="header-name">
            <b>译境 LinguaVerse</b>
            <span>AI 語境翻譯</span>
          </div>
        </div>
        <button className="header-plan-badge" onClick={() => setShowPricing(true)}>
          {plan === "free" ? "FREE" : plan === "pro" ? "PRO" : "ENTERPRISE"}
        </button>
      </header>

      <main className="app-content">
        {tab === "translate" && (
          <TranslatePage
            sourceLang={sourceLang} targetLang={targetLang} context={context}
            onLangChange={handleLangChange} onContextChange={handleContextChange}
            onToast={showToast} onQuotaUpdate={handleQuotaUpdate}
            quotaUsed={quotaUsed} quotaLimit={quotaLimit}
          />
        )}
        {tab === "history" && <HistoryPage refreshKey={historyRefresh} onToast={showToast} />}
        {tab === "settings" && (
          <SettingsPage settings={settings} quotaUsed={quotaUsed} quotaLimit={quotaLimit}
            onUpgrade={() => setShowPricing(true)} onToast={showToast} />
        )}
        {showPricing && <PricingPage onUpgrade={handleUpgrade} currentPlan={plan} />}
      </main>

      <BottomNav active={tab} onChange={handleTabChange} />

      {showPaywall && (
        <Paywall onClose={() => setShowPaywall(false)} onUpgrade={() => { setShowPaywall(false); setShowPricing(true); }} />
      )}

      {toast && <div className="toast" key={toastKey}>{toast}</div>}
    </div>
  );
}
