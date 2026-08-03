import { useState, useCallback, useRef } from 'react';

declare global {
  interface Window {
    show_11123429: (type?: string) => Promise<void>;
    showGiga: () => Promise<void>;
    showRewardAd: (callback: (res: { status: string }) => void) => void;
    TowerAds: new (config: {
      apiKey: string;
      placementId: string;
      onRewardEarned?: (reward: unknown) => void;
      onError?: (error: unknown) => void;
    }) => { loadAndShow: () => Promise<void> };
  }
}

// USL Ads (TowerAds SDK) credentials — provider-issued, not secret (client-side ad SDK key).
const USL_ADS_API_KEY = "76acac885dd6513614fcdc679fe8dc77";
const USL_ADS_PLACEMENT_ID = "plc_62da709ca69f9f97";

interface AdFlowResult {
  success: boolean;
  monetagWatched: boolean;
}

function waitForFn(name: keyof Window, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window[name] === 'function') { resolve(true); return; }
    const start = Date.now();
    const id = setInterval(() => {
      if (typeof window[name] === 'function') { clearInterval(id); resolve(true); }
      else if (Date.now() - start >= timeoutMs) { clearInterval(id); resolve(false); }
    }, 200);
  });
}

export function useAdFlow() {
  const [isShowingAds, setIsShowingAds] = useState(false);
  const [adStep, setAdStep] = useState<'idle' | 'monetag' | 'complete'>('idle');

  const showMonetagAd = useCallback((): Promise<{ success: boolean; watchedFully: boolean; unavailable: boolean }> => {
    return new Promise(async (resolve) => {
      const ready = await waitForFn('show_11123429');
      if (!ready) { resolve({ success: false, watchedFully: false, unavailable: true }); return; }
      window.show_11123429()
        .then(() => resolve({ success: true, watchedFully: true, unavailable: false }))
        .catch((error) => {
          console.error('Monetag ad error:', error);
          const msg = String(error?.message || error || '').toLowerCase();
          const noAds = msg.includes('no ad') || msg.includes('no fill') || msg.includes('unavailable');
          resolve({ success: false, watchedFully: false, unavailable: noAds });
        });
    });
  }, []);

  const showGigaPubAd = useCallback((): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise(async (resolve) => {
      const ready = await waitForFn('showGiga');
      if (!ready) { resolve({ success: false, unavailable: true }); return; }
      window.showGiga()
        .then(() => resolve({ success: true, unavailable: false }))
        .catch((e) => {
          console.error('GigaPub ad error:', e);
          const msg = String(e?.message || e?.error || e || '').toLowerCase();
          const noAds = msg.includes('no ad') || msg.includes('no fill') || msg.includes('unavailable') || msg.includes('empty');
          resolve({ success: false, unavailable: noAds });
        });
    });
  }, []);

  const showMonetixAd = useCallback((): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise(async (resolve) => {
      const ready = await waitForFn('showRewardAd');
      if (!ready) { resolve({ success: false, unavailable: true }); return; }

      let settled = false;
      const settle = (result: { success: boolean; unavailable: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(result);
      };

      // Safety net — window.showRewardAd's callback is the *only* thing that
      // ever resolves this promise. If the SDK never calls back (no fill,
      // the ad request silently failing, script blocked after load, etc.)
      // the button would spin forever with nothing to catch it. Time out
      // and treat it as "unavailable" so the UI recovers.
      const timeoutId = setTimeout(() => {
        console.warn('Monetix ad timed out — SDK never invoked its callback');
        settle({ success: false, unavailable: true });
      }, 20000);

      try {
        window.showRewardAd((res) => {
          console.log('Monetix ad result:', res.status);
          if (res.status === 'completed') {
            settle({ success: true, unavailable: false });
          } else {
            settle({ success: false, unavailable: false });
          }
        });
      } catch (error) {
        console.error('Monetix showRewardAd threw:', error);
        settle({ success: false, unavailable: true });
      }
    });
  }, []);

  // ─── USL Ads (TowerAds SDK) ───────────────────────────────────────────────
  // The SDK's callbacks are bound at construction time, so the client instance
  // is created lazily once and reused for every show — this also satisfies
  // "load the SDK only once".
  const uslAdsInstanceRef = useRef<InstanceType<Window["TowerAds"]> | null>(null);

  const showUSLAd = useCallback((): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      const ready = typeof window.TowerAds === "function";
      if (!ready) { resolve({ success: false, unavailable: true }); return; }

      let rewardEarned = false;
      let settled = false;
      const settle = (result: { success: boolean; unavailable: boolean }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      try {
        if (!uslAdsInstanceRef.current) {
          uslAdsInstanceRef.current = new window.TowerAds({
            apiKey: USL_ADS_API_KEY,
            placementId: USL_ADS_PLACEMENT_ID,
            // Reward the user only here — never anywhere else in the flow.
            onRewardEarned: () => {
              rewardEarned = true;
              settle({ success: true, unavailable: false });
            },
            onError: (error) => {
              console.error("USL Ads error:", error);
              settle({ success: false, unavailable: false });
            },
          });
        }

        uslAdsInstanceRef.current.loadAndShow()
          .then(() => {
            // loadAndShow() resolving doesn't by itself mean a reward was earned
            // (the user may have closed the ad early) — onRewardEarned is the
            // only source of truth. Give it a brief grace window in case it
            // fires just after the promise settles.
            setTimeout(() => settle({ success: rewardEarned, unavailable: false }), 300);
          })
          .catch((error: any) => {
            console.error("USL Ads loadAndShow error:", error);
            const msg = String(error?.message || error || "").toLowerCase();
            const noAds = msg.includes("no ad") || msg.includes("no fill") || msg.includes("unavailable");
            settle({ success: false, unavailable: noAds });
          });
      } catch (error) {
        console.error("USL Ads init error:", error);
        settle({ success: false, unavailable: true });
      }
    });
  }, []);
  // ──────────────────────────────────────────────────────────────────────────

  const runAdFlow = useCallback(async (): Promise<AdFlowResult> => {
    setIsShowingAds(true);
    try {
      setAdStep('monetag');
      const monetagResult = await showMonetagAd();
      if (monetagResult.unavailable) { setAdStep('idle'); return { success: false, monetagWatched: false }; }
      if (!monetagResult.success) { setAdStep('idle'); return { success: false, monetagWatched: false }; }
      setAdStep('complete');
      return { success: true, monetagWatched: true };
    } finally {
      setIsShowingAds(false);
      setAdStep('idle');
    }
  }, [showMonetagAd]);

  return {
    isShowingAds,
    adStep,
    runAdFlow,
    showMonetagAd,
    showGigaPubAd,
    showMonetixAd,
    showUSLAd,
  };
}
