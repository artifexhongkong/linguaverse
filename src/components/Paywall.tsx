interface PaywallProps {
  onClose: () => void;
  onUpgrade: () => void;
}

export function Paywall({ onClose, onUpgrade }: PaywallProps) {
  const features = [
    "無限翻譯次數，不再受限額影響",
    "解鎖全部 137 種語言",
    "6 種語境模式（商務、法律、醫療等）",
    "整份文件翻譯與優先處理",
    "無廣告的純淨體驗",
    "翻譯歷史雲端同步",
  ];

  return (
    <div className="paywall-overlay" onClick={onClose}>
      <div className="paywall" onClick={(e) => e.stopPropagation()}>
        <div className="paywall-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l3.5 7.5L21 12l-7.5 3.5L10 23l-3.5-7.5L-1 12l7.5-3.5L10 1z" transform="translate(2 0)" />
          </svg>
        </div>
        <div>
          <div className="paywall-title">升級 Pro 解鎖完整功能</div>
          <p className="paywall-desc">您的免費配額已用完。升級 Pro 享受無限翻譯與全部語言。</p>
        </div>
        <div className="paywall-features">
          {features.map((f) => (
            <div key={f} className="paywall-feature">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
              {f}
            </div>
          ))}
        </div>
        <button className="upgrade-btn" onClick={onUpgrade}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
          升級 Pro · $9.99/月
        </button>
        <button className="paywall-close" onClick={onClose}>稍後再說</button>
      </div>
    </div>
  );
}
