import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Clock } from "lucide-react";
import { showNotification } from "@/components/AppNotification";

const MILESTONES = [
  { ads: 100, bugReward: 100,  usdReward: null,  label: "✦ 100",   isBug: true },
  { ads: 200, bugReward: 500,  usdReward: null,  label: "✦ 500",   isBug: true },
  { ads: 300, bugReward: 1000, usdReward: null,  label: "✦ 1000",  isBug: true },
  { ads: 400, bugReward: null, usdReward: 0.005, label: "$0.005",  isBug: false },
  { ads: 500, bugReward: null, usdReward: 0.01,  label: "$0.01",   isBug: false },
];

function useCountdown() {
  const [timeStr, setTimeStr] = useState("00:00:00");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      // Reset at 12:00 PM UTC
      const next = new Date();
      next.setUTCHours(12, 0, 0, 0);
      if (now.getUTCHours() >= 12) {
        next.setUTCDate(next.getUTCDate() + 1);
      }
      const diff = next.getTime() - now.getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeStr(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return timeStr;
}

export default function DailyActivityBonus({ user }: { user: any }) {
  const queryClient = useQueryClient();
  const countdown = useCountdown();

  const { data: bonusStatus, isLoading } = useQuery({
    queryKey: ["/api/daily-bonus/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/daily-bonus/status");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/daily-bonus/claim");
      if (!res.ok) {
        const err = await res.json();
        throw err;
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-bonus/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      const m = MILESTONES[data.milestoneIndex];
      if (m) {
        showNotification(
          m.isBug ? `+${m.bugReward} BUG claimed!` : `+${m.usdReward} USD claimed!`,
          "success"
        );
      }
    },
    onError: (err: any) => {
      if (err.alreadyClaimed) {
        showNotification("Bonus already claimed today.", "error");
      } else if (err.noMilestone) {
        showNotification("Watch at least 100 ads to earn a bonus.", "error");
      } else {
        showNotification(err.message || "Failed to claim bonus.", "error");
      }
    },
  });

  const adsWatched = bonusStatus?.adsWatchedToday ?? (user?.adsWatchedToday || 0);
  const currentMilestoneIndex: number = bonusStatus?.currentMilestoneIndex ?? -1;
  const claimedToday: boolean = bonusStatus?.claimedToday ?? false;

  // Current bonus info (highest reached milestone)
  const currentMilestone = currentMilestoneIndex >= 0 ? MILESTONES[currentMilestoneIndex] : null;
  const currentBonusLabel = currentMilestone
    ? currentMilestone.isBug
      ? `✦ ${currentMilestone.bugReward}`
      : currentMilestone.label
    : "✦ 0";

  return (
    <div className="rounded-2xl bg-[#111111] border border-white/5 mb-3 p-5">
      {/* Header */}
      <h3 className="text-lg font-black text-white uppercase tracking-widest mb-1">
        Daily Activity Bonus
      </h3>
      <p className="text-[#888] text-xs mb-5">
        Watch more ads — earn extra rewards daily
      </p>

      {/* Milestones with timeline */}
      <div className="relative">
        {/* Vertical connecting line */}
        <div
          className="absolute left-[14px] top-[22px] w-[2px] bg-white/10 rounded-full"
          style={{ height: `calc(100% - 44px)` }}
        />

        <div className="space-y-3">
          {MILESTONES.map((m, i) => {
            const reached = adsWatched >= m.ads;
            const isCurrent =
              i === currentMilestoneIndex ||
              (i === 0 && currentMilestoneIndex < 0 && adsWatched < m.ads);
            const progress = Math.min(100, (adsWatched / m.ads) * 100);
            const isActive = i === 0 && !reached; // first incomplete milestone is "active"
            const borderColor = reached
              ? "border-green-500/50"
              : isCurrent && i === (currentMilestoneIndex + 1)
              ? "border-green-500/70"
              : "border-white/5";

            // Find which is the "next" milestone to work toward
            const isNext = i === currentMilestoneIndex + 1;

            return (
              <div key={i} className="flex items-center gap-3">
                {/* Dot */}
                <div
                  className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center z-10 border-2 transition-all ${
                    reached
                      ? "bg-green-500 border-green-400"
                      : "bg-[#1C1C1E] border-white/20"
                  }`}
                >
                  {reached && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>

                {/* Row card */}
                <div
                  className={`flex-1 rounded-xl border px-4 py-3 ${
                    reached
                      ? "bg-green-500/5 border-green-500/30"
                      : isNext
                      ? "bg-[#1a1a1a] border-green-500/40"
                      : "bg-[#1C1C1E] border-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm font-bold ${reached ? "text-green-400" : isNext ? "text-white" : "text-white/60"}`}>
                      {adsWatched >= m.ads ? m.ads : adsWatched} / {m.ads}
                    </span>
                    <span className={`text-sm font-bold ${reached ? "text-green-300" : isNext ? "text-white" : "text-white/40"}`}>
                      {m.label}
                    </span>
                  </div>
                  {/* Progress bar only on current active milestone */}
                  {isNext && (
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Note + Timer */}
      <div className="mt-5 text-center">
        <p className="text-[#666] text-xs leading-relaxed">
          The bonus can be claimed only once per day.
          <br />
          All views reset when the timer expires.
        </p>
        <div className="flex items-center justify-center gap-1.5 mt-2">
          <Clock className="w-3.5 h-3.5 text-white/40" />
          <span className="text-white/60 text-sm font-mono font-semibold">{countdown}</span>
        </div>
      </div>

      {/* Current Bonus display */}
      <div className="mt-4 bg-[#1C1C1E] rounded-xl px-4 py-3 text-center border border-white/5">
        <p className="text-[#888] text-[10px] font-bold uppercase tracking-widest mb-1">
          Current Bonus
        </p>
        <p className={`text-xl font-black ${currentMilestone ? "text-white" : "text-white/30"}`}>
          {currentBonusLabel}
        </p>
      </div>

      {/* Get A Bonus button */}
      <button
        onClick={() => claimMutation.mutate()}
        disabled={claimMutation.isPending || claimedToday || isLoading}
        className={`w-full mt-3 py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all ${
          claimedToday
            ? "bg-white/10 text-white/30 cursor-not-allowed"
            : currentMilestone
            ? "bg-green-500 hover:bg-green-400 text-black active:scale-95"
            : "bg-white/10 text-white/30 cursor-not-allowed"
        }`}
      >
        {claimedToday ? "Claimed Today ✓" : claimMutation.isPending ? "Claiming..." : "Get A Bonus"}
      </button>
    </div>
  );
}
