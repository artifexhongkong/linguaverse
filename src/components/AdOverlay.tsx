import { useEffect, useState } from "react";

interface AdOverlayProps {
  onComplete: () => void;
  onSkip: () => void;
}

/**
 * Full-screen ad overlay.
 *
 * In production, this would integrate with AdMob / Unity Ads / etc.
 * For now, it simulates a 5-second ad with a countdown timer.
 * After the countdown, the user can tap "繼續翻譯" to proceed.
 */
export function AdOverlay({ onComplete, onSkip }: AdOverlayProps) {
  const [countdown, setCountdown] = useState(5);
  const [canClose, setCanClose] = useState(false);

  useEffect(() => {
    if (countdown <= 0) {
      setCanClose(true);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  return (
    <div className="ad-overlay">
      <div className="ad-card">
        <div className="ad-header">
          <span className="ad-label">廣告</span>
          {canClose ? (
            <button className="ad-close" onClick={onSkip} aria-label="關閉">×</button>
          ) : (
            <span className="ad-countdown">{countdown}s</span>
          )}
        </div>

        <div className="ad-body">
          <div className="ad-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48, opacity: 0.3 }}>
              <path d="M3 11l18-5v12L3 14v-3z" />
              <path d="M11.6 16.8a3 3 0 11-5.8-1.6" />
            </svg>
            <p>廣告播放中…</p>
            <p className="ad-subtitle">觀看完成後即可繼續翻譯</p>
          </div>
        </div>

        <div className="ad-footer">
          {canClose ? (
            <button className="ad-continue-btn" onClick={onComplete}>
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
