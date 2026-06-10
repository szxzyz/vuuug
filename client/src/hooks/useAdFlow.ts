import { useState, useCallback } from 'react';

declare global {
  interface Window {
    show_11123429: (type?: string) => Promise<void>;
    showGiga: () => Promise<void>;
    showRewardAd: (callback: (res: { status: string }) => void) => void;
  }
}

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
      window.showRewardAd((res) => {
        console.log('Monetix ad result:', res.status);
        if (res.status === 'completed') {
          resolve({ success: true, unavailable: false });
        } else if (res.status === 'closed' || res.status === 'skipped') {
          resolve({ success: false, unavailable: false });
        } else {
          resolve({ success: false, unavailable: false });
        }
      });
    });
  }, []);

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
  };
}
