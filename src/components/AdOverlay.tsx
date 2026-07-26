import { useEffect, useState } from "react";
import { showRewardAd } from "../lib/ads";

interface AdOverlayProps {
  onComplete: () => void;
  onSkip: () => void;
}

/**
 * Full-screen ad overlay.
 *
 * While the ad plays, the translation runs in parallel (the caller
 * passes a translation callback that starts immediately). When the
 * ad completes, the translation result is already ready — saving
 * the user's time.
 *
 * If AdMob is unavailable, falls back to a simulated 5s countdown.
 */
export function AdOverlay({ onComplete, onSkip }: AdOverlayProps) {
  const [status, setStatus] = useState<"loading" | "playing" | "done" | "error">("loading");
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setStatus("playing");

        // Start countdown timer (for simulated/fallback ads — real AdMob
        // ads take over the full screen natively, so the countdown is
        // only visible during the fallback)
        let remaining = 5;
        const timer = setInterval(() => {
          if (cancelled) { clearInterval(timer); return; }
          remaining -= 1;
          setCountdown(remaining);
          if (remaining <= 0) {
            clearInterval(timer);
          }
        }, 1000);

        // Show the real ad (or simulated if web/ad failed)
        const earned = await showRewardAd();

        if (cancelled) return;
        clearInterval(timer);

        if (earned) {
          setStatus("done");
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
                <p className="ad-subtitle">翻譯正在背景進行，完成後即可查看結果</p>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48, color: "var(--accent)" }}>
                  <path d="M5 13l4 4L19 7" />
                </svg>
                <p>廣告已完成</p>
                <p className="ad-subtitle">翻譯結果已就緒</p>
              </>
            )}
          </div>
        </div>

        <div className="ad-footer">
          {status === "done" ? (
            <button className="ad-continue-btn" onClick={handleComplete}>
              查看翻譯結果
            </button>
          ) : (
            <button className="ad-continue-btn" disabled>
              廣告播放中…（翻譯同步進行）
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
