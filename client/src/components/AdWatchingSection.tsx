import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { FiShield, FiZap } from "react-icons/fi";
import { showNotification } from "@/components/AppNotification";
import { useAdSession } from "@/hooks/useAdSession";
import AdFailurePopup from "@/components/AdFailurePopup";
import { useLanguage } from "@/hooks/useLanguage";

declare global {
  interface Window {
    Adsgram: {
      init: (params: { blockId: string; debug?: boolean }) => {
        show: () => Promise<void>;
        destroy: () => void;
      };
    };
  }
}

interface AdWatchingSectionProps {
  user: any;
}

// ─── Layout constants ─────────────────────────────────────────────────────────
const PAD  = 16;   // left padding (card 1 flush)
const PEEK = 40;   // px of adjacent card visible on sides
const GAP  = 10;   // gap between cards

// ─── Ad card definitions ──────────────────────────────────────────────────────
const AD_CARDS = [
  { id: 1, title: "AdsGram",  accentColor: "#3b82f6", image: "/adsgram-logo.jpg"  },
  { id: 2, title: "MonetaG",  accentColor: "#3b82f6", image: "/monetag-logo.jpg"  },
  { id: 3, title: "Gigapub",  accentColor: "#3b82f6", image: "/gigapub-logo.jpg"  },
];

const TABS = [
  { id: "all",     label: "All Ads" },
  { id: "daily",   label: "Daily Ads" },
  { id: "premium", label: "Premium Ads" },
];

export default function AdWatchingSection({ user }: AdWatchingSectionProps) {
  const queryClient = useQueryClient();
  const { startSession, endSession, cancelSession } = useAdSession();
  const { t } = useLanguage();

  const [activeTab, setActiveTab]         = useState("all");
  const [activeIndex, setActiveIndex]     = useState(0);
  const [isShowingAds, setIsShowingAds]   = useState(false);
  const [currentAdStep, setCurrentAdStep] = useState<"idle" | "adsgram" | "verifying">("idle");
  const [showFailurePopup, setShowFailurePopup] = useState(false);
  const [pendingAdStart, setPendingAdStart]     = useState(false);
  const sessionRewardedRef = useRef(false);

  // ─── Carousel DOM refs ────────────────────────────────────────────────────
  const containerRef  = useRef<HTMLDivElement>(null);
  const trackRef      = useRef<HTMLDivElement>(null);
  const dotRefs       = useRef<(HTMLButtonElement | null)[]>([]);

  // ─── Carousel state refs (no re-renders during drag) ─────────────────────
  const containerWRef  = useRef(360);        // measured container width
  const activeIdxRef   = useRef(0);
  const trackXRef      = useRef(PAD);        // current track translateX
  const baseTrackXRef  = useRef(PAD);        // track X at drag start
  const isDraggingRef  = useRef(false);
  const axisRef        = useRef<"h" | "v" | null>(null);
  const startXRef      = useRef(0);
  const startYRef      = useRef(0);
  const lastXRef       = useRef(0);
  const velRef         = useRef(0);
  const lastTRef       = useRef(0);

  // ─── Snap position math ───────────────────────────────────────────────────
  // cardW = containerW - PAD - PEEK - GAP  →  card 1 shows with PAD on left, PEEK of next card shows right
  const snapPositions = useCallback((w: number): number[] => {
    const cw = w - PAD - PEEK - GAP;
    return [
      PAD,                                    // Card 1: flush left
      w / 2 - 1.5 * cw - GAP,               // Card 2: centered
      PEEK - 2 * cw - GAP,                   // Card 3: flush right
    ];
  }, []);

  const cardWidth = (w: number) => w - PAD - PEEK - GAP;

  // ─── Apply track transform directly on DOM ────────────────────────────────
  const applyTrack = useCallback((x: number, animated: boolean) => {
    if (!trackRef.current) return;
    trackRef.current.style.transition = animated
      ? "transform 0.36s cubic-bezier(0.25, 1, 0.5, 1)"
      : "none";
    trackRef.current.style.transform = `translateX(${x}px)`;
    trackXRef.current = x;
  }, []);

  const updateDots = useCallback((idx: number) => {
    dotRefs.current.forEach((dot, i) => {
      if (!dot) return;
      const active = i === idx;
      dot.style.width      = active ? "22px" : "6px";
      dot.style.background = active ? AD_CARDS[idx].accentColor : "rgba(255,255,255,0.18)";
    });
  }, []);

  const snapTo = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(AD_CARDS.length - 1, index));
    activeIdxRef.current = clamped;
    const positions = snapPositions(containerWRef.current);
    applyTrack(positions[clamped], true);
    updateDots(clamped);
    setActiveIndex(clamped);
  }, [applyTrack, updateDots, snapPositions]);

  // ─── Measure container & initialise ──────────────────────────────────────
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.offsetWidth;
    containerWRef.current = w || 360;
    applyTrack(PAD, false);
    updateDots(0);
  }, [applyTrack, updateDots]);

  // ─── Touch handlers ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      isDraggingRef.current = true;
      axisRef.current       = null;
      startXRef.current     = t.clientX;
      startYRef.current     = t.clientY;
      lastXRef.current      = t.clientX;
      velRef.current        = 0;
      lastTRef.current      = Date.now();
      baseTrackXRef.current = trackXRef.current;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      const touch = e.touches[0];
      const dx    = touch.clientX - startXRef.current;
      const dy    = touch.clientY - startYRef.current;

      if (axisRef.current === null) {
        if (Math.abs(dy) > Math.abs(dx) + 5) { axisRef.current = "v"; return; }
        if (Math.abs(dx) > 5)                { axisRef.current = "h"; }
        else return;
      }
      if (axisRef.current === "v") return;

      e.preventDefault();

      const now = Date.now();
      const dt  = now - lastTRef.current;
      if (dt > 0) velRef.current = (touch.clientX - lastXRef.current) / dt;
      lastXRef.current = touch.clientX;
      lastTRef.current = now;

      const positions = snapPositions(containerWRef.current);
      const min = positions[AD_CARDS.length - 1];
      const max = positions[0];

      let newX = baseTrackXRef.current + dx;
      // Rubber-band at edges
      if (newX > max) newX = max + (newX - max) * 0.28;
      if (newX < min) newX = min + (newX - min) * 0.28;

      applyTrack(newX, false);
    };

    const onTouchEnd = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      if (axisRef.current !== "h") { axisRef.current = null; return; }
      axisRef.current = null;

      const cw        = cardWidth(containerWRef.current);
      const dx        = trackXRef.current - baseTrackXRef.current;
      const velocity  = velRef.current;
      const THRESH    = cw * 0.22;
      const VEL       = 0.3;

      if (dx < -THRESH || velocity < -VEL)   snapTo(activeIdxRef.current + 1);
      else if (dx > THRESH || velocity > VEL) snapTo(activeIdxRef.current - 1);
      else                                     snapTo(activeIdxRef.current);
    };

    el.addEventListener("touchstart",  onTouchStart,  { passive: true  });
    el.addEventListener("touchmove",   onTouchMove,   { passive: false });
    el.addEventListener("touchend",    onTouchEnd,    { passive: true  });
    el.addEventListener("touchcancel", onTouchEnd,    { passive: true  });
    return () => {
      el.removeEventListener("touchstart",  onTouchStart);
      el.removeEventListener("touchmove",   onTouchMove);
      el.removeEventListener("touchend",    onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [applyTrack, snapTo, snapPositions]);

  // ─── Mouse drag (desktop) ────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDraggingRef.current  = true;
    axisRef.current        = "h";
    startXRef.current      = e.clientX;
    lastXRef.current       = e.clientX;
    velRef.current         = 0;
    lastTRef.current       = Date.now();
    baseTrackXRef.current  = trackXRef.current;
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const now = Date.now();
    const dt  = now - lastTRef.current;
    if (dt > 0) velRef.current = (e.clientX - lastXRef.current) / dt;
    lastXRef.current = e.clientX;
    lastTRef.current = now;

    const dx        = e.clientX - startXRef.current;
    const positions = snapPositions(containerWRef.current);
    const min = positions[AD_CARDS.length - 1];
    const max = positions[0];
    let newX = baseTrackXRef.current + dx;
    if (newX > max) newX = max + (newX - max) * 0.28;
    if (newX < min) newX = min + (newX - min) * 0.28;
    applyTrack(newX, false);
  }, [applyTrack, snapPositions]);

  const onMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const cw       = cardWidth(containerWRef.current);
    const dx       = trackXRef.current - baseTrackXRef.current;
    const velocity = velRef.current;
    const THRESH   = cw * 0.22;
    const VEL      = 0.3;
    if (dx < -THRESH || velocity < -VEL)    snapTo(activeIdxRef.current + 1);
    else if (dx > THRESH || velocity > VEL) snapTo(activeIdxRef.current - 1);
    else                                     snapTo(activeIdxRef.current);
  }, [snapTo]);

  // ─── App settings & ad limits ────────────────────────────────────────────
  const { data: appSettings } = useQuery({
    queryKey: ["/api/app-settings"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/app-settings");
      return r.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const watchAdMutation = useMutation({
    mutationFn: async (payload: {
      adType: string; sessionId: string;
      backgroundDuration: number; sessionStart: number;
    }) => {
      const r = await apiRequest("POST", "/api/ads/watch", payload);
      if (!r.ok) { const err = await r.json(); throw { status: r.status, ...err }; }
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.setQueryData(["/api/auth/user"], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          balance:     data?.newBalance     !== undefined ? String(data.newBalance) : old.balance,
          weeklyStars: data?.newWeeklyStars !== undefined ? data.newWeeklyStars     : old.weeklyStars,
        };
      });
      showNotification(`+${data?.rewardPOW ?? 0} POW · +${data?.rewardSTAR ?? 0} ⭐ earned!`, "success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard/weekly"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawal-eligibility"] });
    },
    onError: (error: any) => {
      sessionRewardedRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      if      (error.errorType === "insufficient_background") setShowFailurePopup(true);
      else if (error.errorType === "duplicate_session")       showNotification(t("error") + ": Session already used.", "error");
      else if (error.errorType === "cooldown")                showNotification(`${t("processing")} ${error.secsLeft || 5}s`, "error");
      else if (error.errorType === "abuse_lock")              showNotification(`${t("failed")}. ${t("retry")} in ${error.secsLeft || 60}s.`, "error");
      else if (error.limitType  === "hourly")                 showNotification(t("hourly_limit_reached"), "error");
      else if (error.limitType  === "daily")                  showNotification(t("daily_limit_reached_tomorrow"), "error");
      else if (error.message)                                 showNotification(`${t("error")}: ${error.message}`, "error");
      else                                                    showNotification(t("something_went_wrong"), "error");
    },
  });

  const showAdsgramAd = (): Promise<{ success: boolean; unavailable: boolean }> =>
    new Promise((resolve) => {
      if (window.Adsgram) {
        window.Adsgram.init({ blockId: "34708" })
          .show()
          .then(() => resolve({ success: true, unavailable: false }))
          .catch(() => resolve({ success: false, unavailable: false }));
      } else {
        resolve({ success: false, unavailable: true });
      }
    });

  const runAdFlow = async () => {
    if (isShowingAds) return;
    setIsShowingAds(true);
    sessionRewardedRef.current = false;
    const sessionId    = startSession();
    const sessionStart = Date.now();
    try {
      setCurrentAdStep("adsgram");
      const result  = await showAdsgramAd();
      const session = endSession();
      if (result.unavailable) { cancelSession(); showNotification(t("no_ad_available"), "error"); return; }
      if (!result.success)    { setShowFailurePopup(true); return; }
      setCurrentAdStep("verifying");
      if (!sessionRewardedRef.current) {
        sessionRewardedRef.current = true;
        const starReward = appSettings?.starRewardPerAd || 2;
        queryClient.setQueryData(["/api/auth/user"], (old: any) => {
          if (!old) return old;
          return { ...old,
            adsWatchedToday:  (old.adsWatchedToday  || 0) + 1,
            hourlyAdsWatched: (old.hourlyAdsWatched  || 0) + 1,
            weeklyStars:      parseInt(old.weeklyStars || "0") + starReward,
          };
        });
        watchAdMutation.mutate({ adType: "adsgram", sessionId: session.sessionId,
          backgroundDuration: session.backgroundDuration, sessionStart: session.sessionStart });
      }
    } catch { cancelSession(); showNotification(t("something_went_wrong"), "error"); }
    finally  { setCurrentAdStep("idle"); setIsShowingAds(false); }
  };

  const handleStartEarning = () => {
    if (isShowingAds || isLimitReached) return;
    setPendingAdStart(true);
    setShowFailurePopup(true);
  };
  const handlePopupClose = () => {
    setShowFailurePopup(false);
    if (pendingAdStart) { setPendingAdStart(false); runAdFlow(); }
  };

  const DAILY_LIMIT   = appSettings?.dailyAdLimit  || 510;
  const HOURLY_LIMIT  = appSettings?.hourlyAdLimit  || 63;
  const POW_REWARD    = appSettings?.powRewardPerAd || appSettings?.rewardPerAd || 125;
  const dailyWatched  = user?.adsWatchedToday   || 0;
  const hourlyWatched = user?.hourlyAdsWatched  || 0;
  const lastHourlyReset  = user?.lastHourlyReset ? new Date(user.lastHourlyReset) : null;
  const hoursSinceReset  = lastHourlyReset ? (Date.now() - lastHourlyReset.getTime()) / 3_600_000 : 2;
  const effectiveHourly  = hoursSinceReset >= 1 ? 0 : hourlyWatched;
  const adsAvailable     = Math.min(Math.max(0, HOURLY_LIMIT - effectiveHourly), Math.max(0, DAILY_LIMIT - dailyWatched));
  const isLimitReached   = adsAvailable === 0;

  const activeCard = AD_CARDS[activeIndex];

  return (
    <>
      <div className="mb-4">
        {/* Tabs — full width within container padding */}
        <div
          className="flex items-center mb-3"
          style={{ background: "#1a1a1a", borderRadius: 14, padding: "4px", gap: 2 }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 11,
                  fontSize: 13, fontWeight: isActive ? 700 : 500,
                  color: isActive ? "#fff" : "rgba(255,255,255,0.4)",
                  background: isActive ? "#2e2e2e" : "transparent",
                  border: "none", cursor: "pointer", whiteSpace: "nowrap",
                  boxShadow: isActive ? "0 1px 4px rgba(0,0,0,0.4)" : "none",
                  transition: "background 0.2s ease, color 0.2s ease",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Title — below tabs, centered */}
        <div className="mb-3 text-center">
          <h2 className="text-[15px] font-extrabold text-white tracking-widest uppercase mb-0.5">
            {t("viewing_ads")}
          </h2>
          <p className="text-[#666] text-xs">{t("get_paid_watching")}</p>
        </div>

        {/* Carousel — negative margins break out of px-4 page padding so overflow:hidden clips at screen edges not content box */}
        <div
          ref={containerRef}
          className="select-none"
          style={{ overflow: "hidden", touchAction: "pan-y", marginLeft: -16, marginRight: -16 }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {/* Sliding track */}
          <div
            ref={trackRef}
            style={{
              display: "flex",
              gap: GAP,
              willChange: "transform",
              transform: `translateX(${PAD}px)`,
            }}
          >
            {AD_CARDS.map((card, index) => {
              const cw = `calc(100% - ${PAD + PEEK + GAP}px)`;
              return (
                <div
                  key={card.id}
                  style={{
                    flexShrink: 0,
                    width: cw,
                    borderRadius: 18,
                    overflow: "hidden",
                    background: "#1a1a1a",
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    const dragged = Math.abs(trackXRef.current - baseTrackXRef.current) > 6;
                    if (dragged) return;
                    if (index !== activeIdxRef.current) snapTo(index);
                    else handleStartEarning();
                  }}
                >
                  {/* Card header: image + name */}
                  <div
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    {/* Brand image */}
                    <div
                      style={{
                        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                        overflow: "hidden", background: `${card.accentColor}18`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {card.image ? (
                        <img
                          src={card.image}
                          alt={card.title}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <span style={{ fontSize: 20 }}>📢</span>
                      )}
                    </div>
                    {/* Sponsored by + brand name */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.3, marginBottom: 2 }}>
                        Sponsored by
                      </p>
                      <p className="text-white font-bold" style={{ fontSize: 13, lineHeight: 1.2 }}>
                        {card.title}
                      </p>
                    </div>
                  </div>

                  {/* Body */}
                  <div style={{ padding: "10px 12px 12px" }}>
                    {/* Reward + Limit */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div>
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>
                          Reward
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#0a0a0a", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <img src="/pow-icon.png?v=2" alt="POW" style={{ width: "90%", height: "90%", objectFit: "contain" }} />
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: "#ffffff" }}>
                            {POW_REWARD}
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, marginLeft: 3 }}>POW</span>
                          </span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>
                          Ad Limit
                        </p>
                        <span style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.7)" }}>
                          {dailyWatched}
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", fontWeight: 500 }}>/{DAILY_LIMIT}</span>
                        </span>
                      </div>
                    </div>

                    {/* Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (index !== activeIdxRef.current) { snapTo(index); return; }
                        handleStartEarning();
                      }}
                      disabled={isShowingAds || isLimitReached}
                      data-testid="button-watch-ad"
                      style={{
                        width: "100%", padding: "10px 0", borderRadius: 12,
                        fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer",
                        letterSpacing: "0.02em",
                        background: isLimitReached
                          ? "rgba(255,255,255,0.06)"
                          : "#3b82f6",
                        color: isLimitReached ? "rgba(255,255,255,0.3)" : "#fff",
                        opacity: isShowingAds && index !== activeIndex ? 0.5 : 1,
                        transition: "opacity 0.2s",
                      }}
                    >
                      {isShowingAds && index === activeIndex ? (
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                          {currentAdStep === "verifying"
                            ? <><FiShield size={12} style={{ animation: "pulse 1s infinite" }} /> {t("verifying")}</>
                            : <><FiZap    size={12} style={{ animation: "spin 0.8s linear infinite" }} /> {t("loading_ad")}</>
                          }
                        </span>
                      ) : isLimitReached ? "Limit Reached" : "Get POW"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dot indicators */}
        <div style={{ display: "flex", justifyContent: "center", gap: 7, marginTop: 12 }}>
          {AD_CARDS.map((_, i) => (
            <button
              key={i}
              ref={(el) => { dotRefs.current[i] = el; }}
              onClick={() => snapTo(i)}
              style={{
                height: 5, width: i === 0 ? 22 : 6, borderRadius: 3, border: "none", padding: 0, cursor: "pointer",
                background: i === 0 ? AD_CARDS[0].accentColor : "rgba(255,255,255,0.18)",
                transition: "all 0.32s cubic-bezier(0.34, 1.28, 0.64, 1)",
              }}
            />
          ))}
        </div>

        {/* Status */}
        <div style={{ textAlign: "center", marginTop: 8 }}>
          {isLimitReached && dailyWatched >= DAILY_LIMIT
            ? <p style={{ fontSize: 11, color: "rgba(239,68,68,0.7)" }}>{t("daily_limit_reached_tomorrow")}</p>
            : isLimitReached
            ? <p style={{ fontSize: 11, color: "rgba(250,204,21,0.7)" }}>{t("hourly_limit_reached")}</p>
            : <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                {adsAvailable} {t("ads_available_label")} · {dailyWatched}/{DAILY_LIMIT} {t("today_label")}
              </p>
          }
        </div>
      </div>

      {showFailurePopup && <AdFailurePopup onClose={handlePopupClose} />}
    </>
  );
}
