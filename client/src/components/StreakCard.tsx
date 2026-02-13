import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import { Flame, Loader } from "lucide-react";

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

interface StreakCardProps {
  user: any;
}

export default function StreakCard({ user }: StreakCardProps) {
  const queryClient = useQueryClient();
  const [isClaiming, setIsClaiming] = useState(false);
  const [timeUntilNextClaim, setTimeUntilNextClaim] = useState<string>("");
  const [hasClaimed, setHasClaimed] = useState(false);

  const claimStreakMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/streak/claim");
      if (!response.ok) {
        const error = await response.json();
        const errorObj = new Error(error.message || 'Failed to claim streak');
        (errorObj as any).isAlreadyClaimed = error.message === "Please wait 5 minutes before claiming again!";
        throw errorObj;
      }
      return response.json();
    },
    onSuccess: (data) => {
      setHasClaimed(true);
      localStorage.setItem(`streak_claimed_${user?.id}`, new Date().toISOString());
      
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      
      const rewardAmount = parseFloat(data.rewardEarned || '0');
      if (rewardAmount > 0) {
        const earnedPAD = Math.round(rewardAmount);
        showNotification(`You've claimed +${earnedPAD} PAD!`, "success");
      } else {
        showNotification("You've claimed your streak bonus!", "success");
      }
    },
    onError: (error: any) => {
      const notificationType = error.isAlreadyClaimed ? "info" : "error";
      showNotification(error.message || "Failed to claim streak", notificationType);
      if (error.isAlreadyClaimed) {
        setHasClaimed(true);
        if (user?.id) {
          localStorage.setItem(`streak_claimed_${user.id}`, new Date().toISOString());
        }
      }
    },
    onSettled: () => {
      setIsClaiming(false);
    },
  });

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      
      if (user?.id) {
        const claimedTimestamp = localStorage.getItem(`streak_claimed_${user.id}`);
        if (claimedTimestamp) {
          const claimedDate = new Date(claimedTimestamp);
          const nextClaimTime = new Date(claimedDate.getTime() + 5 * 60 * 1000);
          
          if (now.getTime() < nextClaimTime.getTime()) {
            setHasClaimed(true);
            const diff = nextClaimTime.getTime() - now.getTime();
            const minutes = Math.floor(diff / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            setTimeUntilNextClaim(`${minutes}:${seconds.toString().padStart(2, '0')}`);
            return;
          } else {
            setHasClaimed(false);
            localStorage.removeItem(`streak_claimed_${user.id}`);
          }
        }
      }
      
      if (user?.lastStreakDate) {
        const lastClaim = new Date(user.lastStreakDate);
        const minutesSinceLastClaim = (now.getTime() - lastClaim.getTime()) / (1000 * 60);
        
        if (minutesSinceLastClaim < 5) {
          setHasClaimed(true);
          const nextClaimTime = new Date(lastClaim.getTime() + 5 * 60 * 1000);
          const diff = nextClaimTime.getTime() - now.getTime();
          const minutes = Math.floor(diff / (1000 * 60));
          const seconds = Math.floor((diff % (1000 * 60)) / 1000);
          setTimeUntilNextClaim(`${minutes}:${seconds.toString().padStart(2, '0')}`);
          return;
        }
      }
      
      setHasClaimed(false);
      setTimeUntilNextClaim("Available now");
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [user?.lastStreakDate, user?.id]);

  const showAdsgramAd = (): Promise<boolean> => {
    return new Promise(async (resolve) => {
      if (window.Adsgram) {
        try {
          await window.Adsgram.init({ blockId: "20372" }).show();
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

  const showMonetagRewardedAd = (): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      if (typeof window.show_10401872 === 'function') {
        window.show_10401872()
          .then(() => {
            resolve({ success: true, unavailable: false });
          })
          .catch((error) => {
            console.error('Monetag rewarded ad error:', error);
            resolve({ success: false, unavailable: false });
          });
      } else {
        resolve({ success: false, unavailable: true });
      }
    });
  };

  const handleClaimStreak = async () => {
    if (isClaiming || hasClaimed) return;
    
    setIsClaiming(true);
    
    try {
      // Then show Monetag rewarded ad first
      const monetagResult = await showMonetagRewardedAd();
      
      if (monetagResult.unavailable) {
        // If Monetag unavailable, proceed with just AdsGram
        showNotification("Monetag ad not available, showing AdsGram...", "info");
      } else if (!monetagResult.success) {
        showNotification("Please watch the ad completely to claim your bonus.", "error");
        setIsClaiming(false);
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));

      // Show AdsGram int-20372 after Monetag
      const adsgramSuccess = await showAdsgramAd();
      
      if (!adsgramSuccess) {
        showNotification("Please watch the ad completely to claim your bonus.", "error");
        setIsClaiming(false);
        return;
      }
      
      claimStreakMutation.mutate();
    } catch (error) {
      console.error('Streak claim failed:', error);
      showNotification("Failed to claim streak. Please try again.", "error");
      setIsClaiming(false);
    }
  };

  const canClaim = timeUntilNextClaim === "Available now" && !hasClaimed;

  return (
    <Card className="mb-3 minimal-card">
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#4cd3ff]/20 to-[#4cd3ff]/10 border border-[#4cd3ff]/30 flex items-center justify-center">
              <Flame className="w-5 h-5 text-[#4cd3ff]" />
            </div>
            <div>
              <h3 className="text-white font-bold text-xl">
                Claim Bonus
              </h3>
            </div>
          </div>
          <Button
              onClick={handleClaimStreak}
              disabled={isClaiming || !canClaim}
              className="h-10 px-4 bg-gradient-to-br from-[#1a1a1a] to-[#0d0d0d] border border-[#4cd3ff]/30 hover:border-[#4cd3ff] hover:bg-[#4cd3ff]/10 transition-all rounded-full flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg"
            >
              {isClaiming ? (
                <>
                  <Loader className="w-4 h-4 text-[#4cd3ff] animate-spin" />
                  <span className="text-white font-medium text-xs">Claiming...</span>
                </>
              ) : canClaim ? (
                <>
                  <Flame className="w-4 h-4 text-[#4cd3ff]" />
                  <span className="text-white font-medium text-xs">Claim Bonus</span>
                </>
              ) : (
                <>
                  <Flame className="w-4 h-4 text-[#4cd3ff] opacity-50" />
                  <span className="text-white font-medium text-xs opacity-70">{timeUntilNextClaim}</span>
                </>
              )}
            </Button>
        </div>
      </CardContent>
    </Card>
  );
}
