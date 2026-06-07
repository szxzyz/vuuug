import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Play, Clock, Shield } from "lucide-react";
import { showNotification } from "@/components/AppNotification";

declare global {
  interface Window {
    show_10401872: (type?: string | { type: string; inAppSettings: any }) => Promise<void>;
  }
}

interface AdWatchingSectionProps {
  user: any;
}

export default function AdWatchingSection({ user }: AdWatchingSectionProps) {
  const queryClient = useQueryClient();
  const [isShowingAds, setIsShowingAds] = useState(false);
  const [currentAdStep, setCurrentAdStep] = useState<'idle' | 'monetag' | 'verifying'>('idle');
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
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawal-eligibility"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/valid-count"] });
    },
    onError: (error: any) => {
      sessionRewardedRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });

      if (error.limitType === 'hourly') {
        const mins = error.minsUntilRefill || 60;
        showNotification(`Hourly limit reached. Refills in ${mins} min.`, "error");
      } else if (error.limitType === 'daily') {
        showNotification("Daily limit reached (510 ads/day). Come back tomorrow.", "error");
      } else if (error.status === 429) {
        showNotification("Limit reached. Please wait before watching more ads.", "error");
      } else if (error.status === 401 || error.status === 403) {
        showNotification("Authentication error. Please refresh the page.", "error");
      } else if (error.message) {
        showNotification(`Error: ${error.message}`, "error");
      } else {
        showNotification("Network error. Check your connection and try again.", "error");
      }
    },
  });

  const showMonetagAd = (): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      if (typeof window.show_10401872 === 'function') {
        monetagStartTimeRef.current = Date.now();
        window.show_10401872()
          .then(() => {
            resolve({ success: true, unavailable: false });
          })
          .catch((error) => {
            console.error('Monetag ad error:', error);
            resolve({ success: false, unavailable: false });
          });
      } else {
        resolve({ success: false, unavailable: true });
      }
    });
  };

  const handleStartEarning = async () => {
    if (isShowingAds) return;

    setIsShowingAds(true);
    sessionRewardedRef.current = false;

    try {
      setCurrentAdStep('monetag');
      const monetagResult = await showMonetagAd();

      if (monetagResult.unavailable) {
        showNotification("Ads not available. Please try again later.", "error");
        return;
      }

      if (!monetagResult.success) {
        showNotification("Ad failed. Please try again.", "error");
        return;
      }

      setCurrentAdStep('verifying');

      if (!sessionRewardedRef.current) {
        sessionRewardedRef.current = true;

        const rewardAmount = appSettings?.rewardPerAd || 2;
        queryClient.setQueryData(["/api/auth/user"], (old: any) => ({
          ...old,
          balance: String(parseFloat(old?.balance || '0') + rewardAmount),
          adsWatchedToday: (old?.adsWatchedToday || 0) + 1,
          hourlyAdsWatched: (old?.hourlyAdsWatched || 0) + 1,
        }));

        showNotification(`+${rewardAmount} PAD earned!`, "success");
        watchAdMutation.mutate('monetag');
      }
    } catch (error) {
      console.error('Ad watching error:', error);
      showNotification("Error playing ads. Try again.", "error");
    } finally {
      setCurrentAdStep('idle');
      setIsShowingAds(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    }
  };

  const DAILY_LIMIT = appSettings?.dailyAdLimit || 510;
  const HOURLY_LIMIT = appSettings?.hourlyAdLimit || 63;

  const dailyWatched = user?.adsWatchedToday || 0;
  const hourlyWatched = user?.hourlyAdsWatched || 0;
  const lastHourlyReset = user?.lastHourlyReset ? new Date(user.lastHourlyReset) : null;
  const hoursSinceReset = lastHourlyReset
    ? (Date.now() - lastHourlyReset.getTime()) / (1000 * 60 * 60)
    : 2;
  const effectiveHourlyWatched = hoursSinceReset >= 1 ? 0 : hourlyWatched;

  const adsAvailableHourly = Math.max(0, HOURLY_LIMIT - effectiveHourlyWatched);
  const adsAvailableDaily = Math.max(0, DAILY_LIMIT - dailyWatched);
  const adsAvailable = Math.min(adsAvailableHourly, adsAvailableDaily);

  const isLimitReached = adsAvailable === 0;

  return (
    <Card className="rounded-2xl minimal-card mb-3 border-0">
      <CardContent className="p-5">
        <div className="text-center mb-5">
          <h2
            className="text-lg font-extrabold text-white mb-1 tracking-widest uppercase"
          >
            Viewing Ads
          </h2>
          <p className="text-[#AAAAAA] text-xs leading-relaxed">
            Get paid for watching short Ads on Telegram.
          </p>
        </div>

        <div className="flex justify-center mb-4">
          <button
            onClick={handleStartEarning}
            disabled={isShowingAds || isLimitReached}
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
                  {currentAdStep === 'monetag' ? 'Loading...' :
                   currentAdStep === 'verifying' ? 'Verifying...' : 'Loading...'}
                </span>
              </>
            ) : (
              <>
                <Play size={16} />
                <span className="text-sm font-semibold">Start Earning</span>
              </>
            )}
          </button>
        </div>

        {/* Hourly availability info */}
        <div className="text-center">
          {isLimitReached && dailyWatched >= DAILY_LIMIT ? (
            <p className="text-xs text-red-400/80">Daily limit reached. Resets tomorrow.</p>
          ) : isLimitReached ? (
            <p className="text-xs text-yellow-400/80">Hourly limit reached. Refills in ~1 hour.</p>
          ) : (
            <p className="text-xs text-white/30">
              {adsAvailable} ads available · {dailyWatched}/{DAILY_LIMIT} today
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
