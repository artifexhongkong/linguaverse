/**
 * Ad management service — AdMob reward video ads.
 *
 * Revenue model:
 *   - 3 free translations per day
 *   - After 3 free: watch a reward video ad to continue
 *   - "Remove ads" purchase disables all ads permanently
 *
 * Ad loading strategy:
 *   1. On app init: AdMob.initialize() + preload reward ad
 *   2. On showRewardAd(): show preloaded ad, then preload next
 *   3. If ad not loaded: try to load on-demand (may take 2-3s)
 *   4. If all fails: simulated 5s ad (so user isn't blocked)
 */

import { AdMob, RewardAdPluginEvents, type AdLoadInfo, type AdMobError } from "@capacitor-community/admob";
import { Capacitor } from "@capacitor/core";

// AdMob configuration — your real Ad Unit IDs
const REWARD_AD_UNIT_ID = "ca-app-pub-5618359139073355/9378802730";

// Google's official test ad unit ID (for development)
// const TEST_REWARD_AD_UNIT_ID = "ca-app-pub-3940256099942544/5224354917";

let initialized = false;
let rewardAdLoaded = false;
let isLoading = false;

/**
 * Initialize AdMob SDK. Call this on app startup.
 */
export async function initAds(): Promise<void> {
  if (initialized) return;
  if (Capacitor.getPlatform() === "web") {
    console.log("[ads] Web platform — ads disabled");
    initialized = true;
    return;
  }

  try {
    console.log("[ads] Initializing AdMob...");
    await AdMob.initialize({
      initializeForTesting: false,
    });
    console.log("[ads] AdMob initialized successfully");
    initialized = true;

    // Preload reward ad
    preloadRewardAd();
  } catch (err) {
    console.error("[ads] AdMob init failed:", err);
    initialized = true; // still mark as initialized so we don't retry
  }
}

/**
 * Preload the reward video ad so it displays instantly when requested.
 */
async function preloadRewardAd(): Promise<void> {
  if (Capacitor.getPlatform() === "web") return;
  if (isLoading || rewardAdLoaded) return;

  isLoading = true;
  try {
    console.log("[ads] Preloading reward ad...");

    // Set up event listeners (only once)
    AdMob.addListener(RewardAdPluginEvents.Loaded, (info: AdLoadInfo) => {
      console.log("[ads] Reward ad LOADED:", info.adUnitId);
      rewardAdLoaded = true;
      isLoading = false;
    });

    AdMob.addListener(RewardAdPluginEvents.FailedToLoad, (error: AdMobError) => {
      console.warn("[ads] Reward ad FAILED to load:", JSON.stringify(error));
      rewardAdLoaded = false;
      isLoading = false;
    });

    // Prepare (load) the ad
    await AdMob.prepareRewardVideoAd({
      adId: REWARD_AD_UNIT_ID,
      npa: false, // Non-personalized ads
    });
    // The Loaded event will set rewardAdLoaded = true
  } catch (err) {
    console.error("[ads] preloadRewardAd error:", err);
    rewardAdLoaded = false;
    isLoading = false;
  }
}

/**
 * Show a reward video ad. Returns true if the user earned the reward.
 *
 * If AdMob is unavailable (web or load failure), falls back to a
 * simulated 5-second ad so the app remains functional.
 */
export async function showRewardAd(): Promise<boolean> {
  // Web: simulate
  if (Capacitor.getPlatform() === "web") {
    console.log("[ads] Web — simulated ad");
    await new Promise((r) => setTimeout(r, 5000));
    return true;
  }

  // If ad isn't loaded, try to load now (may take 2-3 seconds)
  if (!rewardAdLoaded) {
    console.log("[ads] Ad not preloaded, loading on-demand...");
    await preloadRewardAd();
    // Wait a bit for load to complete
    let waited = 0;
    while (!rewardAdLoaded && waited < 5000) {
      await new Promise((r) => setTimeout(r, 500));
      waited += 500;
    }
  }

  if (!rewardAdLoaded) {
    // Ad still not loaded — fall back to simulated
    console.warn("[ads] Ad load failed — using simulated ad");
    await new Promise((r) => setTimeout(r, 5000));
    return true;
  }

  try {
    console.log("[ads] Showing reward ad...");

    // Track reward via event listener
    let rewardEarned = false;
    const rewardListener = await AdMob.addListener(
      RewardAdPluginEvents.Rewarded,
      () => {
        console.log("[ads] Reward earned!");
        rewardEarned = true;
      },
    );

    let dismissed = false;
    const dismissListener = await AdMob.addListener(
      RewardAdPluginEvents.Dismissed,
      () => {
        console.log("[ads] Ad dismissed");
        dismissed = true;
      },
    );

    // Show the ad (blocks until ad is closed)
    await AdMob.showRewardVideoAd();

    // Wait for events to fire
    await new Promise((r) => setTimeout(r, 300));

    // Clean up
    try { await rewardListener.remove(); } catch {}
    try { await dismissListener.remove(); } catch {}

    // Mark as needing reload
    rewardAdLoaded = false;
    // Preload next ad in background
    preloadRewardAd();

    return rewardEarned || dismissed;
  } catch (err) {
    console.error("[ads] showRewardAd failed:", err);
    // Fall back to simulated
    await new Promise((r) => setTimeout(r, 5000));
    return true;
  }
}

/**
 * Check if real AdMob ads are available (vs simulated).
 */
export function isRealAdAvailable(): boolean {
  return Capacitor.getPlatform() !== "web" && initialized && rewardAdLoaded;
}
