export type Tab = "translate" | "history" | "settings";

interface BottomNavProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const icons: Record<Tab, string> = {
  translate: "M3 5h12M9 3v2M5 9l1.5 9.5a2 2 0 002 1.5h7a2 2 0 002-1.5L19 9M5 9h14M5 9a2 2 0 010-4h14a2 2 0 010 4",
  history: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  settings: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
};

const labels: Record<Tab, string> = {
  translate: "翻譯", history: "歷史", settings: "設定",
};

export function BottomNav({ active, onChange }: BottomNavProps) {
  const tabs: Tab[] = ["translate", "history", "settings"];
  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => (
        <button key={tab} className={`nav-item ${active === tab ? "active" : ""}`} onClick={() => onChange(tab)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d={icons[tab]} />
          </svg>
          <span>{labels[tab]}</span>
        </button>
      ))}
    </nav>
  );
}
