import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { FiShield, FiZap } from "react-icons/fi";
import { showNotification } from "@/components/AppNotification";
import { useAdSession } from "@/hooks/useAdSession";
import AdFailurePopup from "@/components/AdFailurePopup";
import { useLanguage } from "@/hooks/useLanguage";
import { useAdFlow } from "@/hooks/useAdFlow";

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

// ─── Card definitions — each maps to its own ad provider ─────────────────────
const AD_CARDS = [
  { id: 1, adType: "adsgram", title: "AdsGram", accentColor: "#3b82f6", image: "/adsgram-logo.jpg"  },
  { id: 2, adType: "monetag", title: "MonetaG", accentColor: "#3b82f6", image: "/monetag-logo.jpg"  },
  { id: 3, adType: "gigapub", title: "Gigapub", accentColor: "#3b82f6", image: "/gigapub-logo.jpg"  },
];


export default function AdWatchingSection({ user }: AdWatchingSectionProps) {
  const queryClient = useQueryClient();
  const { startSession, endSession, cancelSession, waitForForeground } = useAdSession();
  const { t } = useLanguage();
  const { showMonetagAd, showGigaPubAd } = useAdFlow();

  const TABS = [
    { id: "daily",   label: t("daily_adz") },
    { id: "premium", label: t("premium_adz") },
  ];

  const [activeTab,      setActiveTab]      = useState("daily");
  const [activeIndex,    setActiveIndex]    = useState(0);
  const [isShowingAds,   setIsShowingAds]   = useState(false);
  const [currentAdStep,  setCurrentAdStep]  = useState<"idle" | "loading" | "verifying">("idle");
  const [showFailurePopup, setShowFailurePopup] = useState(false);
  const [failureReason, setFailureReason] = useState<"instructions" | "ad_not_counted">("instructions");
  const [pendingAdStart,   setPendingAdStart]   = useState(false);
  const [pendingCardId,    setPendingCardId]    = useState<number>(1);

  const sessionRewardedRef = useRef(false);
  const currentAdTypeRef   = useRef<string>("adsgram");

  // ─── App settings ──────────────────────────────────────────────────────────
  const { data: appSettings } = useQuery({
    queryKey: ["/api/app-settings"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/app-settings");
      return r.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // ─── Reward mutation ───────────────────────────────────────────────────────
  const watchAdMutation = useMutation({
    mutationFn: async (payload: {
      adType: string; sessionId: string;
      backgroundDuration: number; backgroundEntered: boolean; sessionStart: number;
    }) => {
      // apiRequest throws (with errorType/secsLeft/etc. preserved on the Error)
      // if the response isn't OK, so by this point r.ok is always true.
      const r = await apiRequest("POST", "/api/ads/watch", payload);
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.setQueryData(["/api/auth/user"], (old: any) => {
        if (!old) return old;
        const adType = currentAdTypeRef.current;
        const updates: any = {
          balance:     data?.newBalance     !== undefined ? String(data.newBalance) : old.balance,
        };
        if      (adType === "adsgram") updates.adsWatchedToday          = (old.adsWatchedToday          || 0) + 1;
        else if (adType === "monetag") updates.monetagAdsWatchedToday   = (old.monetagAdsWatchedToday   || 0) + 1;
        else if (adType === "gigapub") updates.gigapubAdsWatchedToday   = (old.gigapubAdsWatchedToday   || 0) + 1;
        return { ...old, ...updates };
      });
      showNotification(t("pow_earned_notification").replace("{n}", String(data?.rewardPOW ?? 0)), "success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawal-eligibility"] });
    },
    onError: (error: any) => {
      sessionRewardedRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      if      (error.errorType === "insufficient_background") { setFailureReason("ad_not_counted"); setShowFailurePopup(true); }
      else if (error.errorType === "duplicate_session")       showNotification(t("error") + ": Session already used.", "error");
      else if (error.errorType === "cooldown")                showNotification(`${t("processing")} ${error.secsLeft || 5}s`, "error");
      else if (error.errorType === "abuse_lock")              showNotification(`${t("failed")}. ${t("retry")} in ${error.secsLeft || 60}s.`, "error");
      else if (error.limitType  === "daily")                  showNotification(t("daily_limit_reached_tomorrow"), "error");
      else if (error.message)                                 showNotification(`${t("error")}: ${error.message}`, "error");
      else                                                    showNotification(t("something_went_wrong"), "error");
    },
  });

  // ─── AdsGram SDK ───────────────────────────────────────────────────────────
  const showAdsgramAd = (): Promise<{ success: boolean; unavailable: boolean }> =>
    new Promise((resolve) => {
      if (window.Adsgram) {
        window.Adsgram.init({ blockId: "34708" })
          .show()
          .then(() => resolve({ success: true,  unavailable: false }))
          .catch(() => resolve({ success: false, unavailable: false }));
      } else {
        resolve({ success: false, unavailable: true });
      }
    });

  // ─── Run ad for a specific card ────────────────────────────────────────────
  const runAdFlowForCard = async (cardId: number) => {
    if (isShowingAds) return;
    setIsShowingAds(true);
    sessionRewardedRef.current = false;

    const card = AD_CARDS.find(c => c.id === cardId)!;
    currentAdTypeRef.current = card.adType;

    const sessionId    = startSession();
    const sessionStart = Date.now();
    try {
      setCurrentAdStep("loading");

      // Register session server-side with its adType BEFORE showing the ad.
      // The server uses this to prevent clients from claiming a different provider's reward.
      const regRes = await apiRequest("POST", "/api/ads/register-session", {
        sessionId,
        adType: card.adType,
        context: "ads_watch",
      });
      if (!regRes.ok) {
        cancelSession();
        showNotification(t("something_went_wrong"), "error");
        return;
      }
      let result: { success: boolean; unavailable: boolean };

      if (card.adType === "adsgram") {
        result = await showAdsgramAd();
      } else if (card.adType === "monetag") {
        const r = await showMonetagAd();
        result  = { success: r.success, unavailable: r.unavailable };
      } else {
        result = await showGigaPubAd();
      }

      if (result.unavailable) { endSession(); cancelSession(); showNotification(t("no_ad_available"), "error"); return; }
      if (!result.success)    { endSession(); setFailureReason("instructions"); setShowFailurePopup(true); return; }

      // Only claim the reward once the user has genuinely come back to the
      // app in the foreground — firing the request while still minimized/
      // backgrounded undercounts backgroundDuration and confusingly claims
      // the reward before the user has actually "returned".
      setCurrentAdStep("verifying");
      await waitForForeground();
      const session = endSession();
      if (!sessionRewardedRef.current) {
        sessionRewardedRef.current = true;
        watchAdMutation.mutate({
          adType:             card.adType,
          sessionId:          session.sessionId,
          backgroundDuration: session.backgroundDuration,
          backgroundEntered:  session.backgroundEntered,
          sessionStart:       session.sessionStart,
        });
      }
    } catch {
      cancelSession();
      showNotification(t("something_went_wrong"), "error");
    } finally {
      setCurrentAdStep("idle");
      setIsShowingAds(false);
    }
  };

  const handleStartEarning = (cardId: number) => {
    const card      = AD_CARDS.find(c => c.id === cardId)!;
    const cardIndex = AD_CARDS.indexOf(card);
    if (isShowingAds || isCardLimitReached(card.adType)) return;
    if (cardIndex !== activeIndex) { setActiveIndex(cardIndex); return; }
    // Monetag and Gigapub go straight to the ad — no pre-ad instruction popup
    if (card.adType === 'monetag' || card.adType === 'gigapub') {
      runAdFlowForCard(cardId);
      return;
    }
    setPendingCardId(cardId);
    setPendingAdStart(true);
    setFailureReason("instructions");
    setShowFailurePopup(true);
  };

  const handlePopupClose = () => {
    setShowFailurePopup(false);
    if (pendingAdStart) { setPendingAdStart(false); runAdFlowForCard(pendingCardId); }
  };

  // ─── Per-card limit helpers ────────────────────────────────────────────────
  const getCardWatched = (adType: string): number => {
    if (adType === "adsgram") return user?.adsWatchedToday        || 0;
    if (adType === "monetag") return user?.monetagAdsWatchedToday || 0;
    if (adType === "gigapub") return user?.gigapubAdsWatchedToday || 0;
    return 0;
  };

  const getCardLimit = (adType: string): number => {
    if (adType === "adsgram") return appSettings?.adsgramAdLimit ?? appSettings?.dailyAdLimit ?? 510;
    if (adType === "monetag") return appSettings?.monetagAdLimit ?? 50;
    if (adType === "gigapub") return appSettings?.gigapubAdLimit ?? 50;
    return 50;
  };

  const getCardReward = (adType: string): number => {
    if (adType === "adsgram") return appSettings?.adsgramRewardPerAd ?? appSettings?.rewardPerAd ?? 125;
    if (adType === "monetag") return appSettings?.monetagRewardPerAd ?? 125;
    if (adType === "gigapub") return appSettings?.gigapubRewardPerAd ?? 125;
    return 125;
  };

  const isCardLimitReached = (adType: string) =>
    getCardWatched(adType) >= getCardLimit(adType);

  return (
    <>
      <div className="mb-4">
        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center mb-3"
          style={{ background: "#1a1a1a", borderRadius: 14, padding: "4px", gap: 2 }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 11,
                  fontSize: 13, fontWeight: isActive ? 700 : 500,
                  color: isActive ? "#fff" : "rgba(255,255,255,0.4)",
                  background: isActive ? "#2e2e2e" : "transparent",
                  border: "none", cursor: "pointer", whiteSpace: "nowrap",
                  boxShadow: isActive ? "0 1px 4px rgba(0,0,0,0.4)" : "none",
                  transition: "background 0.2s ease, color 0.2s ease",
                }}
              >{tab.label}</button>
            );
          })}
        </div>

        {/* ── Title ────────────────────────────────────────────────────────── */}
        <div className="mb-3 text-center">
          <h2 className="text-[15px] font-extrabold text-white tracking-widest uppercase mb-0.5">
            {t("viewing_ads")}
          </h2>
          <p className="text-[#666] text-xs">{t("get_paid_watching")}</p>
        </div>

        {/* ── Cards ────────────────────────────────────────────────────────── */}
        <div className="select-none" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {AD_CARDS.map((card, index) => {
            const watched      = getCardWatched(card.adType);
            const limit        = getCardLimit(card.adType);
            const reward       = getCardReward(card.adType);
            const limitReached = watched >= limit;
            const isActive     = index === activeIndex;
            const isLoading    = isShowingAds && isActive;

            return (
              <div key={card.id}
                style={{ width: "100%", borderRadius: 18, overflow: "hidden", background: "#1a1a1a", cursor: "pointer" }}
                onClick={() => {
                  if (index !== activeIndex) { setActiveIndex(index); return; }
                  handleStartEarning(card.id);
                }}
              >
                {/* ── Header: logo + brand name + Ad Limit counter ─────────── */}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  {/* Brand logo */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    overflow: "hidden", background: `${card.accentColor}18`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {card.image
                      ? <img src={card.image} alt={card.title}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span style={{ fontSize: 20 }}>📢</span>
                    }
                  </div>

                  {/* "Sponsored by" + brand name */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.3, marginBottom: 2 }}>
                      {t("sponsored_by")}
                    </p>
                    <p className="text-white font-bold" style={{ fontSize: 13, lineHeight: 1.2 }}>
                      {card.title}
                    </p>
                  </div>

                  {/* Ad Limit counter (moved into header) */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>
                      {t("ad_limit")}
                    </p>
                    <span style={{
                      fontSize: 13, fontWeight: 800,
                      color: limitReached ? "rgba(239,68,68,0.85)" : "rgba(255,255,255,0.75)",
                    }}>
                      {watched}
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", fontWeight: 500 }}>/{limit}</span>
                    </span>
                  </div>
                </div>

                {/* ── Body: Reward info (left) + Get POW button (right) ────── */}
                <div style={{ padding: "0 12px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Reward info */}
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>
                      {t("reward")}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#0a0a0a", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img src="/pow-icon.png?v=2" alt="POW" style={{ width: "90%", height: "90%", objectFit: "contain" }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#ffffff" }}>
                        {reward}
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, marginLeft: 3 }}>POW</span>
                      </span>
                    </div>
                  </div>

                  {/* Get POW button — replaces the old full-width button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (index !== activeIndex) { setActiveIndex(index); return; }
                      handleStartEarning(card.id);
                    }}
                    disabled={isShowingAds || limitReached}
                    data-testid="button-watch-ad"
                    style={{
                      padding: "9px 16px", borderRadius: 12, minWidth: 92,
                      fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                      letterSpacing: "0.02em", whiteSpace: "nowrap",
                      background: limitReached ? "rgba(255,255,255,0.06)" : "#3b82f6",
                      color:      limitReached ? "rgba(255,255,255,0.3)"  : "#fff",
                      opacity: isShowingAds && !isActive ? 0.5 : 1,
                      transition: "opacity 0.2s",
                    }}
                  >
                    {isLoading ? (
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                        {currentAdStep === "verifying"
                          ? <><FiShield size={11} style={{ animation: "pulse 1s infinite" }} />{t("verifying")}</>
                          : <><FiZap    size={11} style={{ animation: "spin 0.8s linear infinite" }} />{t("loading_ad")}</>
                        }
                      </span>
                    ) : limitReached ? t("limit_reached") : t("get_pow")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Per-card status summary ───────────────────────────────────────── */}
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
            {AD_CARDS.map(c =>
              `${c.title}: ${getCardWatched(c.adType)}/${getCardLimit(c.adType)}`
            ).join(" · ")}
          </p>
        </div>
      </div>

      {showFailurePopup && <AdFailurePopup onClose={handlePopupClose} reason={failureReason} />}
    </>
  );
}
