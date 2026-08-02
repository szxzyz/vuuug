import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, AlertCircle, ArrowDown } from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { getTONPrice } from "@/lib/tonPriceService";

const MIN_SWAP_USD = 0.1;

interface SwapUsdtToTonPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usdBalance: number;
}

type Step = "input" | "processing" | "success" | "error";

export default function SwapUsdtToTonPopup({ open, onOpenChange, usdBalance }: SwapUsdtToTonPopupProps) {
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [errorMsg, setErrorMsg] = useState("");
  const [tonPrice, setTonPrice] = useState<number | null>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [lastResult, setLastResult] = useState<{ usdAmount: number; tonAmount: number } | null>(null);

  // Fetch live price whenever the popup opens
  useEffect(() => {
    if (!open) return;
    setLoadingPrice(true);
    getTONPrice()
      .then((p) => setTonPrice(p))
      .catch(() => setTonPrice(5.5))
      .finally(() => setLoadingPrice(false));
  }, [open]);

  if (!open) return null;

  const handleClose = () => {
    if (step === "processing") return;
    setAmount("");
    setStep("input");
    setErrorMsg("");
    onOpenChange(false);
  };

  const parsedAmount = Math.max(0, parseFloat(amount.replace(/,/g, "")) || 0);
  const clampedAmount = Math.min(parsedAmount, usdBalance);
  const estimatedTon = tonPrice ? clampedAmount / tonPrice : null;

  const handleSwap = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < MIN_SWAP_USD) {
      showNotification(`Minimum swap is $${MIN_SWAP_USD.toFixed(2)} USDT`, "error");
      return;
    }
    if (amt > usdBalance) {
      showNotification("Amount exceeds your USDT balance", "error");
      return;
    }

    setStep("processing");
    setErrorMsg("");

    try {
      const res = await fetch("/api/convert-usd-to-ton", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ usdAmount: amt }),
      });
      const data = await res.json();

      if (data.success) {
        setLastResult({ usdAmount: data.usdAmount ?? amt, tonAmount: data.tonAmount ?? 0 });
        queryClient.setQueryData(["/api/auth/user"], (old: any) => {
          if (!old) return old;
          return {
            ...old,
            ...(data.newUsdBalance !== undefined && { usdBalance: data.newUsdBalance }),
            ...(data.newTonBalance !== undefined && { tonBalance: data.newTonBalance }),
          };
        });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
        setStep("success");
      } else {
        setErrorMsg(data.message || "Swap failed. Please try again.");
        setStep("error");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStep("error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm mx-5 rounded-3xl overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #1a1a1e 0%, #111114 100%)",
          border: "none",
          boxShadow: "0 8px 48px rgba(0,0,0,0.7)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <h2 className="text-white text-lg font-bold tracking-tight">Swap USDT to TON</h2>
          <p className="text-white/40 text-xs mt-0.5">Convert your USDT balance into TON</p>
        </div>

        <div className="px-5 py-5">
          {/* ── INPUT STEP ── */}
          {step === "input" && (
            <>
              {/* Balance */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-white/40 text-xs">Available</span>
                <span className="text-white/70 text-xs font-semibold">${usdBalance.toFixed(4)} USDT</span>
              </div>

              {/* Amount input (USDT) */}
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <span style={{ fontSize: 20 }}>💵</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min={0}
                  max={usdBalance}
                  step="0.01"
                  className="bg-transparent text-white text-xl font-bold outline-none placeholder:text-white/20"
                  style={{ width: 0, flex: 1, minWidth: 0 }}
                />
                <span className="text-white/40 text-sm font-semibold shrink-0">USDT</span>
                <button
                  onClick={() => setAmount(String(usdBalance))}
                  className="shrink-0 rounded-lg font-bold"
                  style={{
                    background: "rgba(76,211,255,0.12)",
                    border: "1px solid rgba(76,211,255,0.25)",
                    color: "#4cd3ff",
                    fontSize: 11,
                    padding: "4px 10px",
                  }}
                >
                  MAX
                </button>
              </div>

              {/* Arrow */}
              <div className="flex justify-center my-2">
                <ArrowDown size={14} color="rgba(255,255,255,0.5)" />
              </div>

              {/* Receive (TON) */}
              <div
                className="flex items-center justify-between px-4 py-3 rounded-2xl mb-3"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <span
                  className="text-xl font-bold"
                  style={{ color: loadingPrice ? "rgba(255,255,255,0.3)" : "#4cd3ff" }}
                >
                  {loadingPrice ? "…" : estimatedTon !== null ? estimatedTon.toFixed(6) : "0.000000"}
                </span>
                <div className="flex items-center gap-1.5">
                  <img src="/images/ton.png" alt="TON" className="w-5 h-5 rounded-full object-cover" />
                  <span className="text-white/70 text-sm font-semibold">TON</span>
                </div>
              </div>

              {/* Live rate */}
              {tonPrice && !loadingPrice && (
                <p className="text-white/30 text-xs text-center mb-4">
                  1 TON ≈ ${tonPrice.toFixed(2)}
                </p>
              )}

              {/* Swap button */}
              <button
                onClick={handleSwap}
                disabled={clampedAmount <= 0}
                className="w-full py-3.5 rounded-2xl text-white font-bold text-sm tracking-wide transition-all active:scale-[0.98]"
                style={{
                  background: clampedAmount > 0 ? "linear-gradient(135deg, #4cd3ff, #007BFF)" : "rgba(255,255,255,0.08)",
                  color: clampedAmount > 0 ? "#fff" : "rgba(255,255,255,0.3)",
                  boxShadow: clampedAmount > 0 ? "0 4px 16px rgba(0,123,255,0.35)" : "none",
                  cursor: clampedAmount > 0 ? "pointer" : "not-allowed",
                }}
              >
                Swap to TON
              </button>

              {/* Info + cancel */}
              <p className="text-white/30 text-xs text-center mt-3 leading-relaxed">
                Minimum ${MIN_SWAP_USD.toFixed(2)} · This action cannot be undone
              </p>
              <button
                onClick={handleClose}
                className="w-full mt-2 py-3 rounded-2xl text-white/60 text-sm font-bold transition-all active:scale-[0.98]"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                Cancel
              </button>
            </>
          )}

          {/* ── PROCESSING STEP ── */}
          {step === "processing" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "rgba(76,211,255,0.1)", border: "1px solid rgba(76,211,255,0.2)" }}
              >
                <Loader2 className="w-8 h-8 text-[#4cd3ff] animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-white font-bold text-base">Swapping…</p>
                <p className="text-white/40 text-xs mt-1">Converting USDT to TON</p>
              </div>
            </div>
          )}

          {/* ── SUCCESS STEP ── */}
          {step === "success" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)" }}
              >
                <CheckCircle2 className="w-8 h-8 text-green-400" />
              </div>
              <div className="text-center">
                <p className="text-white font-bold text-base">Swap Successful!</p>
                <p className="text-white/40 text-xs mt-1">
                  ${lastResult?.usdAmount.toFixed(4)} USDT → {lastResult?.tonAmount.toFixed(6)} TON
                </p>
              </div>
              <button
                onClick={handleClose}
                className="w-full py-3 rounded-2xl text-white font-bold text-sm mt-2 transition-all active:scale-[0.98]"
                style={{ background: "rgba(34,197,94,0.2)", border: "1px solid rgba(34,197,94,0.3)" }}
              >
                Done
              </button>
            </div>
          )}

          {/* ── ERROR STEP ── */}
          {step === "error" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <AlertCircle className="w-8 h-8 text-red-400" />
              </div>
              <div className="text-center">
                <p className="text-white font-bold text-base">Swap Failed</p>
                <p className="text-white/40 text-xs mt-1 leading-relaxed">{errorMsg}</p>
              </div>
              <div className="flex gap-2 w-full mt-2">
                <button
                  onClick={() => { setStep("input"); setErrorMsg(""); }}
                  className="flex-1 py-3 rounded-2xl text-white/60 font-bold text-sm transition-all active:scale-[0.98]"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  Try Again
                </button>
                <button
                  onClick={handleClose}
                  className="flex-1 py-3 rounded-2xl text-white font-bold text-sm transition-all active:scale-[0.98]"
                  style={{ background: "rgba(76,211,255,0.15)", border: "1px solid rgba(76,211,255,0.25)" }}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
