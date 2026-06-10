import { useState, useCallback } from 'react';

declare global {
  interface Window {
    show_11123429: (type?: string) => Promise<void>;
    showGiga: (id?: number) => Promise<void>;
  }
}

interface AdFlowResult {
  success: boolean;
  monetagWatched: boolean;
}

export function useAdFlow() {
  const [isShowingAds, setIsShowingAds] = useState(false);
  const [adStep, setAdStep] = useState<'idle' | 'monetag' | 'complete'>('idle');

  const showMonetagAd = useCallback((): Promise<{ success: boolean; watchedFully: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      if (typeof window.show_11123429 === 'function') {
        window.show_11123429()
          .then(() => {
            resolve({ success: true, watchedFully: true, unavailable: false });
          })
          .catch((error) => {
            console.error('Monetag ad error:', error);
            resolve({ success: false, watchedFully: false, unavailable: false });
          });
      } else {
        resolve({ success: false, watchedFully: false, unavailable: true });
      }
    });
  }, []);

  const showGigaPubAd = useCallback((): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      if (typeof window.showGiga === 'function') {
        window.showGiga(34625)
          .then(() => resolve({ success: true, unavailable: false }))
          .catch(() => resolve({ success: false, unavailable: false }));
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
      
      if (!monetagResult.success) {
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
  };
}
