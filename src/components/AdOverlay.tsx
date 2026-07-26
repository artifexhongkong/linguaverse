import { useEffect, useState } from "react";
import { showRewardAd } from "../lib/ads";

interface AdOverlayProps {
  onComplete: () => void;
  onSkip: () => void;
}

/**
 * Full-screen ad overlay.
 *
 * Uses AdMob reward video ad on Android (international users).
 * Falls back to a simulated 5s countdown for:
 *   - Web platform
 *   - Users in mainland China (AdMob blocked by GFW)
 *   - Ad load failures
 */
export function AdOverlay({ onComplete, onSkip }: AdOverlayProps) {
  const [status, setStatus] = useState<"loading" | "playing" | "done" | "error">("loading");
  const [countdown, setCountdown] = useState(5);
  const [canSkip, setCanSkip] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setStatus("playing");

        // Start countdown timer (for simulated/fallback ads)
        let remaining = 5;
        const timer = setInterval(() => {
          if (cancelled) { clearInterval(timer); return; }
          remaining -= 1;
          setCountdown(remaining);
          if (remaining <= 0) {
            clearInterval(timer);
            setCanSkip(true);
            setStatus("done");
          }
        }, 1000);

        // Show the real ad (or simulated if China/web)
        const earned = await showRewardAd();

        if (cancelled) return;
        clearInterval(timer);

        if (earned) {
          setStatus("done");
          setCanSkip(true);
        } else {
          setStatus("error");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[AdOverlay] Ad failed:", err);
        setStatus("error");
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleComplete = () => {
    if (status === "done") {
      onComplete();
    } else {
      onSkip();
    }
  };

  if (status === "error") {
    return (
      <div className="ad-overlay">
        <div className="ad-card">
          <div className="ad-header">
            <span className="ad-label">廣告</span>
          </div>
          <div className="ad-body">
            <div className="ad-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48, opacity: 0.3 }}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <p>廣告載入失敗</p>
              <p className="ad-subtitle">請檢查網路連線後重試</p>
            </div>
          </div>
          <div className="ad-footer">
            <button className="ad-continue-btn" onClick={onSkip}>
              關閉
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ad-overlay">
      <div className="ad-card">
        <div className="ad-header">
          <span className="ad-label">廣告</span>
          {status === "done" ? (
            <button className="ad-close" onClick={handleComplete} aria-label="關閉">×</button>
          ) : (
            <span className="ad-countdown">{Math.max(countdown, 0)}s</span>
          )}
        </div>

        <div className="ad-body">
          <div className="ad-placeholder">
            {status === "playing" ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48, opacity: 0.3 }}>
                  <path d="M3 11l18-5v12L3 14v-3z" />
                  <path d="M11.6 16.8a3 3 0 11-5.8-1.6" />
                </svg>
                <p>廣告播放中…</p>
                <p className="ad-subtitle">觀看完成後即可繼續翻譯</p>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48, color: "var(--accent)" }}>
                  <path d="M5 13l4 4L19 7" />
                </svg>
                <p>廣告已完成</p>
                <p className="ad-subtitle">可以繼續翻譯了</p>
              </>
            )}
          </div>
        </div>

        <div className="ad-footer">
          {status === "done" ? (
            <button className="ad-continue-btn" onClick={handleComplete}>
              繼續翻譯
            </button>
          ) : (
            <button className="ad-continue-btn" disabled>
              請等待廣告播放完成…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
