import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowUpDown, Loader2, ChevronRight } from "lucide-react";
import { getTONPrice } from "@/lib/tonPriceService";
import { showNotification } from "@/components/AppNotification";

interface SwapSheetProps {
  open: boolean;
  onClose: () => void;
  balancePAD: number;
  onSwap: (convertTo: "USD" | "TON") => void;
  isPending: boolean;
  minimumPOW?: number;
}

function roundToCleanDisplay(n: number): string {
  if (n <= 0) return "0";
  let rounded: number;
  if (n >= 1_000_000) {
    rounded = Math.round(n / 1_000) * 1_000;
  } else if (n >= 1_000) {
    rounded = Math.round(n / 1_000) * 1_000;
  } else if (n >= 100) {
    rounded = Math.round(n / 100) * 100;
  } else {
    rounded = Math.round(n / 10) * 10;
  }
  return rounded.toLocaleString();
}

export default function SwapSheet({ open, onClose, balancePAD, onSwap, isPending, minimumPOW = 100 }: SwapSheetProps) {
  const [receiveCurrency, setReceiveCurrency] = useState<"USDT" | "TON">("USDT");
  const [tonPrice, setTonPrice] = useState<number | null>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Fixed: 10,000,000 POW = $1 USD (must match server/tonPriceService.ts POW_PER_USD)
  // Dynamic: POW ↔ TON = calculated via live USD market price
  //   tonAmount = powAmount / (10,000,000 × liveTonUsdPrice)
  const POW_PER_USD = 10_000_000;

  useEffect(() => {
    if (!open) return;
    setLoadingPrice(true);
    getTONPrice()
      .then((price) => setTonPrice(price))
      .catch(() => setTonPrice(5.5))
      .finally(() => setLoadingPrice(false));

    // Refresh price every 60 seconds while sheet is open
    const interval = setInterval(() => {
      getTONPrice()
        .then((price) => setTonPrice(price))
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [open]);

  const receiveUSDT = balancePAD / POW_PER_USD;
  // TON amount: POW → USD → TON via live price
  const receiveTON = tonPrice ? balancePAD / (POW_PER_USD * tonPrice) : null;

  const receiveAmount =
    receiveCurrency === "USDT"
      ? receiveUSDT.toFixed(4)
      : receiveTON !== null
      ? receiveTON.toFixed(6)
      : "...";

  const handleContinue = () => {
    if (balancePAD <= 0) {
      showNotification("No POW balance to swap.", "error");
      return;
    }
    if (balancePAD < minimumPOW) {
      showNotification(`Minimum ${minimumPOW.toLocaleString()} POW required to swap.`, "error");
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    onSwap(receiveCurrency === "USDT" ? "USD" : "TON");
    setShowConfirm(false);
  };

  const handleClose = () => {
    setShowConfirm(false);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={handleClose}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.65)",
              zIndex: 100,
            }}
          />

          {/* Bottom Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 101,
              background: "#fff",
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: "20px 20px 36px",
              maxWidth: 480,
              margin: "0 auto",
            }}
          >
            {/* Drag handle */}
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: "rgba(0,0,0,0.15)",
                margin: "0 auto 18px",
              }}
            />

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>Swap</span>
              <button
                onClick={handleClose}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.07)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={16} color="#333" />
              </button>
            </div>

            {/* FROM section */}
            <div style={{ marginBottom: 4 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(0,0,0,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                FROM
              </p>
              <div
                style={{
                  background: "#f7f7f7",
                  borderRadius: 16,
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 28, fontWeight: 700, color: "#111", fontVariantNumeric: "tabular-nums" }}>
                  {roundToCleanDisplay(balancePAD)}
                </span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#fff",
                    borderRadius: 20,
                    padding: "6px 10px 6px 8px",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
                  }}
                >
                  <span style={{ fontSize: 18 }}>⚡</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>POW</span>
                  <ChevronRight size={14} color="#888" />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, paddingLeft: 2, paddingRight: 2 }}>
                <span style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
                  Balance: {roundToCleanDisplay(balancePAD)} POW
                </span>
                <span
                  style={{ fontSize: 12, fontWeight: 700, color: "#1a9eff", cursor: "pointer" }}
                  onClick={() => {/* already using full balance */}}
                >
                  MAX
                </span>
              </div>
            </div>

            {/* Swap direction arrow */}
            <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
              <button
                onClick={() => setReceiveCurrency(receiveCurrency === "USDT" ? "TON" : "USDT")}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  border: "1.5px solid rgba(0,0,0,0.12)",
                  background: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.07)",
                }}
              >
                <ArrowUpDown size={16} color="#555" />
              </button>
            </div>

            {/* RECEIVE section */}
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(0,0,0,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                RECEIVE
              </p>
              <div
                style={{
                  background: "#f7f7f7",
                  borderRadius: 16,
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 28, fontWeight: 700, color: loadingPrice ? "#aaa" : "#111", fontVariantNumeric: "tabular-nums" }}>
                  {loadingPrice ? "..." : receiveAmount}
                </span>
                {/* Currency toggle */}
                <div style={{ display: "flex", gap: 6 }}>
                  {(["USDT", "TON"] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setReceiveCurrency(c)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        background: receiveCurrency === c ? "#1a9eff" : "#fff",
                        borderRadius: 20,
                        padding: "6px 10px 6px 8px",
                        border: "none",
                        cursor: "pointer",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
                        transition: "background 0.18s",
                      }}
                    >
                      <span style={{ fontSize: 15 }}>{c === "USDT" ? "💵" : "💎"}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: receiveCurrency === c ? "#fff" : "#111" }}>{c}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Live rate info panel — always visible */}
              <div style={{
                marginTop: 10,
                background: "rgba(26,158,255,0.06)",
                border: "1px solid rgba(26,158,255,0.14)",
                borderRadius: 12,
                padding: "10px 14px",
              }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(0,0,0,0.35)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                  Live Exchange Rates
                </p>
                {loadingPrice ? (
                  <p style={{ fontSize: 12, color: "rgba(0,0,0,0.35)" }}>Fetching live price…</p>
                ) : tonPrice ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}>1 TON</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#1a9eff" }}>${tonPrice.toFixed(4)} USD</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}>1 USD</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>10,000,000 POW</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}>1 TON</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>{Math.round(POW_PER_USD * tonPrice).toLocaleString()} POW</span>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: "rgba(0,0,0,0.35)" }}>Price unavailable</p>
                )}
              </div>
            </div>

            {/* Continue button */}
            <button
              onClick={handleContinue}
              disabled={isPending || balancePAD <= 0}
              style={{
                width: "100%",
                padding: "16px 0",
                borderRadius: 14,
                background: balancePAD > 0 ? "#1a9eff" : "#aaa",
                color: "#fff",
                fontSize: 16,
                fontWeight: 700,
                border: "none",
                cursor: balancePAD > 0 ? "pointer" : "not-allowed",
                letterSpacing: "0.02em",
                transition: "opacity 0.15s",
                opacity: isPending ? 0.7 : 1,
              }}
            >
              {isPending ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                  Processing…
                </span>
              ) : (
                "Continue"
              )}
            </button>
          </motion.div>

          {/* ── Confirmation Dialog ────────────────────────────────────────── */}
          <AnimatePresence>
            {showConfirm && (
              <motion.div
                key="confirm-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.45)",
                  zIndex: 110,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 24px",
                }}
              >
                <motion.div
                  initial={{ scale: 0.88, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.88, opacity: 0 }}
                  transition={{ type: "spring", damping: 25, stiffness: 350 }}
                  style={{
                    background: "#fff",
                    borderRadius: 20,
                    padding: "28px 24px 22px",
                    width: "100%",
                    maxWidth: 360,
                  }}
                >
                  {/* Icon */}
                  <div style={{ textAlign: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 36 }}>⚡</span>
                  </div>

                  <h2 style={{ fontSize: 18, fontWeight: 800, color: "#111", textAlign: "center", marginBottom: 8 }}>
                    Confirm Swap
                  </h2>
                  <p style={{ fontSize: 14, color: "rgba(0,0,0,0.55)", textAlign: "center", marginBottom: 4, lineHeight: 1.5 }}>
                    Are you sure you want to swap your POW to {receiveCurrency}?
                  </p>
                  <p style={{ fontSize: 12, color: "rgba(0,0,0,0.35)", textAlign: "center", marginBottom: 20 }}>
                    This action cannot be undone.
                  </p>

                  {/* Summary */}
                  <div
                    style={{
                      background: "#f7f7f7",
                      borderRadius: 12,
                      padding: "14px 16px",
                      marginBottom: 20,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: "rgba(0,0,0,0.5)" }}>You swap</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>
                        {roundToCleanDisplay(balancePAD)} POW
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13, color: "rgba(0,0,0,0.5)" }}>You receive</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#1a9eff" }}>
                        {receiveAmount} {receiveCurrency}
                      </span>
                    </div>
                  </div>

                  {/* Currency selector */}
                  <p style={{ fontSize: 12, color: "rgba(0,0,0,0.45)", textAlign: "center", marginBottom: 10, fontWeight: 600 }}>
                    SELECT CURRENCY TO RECEIVE
                  </p>
                  <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
                    {(["USDT", "TON"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setReceiveCurrency(c)}
                        style={{
                          flex: 1,
                          padding: "11px 0",
                          borderRadius: 12,
                          border: receiveCurrency === c ? "2px solid #1a9eff" : "2px solid rgba(0,0,0,0.1)",
                          background: receiveCurrency === c ? "rgba(26,158,255,0.07)" : "#f7f7f7",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 7,
                          transition: "all 0.15s",
                        }}
                      >
                        <span style={{ fontSize: 18 }}>{c === "USDT" ? "💵" : "💎"}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: receiveCurrency === c ? "#1a9eff" : "#333" }}>
                          {c}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Buttons */}
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => setShowConfirm(false)}
                      style={{
                        flex: 1,
                        padding: "13px 0",
                        borderRadius: 12,
                        border: "1.5px solid rgba(0,0,0,0.12)",
                        background: "#fff",
                        color: "#555",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirm}
                      disabled={isPending}
                      style={{
                        flex: 1,
                        padding: "13px 0",
                        borderRadius: 12,
                        background: "#1a9eff",
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 700,
                        border: "none",
                        cursor: "pointer",
                        opacity: isPending ? 0.7 : 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      {isPending && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
                      Confirm Swap
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </>
      )}
    </AnimatePresence>
  );
}
