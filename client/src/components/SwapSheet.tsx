import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowDown, Loader2 } from "lucide-react";
import { getTONPrice } from "@/lib/tonPriceService";
import { showNotification } from "@/components/AppNotification";

interface SwapSheetProps {
  open: boolean;
  onClose: () => void;
  balancePAD: number;
  onSwap: (convertTo: "USD" | "TON", amount: number) => void;
  isPending: boolean;
  minimumPOW?: number;
}

export default function SwapSheet({
  open,
  onClose,
  balancePAD,
  onSwap,
  isPending,
  minimumPOW = 100,
}: SwapSheetProps) {
  const [receiveCurrency, setReceiveCurrency] = useState<"USDT" | "TON">("USDT");
  const [tonPrice, setTonPrice] = useState<number | null>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // Editable input — starts with full balance, user can type any amount
  const [inputValue, setInputValue] = useState("");

  const POW_PER_USD = 10_000_000;

  // Seed input and fetch price when sheet opens
  useEffect(() => {
    if (!open) return;
    setInputValue(String(balancePAD));
    setLoadingPrice(true);
    getTONPrice()
      .then((p) => setTonPrice(p))
      .catch(() => setTonPrice(5.5))
      .finally(() => setLoadingPrice(false));

    const iv = setInterval(() => {
      getTONPrice().then((p) => setTonPrice(p)).catch(() => {});
    }, 60_000);
    return () => clearInterval(iv);
  }, [open, balancePAD]);

  const parsedAmount = Math.max(0, parseFloat(inputValue.replace(/,/g, "")) || 0);
  const clampedAmount = Math.min(parsedAmount, balancePAD);

  const receiveUSDT = clampedAmount / POW_PER_USD;
  const receiveTON = tonPrice ? clampedAmount / (POW_PER_USD * tonPrice) : null;
  const receiveDisplay =
    receiveCurrency === "USDT"
      ? receiveUSDT.toFixed(4)
      : receiveTON !== null
      ? receiveTON.toFixed(6)
      : "…";

  const handleContinue = () => {
    if (clampedAmount <= 0) {
      showNotification("Enter a POW amount to swap.", "error");
      return;
    }
    if (clampedAmount < minimumPOW) {
      showNotification(`Minimum ${minimumPOW.toLocaleString()} POW required.`, "error");
      return;
    }
    if (clampedAmount > balancePAD) {
      showNotification("Amount exceeds your balance.", "error");
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    onSwap(receiveCurrency === "USDT" ? "USD" : "TON", clampedAmount);
    setShowConfirm(false);
  };

  const handleClose = () => {
    setShowConfirm(false);
    onClose();
  };

  // Shared dark colors
  const bg = "#0d0d0d";
  const cardBg = "#1a1a1a";
  const border = "rgba(255,255,255,0.08)";
  const accent = "#4cd3ff";
  const textPrimary = "#ffffff";
  const textMuted = "rgba(255,255,255,0.45)";

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="sw-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 100 }}
          />

          {/* Sheet */}
          <motion.div
            key="sw-sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 340 }}
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 101,
              background: bg,
              borderTop: `1px solid ${border}`,
              borderTopLeftRadius: 20, borderTopRightRadius: 20,
              padding: "14px 16px 32px",
              maxWidth: 480, margin: "0 auto",
            }}
          >
            {/* Drag handle */}
            <div style={{ width: 32, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.2)", margin: "0 auto 14px" }} />

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: textPrimary }}>Swap POW</span>
              <button
                onClick={handleClose}
                style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.1)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <X size={14} color="rgba(255,255,255,0.7)" />
              </button>
            </div>

            {/* FROM */}
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>You Swap</span>
              <div style={{ marginTop: 6, background: cardBg, border: `1px solid ${border}`, borderRadius: 14, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Editable number input */}
                  <input
                    type="number"
                    min={0}
                    max={balancePAD}
                    step={1}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    style={{
                      flex: 1, background: "transparent", border: "none", outline: "none",
                      fontSize: 24, fontWeight: 700, color: textPrimary,
                      fontVariantNumeric: "tabular-nums",
                      minWidth: 0,
                    }}
                  />
                  {/* MAX button */}
                  <button
                    onClick={() => setInputValue(String(balancePAD))}
                    style={{
                      background: "rgba(76,211,255,0.12)", border: `1px solid rgba(76,211,255,0.25)`,
                      borderRadius: 8, padding: "4px 10px",
                      fontSize: 11, fontWeight: 700, color: accent, cursor: "pointer",
                      letterSpacing: "0.04em",
                    }}
                  >
                    MAX
                  </button>
                  {/* POW chip */}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.07)", borderRadius: 20, padding: "5px 10px 5px 8px" }}>
                    <span style={{ fontSize: 14 }}>⚡</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: textPrimary }}>POW</span>
                  </div>
                </div>
                <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: textMuted }}>
                    Balance: {balancePAD.toLocaleString()} POW
                  </span>
                  {parsedAmount > balancePAD && (
                    <span style={{ fontSize: 11, color: "#ff6b6b" }}>Exceeds balance</span>
                  )}
                </div>
              </div>
            </div>

            {/* Arrow */}
            <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: cardBg, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ArrowDown size={14} color="rgba(255,255,255,0.5)" />
              </div>
            </div>

            {/* RECEIVE */}
            <div style={{ marginBottom: 14 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>You Receive</span>
              <div style={{ marginTop: 6, background: cardBg, border: `1px solid ${border}`, borderRadius: 14, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 24, fontWeight: 700, color: loadingPrice ? "rgba(255,255,255,0.3)" : accent, fontVariantNumeric: "tabular-nums" }}>
                    {loadingPrice ? "…" : receiveDisplay}
                  </span>
                  {/* Currency toggle */}
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["USDT", "TON"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setReceiveCurrency(c)}
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          background: receiveCurrency === c ? accent : "rgba(255,255,255,0.07)",
                          borderRadius: 16, padding: "5px 10px", border: "none", cursor: "pointer",
                          transition: "background 0.15s",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>{c === "USDT" ? "💵" : "💎"}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: receiveCurrency === c ? "#000" : textPrimary }}>{c}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Live rate strip */}
            {tonPrice && !loadingPrice && (
              <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: textMuted }}>1 TON = <span style={{ color: accent }}>${tonPrice.toFixed(2)}</span></span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>·</span>
                <span style={{ fontSize: 11, color: textMuted }}>1 USD = 10,000,000 POW</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>·</span>
                <span style={{ fontSize: 11, color: textMuted }}>1 TON = {Math.round(POW_PER_USD * tonPrice).toLocaleString()} POW</span>
              </div>
            )}

            {/* Continue */}
            <button
              onClick={handleContinue}
              disabled={isPending || clampedAmount <= 0}
              style={{
                width: "100%", padding: "14px 0", borderRadius: 12,
                background: clampedAmount > 0 ? accent : "rgba(255,255,255,0.1)",
                color: clampedAmount > 0 ? "#000" : "rgba(255,255,255,0.3)",
                fontSize: 15, fontWeight: 700, border: "none",
                cursor: clampedAmount > 0 ? "pointer" : "not-allowed",
                opacity: isPending ? 0.7 : 1,
                transition: "all 0.15s",
              }}
            >
              {isPending ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                  Processing…
                </span>
              ) : "Continue"}
            </button>
          </motion.div>

          {/* ── Confirmation dialog ───────────────────────────────────────────── */}
          <AnimatePresence>
            {showConfirm && (
              <motion.div
                key="sw-confirm-bg"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 20px" }}
              >
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                  transition={{ type: "spring", damping: 26, stiffness: 360 }}
                  style={{ background: "#1a1a1a", border: `1px solid ${border}`, borderRadius: 20, padding: "24px 20px 20px", width: "100%", maxWidth: 360 }}
                >
                  <div style={{ textAlign: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 32 }}>⚡</span>
                  </div>
                  <h2 style={{ fontSize: 17, fontWeight: 800, color: textPrimary, textAlign: "center", marginBottom: 6 }}>Confirm Swap</h2>
                  <p style={{ fontSize: 13, color: textMuted, textAlign: "center", marginBottom: 3, lineHeight: 1.5 }}>
                    Swap your POW to {receiveCurrency}?
                  </p>

                  {/* TON-specific warning */}
                  {receiveCurrency === "TON" && (
                    <div style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.25)", borderRadius: 10, padding: "10px 12px", marginBottom: 14, textAlign: "left" }}>
                      <p style={{ fontSize: 12, color: "#fbbf24", fontWeight: 600, marginBottom: 4 }}>⚠️ Important Notice</p>
                      <p style={{ fontSize: 11.5, color: "rgba(251,191,36,0.85)", lineHeight: 1.55, margin: 0 }}>
                        TON received through swapping can only be used for creating advertisements within Paid Adz. This swap is permanent and cannot be reversed. Are you sure you want to continue?
                      </p>
                    </div>
                  )}

                  {receiveCurrency !== "TON" && (
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", textAlign: "center", marginBottom: 16 }}>
                      This action cannot be undone.
                    </p>
                  )}

                  {/* Summary */}
                  <div style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${border}`, borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: textMuted }}>You swap</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: textPrimary }}>{clampedAmount.toLocaleString()} POW</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: textMuted }}>You receive</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: accent }}>{receiveDisplay} {receiveCurrency}</span>
                    </div>
                  </div>

                  {/* Currency selector */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    {(["USDT", "TON"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setReceiveCurrency(c)}
                        style={{
                          flex: 1, padding: "10px 0", borderRadius: 10,
                          border: `1.5px solid ${receiveCurrency === c ? accent : border}`,
                          background: receiveCurrency === c ? "rgba(76,211,255,0.1)" : "transparent",
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        }}
                      >
                        <span style={{ fontSize: 16 }}>{c === "USDT" ? "💵" : "💎"}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: receiveCurrency === c ? accent : "rgba(255,255,255,0.6)" }}>{c}</span>
                      </button>
                    ))}
                  </div>

                  {/* Buttons */}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setShowConfirm(false)}
                      style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: `1px solid ${border}`, background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirm}
                      disabled={isPending}
                      style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: accent, color: "#000", fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer", opacity: isPending ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      {isPending && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
                      Confirm
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <style>{`@keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} } input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}`}</style>
        </>
      )}
    </AnimatePresence>
  );
}
