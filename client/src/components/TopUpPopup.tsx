import { useState, useEffect, useRef } from "react";
import { useTonConnectUI, useTonAddress } from "@tonconnect/ui-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { showNotification } from "@/components/AppNotification";

const DEPOSIT_WALLET = "UQC4E8orjioFZB3ePOKzlhjMWLLpTDjIk7ZRY2YS6K_fEdxL";
const MIN_DEPOSIT = 0.1;

interface TopUpPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "input" | "processing" | "success" | "error" | "pending";

export default function TopUpPopup({ open, onOpenChange }: TopUpPopupProps) {
  const [tonConnectUI] = useTonConnectUI();
  const connectedAddress = useTonAddress();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [errorMsg, setErrorMsg] = useState("");
  const pendingBocRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-poll when pending — check every 10s if deposit was confirmed on-chain
  useEffect(() => {
    if (step === "pending" && pendingBocRef.current) {
      const boc = pendingBocRef.current;
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/ton/deposit/status?boc=${encodeURIComponent(boc)}`,
            { credentials: "include" }
          );
          const data = await res.json();
          if (data.confirmed) {
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
            // Update balance immediately using server value
            queryClient.setQueryData(["/api/auth/user"], (old: any) => {
              if (!old) return old;
              return { ...old, tonBalance: data.tonBalance };
            });
            queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
            queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
            setStep("success");
            showNotification("TON deposit confirmed!", "success");
          }
        } catch {
          // silently retry next tick
        }
      }, 10_000);
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [step]);

  if (!open) return null;

  const handleClose = () => {
    if (step === "processing") return;
    setAmount("");
    setStep("input");
    setErrorMsg("");
    onOpenChange(false);
  };

  const handleDeposit = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < MIN_DEPOSIT) {
      showNotification(`Minimum deposit is ${MIN_DEPOSIT} TON`, "error");
      return;
    }

    if (!connectedAddress) {
      try {
        await tonConnectUI.openModal();
      } catch {
        showNotification("Please connect your TON wallet first", "error");
      }
      return;
    }

    setStep("processing");
    setErrorMsg("");

    try {
      const nanotons = BigInt(Math.round(amt * 1_000_000_000));

      const result = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [
          {
            address: DEPOSIT_WALLET,
            amount: nanotons.toString(),
          },
        ],
      });

      const res = await fetch("/api/ton/deposit/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ boc: result.boc, amount: amt }),
      });

      const data = await res.json();

      if (data.success) {
        setStep("success");
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      } else if (data.pending) {
        pendingBocRef.current = result.boc;
        setStep("pending");
      } else {
        setErrorMsg(data.message || "Verification failed. Your deposit will be credited within 5 minutes.");
        setStep("error");
      }
    } catch (err: any) {
      if (err?.message?.includes("User rejected")) {
        setStep("input");
        showNotification("Transaction cancelled", "info");
      } else {
        setErrorMsg("Transaction failed. Please try again.");
        setStep("error");
      }
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
        {/* Header — no close button */}
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <h2 className="text-white text-lg font-bold tracking-tight">TON Deposit</h2>
          <p className="text-white/40 text-xs mt-0.5">Enter the deposit amount</p>
        </div>

        <div className="px-5 py-5">
          {/* ── INPUT STEP ── */}
          {step === "input" && (
            <>
              {/* Amount input */}
              <div className="mb-4">
                <div
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  <img src="/images/ton.png" alt="TON" className="w-6 h-6 rounded-full object-cover shrink-0" />
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min={MIN_DEPOSIT}
                    step="0.1"
                    className="bg-transparent text-white text-xl font-bold outline-none placeholder:text-white/20"
                    style={{ width: 0, flex: 1, minWidth: 0 }}
                  />
                  <span className="text-white/40 text-sm font-semibold shrink-0">TON</span>
                </div>

                {/* Quick amounts */}
                <div className="flex gap-2 mt-3">
                  {[0.5, 1, 5, 10].map((v) => (
                    <button
                      key={v}
                      onClick={() => setAmount(v.toString())}
                      className="flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                      style={{
                        background: amount === v.toString() ? "rgba(0,123,255,0.25)" : "rgba(255,255,255,0.06)",
                        color: amount === v.toString() ? "#4cd3ff" : "rgba(255,255,255,0.5)",
                        border: amount === v.toString() ? "1px solid rgba(76,211,255,0.3)" : "1px solid transparent",
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Deposit button */}
              <button
                onClick={handleDeposit}
                className="w-full py-3.5 rounded-2xl text-white font-bold text-sm tracking-wide transition-all active:scale-[0.98]"
                style={{
                  background: "linear-gradient(135deg, #4cd3ff, #007BFF)",
                  boxShadow: "0 4px 16px rgba(0,123,255,0.35)",
                }}
              >
                Deposit
              </button>

              {/* Info + cancel */}
              <p className="text-white/30 text-xs text-center mt-3 leading-relaxed">
                Minimum {MIN_DEPOSIT} TON · Credited within 5 minutes
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
                <p className="text-white font-bold text-base">Processing Deposit</p>
                <p className="text-white/40 text-xs mt-1">Please confirm in your TON wallet…</p>
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
                <p className="text-white font-bold text-base">Deposit Successful!</p>
                <p className="text-white/40 text-xs mt-1">
                  {amount} TON has been credited to your account.
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

          {/* ── PENDING STEP ── */}
          {step === "pending" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)" }}
              >
                <Clock className="w-8 h-8 text-yellow-400" />
              </div>
              <div className="text-center">
                <p className="text-white font-bold text-base">Transaction Sent ✓</p>
                <p className="text-white/50 text-xs mt-2 leading-relaxed px-2">
                  Your TON was sent successfully. Balance will be credited within 5 minutes once the blockchain confirms it.
                </p>
              </div>
              <button
                onClick={handleClose}
                className="w-full py-3 rounded-2xl text-white font-bold text-sm transition-all active:scale-[0.98]"
                style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)" }}
              >
                OK, Got it
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
                <p className="text-white font-bold text-base">Deposit Pending</p>
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
