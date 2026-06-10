import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Play, Clock, Shield } from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { useAdSession } from "@/hooks/useAdSession";
import AdFailurePopup from "@/components/AdFailurePopup";
import WatchInstructionPopup from "@/components/WatchInstructionPopup";

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

const MIN_BACKGROUND_MS = 3000;

interface AdWatchingSectionProps {
  user: any;
}

export default function AdWatchingSection({ user }: AdWatchingSectionProps) {
  const queryClient = useQueryClient();
  const { startSession, endSession, cancelSession } = useAdSession();

  // Popup shows on first load; dismissed via checkbox confirm
  const [showInstructionPopup, setShowInstructionPopup] = useState(true);
  const [isShowingAds, setIsShowingAds]                 = useState(false);
  const [currentAdStep, setCurrentAdStep]               = useState<'idle' | 'adsgram' | 'verifying'>('idle');
  const [showFailurePopup, setShowFailurePopup]         = useState(false);
  const sessionRewardedRef                              = useRef(false);

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
    mutationFn: async (payload: {
      adType: string;
      sessionId: string;
      backgroundDuration: number;
      sessionStart: number;
    }) => {
      const response = await apiRequest("POST", "/api/ads/watch", payload);
      if (!response.ok) {
        const error = await response.json();
        throw { status: response.status, ...error };
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawal-eligibility"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/valid-count"] });
    },
    onError: (error: any) => {
      sessionRewardedRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });

      if (error.errorType === "insufficient_background") {
        setShowFailurePopup(true);
      } else if (error.errorType === "duplicate_session") {
        showNotification("Session already used. Please watch a new ad.", "error");
      } else if (error.errorType === "cooldown") {
        const secs = error.secsLeft || 5;
        showNotification(`Please wait ${secs}s before watching another ad.`, "error");
      } else if (error.errorType === "abuse_lock") {
        const secs = error.secsLeft || 60;
        showNotification(`Too many failed attempts. Try again in ${secs}s.`, "error");
      } else if (error.limitType === "hourly") {
        showNotification("Hourly limit reached. Refills in ~1 hour.", "error");
      } else if (error.limitType === "daily") {
        showNotification("Daily limit reached. Come back tomorrow.", "error");
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

  const showAdsgramAd = (): Promise<{ success: boolean; unavailable: boolean }> =>
    new Promise((resolve) => {
      if (window.Adsgram) {
        window.Adsgram.init({ blockId: "int-20374" })
          .show()
          .then(() => resolve({ success: true, unavailable: false }))
          .catch((err) => {
            console.error("AdsGram ad error:", err);
            resolve({ success: false, unavailable: false });
          });
      } else {
        resolve({ success: false, unavailable: true });
      }
    });

  // Session starts ONLY when this function is called (from Start Earning button)
  const handleStartEarning = async () => {
    if (isShowingAds) return;

    setIsShowingAds(true);
    sessionRewardedRef.current = false;

    // ── Session tracking begins HERE ─────────────────────────────────────
    const sessionId    = startSession();
    const sessionStart = Date.now();
    // ─────────────────────────────────────────────────────────────────────

    try {
      setCurrentAdStep("adsgram");
      const adsgramResult = await showAdsgramAd();
      const session       = endSession();

      if (adsgramResult.unavailable) {
        cancelSession();
        showNotification("Ads not available. Please try again later.", "error");
        return;
      }

      if (!adsgramResult.success) {
        setShowFailurePopup(true);
        return;
      }

      if (session.backgroundDuration < MIN_BACKGROUND_MS) {
        setShowFailurePopup(true);
        return;
      }

      setCurrentAdStep("verifying");

      if (!sessionRewardedRef.current) {
        sessionRewardedRef.current = true;

        const rewardAmount = appSettings?.rewardPerAd || 2;
        queryClient.setQueryData(["/api/auth/user"], (old: any) => ({
          ...old,
          balance:          String(parseFloat(old?.balance || "0") + rewardAmount),
          adsWatchedToday:  (old?.adsWatchedToday  || 0) + 1,
          hourlyAdsWatched: (old?.hourlyAdsWatched || 0) + 1,
        }));
        showNotification(`+${rewardAmount} POW earned!`, "success");

        watchAdMutation.mutate({
          adType:             "adsgram",
          sessionId:          session.sessionId,
          backgroundDuration: session.backgroundDuration,
          sessionStart:       session.sessionStart,
        });
      }
    } catch (err) {
      console.error("Ad watching error:", err);
      cancelSession();
      showNotification("Error playing ads. Try again.", "error");
    } finally {
      setCurrentAdStep("idle");
      setIsShowingAds(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    }
  };

  // User confirmed the instruction popup — just dismiss it, ad does NOT start yet
  const handleInstructionContinue = () => {
    setShowInstructionPopup(false);
    // ad starts only when user presses Start Earning
  };

  const DAILY_LIMIT  = appSettings?.dailyAdLimit  || 510;
  const HOURLY_LIMIT = appSettings?.hourlyAdLimit  || 63;

  const dailyWatched    = user?.adsWatchedToday   || 0;
  const hourlyWatched   = user?.hourlyAdsWatched   || 0;
  const lastHourlyReset = user?.lastHourlyReset ? new Date(user.lastHourlyReset) : null;
  const hoursSinceReset = lastHourlyReset
    ? (Date.now() - lastHourlyReset.getTime()) / (1000 * 60 * 60)
    : 2;
  const effectiveHourly = hoursSinceReset >= 1 ? 0 : hourlyWatched;
  const adsAvailable    = Math.min(
    Math.max(0, HOURLY_LIMIT - effectiveHourly),
    Math.max(0, DAILY_LIMIT  - dailyWatched),
  );
  const isLimitReached  = adsAvailable === 0;

  return (
    <>
      <Card className="rounded-2xl minimal-card mb-3 border-0">
        <CardContent className="p-5">
          {/* Header */}
          <div className="text-center mb-5">
            <h2 className="text-lg font-extrabold text-white mb-1 tracking-widest uppercase">
              Viewing Ads
            </h2>
            <p className="text-[#AAAAAA] text-xs leading-relaxed">
              Get paid for watching short Ads on Telegram.
            </p>
          </div>

          {/* Start Earning button */}
          <div className="flex justify-center mb-4">
            <button
              onClick={handleStartEarning}
              disabled={isShowingAds || isLimitReached}
              className="btn-primary px-6 py-3 flex items-center gap-2 min-w-[160px] justify-center text-base disabled:opacity-50"
              data-testid="button-watch-ad"
            >
              {isShowingAds ? (
                <>
                  {currentAdStep === "verifying" ? (
                    <Shield size={16} className="animate-pulse text-green-400" />
                  ) : (
                    <Clock size={16} className="animate-spin" />
                  )}
                  <span className="text-sm font-semibold">
                    {currentAdStep === "adsgram"   ? "Loading Ad..."  :
                     currentAdStep === "verifying" ? "Verifying..."   : "Loading..."}
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

          {/* Availability info */}
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

      {/* Instruction Popup — shown on page open, dismissed via checkbox */}
      {showInstructionPopup && (
        <WatchInstructionPopup onContinue={handleInstructionContinue} />
      )}

      {/* Failure Popup */}
      {showFailurePopup && (
        <AdFailurePopup onClose={() => setShowFailurePopup(false)} />
      )}
    </>
  );
}
