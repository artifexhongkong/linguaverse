import { useEffect, useState } from "react";
import { fetchTranslations, toggleFavorite, deleteTranslation, type TranslationRecord } from "../lib/supabase";
import { getLanguage, getContextMode } from "../lib/languages";

interface HistoryPageProps {
  refreshKey: number;
  onToast: (msg: string) => void;
}

export function HistoryPage({ refreshKey, onToast }: HistoryPageProps) {
  const [records, setRecords] = useState<TranslationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "favorite">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchTranslations();
        if (!cancelled) setRecords(data);
      } catch {
        if (!cancelled) onToast("無法載入歷史記錄");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey, onToast]);

  const filtered = filter === "favorite" ? records.filter((r) => r.is_favorite) : records;

  const handleFav = async (id: string, fav: boolean) => {
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, is_favorite: fav } : r)));
    try {
      await toggleFavorite(id, fav);
    } catch {
      onToast("操作失敗");
      setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, is_favorite: !fav } : r)));
    }
  };

  const handleDelete = async (id: string) => {
    const prev = records;
    setRecords((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteTranslation(id);
      onToast("已刪除");
    } catch {
      onToast("刪除失敗");
      setRecords(prev);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast("已複製到剪貼簿");
    } catch {
      onToast("複製失敗");
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "剛剛";
    if (mins < 60) return `${mins} 分鐘前`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} 小時前`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} 天前`;
    return d.toLocaleDateString("zh-TW", { month: "short", day: "numeric" });
  };

  return (
    <div className="page history-page">
      <h1 className="page-title">翻譯歷史</h1>
      <div className="history-filter">
        <button className={`filter-chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          全部
        </button>
        <button className={`filter-chip ${filter === "favorite" ? "active" : ""}`} onClick={() => setFilter("favorite")}>
          <svg viewBox="0 0 24 24" fill={filter === "favorite" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
            <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
          收藏
        </button>
      </div>

      {loading ? (
        <div className="history-list">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="history-item" style={{ height: 108 }}>
              <div className="skeleton" style={{ width: "45%", height: 13, marginBottom: 10 }} />
              <div className="skeleton" style={{ width: "88%", height: 15, marginBottom: 7 }} />
              <div className="skeleton" style={{ width: "68%", height: 15 }} />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="empty-title">{filter === "favorite" ? "尚無收藏記錄" : "尚無翻譯記錄"}</div>
          <div className="empty-desc">
            {filter === "favorite" ? "點擊歷史記錄中的星星即可收藏" : "開始翻譯後，記錄會自動儲存在這裡"}
          </div>
        </div>
      ) : (
        <div className="history-list">
          {filtered.map((r, i) => {
            const src = getLanguage(r.source_lang);
            const tgt = getLanguage(r.target_lang);
            const ctx = getContextMode(r.context_mode);
            return (
              <div key={r.id} className="history-item anim-up" style={{ animationDelay: `${Math.min(i * 0.04, 0.32)}s` }}>
                <div className="history-item-head">
                  <div className="history-lang-pair">
                    <span className="lang-flag">{src.flag}</span>
                    <span>{src.nativeName}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                    <span className="lang-flag">{tgt.flag}</span>
                    <span>{tgt.nativeName}</span>
                    <span className="history-context-tag">{ctx.icon} {ctx.name}</span>
                  </div>
                  <div className="history-actions">
                    <button
                      className={`history-fav-btn ${r.is_favorite ? "active" : ""}`}
                      onClick={() => handleFav(r.id, !r.is_favorite)}
                      aria-label="收藏"
                    >
                      <svg viewBox="0 0 24 24" fill={r.is_favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </button>
                    <button
                      className="history-fav-btn"
                      onClick={() => handleCopy(r.translated_text)}
                      aria-label="複製譯文"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="11" height="11" rx="2" />
                        <path d="M5 15V5a2 2 0 012-2h10" />
                      </svg>
                    </button>
                    <button className="history-fav-btn" onClick={() => handleDelete(r.id)} aria-label="刪除">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="history-source">{r.source_text}</div>
                <div className="history-target">{r.translated_text}</div>
                <div className="history-time">{formatTime(r.created_at)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
