import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { FaPlay } from "react-icons/fa";
import { FiClock, FiShield } from "react-icons/fi";
import { showNotification } from "@/components/AppNotification";
import { useAdSession } from "@/hooks/useAdSession";
import AdFailurePopup from "@/components/AdFailurePopup";
import { useLanguage } from "@/hooks/useLanguage";

declare global {
  interface Window {
    Adsgram: {
      init: (params: { blockId: string; debug?: boolean }) => {
        show: () => Promise<void>;
        destroy: () => void;
      };
    };
  }
}

interface AdWatchingSectionProps {
  user: any;
}

export default function AdWatchingSection({ user }: AdWatchingSectionProps) {
  const queryClient = useQueryClient();
  const { startSession, endSession, cancelSession } = useAdSession();
  const { t } = useLanguage();

  const [isShowingAds, setIsShowingAds]         = useState(false);
  const [currentAdStep, setCurrentAdStep]       = useState<"idle" | "adsgram" | "verifying">("idle");
  const [showFailurePopup, setShowFailurePopup] = useState(false);
  const [pendingAdStart, setPendingAdStart]     = useState(false);
  const sessionRewardedRef                      = useRef(false);

  const { data: appSettings } = useQuery({
    queryKey: ["/api/app-settings"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/app-settings");
      return r.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const watchAdMutation = useMutation({
    mutationFn: async (payload: {
      adType: string;
      sessionId: string;
      backgroundDuration: number;
      sessionStart: number;
    }) => {
      const r = await apiRequest("POST", "/api/ads/watch", payload);
      if (!r.ok) {
        const err = await r.json();
        throw { status: r.status, ...err };
      }
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.setQueryData(["/api/auth/user"], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          balance:     data?.newBalance !== undefined ? String(data.newBalance) : old.balance,
          weeklyStars: data?.newWeeklyStars !== undefined ? data.newWeeklyStars : old.weeklyStars,
        };
      });

      const pow  = data?.rewardPOW  ?? 0;
      const star = data?.rewardSTAR ?? 0;
      showNotification(`+${pow} POW · +${star} ⭐ earned!`, "success");

      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard/weekly"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawal-eligibility"] });
    },
    onError: (error: any) => {
      sessionRewardedRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      if (error.errorType === "insufficient_background") {
        setShowFailurePopup(true);
      } else if (error.errorType === "duplicate_session") {
        showNotification(t('error') + ": Session already used.", "error");
      } else if (error.errorType === "cooldown") {
        showNotification(`${t('processing')} ${error.secsLeft || 5}s`, "error");
      } else if (error.errorType === "abuse_lock") {
        showNotification(`${t('failed')}. ${t('retry')} in ${error.secsLeft || 60}s.`, "error");
      } else if (error.limitType === "hourly") {
        showNotification(t('hourly_limit_reached'), "error");
      } else if (error.limitType === "daily") {
        showNotification(t('daily_limit_reached_tomorrow'), "error");
      } else if (error.message) {
        showNotification(`${t('error')}: ${error.message}`, "error");
      } else {
        showNotification(t('something_went_wrong'), "error");
      }
    },
  });

  const showAdsgramAd = (): Promise<{ success: boolean; unavailable: boolean }> =>
    new Promise((resolve) => {
      if (window.Adsgram) {
        window.Adsgram.init({ blockId: "34708" })
          .show()
          .then(() => resolve({ success: true, unavailable: false }))
          .catch((err) => {
            console.error("AdsGram error:", err);
            resolve({ success: false, unavailable: false });
          });
      } else {
        resolve({ success: false, unavailable: true });
      }
    });

  const runAdFlow = async () => {
    if (isShowingAds) return;
    setIsShowingAds(true);
    sessionRewardedRef.current = false;

    const sessionId    = startSession();
    const sessionStart = Date.now();

    try {
      setCurrentAdStep("adsgram");
      const adsgramResult = await showAdsgramAd();
      const session       = endSession();

      if (adsgramResult.unavailable) {
        cancelSession();
        showNotification(t('no_ad_available'), "error");
        return;
      }

      if (!adsgramResult.success) {
        setShowFailurePopup(true);
        return;
      }

      setCurrentAdStep("verifying");

      if (!sessionRewardedRef.current) {
        sessionRewardedRef.current = true;
        const starReward = appSettings?.starRewardPerAd || 2;
        queryClient.setQueryData(["/api/auth/user"], (old: any) => {
          if (!old) return old;
          return {
            ...old,
            adsWatchedToday:  (old.adsWatchedToday  || 0) + 1,
            hourlyAdsWatched: (old.hourlyAdsWatched || 0) + 1,
            weeklyStars:      (parseInt(old.weeklyStars || "0") + starReward),
          };
        });
        watchAdMutation.mutate({
          adType: "adsgram",
          sessionId: session.sessionId,
          backgroundDuration: session.backgroundDuration,
          sessionStart: session.sessionStart,
        });
      }
    } catch (err) {
      console.error("Ad watching error:", err);
      cancelSession();
      showNotification(t('something_went_wrong'), "error");
    } finally {
      setCurrentAdStep("idle");
      setIsShowingAds(false);
    }
  };

  const handleStartEarning = () => {
    if (isShowingAds) return;
    setPendingAdStart(true);
    setShowFailurePopup(true);
  };

  const handlePopupClose = () => {
    setShowFailurePopup(false);
    if (pendingAdStart) {
      setPendingAdStart(false);
      runAdFlow();
    }
  };

  const DAILY_LIMIT  = appSettings?.dailyAdLimit  || 510;
  const HOURLY_LIMIT = appSettings?.hourlyAdLimit  || 63;
  const dailyWatched    = user?.adsWatchedToday   || 0;
  const hourlyWatched   = user?.hourlyAdsWatched   || 0;
  const lastHourlyReset = user?.lastHourlyReset ? new Date(user.lastHourlyReset) : null;
  const hoursSinceReset = lastHourlyReset ? (Date.now() - lastHourlyReset.getTime()) / 3_600_000 : 2;
  const effectiveHourly = hoursSinceReset >= 1 ? 0 : hourlyWatched;
  const adsAvailable    = Math.min(
    Math.max(0, HOURLY_LIMIT - effectiveHourly),
    Math.max(0, DAILY_LIMIT  - dailyWatched),
  );
  const isLimitReached = adsAvailable === 0;

  return (
    <>
      <Card className="rounded-2xl minimal-card mb-3 border-0">
        <CardContent className="p-5">
          <div className="text-center mb-5">
            <h2 className="text-lg font-extrabold text-white mb-1 tracking-widest uppercase">
              {t('viewing_ads')}
            </h2>
            <p className="text-[#AAAAAA] text-xs leading-relaxed">
              {t('get_paid_watching')}
            </p>
          </div>

          <div className="flex justify-center mb-4">
            <button
              onClick={handleStartEarning}
              disabled={isShowingAds || isLimitReached}
              className="btn-primary px-6 py-3 flex items-center gap-2 min-w-[160px] justify-center disabled:opacity-50"
              data-testid="button-watch-ad"
            >
              {isShowingAds ? (
                <>
                  {currentAdStep === "verifying"
                    ? <FiShield size={15} className="animate-pulse text-green-400" />
                    : <FiClock size={15} className="animate-spin" />
                  }
                  <span className="text-sm font-semibold">
                    {currentAdStep === "adsgram"   ? t('loading_ad')  :
                     currentAdStep === "verifying" ? t('verifying')   : t('loading')}
                  </span>
                </>
              ) : (
                <>
                  <FaPlay size={13} />
                  <span className="text-sm font-semibold">{t('start_earning')}</span>
                </>
              )}
            </button>
          </div>

          <div className="text-center">
            {isLimitReached && dailyWatched >= DAILY_LIMIT ? (
              <p className="text-xs text-red-400/80">{t('daily_limit_reached_tomorrow')}</p>
            ) : isLimitReached ? (
              <p className="text-xs text-yellow-400/80">{t('hourly_limit_reached')}</p>
            ) : (
              <p className="text-xs text-white/30">
                {adsAvailable} {t('ads_available_label')} · {dailyWatched}/{DAILY_LIMIT} {t('today_label')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {showFailurePopup && (
        <AdFailurePopup onClose={handlePopupClose} />
      )}
    </>
  );
}
