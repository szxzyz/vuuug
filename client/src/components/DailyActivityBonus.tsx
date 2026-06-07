import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Clock } from "lucide-react";
import { showNotification } from "@/components/AppNotification";

const MILESTONES = [
  { ads: 100, bugReward: 100,  usdReward: null,  label: "✦ 100 BUG", isBug: true  },
  { ads: 200, bugReward: 500,  usdReward: null,  label: "✦ 500 BUG", isBug: true  },
  { ads: 300, bugReward: 1000, usdReward: null,  label: "✦ 1000 BUG",isBug: true  },
  { ads: 400, bugReward: null, usdReward: 0.005, label: "$0.005",     isBug: false },
  { ads: 500, bugReward: null, usdReward: 0.01,  label: "$0.01",      isBug: false },
];

function useCountdown() {
  const [timeStr, setTimeStr] = useState("00:00:00");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = new Date(now);
      next.setUTCHours(12, 0, 0, 0);
      if (now >= next) next.setUTCDate(next.getUTCDate() + 1);
      const diff = Math.max(0, next.getTime() - now.getTime());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeStr(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`);
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
      if (!res.ok) throw await res.json();
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-bonus/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      const m = MILESTONES[data.milestoneIndex];
      if (m) showNotification(m.isBug ? `+${m.bugReward} BUG claimed!` : `+${m.label} claimed!`, "success");
    },
    onError: (err: any) => {
      if (err.alreadyClaimed) showNotification("Bonus already claimed today.", "error");
      else if (err.noMilestone) showNotification("Watch at least 100 ads to earn a bonus.", "error");
      else showNotification(err.message || "Failed to claim bonus.", "error");
    },
  });

  const adsWatched = bonusStatus?.adsWatchedToday ?? (user?.adsWatchedToday || 0);
  const currentMilestoneIndex: number = bonusStatus?.currentMilestoneIndex ?? -1;
  const claimedToday: boolean = bonusStatus?.claimedToday ?? false;
  const currentMilestone = currentMilestoneIndex >= 0 ? MILESTONES[currentMilestoneIndex] : null;

  return (
    <div className="rounded-2xl bg-[#111111] border border-white/5 mb-3 p-3">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-black text-white uppercase tracking-widest leading-tight">
            Daily Activity Bonus
          </h3>
          <p className="text-[#555] text-[10px] mt-0.5">Watch ads — earn extra daily rewards</p>
        </div>
        <div className="flex items-center gap-1 bg-[#1C1C1E] rounded-lg px-2 py-1">
          <Clock className="w-2.5 h-2.5 text-white/30" />
          <span className="text-white/50 text-[11px] font-mono font-bold">{countdown}</span>
        </div>
      </div>

      {/* Milestones — compact list */}
      <div className="space-y-1 mb-2">
        {MILESTONES.map((m, i) => {
          const reached = adsWatched >= m.ads;
          const isNext = i === currentMilestoneIndex + 1;
          const progress = Math.min(100, (adsWatched / m.ads) * 100);

          return (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-xl px-3 py-1.5 border transition-all ${
                reached
                  ? "bg-green-500/8 border-green-500/20"
                  : isNext
                  ? "bg-[#1a1a1a] border-green-500/25"
                  : "bg-[#161616] border-white/4"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                reached ? "bg-green-400" : isNext ? "bg-green-500/50" : "bg-white/12"
              }`} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-semibold ${reached ? "text-green-400" : isNext ? "text-white" : "text-white/35"}`}>
                    {Math.min(adsWatched, m.ads)}/{m.ads}
                  </span>
                  <span className={`text-[11px] font-bold ${reached ? "text-green-300" : isNext ? "text-white/70" : "text-white/25"}`}>
                    {m.label}
                  </span>
                </div>
                {isNext && (
                  <div className="h-[2px] bg-white/6 rounded-full mt-1 overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${progress}%` }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom row: current bonus + claim button */}
      <div className="flex items-center gap-2">
        <div className="bg-[#1C1C1E] rounded-xl px-3 py-2 border border-white/5 flex-1 text-center">
          <p className="text-[#555] text-[9px] font-bold uppercase tracking-widest">Bonus</p>
          <p className={`text-sm font-black mt-0.5 ${currentMilestone ? "text-white" : "text-white/20"}`}>
            {currentMilestone ? currentMilestone.label : "—"}
          </p>
        </div>

        <button
          onClick={() => claimMutation.mutate()}
          disabled={claimMutation.isPending || claimedToday || isLoading || !currentMilestone}
          className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 ${
            claimedToday
              ? "bg-white/6 text-white/25 cursor-not-allowed"
              : currentMilestone
              ? "bg-green-500 hover:bg-green-400 text-black"
              : "bg-white/6 text-white/25 cursor-not-allowed"
          }`}
        >
          {claimedToday ? "Claimed ✓" : claimMutation.isPending ? "..." : "Get Bonus"}
        </button>
      </div>
    </div>
  );
}
