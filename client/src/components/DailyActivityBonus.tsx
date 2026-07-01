import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Clock } from "lucide-react";
import { showNotification } from "@/components/AppNotification";

const MILESTONES = [
  { ads: 100, bugReward: 100,  usdReward: null,  label: "100 POW",  isBug: false },
  { ads: 200, bugReward: 500,  usdReward: null,  label: "500 POW",  isBug: false },
  { ads: 300, bugReward: 1000, usdReward: null,  label: "1000 POW", isBug: false },
  { ads: 400, bugReward: null, usdReward: 0.05,  label: "$0.05",     isBug: false },
  { ads: 500, bugReward: null, usdReward: 0.10,  label: "$0.10",     isBug: false },
];

function useCountdown(targetIso: string | undefined, onReset?: () => void) {
  const [timeStr, setTimeStr] = useState("--:--:--");
  const hasFiredRef = useRef(false);

  useEffect(() => {
    if (!targetIso) return;
    hasFiredRef.current = false;

    const targetMs = new Date(targetIso).getTime();

    const tick = () => {
      const diff = targetMs - Date.now();
      if (diff <= 1000) {
        setTimeStr("00:00:00");
        if (!hasFiredRef.current) {
          hasFiredRef.current = true;
          onReset?.();
        }
        return;
      }
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
  }, [targetIso]);

  return timeStr;
}

export default function DailyActivityBonus({ user }: { user: any }) {
  const queryClient = useQueryClient();

  const { data: bonusStatus, isLoading } = useQuery({
    queryKey: ["/api/daily-bonus/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/daily-bonus/status");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const countdown = useCountdown(bonusStatus?.nextResetAt, () => {
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    queryClient.invalidateQueries({ queryKey: ["/api/daily-bonus/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
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
          m.usdReward !== null ? `+${m.usdReward} USD earned!` : `+${m.bugReward} POW added to your balance!`,
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

  const currentMilestone = currentMilestoneIndex >= 0 ? MILESTONES[currentMilestoneIndex] : null;
  const canClaim = !!currentMilestone;

  return (
    <div className="mb-3 px-1">
      <p style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
        Daily Activity Bonus
      </p>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', fontWeight: 500, marginBottom: 14 }}>
        Watch more ads — earn extra rewards daily
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {MILESTONES.map((m, i) => {
          const reached = adsWatched >= m.ads;
          const isNext = i === currentMilestoneIndex + 1;
          const progress = Math.min(100, (adsWatched / m.ads) * 100);

          return (
            <div
              key={i}
              style={{
                background: '#1C1C1E',
                borderRadius: 12,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                opacity: reached ? 1 : isNext ? 1 : 0.55,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: reached
                    ? '#22c55e'
                    : isNext
                    ? 'rgba(255,255,255,0.3)'
                    : 'rgba(255,255,255,0.12)',
                }}
              />

              <span style={{ fontSize: 13, fontWeight: 700, color: reached ? '#22c55e' : isNext ? '#fff' : 'rgba(255,255,255,0.5)', minWidth: 46 }}>
                {m.ads} ads
              </span>

              {isNext && (
                <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
                  <div
                    style={{ width: `${progress}%`, height: '100%', background: '#22c55e', borderRadius: 99, transition: 'width 0.5s ease' }}
                  />
                </div>
              )}

              {!isNext && <div style={{ flex: 1 }} />}

              <span style={{
                fontSize: 13,
                fontWeight: 800,
                color: reached ? '#22c55e' : isNext ? '#fff' : 'rgba(255,255,255,0.4)',
                letterSpacing: '-0.2px',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}>
                {m.label}
              </span>

              {reached && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 4, paddingLeft: 2, paddingRight: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.3)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
            {countdown}
          </span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontWeight: 500 }}>resets at 12:00 UTC</span>
        </div>
        {currentMilestone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>Bonus</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 3 }}>
                {currentMilestone.label}
            </span>
          </div>
        )}
      </div>

      <button
        onClick={() => claimMutation.mutate()}
        disabled={claimMutation.isPending || isLoading || !canClaim}
        className={`btn-primary active:scale-95 transition-transform ${
          !canClaim ? 'opacity-40 cursor-not-allowed' : ''
        }`}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '12px 0',
          borderRadius: 12,
          fontSize: 14,
          fontWeight: 700,
          cursor: !canClaim ? 'not-allowed' : 'pointer',
          letterSpacing: '0.03em',
          marginTop: 10,
        }}
      >
        {claimMutation.isPending ? "CLAIMING..." : "GET BONUS"}
      </button>
    </div>
  );
}
