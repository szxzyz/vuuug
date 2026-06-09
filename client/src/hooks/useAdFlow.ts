import { useState, useRef, useCallback } from 'react';

declare global {
  interface Window {
    show_11123429: (type?: string) => Promise<void>;
    showGiga: (id?: number) => Promise<void>;
    showAdexium: () => Promise<void>;
    _adexiumWidget: {
      show: () => void | Promise<void>;
      autoMode: () => void;
    } | null;
    _adexiumReady: boolean;
    AdexiumWidget: new (config: { wid: string; adFormat: string }) => {
      show: () => void | Promise<void>;
      autoMode: () => void;
    };
  }
}

interface AdFlowResult {
  success: boolean;
  monetagWatched: boolean;
}

export function useAdFlow() {
  const [isShowingAds, setIsShowingAds] = useState(false);
  const [adStep, setAdStep] = useState<'idle' | 'monetag' | 'complete'>('idle');
  const monetagStartTimeRef = useRef<number>(0);

  const showMonetagAd = useCallback((): Promise<{ success: boolean; watchedFully: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      if (typeof window.show_11123429 === 'function') {
        monetagStartTimeRef.current = Date.now();
        window.show_11123429()
          .then(() => {
            const watchDuration = Date.now() - monetagStartTimeRef.current;
            const watchedAtLeast3Seconds = watchDuration >= 3000;
            resolve({ success: true, watchedFully: watchedAtLeast3Seconds, unavailable: false });
          })
          .catch((error) => {
            console.error('Monetag ad error:', error);
            const watchDuration = Date.now() - monetagStartTimeRef.current;
            const watchedAtLeast3Seconds = watchDuration >= 3000;
            resolve({ success: false, watchedFully: watchedAtLeast3Seconds, unavailable: false });
          });
      } else {
        resolve({ success: false, watchedFully: false, unavailable: true });
      }
    });
  }, []);

  const showGigaPubAd = useCallback((): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      if (typeof window.showGiga === 'function') {
        window.showGiga()
          .then(() => resolve({ success: true, unavailable: false }))
          .catch(() => resolve({ success: false, unavailable: false }));
      } else {
        resolve({ success: false, unavailable: true });
      }
    });
  }, []);

  const showAdexiumAd = useCallback((): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      if (typeof window.showAdexium === 'function') {
        window.showAdexium()
          .then(() => resolve({ success: true, unavailable: false }))
          .catch((err: Error) => {
            const isUnavailable = err?.message === 'unavailable' || !window._adexiumScriptLoaded;
            resolve({ success: false, unavailable: isUnavailable });
          });
      } else {
        resolve({ success: false, unavailable: true });
      }
    });
  }, []);

  const runAdFlow = useCallback(async (): Promise<AdFlowResult> => {
    setIsShowingAds(true);
    
    try {
      setAdStep('monetag');
      const monetagResult = await showMonetagAd();
      
      if (monetagResult.unavailable) {
        setAdStep('idle');
        return { success: false, monetagWatched: false };
      }
      
      if (!monetagResult.watchedFully) {
        setAdStep('idle');
        return { success: false, monetagWatched: false };
      }
      
      setAdStep('complete');
      
      return { 
        success: true, 
        monetagWatched: true
      };
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
    showAdexiumAd,
  };
}
