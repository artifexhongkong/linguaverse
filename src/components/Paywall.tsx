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
            <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4L12 3z" />
            <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14z" />
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
