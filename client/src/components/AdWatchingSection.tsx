import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Play, Clock, Shield } from "lucide-react";
import { showNotification } from "@/components/AppNotification";

declare global {
  interface Window {
    show_10401872: (type?: string | { type: string; inAppSettings: any }) => Promise<void>;
    Adsgram: {
      init: (config: { blockId: string }) => {
        show: () => Promise<void>;
      };
    };
  }
}

interface AdWatchingSectionProps {
  user: any;
}

export default function AdWatchingSection({ user }: AdWatchingSectionProps) {
  const queryClient = useQueryClient();
  const [isShowingAds, setIsShowingAds] = useState(false);
  const [currentAdStep, setCurrentAdStep] = useState<'idle' | 'monetag' | 'adsgram' | 'verifying'>('idle');
  const sessionRewardedRef = useRef(false);
  const monetagStartTimeRef = useRef<number>(0);

  const { data: appSettings } = useQuery({
    queryKey: ["/api/app-settings"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/app-settings");
      return response.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const watchAdMutation = useMutation({
    mutationFn: async (adType: string) => {
      const response = await apiRequest("POST", "/api/ads/watch", { adType });
      if (!response.ok) {
        const error = await response.json();
        throw { status: response.status, ...error };
      }
      return response.json();
    },
    onSuccess: async (data) => {
      const rewardAmount = data?.rewardPAD || appSettings?.rewardPerAd || 2;
      showNotification(`+${rewardAmount} PAD earned!`, "success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawal-eligibility"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/valid-count"] });
    },
    onError: (error: any) => {
      sessionRewardedRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      
      if (error.status === 429) {
        const limit = error.limit || appSettings?.dailyAdLimit || 50;
        showNotification(`Daily ad limit reached (${limit} ads/day)`, "error");
      } else if (error.status === 401 || error.status === 403) {
        showNotification("Authentication error. Please refresh the page.", "error");
      } else if (error.message) {
        showNotification(`Error: ${error.message}`, "error");
      } else {
        showNotification("Network error. Check your connection and try again.", "error");
      }
    },
  });

  const showMonetagAd = (): Promise<{ success: boolean; watchedFully: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      if (typeof window.show_10401872 === 'function') {
        monetagStartTimeRef.current = Date.now();
        window.show_10401872()
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
  };

  const showAdsgramAd = (): Promise<boolean> => {
    return new Promise(async (resolve) => {
      if (window.Adsgram) {
        try {
          await window.Adsgram.init({ blockId: "int-20373" }).show();
          resolve(true);
        } catch (error) {
          console.error('Adsgram ad error:', error);
          resolve(false);
        }
      } else {
        resolve(false);
      }
    });
  };

  const handleStartEarning = async () => {
    if (isShowingAds) return;
    
    setIsShowingAds(true);
    sessionRewardedRef.current = false;
    
    try {
      // STEP 1: Show Monetag ad - User must watch at least 3 seconds
      setCurrentAdStep('monetag');
      const monetagResult = await showMonetagAd();
      
      // Handle Monetag unavailable
      if (monetagResult.unavailable) {
        showNotification("Ads not available. Please try again later.", "error");
        return;
      }
      
      // Check if Monetag was closed before 3 seconds
      if (!monetagResult.watchedFully) {
        showNotification("Claimed too fast!", "error");
        return;
      }
      
      // Monetag was watched fully (at least 3 seconds)
      if (!monetagResult.success) {
        showNotification("Ad failed. Please try again.", "error");
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // STEP 2: Show Adsgram ad
      setCurrentAdStep('adsgram');
      const adsgramSuccess = await showAdsgramAd();

      if (!adsgramSuccess) {
        showNotification("Please complete the ad to earn reward.", "error");
        return;
      }
      
      // STEP 3: Grant reward after both complete successfully
      setCurrentAdStep('verifying');
      
      if (!sessionRewardedRef.current) {
        sessionRewardedRef.current = true;
        
        // Optimistic UI update - only ONE increment to progress
        const rewardAmount = appSettings?.rewardPerAd || 2;
        queryClient.setQueryData(["/api/auth/user"], (old: any) => ({
          ...old,
          balance: String(parseFloat(old?.balance || '0') + rewardAmount),
          adsWatchedToday: (old?.adsWatchedToday || 0) + 1
        }));
        
        // Sync with backend - single reward call
        watchAdMutation.mutate('monetag');
      }
    } finally {
      // Always reset state on completion or error
      setCurrentAdStep('idle');
      setIsShowingAds(false);
    }
  };

  const adsWatchedToday = user?.adsWatchedToday || 0;
  const dailyLimit = appSettings?.dailyAdLimit || 50;

  return (
    <Card className="rounded-2xl minimal-card mb-3">
      <CardContent className="p-4">
        <div className="text-center mb-3">
          <h2 className="text-base font-bold text-white mb-1">Viewing ads</h2>
          <p className="text-[#AAAAAA] text-xs">Get PAD for watching commercials</p>
        </div>
        
        <div className="flex justify-center mb-3">
          <button
            onClick={handleStartEarning}
            disabled={isShowingAds || adsWatchedToday >= dailyLimit}
            className="btn-primary px-6 py-3 flex items-center gap-2 min-w-[160px] justify-center text-base disabled:opacity-50"
            data-testid="button-watch-ad"
          >
            {isShowingAds ? (
              <>
                {currentAdStep === 'verifying' ? (
                  <Shield size={16} className="animate-pulse text-green-400" />
                ) : (
                  <Clock size={16} className="animate-spin" />
                )}
                <span className="text-sm font-semibold">
                  {currentAdStep === 'monetag' ? 'Monetag...' : 
                   currentAdStep === 'adsgram' ? 'AdGram...' :
                   currentAdStep === 'verifying' ? 'Verifying...' : 'Loading...'}
                </span>
              </>
            ) : (
              <>
                <Play size={16} className="group-hover:scale-110 transition-transform" />
                <span className="text-sm font-semibold">Start Earning</span>
              </>
            )}
          </button>
        </div>
        
        {/* Watched counter - Always visible */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground">
            Watched: {adsWatchedToday}/{dailyLimit}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
