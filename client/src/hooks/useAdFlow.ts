import { useState, useCallback, useRef } from 'react';

declare global {
  interface Window {
    show_11123429: (type?: string) => Promise<void>;
    showGiga: () => Promise<unknown> | unknown;
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

      let settled = false;
      const settle = (r: { success: boolean; watchedFully: boolean; unavailable: boolean }) => {
        if (settled) return; settled = true; clearTimeout(timer); resolve(r);
      };
      // Hard timeout — if the Monetag SDK never settles (no fill, script error,
      // etc.) the Watch button would spin forever without this guard.
      const timer = setTimeout(() => {
        console.warn('Monetag ad timed out after 30 s');
        settle({ success: false, watchedFully: false, unavailable: true });
      }, 30_000);

      window.show_11123429()
        .then(() => settle({ success: true, watchedFully: true, unavailable: false }))
        .catch((error) => {
          console.error('Monetag ad error:', error);
          const msg = String(error?.message || error || '').toLowerCase();
          const noAds = msg.includes('no ad') || msg.includes('no fill') || msg.includes('unavailable');
          settle({ success: false, watchedFully: false, unavailable: noAds });
        });
    });
  }, []);

  const showGigaPubAd = useCallback((): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise(async (resolve) => {
      const ready = await waitForFn('showGiga');
      if (!ready) { resolve({ success: false, unavailable: true }); return; }

      let settled = false;
      const settle = (r: { success: boolean; unavailable: boolean }) => {
        if (settled) return; settled = true; clearTimeout(timer); resolve(r);
      };
      const timer = setTimeout(() => {
        console.warn('GigaPub ad timed out after 30 s');
        settle({ success: false, unavailable: true });
      }, 30_000);

      // Promise.resolve handles both the documented Promise API and older
      // GigaPub builds that return a plain/thenable value. The previous direct
      // `.then()` call could leave the outer promise pending forever when a
      // build returned undefined.
      Promise.resolve(window.showGiga())
        .then((result) => {
          console.info('GigaPub ad completed:', result);
          settle({ success: true, unavailable: false });
        })
        .catch((e) => {
          console.error('GigaPub ad error:', e);
          const msg = String(e?.message || e?.error || e || '').toLowerCase();
          const noAds = msg.includes('no ad') || msg.includes('no fill') || msg.includes('unavailable') || msg.includes('empty');
          settle({ success: false, unavailable: noAds });
        });
    });
  }, []);

  // ─── USL Ads (TowerAds SDK) ───────────────────────────────────────────────
  // The TowerAds SDK binds callbacks at construction time. Re-using the same
  // instance across multiple ad invocations means the callbacks from the first
  // construction close over that invocation's `settle`/`rewardEarned` — every
  // subsequent invocation's callbacks would silently call the wrong resolver.
  //
  // Fix: route all callbacks through a mutable ref that always points to the
  // *current* invocation's resolver. The instance is still a singleton (to
  // avoid loading the SDK script more than once), but the effective callback
  // target is swapped on every call.
  const uslAdsInstanceRef   = useRef<InstanceType<Window["TowerAds"]> | null>(null);
  const uslCurrentSettleRef = useRef<((r: { success: boolean; unavailable: boolean }) => void) | null>(null);

  const showUSLAd = useCallback((): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise(async (resolve) => {
      const ready = await waitForFn('TowerAds', 10_000);
      if (!ready) { resolve({ success: false, unavailable: true }); return; }

      let settled = false;
      const settle = (result: { success: boolean; unavailable: boolean }) => {
        if (settled) return;
        settled = true;
        uslCurrentSettleRef.current = null; // clear so stale callbacks can't fire twice
        resolve(result);
      };

      // Point the mutable ref at THIS invocation's resolver BEFORE showing the ad.
      uslCurrentSettleRef.current = settle;

      try {
        if (!uslAdsInstanceRef.current) {
          uslAdsInstanceRef.current = new window.TowerAds({
            apiKey: USL_ADS_API_KEY,
            placementId: USL_ADS_PLACEMENT_ID,
            // All callbacks route through the mutable ref so they always reach
            // the current invocation regardless of how many times the ad runs.
            onRewardEarned: () => {
              console.log("USL Ads: reward earned");
              uslCurrentSettleRef.current?.({ success: true, unavailable: false });
            },
            onError: (error) => {
              console.error("USL Ads error:", error);
              uslCurrentSettleRef.current?.({ success: false, unavailable: false });
            },
          });
        }

        // Hard 30 s timeout — if loadAndShow() never resolves AND onRewardEarned /
        // onError never fire (e.g. the ad is still playing or the SDK is stuck),
        // the Watch button would spin forever without this guard.
        const hardTimer = setTimeout(() => {
          console.warn('USL Ads timed out after 30 s');
          settle({ success: false, unavailable: true });
        }, 30_000);

        uslAdsInstanceRef.current.loadAndShow()
          .then(() => {
            clearTimeout(hardTimer);
            // loadAndShow() resolving does not by itself mean a reward was earned
            // (the user may have closed the ad early) — onRewardEarned is the
            // only source of truth. Give it a brief grace window in case it
            // fires just after the promise settles; if it hasn't fired by then,
            // settle as not rewarded.
            // Some TowerAds builds resolve loadAndShow before dispatching the
            // reward callback. Give that callback enough time to arrive, while
            // still recovering if the SDK silently returns without a reward.
            setTimeout(() => settle({ success: false, unavailable: false }), 2_000);
          })
          .catch((error: any) => {
            clearTimeout(hardTimer);
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
    showUSLAd,
  };
}
