import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import { FiCheck, FiExternalLink } from "react-icons/fi";

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
  const [channelRequired, setChannelRequired] = useState<{ channelLink: string | null; channelName: string } | null>(null);
  const queryClient = useQueryClient();

  const redeemPromoMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", "/api/promo-codes/redeem", { code });
      const data = await response.json();
      if (!response.ok) {
        const err: any = new Error(data.message || "Invalid promo code");
        err.errorType = data.errorType;
        err.channelLink = data.channelLink;
        err.channelName = data.channelName;
        throw err;
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      setPromoCode("");
      setInlineError(null);
      setChannelRequired(null);
      showNotification(data.message || "Promo applied successfully!", "success");
    },
    onError: (error: any) => {
      if (error.errorType === 'channel_required') {
        setChannelRequired({
          channelLink: error.channelLink || null,
          channelName: error.channelName || 'Channel',
        });
        setInlineError(null);
      } else {
        setChannelRequired(null);
        setInlineError(error.message || "Invalid Code");
      }
    },
  });

  const handleSubmit = async () => {
    const code = promoCode.trim().toUpperCase();
    if (!code) {
      setInlineError("Please enter a promo code");
      return;
    }
    setInlineError(null);
    setChannelRequired(null);
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

  const handleJoinChannel = () => {
    if (!channelRequired?.channelLink) return;
    const link = channelRequired.channelLink;
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      if (link.includes("t.me/") && tg.openTelegramLink) tg.openTelegramLink(link);
      else if (tg.openLink) tg.openLink(link);
      else window.open(link, "_blank");
    } else {
      window.open(link, "_blank");
    }
  };

  const isDisabled = busy || redeemPromoMutation.isPending || !promoCode.trim();
  const isLoading  = busy || redeemPromoMutation.isPending;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {inlineError && (
        <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171', letterSpacing: '0.04em' }}>{inlineError}</span>
      )}

      {/* Channel required message */}
      {channelRequired && (
        <div style={{
          background: "rgba(251,113,133,0.10)",
          border: "1px solid rgba(251,113,133,0.25)",
          borderRadius: 10,
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171' }}>
            You must join <strong>{channelRequired.channelName}</strong> before claiming this promo code.
          </span>
          {channelRequired.channelLink && (
            <button
              onClick={handleJoinChannel}
              style={{
                height: 34,
                borderRadius: 8,
                border: "none",
                background: "rgba(251,113,133,0.20)",
                color: "#f87171",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <FiExternalLink size={12} />
              Join {channelRequired.channelName}
            </button>
          )}
          <button
            onClick={() => redeemPromoMutation.mutate(promoCode.trim().toUpperCase())}
            disabled={isLoading}
            style={{
              height: 34,
              borderRadius: 8,
              border: "none",
              background: isLoading ? "rgba(255,255,255,0.04)" : "rgba(34,197,94,0.15)",
              color: isLoading ? "rgba(255,255,255,0.2)" : "#22c55e",
              fontSize: 12,
              fontWeight: 700,
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            {isLoading ? "Verifying…" : "✓ I've Joined — Verify & Claim"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={promoCode}
          onChange={e => { setPromoCode(e.target.value.toUpperCase()); setInlineError(null); setChannelRequired(null); }}
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
