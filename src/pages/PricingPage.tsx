interface PricingPageProps {
  onUpgrade: (plan: string) => void;
  currentPlan: string;
}

export function PricingPage({ onUpgrade, currentPlan }: PricingPageProps) {
  const plans = [
    {
      name: "Free", price: "$0", period: "免費", featured: false, plan: "free",
      cta: "目前方案",
      features: ["每月 30 次翻譯", "20 種常用語言", "通用語境模式", "翻譯歷史記錄"],
    },
    {
      name: "Pro", price: "$9.99", period: "/ 月", featured: true, plan: "pro",
      cta: "升級 Pro",
      features: ["無限翻譯次數", "全部 137 種語言", "6 種語境模式", "整份文件翻譯", "優先翻譯佇列", "無廣告體驗"],
    },
    {
      name: "Enterprise", price: "洽談", period: "客製化", featured: false, plan: "enterprise",
      cta: "聯絡銷售",
      features: ["團隊共享配額", "API 存取", "自訂領域模型", "私有化部署", "SSO 與權限管理", "專屬客服支援"],
    },
  ];

  return (
    <div className="page pricing-page">
      <div className="pricing-header">
        <h1 className="pricing-title">選擇適合你的方案</h1>
        <p className="pricing-subtitle">隨時升級或降級，取消不受限制</p>
      </div>
      <div className="pricing-cards">
        {plans.map((p) => {
          const isCurrent = currentPlan === p.plan;
          return (
            <div key={p.name} className={`pricing-plan ${p.featured ? "featured" : ""}`}>
              <div className="pricing-plan-head">
                <div className="pricing-plan-name">{p.name}</div>
                {p.featured && <div className="pricing-plan-badge">最受歡迎</div>}
              </div>
              <div className="pricing-plan-price">
                <span className="pricing-plan-amount">{p.price}</span>
                <span className="pricing-plan-period">{p.period}</span>
              </div>
              <ul className="pricing-plan-features">
                {p.features.map((f) => (
                  <li key={f}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                className={`pricing-plan-cta ${p.featured ? "primary" : "secondary"}`}
                onClick={() => onUpgrade(p.plan)}
                disabled={isCurrent}
              >
                {isCurrent ? "目前方案" : p.cta}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
