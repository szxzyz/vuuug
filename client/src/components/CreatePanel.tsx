import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X, Loader2, AlertTriangle, ClipboardList,
  CheckCircle2, ShieldCheck, ShieldOff, Plus, ChevronLeft,
  Type, LayoutGrid, ArrowUpRight, Trash2, Pause, Play,
  Radio, Rocket,
} from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { useLocation } from "wouter";
import TopUpPopup from "@/components/TopUpPopup";
import { useLanguage } from "@/hooks/useLanguage";

// ─── Pricing ───────────────────────────────────────────────────
const PACKAGES = [
  { clicks: 100,   price: 0.1500, verified: 0.2000 },
  { clicks: 500,   price: 0.7500, verified: 1.0000 },
  { clicks: 1000,  price: 1.5000, verified: 2.0000 },
  { clicks: 2000,  price: 3.0000, verified: 4.0000 },
  { clicks: 5000,  price: 7.5000, verified: 10.000 },
  { clicks: 10000, price: 15.000, verified: 20.000 },
];

type Flow       = "advertise" | "giveaway" | null;
type Category   = "channel" | "bot";
type VerifyType = "verification" | "without";
interface Props { open: boolean; onClose: () => void; onFlowChange?: (flow: Flow) => void; }
interface MyTask {
  id: string;
  title: string;
  taskType: string;
  status: string;
  currentClicks: number;
  totalClicksRequired: number;
}

const BOT_NAME = "@Paid_Adzbot";

// spring preset — very fast, no bounce (pill stack)
const SPRING = { type: "spring" as const, stiffness: 500, damping: 42, mass: 0.9 };

// native iOS-style sheet easing (matches vaul's drawer feel used elsewhere in the app)
const SHEET_TRANSITION = { type: "tween" as const, duration: 0.28, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] };

const BLUE = "#4cd3ff";
const BLUE_HOVER = "#6ddeff";

export default function CreatePanel({ open, onClose, onFlowChange }: Props) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { t } = useLanguage();

  // ── state
  const [flow,         setFlow]         = useState<Flow>(null);
  const [category,     setCategory]     = useState<Category>("channel");
  const [verifyType,   setVerifyType]   = useState<VerifyType>("verification");
  const [taskName,     setTaskName]     = useState("");
  const [channelLink,  setChannelLink]  = useState("");
  const [botUser,      setBotUser]      = useState("");
  const [botStart,     setBotStart]     = useState("");
  const [selectedPkg,  setSelectedPkg]  = useState<number | null>(null);
  const [chState,      setChState]      = useState<"idle" | "checking" | "ok" | "err">("idle");
  const [chError,      setChError]      = useState("");
  const [advTab,       setAdvTab]       = useState<"add" | "mine">("add");
  const [topUpOpen,    setTopUpOpen]    = useState(false);
  const [addClicksTaskId, setAddClicksTaskId] = useState<string | null>(null);
  const [addClicksValue,  setAddClicksValue]  = useState("500");

  const { data: authUser } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });
  const tonBalance   = parseFloat(authUser?.tonBalance || "0");
  const tonFormatted = tonBalance >= 1000 ? (tonBalance / 1000).toFixed(1) + "k" : tonBalance.toFixed(2);

  const isVerif     = verifyType === "verification";
  const pkgData     = PACKAGES.find(p => p.clicks === selectedPkg);
  const cost        = pkgData ? (isVerif ? pkgData.verified : pkgData.price).toFixed(4) : null;
  const chVerified  = chState === "ok";

  // Notify parent whenever flow changes so Layout.tsx can swap the + button icon
  const setFlowWithNotify = useCallback((f: Flow) => {
    setFlow(f);
    onFlowChange?.(f);
  }, [onFlowChange]);

  const reset = useCallback(() => {
    setFlowWithNotify(null); setCategory("channel"); setVerifyType("verification");
    setTaskName(""); setChannelLink(""); setBotUser(""); setBotStart("");
    setSelectedPkg(null); setChState("idle"); setChError("");
    setAdvTab("add"); setTopUpOpen(false); setAddClicksTaskId(null); setAddClicksValue("500");
  }, [setFlowWithNotify]);

  const handleClose = useCallback(() => {
    onClose(); setTimeout(reset, 400);
  }, [onClose, reset]);

  const resetCh = () => { setChState("idle"); setChError(""); };

  const verifyChannel = async () => {
    const url = channelLink.trim();
    if (!url) return;
    setChState("checking"); setChError("");
    try {
      const res  = await fetch("/api/advertiser-tasks/verify-channel", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelLink: url }),
      });
      const data = await res.json();
      if (data.success) setChState("ok");
      else { setChState("err"); setChError(data.message || t("bot_not_admin_error")); }
    } catch { setChState("err"); setChError(t("network_error_retry")); }
  };

  const { data: myTasksData, isLoading: isLoadingMyTasks } = useQuery<{ success: boolean; tasks: MyTask[] }>({
    queryKey: ["/api/advertiser-tasks/my-tasks"],
    enabled: flow === "advertise" && advTab === "mine",
  });
  const myTasks = myTasksData?.tasks || [];

  const invalidateMyTasks = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks/my-tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks"] });
  };

  const deleteMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await fetch(`/api/advertiser-tasks/${taskId}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to delete");
      return data;
    },
    onSuccess: () => { showNotification(t("mission_deleted_msg"), "success"); invalidateMyTasks(); },
    onError: (e: Error) => showNotification(e.message, "error"),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ taskId, action }: { taskId: string; action: "pause" | "resume" }) => {
      const res = await fetch(`/api/advertiser-tasks/${taskId}/${action}`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: (_d, vars) => { showNotification(vars.action === "pause" ? t("mission_paused_msg") : t("mission_resumed_msg"), "success"); invalidateMyTasks(); },
    onError: (e: Error) => showNotification(e.message, "error"),
  });

  const addClicksMutation = useMutation({
    mutationFn: async ({ taskId, additionalClicks }: { taskId: string; additionalClicks: number }) => {
      const res = await fetch(`/api/advertiser-tasks/${taskId}/increase-limit`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalClicks }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to add clicks");
      return data;
    },
    onSuccess: () => {
      showNotification("Clicks added!", "success");
      invalidateMyTasks();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setAddClicksTaskId(null); setAddClicksValue("500");
    },
    onError: (e: Error) => showNotification(e.message, "error"),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const link = category === "channel"
        ? channelLink.trim()
        : isVerif
          ? botStart.trim()
          : `https://t.me/${botUser.replace(/^@/, "").trim()}`;
      const res = await fetch("/api/advertiser-tasks/create", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: category, title: taskName.trim(), link,
          totalClicksRequired: selectedPkg,
          verificationRequired: isVerif,
          channelVerified: category === "channel" ? chVerified : false,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: () => {
      showNotification(t("mission_created_msg"), "success");
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks/my-tasks"] });
      handleClose();
    },
    onError: (e: Error) => showNotification(e.message, "error"),
  });

  const botStartInvalidForVerif = category === "bot" && isVerif && botStart.trim().length > 0 && !botStart.includes("t.me");

  const canSubmit = (() => {
    if (!taskName.trim() || !selectedPkg || createMutation.isPending) return false;
    if (category === "channel") {
      if (!channelLink.trim() || !channelLink.includes("t.me/")) return false;
      if (isVerif && !chVerified) return false;
    } else {
      if (isVerif && (!botStart.trim() || !botStart.includes("t.me"))) return false;
      if (!isVerif && !botUser.trim()) return false;
    }
    return true;
  })();

  const pills = [
    { id: "advertise" as Flow, label: t("advertise_label"),  icon: Radio,  nav: undefined },
    { id: null        as Flow, label: t("ambassador_label"), icon: Rocket, nav: "/ambassador" },
  ];

  return (
    <>
      {/* ── dim backdrop for pill menu ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-[49]"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* ── pill stack ── */}
      <AnimatePresence>
        {open && flow === null && (
          <div className="fixed z-[65]"
            style={{ bottom: 92, right: 16, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            {pills.map(({ id, label, icon: Icon, nav }, i) => (
              <motion.button key={label}
                initial={{ opacity: 0, x: 14, scale: 0.88 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 10, scale: 0.9 }}
                transition={{ delay: i * 0.03, ...SPRING }}
                whileTap={{ scale: 0.88 }}
                onClick={() => { if (nav) { onClose(); navigate(nav); } else setFlowWithNotify(id); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 10, height: 48,
                  background: "rgba(28,28,30,0.9)", backdropFilter: "blur(16px)",
                  WebkitBackdropFilter: "blur(16px)", border: "none",
                  borderRadius: 24, padding: "0 18px 0 14px", cursor: "pointer",
                  boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
                }}
              >
                <Icon style={{ width: 32, height: 32, color: "#6E6E73", strokeWidth: 2 }} />
                <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
              </motion.button>
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* ── full-screen page sheet ── */}
      <AnimatePresence>
        {flow !== null && (
          <>
            {/* sheet dim */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[68]"
              style={{ background: "rgba(0,0,0,0.65)" }}
              onClick={handleClose}
            />

            {/* page */}
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={SHEET_TRANSITION}
              className="fixed inset-x-0 bottom-0 z-[69]"
              style={{
                /* full viewport height → true page feel */
                height: "100dvh",
                background: "#000",
                borderRadius: "22px 22px 0 0",
                display: "flex",
                flexDirection: "column",
                /* GPU layer — eliminates jank */
                willChange: "transform",
                contain: "layout style",
              }}
              onClick={e => e.stopPropagation()}
            >

              {/* ════ HEADER ════ */}
              {flow === "advertise" ? (
                <div style={{
                  flexShrink: 0,
                  background: "#000",
                  paddingTop: "env(safe-area-inset-top, 6px)",
                }}>
                  <div style={{ padding: "10px 16px 12px" }}>
                    <div className="w-full h-12 rounded-2xl flex items-center p-1" style={{ background: "rgba(255,255,255,0.12)" }}>
                      <button
                        onClick={() => setAdvTab("add")}
                        className="flex-1 h-full rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
                        style={{
                          background: advTab === "add" ? "rgba(255,255,255,0.14)" : "transparent",
                          border: "none", cursor: "pointer",
                        }}
                      >
                        <Plus className="w-4 h-4" style={{ color: advTab === "add" ? "#fff" : "rgba(255,255,255,0.5)" }} />
                        <span className="font-semibold text-sm" style={{ color: advTab === "add" ? "#fff" : "rgba(255,255,255,0.5)" }}>{t("add_missions")}</span>
                      </button>
                      <button
                        onClick={() => setAdvTab("mine")}
                        className="flex-1 h-full rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
                        style={{
                          background: advTab === "mine" ? "rgba(255,255,255,0.14)" : "transparent",
                          border: "none", cursor: "pointer",
                        }}
                      >
                        <ClipboardList className="w-4 h-4" style={{ color: advTab === "mine" ? "#fff" : "rgba(255,255,255,0.5)" }} />
                        <span className="font-semibold text-sm" style={{ color: advTab === "mine" ? "#fff" : "rgba(255,255,255,0.5)" }}>{t("my_missions_label")}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{
                  flexShrink: 0,
                  background: "#000",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  paddingTop: "env(safe-area-inset-top, 6px)",
                }}>
                  {/* drag handle */}
                  <div style={{ display: "flex", justifyContent: "center", paddingTop: 8, paddingBottom: 4 }}>
                    <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)" }} />
                  </div>

                  {/* title row */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "6px 16px 12px" }}>
                    <p style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>{t("giveaway_label")}</p>
                    <button onClick={handleClose} style={closeBtnStyle}>
                      <X style={{ width: 15, height: 15, color: "rgba(255,255,255,0.55)" }} />
                    </button>
                  </div>
                </div>
              )}

              {/* ════ SCROLLABLE BODY ════ */}
              <div style={{
                flex: 1, overflowY: "auto", overflowX: "hidden",
                WebkitOverflowScrolling: "touch",
                padding: "14px 16px 8px",
              }}>

                {/* ── Giveaway coming soon ── */}
                {flow === "giveaway" && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 80 }}>
                    <span style={{ fontSize: 48 }}>🎁</span>
                    <p style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>{t("coming_soon_label")}</p>
                    <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 14, textAlign: "center" }}>
                      {t("giveaway_coming_soon_text")}
                    </p>
                  </div>
                )}

                {/* ── My Missions list ── */}
                {flow === "advertise" && advTab === "mine" && (
                  <MyMissionsList
                    tasks={myTasks}
                    isLoading={isLoadingMyTasks}
                    onDelete={id => { if (window.confirm(t("delete_mission_confirm"))) deleteMutation.mutate(id); }}
                    onToggleStatus={(id, action) => toggleStatusMutation.mutate({ taskId: id, action })}
                    addClicksTaskId={addClicksTaskId}
                    setAddClicksTaskId={setAddClicksTaskId}
                    addClicksValue={addClicksValue}
                    setAddClicksValue={setAddClicksValue}
                    onConfirmAddClicks={id => {
                      const n = parseInt(addClicksValue, 10);
                      if (!n || n <= 0) { showNotification("Enter a valid number of clicks", "error"); return; }
                      addClicksMutation.mutate({ taskId: id, additionalClicks: n });
                    }}
                    isAddingClicks={addClicksMutation.isPending}
                  />
                )}

                {/* ── Advertise form ── */}
                {flow === "advertise" && advTab === "add" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

                    {/* TASK NAME */}
                    <Field label={t("task_name_label")} icon={<Type size={13} />}>
                      <input
                        type="text"
                        placeholder={category === "channel" ? "e.g. Join PaidAdz Channel" : "e.g. Start My Earning Bot"}
                        value={taskName}
                        onChange={e => setTaskName(e.target.value)}
                        style={INPUT}
                      />
                    </Field>

                    {/* CATEGORY */}
                    <Field label={t("category_label")} icon={<LayoutGrid size={13} />}>
                      <PillToggle
                        options={[
                          { id: "channel", label: t("channel_group") },
                          { id: "bot",     label: t("website_bot_label") },
                        ]}
                        value={category}
                        onChange={v => {
                          setCategory(v as Category);
                          setChannelLink(""); setBotUser(""); setBotStart(""); resetCh();
                        }}
                      />
                    </Field>

                    {/* TYPE */}
                    <Field label={t("verification_type_label")} icon={<ShieldCheck size={13} />}>
                      <PillToggle
                        options={[
                          { id: "verification", label: t("with_verification"),    icon: <ShieldCheck size={12} /> },
                          { id: "without",      label: t("without_verification"), icon: <ShieldOff   size={12} /> },
                        ]}
                        value={verifyType}
                        onChange={v => { setVerifyType(v as VerifyType); resetCh(); }}
                      />
                      <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11.5, marginTop: 8, lineHeight: 1.6, paddingLeft: 2 }}>
                        {typeHint(category, isVerif, t)}
                      </p>
                    </Field>

                    {/* ── CHANNEL fields ── */}
                    {category === "channel" && (
                      <Field label={t("channel_link_label")}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            type="text"
                            placeholder="https://t.me/YourChannel"
                            value={channelLink}
                            onChange={e => { setChannelLink(e.target.value); resetCh(); }}
                            style={{ ...INPUT, flex: 1 }}
                          />
                          {isVerif && (
                            <button
                              onClick={verifyChannel}
                              disabled={chState === "checking" || chVerified || !channelLink.trim()}
                              className="transition-colors"
                              style={verifyBtnStyle(chState, !!channelLink.trim())}
                            >
                              {chState === "checking"
                                ? <Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} />
                                : chState === "ok"
                                  ? <><CheckCircle2 size={13} /> Done</>
                                  : "Verify"}
                            </button>
                          )}
                        </div>

                        {/* warning / success / error */}
                        <AnimatePresence>
                          {isVerif && chState !== "ok" && (
                            <motion.div
                              key="warn"
                              initial={{ opacity: 0, y: -4, height: 0 }}
                              animate={{ opacity: 1, y: 0, height: "auto" }}
                              exit={{ opacity: 0, y: -4, height: 0 }}
                              transition={{ duration: 0.15 }}
                              style={{ overflow: "hidden" }}
                            >
                              <div style={warningBox}>
                                <AlertTriangle size={13} style={{ color: "#eab308", flexShrink: 0, marginTop: 1 }} />
                                <p style={{ color: "rgba(253,230,138,0.8)", fontSize: 12, lineHeight: 1.6 }}>
                                  {chState === "err" && chError
                                    ? chError
                                    : <>Add <strong style={{ color: "#fbbf24" }}>{BOT_NAME}</strong> as <strong>Admin</strong> in your channel, then tap <strong>Verify</strong>.</>
                                  }
                                </p>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                      </Field>
                    )}

                    {/* ── BOT fields ── */}
                    {category === "bot" && (
                      <Field label={isVerif ? t("referral_start_link") : t("bot_username_label")}>
                        {isVerif ? (
                          <>
                            <input
                              type="text"
                              placeholder="https://t.me/YourBot?start=REF_CODE"
                              value={botStart}
                              onChange={e => setBotStart(e.target.value)}
                              style={{ ...INPUT, ...(botStartInvalidForVerif ? { borderColor: "rgba(248,113,113,0.5)" } : {}) }}
                            />
                            {botStartInvalidForVerif ? (
                              <p style={{ color: "#f87171", fontSize: 11.5, marginTop: 6, lineHeight: 1.6, display: "flex", alignItems: "flex-start", gap: 5 }}>
                                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                                Verification is only supported for Telegram (t.me) links. Please disable verification for external websites.
                              </p>
                            ) : (
                              <p style={{ color: "rgba(255,255,255,0.22)", fontSize: 11.5, marginTop: 6, lineHeight: 1.6 }}>
                                Users must start via your referral link — verified before reward is granted.
                              </p>
                            )}
                          </>
                        ) : (
                          <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", fontSize: 15, pointerEvents: "none" }}>@</span>
                            <input
                              type="text"
                              placeholder="yourbotname"
                              value={botUser}
                              onChange={e => setBotUser(e.target.value)}
                              style={{ ...INPUT, paddingLeft: 28 }}
                            />
                          </div>
                        )}
                      </Field>
                    )}

                    {/* COMPLETIONS */}
                    <Field label={t("number_of_completions")}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {PACKAGES.map(pkg => {
                          const sel   = selectedPkg === pkg.clicks;
                          const price = isVerif ? pkg.verified : pkg.price;
                          return (
                            <button
                              key={pkg.clicks}
                              onClick={() => setSelectedPkg(pkg.clicks)}
                              style={{
                                padding: "12px 4px", borderRadius: 12, border: "none",
                                background: sel ? "rgba(76,211,255,0.14)" : "#1a1a1a",
                                outline: `1.5px solid ${sel ? "rgba(76,211,255,0.6)" : "transparent"}`,
                                cursor: "pointer", textAlign: "center",
                                transition: "background 120ms, outline-color 120ms",
                              }}
                            >
                              <p style={{ color: sel ? BLUE : "#fff", fontWeight: 700, fontSize: 15, lineHeight: 1 }}>
                                {pkg.clicks >= 1000 ? `${pkg.clicks / 1000}K` : pkg.clicks}
                              </p>
                              <p style={{ color: sel ? "rgba(76,211,255,0.7)" : "rgba(255,255,255,0.28)", fontSize: 10.5, marginTop: 4, fontWeight: 500 }}>
                                {price.toFixed(4)} TON
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </Field>

                  </div>
                )}
              </div>

              {/* ════ BOTTOM NAV — matches exact floating nav style from Layout.tsx ════ */}
              {flow === "advertise" && (
                <div style={{
                  flexShrink: 0,
                  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
                  paddingLeft: 16, paddingRight: 16, paddingTop: 10,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 12,
                  background: "transparent",
                }}>
                  {/* Nav pill: TON balance | [Pay] — identical to main app nav */}
                  <nav style={{
                    display: "flex", alignItems: "center",
                    height: 64, borderRadius: 40,
                    background: "rgba(28,28,30,0.9)",
                    backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                    overflow: "hidden",
                  }}>
                    {/* TON balance + top-up */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px 0 18px" }}>
                      <img src="/images/ton.png" alt="TON" style={{ width: 20, height: 20, objectFit: "cover", borderRadius: "50%", flexShrink: 0 }} />
                      <span style={{ color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: "0.01em", whiteSpace: "nowrap" }}>{tonFormatted}</span>
                      <motion.button
                        onClick={() => setTopUpOpen(true)}
                        whileTap={{ scale: 0.82 }}
                        transition={{ type: "spring", stiffness: 400, damping: 17 }}
                        style={{
                          width: 28, height: 28, borderRadius: "50%",
                          background: "rgba(255,255,255,0.10)", border: "none",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", flexShrink: 0,
                        }}
                      >
                        <Plus style={{ width: 13, height: 13, color: "#fff" }} />
                      </motion.button>
                    </div>

                    {/* Divider + Pay — only on Add Missions tab */}
                    {advTab === "add" && (
                      <>
                        <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.10)", flexShrink: 0 }} />
                        <motion.button
                          onClick={() => canSubmit && createMutation.mutate()}
                          disabled={!canSubmit}
                          whileTap={{ scale: canSubmit ? 0.94 : 1 }}
                          transition={{ type: "spring", stiffness: 400, damping: 17 }}
                          style={{
                            height: "100%", padding: "0 22px", border: "none",
                            background: canSubmit ? BLUE : "transparent",
                            color: canSubmit ? "#000" : "rgba(255,255,255,0.25)",
                            fontSize: 14, fontWeight: 700, letterSpacing: "0.01em",
                            whiteSpace: "nowrap", cursor: canSubmit ? "pointer" : "not-allowed",
                            display: "flex", alignItems: "center", gap: 7,
                            transition: "background 150ms, color 150ms",
                          }}
                        >
                          {createMutation.isPending
                            ? <><Loader2 size={14} style={{ animation: "spin 0.8s linear infinite" }} /> {t("creating_ellipsis")}</>
                            : <>Pay {cost ? `${cost} TON` : "—"}</>
                          }
                        </motion.button>
                      </>
                    )}
                  </nav>

                  {/* Back button — same size, position, and style as the + button in Layout.tsx */}
                  <motion.button
                    onClick={handleClose}
                    whileTap={{ scale: 0.88 }}
                    transition={{ type: "spring", stiffness: 380, damping: 22 }}
                    aria-label="Back"
                    style={{
                      width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
                      background: "rgba(28,28,30,0.9)",
                      backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                      border: "none",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer",
                    }}
                  >
                    <ChevronLeft style={{ width: 22, height: 22, color: "rgba(255,255,255,0.85)", strokeWidth: 2.2 }} />
                  </motion.button>
                </div>
              )}

              <TopUpPopup open={topUpOpen} onOpenChange={setTopUpOpen} />

            </motion.div>
          </>
        )}
      </AnimatePresence>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}

function MissionStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const map: Record<string, { label: string; color: string; bg: string }> = {
    running:      { label: t("status_running"),       color: "#4ade80", bg: "rgba(34,197,94,0.14)" },
    under_review: { label: t("status_under_review"),  color: "#facc15", bg: "rgba(234,179,8,0.14)" },
    paused:       { label: t("status_paused"),        color: "#fb923c", bg: "rgba(251,146,60,0.14)" },
    completed:    { label: t("status_completed"),     color: "#4ade80", bg: "rgba(34,197,94,0.14)" },
    rejected:     { label: t("status_rejected"),      color: "#f87171", bg: "rgba(248,113,113,0.14)" },
  };
  const s = map[status] || { label: status, color: "rgba(255,255,255,0.5)", bg: "rgba(255,255,255,0.08)" };
  return (
    <span style={{
      flexShrink: 0, padding: "4px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700,
      color: s.color, background: s.bg,
    }}>
      {s.label}
    </span>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 9 }}>
        {icon && (
          <div style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "rgba(255,255,255,0.45)" }}>
            {icon}
          </div>
        )}
        <p style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </p>
      </div>
      {children}
    </div>
  );
}

function MyMissionsList({
  tasks, isLoading, onDelete, onToggleStatus,
  addClicksTaskId, setAddClicksTaskId, addClicksValue, setAddClicksValue,
  onConfirmAddClicks, isAddingClicks,
}: {
  tasks: MyTask[];
  isLoading: boolean;
  onDelete: (id: string) => void;
  onToggleStatus: (id: string, action: "pause" | "resume") => void;
  addClicksTaskId: string | null;
  setAddClicksTaskId: (id: string | null) => void;
  addClicksValue: string;
  setAddClicksValue: (v: string) => void;
  onConfirmAddClicks: (id: string) => void;
  isAddingClicks: boolean;
}) {
  const { t } = useLanguage();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-white/30" style={{ animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <ClipboardList className="w-10 h-10 text-white/20" />
        <p className="text-white/40 text-sm">{t("no_missions_yet")}</p>
        <p className="text-white/25 text-xs">{t("create_from_add_tab")}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {tasks.map((task: any) => {
        const pct = task.totalClicksRequired > 0
          ? Math.min(100, Math.round((task.currentClicks / task.totalClicksRequired) * 100))
          : 0;
        const canToggle = task.status === "running" || task.status === "paused";
        const addingHere = addClicksTaskId === task.id;

        return (
          <div key={task.id} style={{ background: "#111", borderRadius: 14, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
              <p style={{ color: "#fff", fontSize: 14, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {task.title}
              </p>
              <MissionStatusBadge status={task.status} />
            </div>

            <a href={task.link} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, color: "rgba(76,211,255,0.7)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.link}</span>
              <ArrowUpRight size={12} style={{ flexShrink: 0 }} />
            </a>

            {/* progress bar */}
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, borderRadius: 3, background: BLUE, transition: "width 200ms" }} />
              </div>
              <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 5 }}>
                {task.currentClicks} / {task.totalClicksRequired} {t("completions_label")} ({pct}%)
              </p>
            </div>

            {/* actions */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              {canToggle && (
                <button
                  onClick={() => onToggleStatus(task.id, task.status === "running" ? "pause" : "resume")}
                  className="active:scale-95 transition-transform"
                  style={miniActionBtnStyle}
                >
                  {task.status === "running" ? <Pause size={12} /> : <Play size={12} />}
                  {task.status === "running" ? t("pause_label") : t("resume_label")}
                </button>
              )}
              <button
                onClick={() => { setAddClicksTaskId(addingHere ? null : task.id); setAddClicksValue("500"); }}
                className="active:scale-95 transition-transform"
                style={miniActionBtnStyle}
              >
                <Plus size={12} /> {t("add_clicks_label")}
              </button>
              <button
                onClick={() => onDelete(task.id)}
                className="active:scale-95 transition-transform"
                style={{ ...miniActionBtnStyle, background: "rgba(248,113,113,0.12)", color: "#f87171", marginLeft: "auto" }}
              >
                <Trash2 size={12} />
              </button>
            </div>

            <AnimatePresence>
              {addingHere && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ overflow: "hidden" }}
                >
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <input
                      type="number"
                      min={1}
                      value={addClicksValue}
                      onChange={e => setAddClicksValue(e.target.value)}
                      style={{ ...INPUT, flex: 1, padding: "9px 12px" }}
                      placeholder={t("additional_clicks_placeholder")}
                    />
                    <button
                      onClick={() => onConfirmAddClicks(task.id)}
                      disabled={isAddingClicks}
                      style={{
                        flexShrink: 0, height: 40, padding: "0 16px", borderRadius: 10, border: "none",
                        background: BLUE, color: "#000", fontSize: 12.5, fontWeight: 700,
                        cursor: isAddingClicks ? "default" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      }}
                    >
                      {isAddingClicks ? <Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} /> : t("confirm_label")}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function PillToggle({ options, value, onChange }: {
  options: { id: string; label: string; icon?: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", background: "#1a1a1a", borderRadius: 12, padding: 3, gap: 3 }}>
      {options.map(opt => {
        const sel = value === opt.id;
        return (
          <button key={opt.id} onClick={() => onChange(opt.id)}
            style={{
              flex: 1, padding: "9px 6px", borderRadius: 10, border: "none",
              background: sel ? "rgba(255,255,255,0.11)" : "transparent",
              color: sel ? "#fff" : "rgba(255,255,255,0.32)",
              fontSize: 12.5, fontWeight: sel ? 600 : 400,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              transition: "background 100ms, color 100ms",
            }}>
            {opt.icon}{opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Styles / helpers ──────────────────────────────────────────

const INPUT: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "#1a1a1a", border: "1px solid #2a2a2a",
  borderRadius: 12, padding: "13px 14px",
  color: "#fff", fontSize: 14, outline: "none", fontFamily: "inherit",
};

const closeBtnStyle: React.CSSProperties = {
  width: 30, height: 30, borderRadius: "50%", flexShrink: 0, marginTop: 2,
  background: "rgba(255,255,255,0.08)", border: "none",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

// matches the app's main bottom nav scale (Layout.tsx) for the CreatePanel's own footer icons
const navCircleBtnStyle: React.CSSProperties = {
  width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
  background: "rgba(255,255,255,0.10)", border: "none",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

const miniActionBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5,
  height: 30, padding: "0 10px", borderRadius: 8, border: "none",
  background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.75)",
  fontSize: 11.5, fontWeight: 600, cursor: "pointer",
};

const warningBox: React.CSSProperties = {
  marginTop: 8, background: "rgba(234,179,8,0.07)",
  border: "1px solid rgba(234,179,8,0.22)", borderRadius: 10,
  padding: "9px 11px", display: "flex", gap: 8, alignItems: "flex-start",
};

function verifyBtnStyle(state: "idle" | "checking" | "ok" | "err", hasLink: boolean): React.CSSProperties {
  const ok = state === "ok";
  return {
    flexShrink: 0, height: 46, padding: "0 14px", borderRadius: 12, border: "none",
    background: ok ? "rgba(34,197,94,0.14)" : hasLink ? BLUE : "rgba(76,211,255,0.14)",
    color: ok ? "#4ade80" : hasLink ? "#000" : BLUE,
    fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
    display: "flex", alignItems: "center", gap: 5,
    cursor: state === "checking" || ok ? "default" : "pointer",
    transition: "background 150ms, color 150ms",
  };
}

function typeHint(cat: Category, verif: boolean, t: (key: string) => string): string {
  if (cat === "channel") {
    return verif ? t("channel_verified_hint") : t("channel_instant_hint");
  }
  return verif ? t("bot_verified_hint") : t("bot_instant_hint");
}

