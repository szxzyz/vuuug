import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import { FiCheck } from "react-icons/fi";

declare global {
  interface Window {
    Adsgram?: {
      init: (params: { blockId: string; debug?: boolean }) => { show: () => Promise<void>; destroy: () => void };
    };
  }
}

const PROMO_BLOCK_ID = "int-35652";

function showAdsgramAd(): Promise<{ success: boolean; unavailable: boolean }> {
  return new Promise((resolve) => {
    if (!window.Adsgram) {
      resolve({ success: false, unavailable: true });
      return;
    }
    try {
      window.Adsgram.init({ blockId: PROMO_BLOCK_ID })
        .show()
        .then(() => resolve({ success: true, unavailable: false }))
        .catch(() => resolve({ success: false, unavailable: false }));
    } catch {
      resolve({ success: false, unavailable: true });
    }
  });
}

export default function PromoCodeInput() {
  const [promoCode, setPromoCode] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const redeemPromoMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", "/api/promo-codes/redeem", { code });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Invalid promo code");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      setPromoCode("");
      setInlineError(null);
      showNotification(data.message || "Promo applied successfully!", "success");
    },
    onError: (error: any) => {
      setInlineError(error.message || "Invalid Code");
    },
  });

  const handleSubmit = async () => {
    const code = promoCode.trim().toUpperCase();
    if (!code) {
      setInlineError("Please enter a promo code");
      return;
    }
    setInlineError(null);
    setBusy(true);

    try {
      const adResult = await showAdsgramAd();
      if (!adResult.success && !adResult.unavailable) {
        setInlineError("Please watch the ad to claim your reward");
        setBusy(false);
        return;
      }
      redeemPromoMutation.mutate(code);
    } catch {
      redeemPromoMutation.mutate(code);
    } finally {
      setBusy(false);
    }
  };

  const isDisabled = busy || redeemPromoMutation.isPending || !promoCode.trim();
  const isLoading  = busy || redeemPromoMutation.isPending;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {inlineError && (
        <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171', letterSpacing: '0.04em' }}>{inlineError}</span>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={promoCode}
          onChange={e => { setPromoCode(e.target.value.toUpperCase()); setInlineError(null); }}
          onKeyDown={e => e.key === "Enter" && !isDisabled && handleSubmit()}
          placeholder="Enter promo code"
          disabled={isLoading}
          style={{
            flex: 1,
            height: 42,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 10,
            padding: "0 12px",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            outline: "none",
            letterSpacing: "0.05em",
            transition: "border-color 0.15s",
          }}
          onFocus={e => (e.target.style.borderColor = "rgba(255,255,255,0.25)")}
          onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.09)")}
        />
        <button
          onClick={handleSubmit}
          disabled={isDisabled}
          style={{
            height: 42,
            padding: "0 16px",
            borderRadius: 10,
            border: "none",
            background: isDisabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.10)",
            color: isDisabled ? "rgba(255,255,255,0.2)" : "#fff",
            fontSize: 12,
            fontWeight: 700,
            cursor: isDisabled ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexShrink: 0,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            transition: "all 0.15s ease",
          }}
          className={isDisabled ? "" : "active:scale-95 transition-transform"}
        >
          {isLoading ? (
            <span style={{
              width: 12, height: 12, borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.2)",
              borderTopColor: "#fff",
              display: "inline-block",
              animation: "spin 0.7s linear infinite",
            }} />
          ) : (
            <FiCheck size={13} />
          )}
          {isLoading ? "Loading…" : "APPLY"}
        </button>
      </div>
    </div>
  );
}
