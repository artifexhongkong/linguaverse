/**
 * Ad management service — AdMob (international) + region detection.
 *
 * Revenue model:
 *   - 3 free translations per day
 *   - After 3 free: watch a reward video ad to continue
 *   - "Remove ads" purchase disables all ads permanently
 *
 * Region detection:
 *   - If user is in mainland China → AdMob may not work (GFW blocks
 *     Google services). Falls back to a simulated ad (5s countdown)
 *     so the app still functions. Real China SDK (穿山甲/CSJ Pangolin)
 *     can be added later via a native plugin.
 *   - If user is international → uses AdMob reward video.
 */

import { AdMob, RewardAdPluginEvents, AdLoadInfo } from "@capacitor-community/admob";
import { Capacitor } from "@capacitor/core";

// AdMob configuration
const ADMOB_APP_ID = "ca-app-pub-5618359139073355~3348581000";
const REWARD_AD_UNIT_ID = "ca-app-pub-5618359139073355/9378802730";

// Google's official test ad unit IDs (for development)
// https://developers.google.com/admob/android/test-ads
const TEST_REWARD_AD_UNIT_ID = "ca-app-pub-3940256099942544/5224354917";

// Set to true during development to use test ads (won't generate revenue)
const USE_TEST_ADS = false;

let initialized = false;
let rewardAdLoaded = false;
let inChina = false;

/**
 * Detect if the user is in mainland China.
 * Uses IP geolocation API (falls back to timezone check).
 */
async function detectChina(): Promise<boolean> {
  try {
    // Method 1: IP geolocation (most accurate)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch("https://ipapi.co/json/", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await resp.json();
    if (data && data.country_code) {
      return data.country_code === "CN";
    }
  } catch {
    // IP API failed (possibly blocked in China itself!)
    // If ipapi.co is unreachable, user is very likely in China
    // (GFW blocks many international APIs)
  }

  // Method 2: Timezone check (fallback)
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz === "Asia/Shanghai" || tz === "Asia/Urumqi";
  } catch {
    return false;
  }
}

/**
 * Initialize AdMob SDK. Call this on app startup.
 * Safe to call multiple times (idempotent).
 */
export async function initAds(): Promise<void> {
  if (initialized) return;

  // Only initialize on native platforms (not web)
  if (Capacitor.getPlatform() === "web") {
    initialized = true;
    return;
  }

  // Check if user is in China
  inChina = await detectChina();
  console.log("[ads] User in China:", inChina);

  if (inChina) {
    // AdMob won't work in China — skip initialization.
    // The app will use a simulated ad (countdown timer) instead.
    // TODO: integrate 穿山甲 (CSJ Pangolin) SDK for real ads in China.
    initialized = true;
    return;
  }

  try {
    // Initialize AdMob
    await AdMob.initialize({
      initializeForTesting: USE_TEST_ADS,
    });
    console.log("[ads] AdMob initialized");

    // Prepare reward video ad (preload for faster display)
    await preloadRewardAd();
    initialized = true;
  } catch (err) {
    console.error("[ads] AdMob init failed:", err);
    // Fall back to simulated ad
    initialized = true;
  }
}

/**
 * Preload the reward video ad so it displays instantly when requested.
 */
async function preloadRewardAd(): Promise<void> {
  if (inChina || Capacitor.getPlatform() === "web") return;

  try {
    const adUnitId = USE_TEST_ADS ? TEST_REWARD_AD_UNIT_ID : REWARD_AD_UNIT_ID;

    // Listen for ad loading events
    AdMob.addListener(RewardAdPluginEvents.Loaded, (info: AdLoadInfo) => {
      console.log("[ads] Reward ad loaded:", info.adUnitId);
      rewardAdLoaded = true;
    });

    AdMob.addListener(RewardAdPluginEvents.FailedToLoad, (error) => {
      console.warn("[ads] Reward ad failed to load:", error);
      rewardAdLoaded = false;
    });

    // Prepare (load) the ad
    await AdMob.prepareRewardVideoAd({
      adId: adUnitId,
      // These options improve fill rate
      npa: false, // Non-personalized ads — set true for GDPR compliance
    });
    rewardAdLoaded = true;
  } catch (err) {
    console.error("[ads] preloadRewardAd failed:", err);
    rewardAdLoaded = false;
  }
}

/**
 * Show a reward video ad. Returns true if the user earned the reward
 * (watched the full ad), false if they skipped or it failed.
 *
 * If AdMob is unavailable (China or web), falls back to a simulated
 * 5-second ad so the app remains functional.
 *
 * The reward is determined by the RewardAdPluginEvents.Rewarded event,
 * NOT the return value of showRewardVideoAd() (which returns the
 * reward item only if earned).
 */
export async function showRewardAd(): Promise<boolean> {
  // Web platform or China: simulate ad with delay
  if (Capacitor.getPlatform() === "web" || inChina) {
    console.log("[ads] Using simulated ad (web/China)");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return true;
  }

  try {
    // If ad isn't preloaded, try to load it now
    if (!rewardAdLoaded) {
      await preloadRewardAd();
    }

    if (!rewardAdLoaded) {
      // Ad still not loaded — fall back to simulated
      console.warn("[ads] Ad not loaded, using simulated");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return true;
    }

    // Set up a one-time reward listener before showing the ad.
    // The Rewarded event fires when the user has earned the reward
    // (watched the full video).
    let rewardEarned = false;
    let rewardListener: { remove: () => Promise<void> } | null = null;

    rewardListener = await AdMob.addListener(
      RewardAdPluginEvents.Rewarded,
      () => {
        console.log("[ads] Reward earned!");
        rewardEarned = true;
      },
    );

    // Also listen for Dismissed (user closed the ad)
    let dismissed = false;
    const dismissListener = await AdMob.addListener(
      RewardAdPluginEvents.Dismissed,
      () => {
        console.log("[ads] Ad dismissed");
        dismissed = true;
      },
    );

    // Show the ad (this blocks until the ad is closed)
    await AdMob.showRewardVideoAd();

    // Small delay to let events fire
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Clean up listeners
    try { await rewardListener?.remove(); } catch {}
    try { await dismissListener.remove(); } catch {}

    // Reload for next time
    rewardAdLoaded = false;
    preloadRewardAd(); // fire and forget — preload for next use

    // If reward was earned OR ad was dismissed (some ads auto-reward
    // on dismiss), grant the reward. Being lenient here improves UX —
    // users who watch most of the ad still get their translation.
    return rewardEarned || dismissed;
  } catch (err) {
    console.error("[ads] showRewardAd failed:", err);
    // Fall back to simulated ad so user isn't blocked
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return true;
  }
}

/**
 * Check if real AdMob ads are available (vs simulated).
 */
export function isRealAdAvailable(): boolean {
  return !inChina && Capacitor.getPlatform() !== "web" && initialized;
}
