import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import { Clock, Shield } from "lucide-react";

declare global {
  interface Window {
    show_11123429: (type?: string) => Promise<void>;
  }
}

export default function PromoCodeInput() {
  const [promoCode, setPromoCode] = useState("");
  const [isShowingAd, setIsShowingAd] = useState(false);
  const [currentAdStep, setCurrentAdStep] = useState<'idle' | 'monetag' | 'verifying'>('idle');
  const monetagStartTimeRef = useRef<number>(0);
  const queryClient = useQueryClient();

  const redeemPromoMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", "/api/promo-codes/redeem", { code });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Invalid promo code");
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      setPromoCode("");
      showNotification(data.message || "Promo applied successfully!", "success");
    },
    onError: (error: any) => {
      const message = error.message || "Invalid promo code";
      showNotification(message, "error");
    },
  });

  const showMonetagAd = (): Promise<{ success: boolean; watchedFully: boolean; unavailable: boolean }> => {
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
  };

  const handleSubmit = async () => {
    if (!promoCode.trim()) {
      showNotification("Please enter a promo code", "error");
      return;
    }

    if (isShowingAd) return;
    setIsShowingAd(true);

    try {
      setCurrentAdStep('monetag');
      const monetagResult = await showMonetagAd();

      if (monetagResult.unavailable) {
        showNotification("Monetag ads not available. Please try again later.", "error");
        return;
      }

      if (!monetagResult.watchedFully) {
        showNotification("Claimed too fast!", "error");
        return;
      }

      if (!monetagResult.success) {
        showNotification("Ad failed. Please try again.", "error");
        return;
      }

      setCurrentAdStep('verifying');
      redeemPromoMutation.mutate(promoCode.trim().toUpperCase());
    } finally {
      setCurrentAdStep('idle');
      setIsShowingAd(false);
    }
  };

  const getButtonText = () => {
    if (currentAdStep === 'monetag') return "Loading...";
    if (currentAdStep === 'verifying') return "Verifying...";
    if (redeemPromoMutation.isPending) return "Applying...";
    return "Apply";
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <Input
          placeholder="Enter promo code"
          value={promoCode}
          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
          disabled={redeemPromoMutation.isPending || isShowingAd}
          className="bg-[#0d0d0d] border border-[#333] rounded-lg text-white placeholder:text-gray-500 px-[14px] py-[12px] h-[48px] focus:border-[#4cd3ff] focus:ring-1 focus:ring-[#4cd3ff]"
        />
      </div>
      <Button
        onClick={handleSubmit}
        disabled={redeemPromoMutation.isPending || isShowingAd || !promoCode.trim()}
        className="min-h-[48px] px-6 bg-[#4cd3ff] hover:bg-[#6ddeff] text-black rounded-lg transition-all active:scale-[0.97] shadow-[0_0_20px_rgba(76,211,255,0.4)] font-bold flex items-center gap-2"
      >
        {isShowingAd && currentAdStep !== 'idle' && (
          currentAdStep === 'verifying' ? (
            <Shield size={14} className="animate-pulse text-green-600" />
          ) : (
            <Clock size={14} className="animate-spin" />
          )
        )}
        {getButtonText()}
      </Button>
    </div>
  );
}
