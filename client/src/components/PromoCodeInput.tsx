import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import { FiCheck } from "react-icons/fi";

export default function PromoCodeInput() {
  const [promoCode, setPromoCode] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
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
      setInlineError("Invalid Code");
    },
  });

  const handleSubmit = () => {
    if (!promoCode.trim()) {
      setInlineError("Please enter a promo code");
      return;
    }
    setInlineError(null);
    redeemPromoMutation.mutate(promoCode.trim().toUpperCase());
  };

  const busy     = redeemPromoMutation.isPending;
  const disabled = busy || !promoCode.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {inlineError && (
        <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171', letterSpacing: '0.04em' }}>{inlineError}</span>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        value={promoCode}
        onChange={e => { setPromoCode(e.target.value.toUpperCase()); setInlineError(null); }}
        onKeyDown={e => e.key === "Enter" && !disabled && handleSubmit()}
        placeholder="Enter promo code"
        disabled={busy}
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
        disabled={disabled}
        style={{
          height: 42,
          padding: "0 16px",
          borderRadius: 10,
          border: "none",
          background: disabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.10)",
          color: disabled ? "rgba(255,255,255,0.2)" : "#fff",
          fontSize: 12,
          fontWeight: 700,
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
          flexShrink: 0,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
          transition: "all 0.15s ease",
        }}
        className={disabled ? "" : "active:scale-95 transition-transform"}
      >
        {busy ? (
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
        {busy ? "Applying…" : "APPLY"}
      </button>
    </div>
    </div>
  );
}
