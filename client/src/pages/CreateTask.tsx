import { useAuth } from "@/hooks/useAuth";
import { useAdmin } from "@/hooks/useAdmin";
import Layout from "@/components/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle,
  FileText,
  Clock,
  TrendingUp,
  Trash2,
  Gamepad2,
  Users,
  Handshake,
  Sparkles,
  CheckCircle2,
  Info,
} from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

const TON_PER_CLICK = 0.001;
const MIN_CLICKS = 100;

interface Task {
  id: string;
  taskType: string;
  title: string;
  link: string;
  totalClicksRequired: number;
  currentClicks: number;
  costPerClick: string;
  totalCost: string;
  status: string;
  advertiserId: string;
  createdAt: string;
  completedAt?: string;
}

function VerifyInfoDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useQuery<{ username: string }>({
    queryKey: ["/api/bot-info"],
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const botUsername = data?.username || "PaidAdzbot";
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Channel Verification</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-3">
          <p className="text-sm font-semibold text-white">
            Verification is available for Telegram channels and chats.
          </p>
          <p className="text-sm text-white/70">
            Add{" "}
            <a
              href={`https://t.me/${botUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-bold"
            >
              @{botUsername}
            </a>{" "}
            as an admin to your channel, then press Verify.
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export default function CreateTask() {
  const { user, isLoading } = useAuth();
  const { isAdmin } = useAdmin();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"add-task" | "my-task">(() => {
    if (typeof window !== "undefined") {
      const tabParam = new URLSearchParams(window.location.search).get("tab");
      return tabParam === "my-task" ? "my-task" : "add-task";
    }
    return "add-task";
  });

  // "game" = Bot type, "social" = Channel type
  const [category, setCategory] = useState<"game" | "social" | "partner" | null>(null);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [executions, setExecutions] = useState(MIN_CLICKS.toString());
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [extraClicks, setExtraClicks] = useState(MIN_CLICKS.toString());
  const [isAddClicksOpen, setIsAddClicksOpen] = useState(false);

  // Channel verification (Social category)
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [showVerifyInfo, setShowVerifyInfo] = useState(false);

  const { data: appSettings } = useQuery<any>({
    queryKey: ["/api/app-settings"],
    retry: false,
  });

  const clicksNum = parseInt(executions) || 0;
  const totalCostTON = clicksNum * TON_PER_CLICK;
  const tonBalance = parseFloat((user as any)?.tonBalance || "0");
  const hasSufficientBalance = isAdmin || tonBalance >= totalCostTON;

  // Map UI category → backend taskType
  const backendType = category === "game" ? "bot" : category === "social" ? "channel" : category;

  const { data: myTasksData, isLoading: myTasksLoading } = useQuery<{
    success: boolean;
    tasks: Task[];
  }>({
    queryKey: ["/api/advertiser-tasks/my-tasks"],
    retry: false,
    refetchOnMount: true,
  });

  const handleVerifyChannel = async () => {
    if (!link.trim()) {
      showNotification("Please enter a channel link first", "error");
      return;
    }
    setIsVerifying(true);
    try {
      const response = await apiRequest("POST", "/api/advertiser-tasks/verify-channel", {
        channelLink: link,
      });
      const data = await response.json();
      if (data.success) {
        setIsVerified(true);
        showNotification("Channel verified!", "success");
      } else {
        showNotification(data.message || "Verification failed", "error");
      }
    } catch {
      showNotification("Failed to verify channel", "error");
    } finally {
      setIsVerifying(false);
    }
  };

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/advertiser-tasks/create", {
        taskType: backendType,
        title,
        link,
        totalClicksRequired: clicksNum,
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message);
      return data;
    },
    onSuccess: () => {
      showNotification("Task created successfully!", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks/my-tasks"] });
      setTitle("");
      setLink("");
      setExecutions(MIN_CLICKS.toString());
      setCategory(null);
      setIsVerified(false);
      setActiveTab("my-task");
    },
    onError: (error: Error) => {
      showNotification(error.message || "Failed to create task", "error");
    },
  });

  const increaseClicksMutation = useMutation({
    mutationFn: async ({ taskId, clicks }: { taskId: string; clicks: number }) => {
      const response = await apiRequest("POST", `/api/advertiser-tasks/${taskId}/increase-limit`, {
        additionalClicks: clicks,
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message);
      return data;
    },
    onSuccess: () => {
      showNotification("Clicks added!", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks/my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setIsAddClicksOpen(false);
      setSelectedTask(null);
    },
    onError: (error: Error) => {
      showNotification(error.message || "Failed to add clicks", "error");
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await apiRequest("DELETE", `/api/advertiser-tasks/${taskId}`);
      const data = await response.json();
      if (!data.success) throw new Error(data.message);
      return data;
    },
    onSuccess: () => {
      showNotification("Task deleted!", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks/my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setTaskToDelete(null);
    },
    onError: (error: Error) => {
      showNotification(error.message || "Failed to delete task", "error");
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

    if (!category) {
      showNotification("Please select a category", "error");
      return;
    }

    if (!title.trim()) {
      showNotification("Please enter a task title", "error");
      return;
    }

    const urlInTitle = /(https?:\/\/|t\.me\/|\.com|\.net|\.org|\.io|www\.)/i;
    if (urlInTitle.test(title)) {
      showNotification("Links not allowed in title", "error");
      return;
    }

    if (!link.trim()) {
      showNotification("Please enter a link", "error");
      return;
    }

    if (clicksNum < MIN_CLICKS) {
      showNotification(`Minimum ${MIN_CLICKS} executions required`, "error");
      return;
    }

    if (category === "social" && !isAdmin && !isVerified) {
      showNotification("Please verify your channel first", "error");
      return;
    }

    if (category !== "partner" && !isAdmin && !hasSufficientBalance) {
      showNotification(`Insufficient TON balance. Need ${totalCostTON.toFixed(3)} TON`, "error");
      return;
    }

    createTaskMutation.mutate();
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-white/40 text-sm">Loading...</div>
        </div>
      </Layout>
    );
  }

  const myTasks = myTasksData?.tasks || [];
  const activeTasks = myTasks.filter(
    (t) => t.status === "running" || t.status === "under_review" || t.status === "paused"
  );
  const doneTasks = myTasks.filter(
    (t) => t.status === "completed" || t.status === "rejected"
  );

  // Category button style helper
  const catStyle = (cat: string, color: string, activeColor: string) => ({
    active: category === cat,
    border: `1.5px solid ${category === cat ? activeColor : "rgba(255,255,255,0.08)"}`,
    background: category === cat
      ? `linear-gradient(135deg,${color}18,${color}0e)`
      : "rgba(255,255,255,0.04)",
    boxShadow: category === cat ? `0 0 14px ${color}22` : "none",
  });

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-28">

        {/* ── Tab Buttons (home withdraw/swap style) ── */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          {(["add-task", "my-task"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={activeTab === tab ? "btn-primary" : ""}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "12px 0",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                letterSpacing: "0.03em",
                background: activeTab === tab ? undefined : "rgba(255,255,255,0.06)",
                color: activeTab === tab ? undefined : "rgba(255,255,255,0.45)",
                border: "none",
                transition: "all 0.18s",
              }}
            >
              {tab === "add-task" ? "Add Task" : "My Task"}
            </button>
          ))}
        </div>

        {/* ── ADD TASK TAB ── */}
        {activeTab === "add-task" && (
          <form onSubmit={handleCreate} className="space-y-4">

            {/* Category — compact cards */}
            <div>
              <p className="text-xs text-white/40 font-semibold uppercase tracking-widest mb-2">
                Task Category
              </p>
              <div className={`grid gap-2.5 ${isAdmin ? "grid-cols-3" : "grid-cols-2"}`}>
                {/* Game */}
                {(() => {
                  const s = catStyle("game", "#00d2ff", "#00d2ff");
                  return (
                    <button
                      type="button"
                      onClick={() => setCategory("game")}
                      style={{
                        padding: "10px 8px",
                        borderRadius: 12,
                        border: s.border,
                        background: s.background,
                        boxShadow: s.boxShadow,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 5,
                        cursor: "pointer",
                        transition: "all 0.18s",
                      }}
                    >
                      <Gamepad2
                        className="w-5 h-5"
                        style={{ color: s.active ? "#00d2ff" : "rgba(255,255,255,0.35)" }}
                      />
                      <span
                        className="text-xs font-bold"
                        style={{ color: s.active ? "#00d2ff" : "rgba(255,255,255,0.45)" }}
                      >
                        Game
                      </span>
                    </button>
                  );
                })()}

                {/* Social */}
                {(() => {
                  const s = catStyle("social", "#a78bfa", "#a78bfa");
                  return (
                    <button
                      type="button"
                      onClick={() => { setCategory("social"); setIsVerified(false); }}
                      style={{
                        padding: "10px 8px",
                        borderRadius: 12,
                        border: s.border,
                        background: s.background,
                        boxShadow: s.boxShadow,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 5,
                        cursor: "pointer",
                        transition: "all 0.18s",
                      }}
                    >
                      <Users
                        className="w-5 h-5"
                        style={{ color: s.active ? "#a78bfa" : "rgba(255,255,255,0.35)" }}
                      />
                      <span
                        className="text-xs font-bold"
                        style={{ color: s.active ? "#a78bfa" : "rgba(255,255,255,0.45)" }}
                      >
                        Social
                      </span>
                    </button>
                  );
                })()}

                {/* Partner (admin only) */}
                {isAdmin && (() => {
                  const s = catStyle("partner", "#34d399", "#34d399");
                  return (
                    <button
                      type="button"
                      onClick={() => setCategory("partner")}
                      style={{
                        padding: "10px 8px",
                        borderRadius: 12,
                        border: s.border,
                        background: s.background,
                        boxShadow: s.boxShadow,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 5,
                        cursor: "pointer",
                        transition: "all 0.18s",
                      }}
                    >
                      <Handshake
                        className="w-5 h-5"
                        style={{ color: s.active ? "#34d399" : "rgba(255,255,255,0.35)" }}
                      />
                      <span
                        className="text-xs font-bold"
                        style={{ color: s.active ? "#34d399" : "rgba(255,255,255,0.45)" }}
                      >
                        Partner
                      </span>
                    </button>
                  );
                })()}
              </div>
            </div>

            {/* Title */}
            <div>
              <p className="text-xs text-white/40 font-semibold uppercase tracking-widest mb-2">
                Title
              </p>
              <input
                type="text"
                placeholder={
                  category === "game"
                    ? "e.g. Play our new game and earn rewards"
                    : category === "social"
                    ? "e.g. Join our Telegram channel"
                    : "Task title..."
                }
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  width: "100%",
                  padding: "13px 16px",
                  borderRadius: 12,
                  border: "1.5px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#fff",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>

            {/* Link */}
            <div>
              <p className="text-xs text-white/40 font-semibold uppercase tracking-widest mb-2">
                Link
              </p>
              <input
                type="url"
                placeholder={
                  category === "game"
                    ? "https://t.me/YourBot?start=..."
                    : category === "social"
                    ? "https://t.me/YourChannel"
                    : "https://..."
                }
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  if (category === "social") setIsVerified(false);
                }}
                style={{
                  width: "100%",
                  padding: "13px 16px",
                  borderRadius: 12,
                  border: "1.5px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#fff",
                  fontSize: 14,
                  outline: "none",
                }}
              />

              {/* Channel verification row (Social only) */}
              {category === "social" && (
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={handleVerifyChannel}
                    disabled={isVerifying || !link.trim()}
                    style={{
                      flex: 1,
                      padding: "9px 0",
                      borderRadius: 10,
                      border: `1.5px solid ${isVerified ? "#4ade80" : link.trim() ? "#a78bfa" : "rgba(255,255,255,0.12)"}`,
                      background: isVerified
                        ? "rgba(74,222,128,0.1)"
                        : link.trim()
                        ? "rgba(167,139,250,0.1)"
                        : "rgba(255,255,255,0.04)",
                      color: isVerified ? "#4ade80" : link.trim() ? "#a78bfa" : "rgba(255,255,255,0.3)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: isVerifying || !link.trim() ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      transition: "all 0.18s",
                    }}
                  >
                    {isVerifying ? (
                      "Verifying..."
                    ) : isVerified ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" /> Verified
                      </>
                    ) : (
                      "Verify Channel"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowVerifyInfo(true)}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      border: "1.5px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.04)",
                      color: "rgba(255,255,255,0.35)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Number of executions + inline cost */}
            <div>
              <p className="text-xs text-white/40 font-semibold uppercase tracking-widest mb-2">
                Number of Executions
              </p>
              <div className="relative">
                <input
                  type="number"
                  min={MIN_CLICKS}
                  step="100"
                  placeholder={`Min ${MIN_CLICKS}`}
                  value={executions}
                  onChange={(e) => setExecutions(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "13px 16px",
                    paddingRight: "110px",
                    borderRadius: 12,
                    border: "1.5px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.05)",
                    color: "#fff",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
                {/* Cost badge inside input */}
                {!isAdmin && category !== "partner" && clicksNum >= MIN_CLICKS && (
                  <span
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: hasSufficientBalance ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)",
                      color: hasSufficientBalance ? "#4ade80" : "#f87171",
                      borderRadius: 7,
                      padding: "3px 8px",
                      fontSize: 12,
                      fontWeight: 700,
                      pointerEvents: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {totalCostTON.toFixed(3)} TON
                  </span>
                )}
                {isAdmin && clicksNum >= MIN_CLICKS && (
                  <span
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "rgba(74,222,128,0.15)",
                      color: "#4ade80",
                      borderRadius: 7,
                      padding: "3px 8px",
                      fontSize: 12,
                      fontWeight: 700,
                      pointerEvents: "none",
                    }}
                  >
                    Free
                  </span>
                )}
              </div>
              <p className="text-xs text-white/25 mt-1.5 ml-1">
                Min {MIN_CLICKS} clicks · 0.001 TON per click
                {!isAdmin && tonBalance > 0 && (
                  <> · Balance: <span style={{ color: hasSufficientBalance ? "#4ade80" : "#f87171" }}>{tonBalance.toFixed(3)} TON</span></>
                )}
              </p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="btn-primary w-full active:scale-[0.98] transition-transform"
              style={{
                padding: "14px 0",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.03em",
                opacity: createTaskMutation.isPending ? 0.7 : 1,
                marginTop: 4,
              }}
              disabled={createTaskMutation.isPending}
            >
              {createTaskMutation.isPending
                ? "Publishing..."
                : category === "partner"
                ? "Publish Partner Task"
                : isAdmin
                ? "Publish Task (Free)"
                : `Pay ${totalCostTON.toFixed(3)} TON & Publish`}
            </button>
          </form>
        )}

        {/* ── MY TASK TAB ── */}
        {activeTab === "my-task" && (
          <div className="space-y-4">
            {myTasksLoading ? (
              <div className="text-center py-12 text-white/40 text-sm">Loading tasks...</div>
            ) : myTasks.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 mx-auto mb-3 text-white/20" />
                <p className="text-white/40 mb-5 text-sm">No tasks yet</p>
                <button
                  className="btn-primary active:scale-95 transition-transform"
                  style={{ padding: "10px 24px", borderRadius: 10, fontSize: 13, fontWeight: 700 }}
                  onClick={() => setActiveTab("add-task")}
                >
                  <Sparkles className="w-4 h-4 inline mr-1.5" />
                  Create First Task
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {activeTasks.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs text-white/40 font-semibold uppercase tracking-widest flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5" />
                      Active ({activeTasks.length})
                    </p>
                    {activeTasks.map((task) => {
                      const pct = Math.min(100, (task.currentClicks / task.totalClicksRequired) * 100);
                      const remaining = task.totalClicksRequired - task.currentClicks;
                      const isGame = task.taskType === "bot";
                      return (
                        <div
                          key={task.id}
                          style={{
                            borderRadius: 14,
                            border: "1.5px solid rgba(255,255,255,0.07)",
                            background: "rgba(255,255,255,0.04)",
                            padding: "14px 16px",
                          }}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {isGame ? (
                                <Gamepad2 className="w-4 h-4 text-cyan-400" />
                              ) : (
                                <Users className="w-4 h-4 text-violet-400" />
                              )}
                              <span
                                className="text-xs font-bold uppercase tracking-wider"
                                style={{ color: isGame ? "#00d2ff" : "#a78bfa" }}
                              >
                                {isGame ? "Game" : task.taskType === "channel" ? "Social" : task.taskType}
                              </span>
                              <span
                                className="text-xs px-1.5 py-0.5 rounded-full font-semibold"
                                style={{
                                  background:
                                    task.status === "running"
                                      ? "rgba(74,222,128,0.12)"
                                      : task.status === "under_review"
                                      ? "rgba(251,191,36,0.12)"
                                      : "rgba(251,146,60,0.12)",
                                  color:
                                    task.status === "running"
                                      ? "#4ade80"
                                      : task.status === "under_review"
                                      ? "#fbbf24"
                                      : "#fb923c",
                                }}
                              >
                                {task.status === "running"
                                  ? "Running"
                                  : task.status === "under_review"
                                  ? "Pending"
                                  : "Paused"}
                              </span>
                            </div>
                            <button
                              onClick={() => setTaskToDelete(task)}
                              style={{
                                background: "rgba(239,68,68,0.1)",
                                border: "none",
                                borderRadius: 8,
                                padding: "5px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-400" />
                            </button>
                          </div>

                          <p className="text-sm font-bold text-white mb-2 leading-snug">{task.title}</p>

                          <div
                            style={{
                              height: 6,
                              borderRadius: 99,
                              background: "rgba(255,255,255,0.08)",
                              marginBottom: 6,
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                borderRadius: 99,
                                width: `${pct}%`,
                                background: isGame
                                  ? "linear-gradient(90deg,#00d2ff,#0066ff)"
                                  : "linear-gradient(90deg,#a78bfa,#6d28d9)",
                                transition: "width 0.4s",
                              }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-white/35 mb-3">
                            <span>{task.currentClicks} / {task.totalClicksRequired} clicks</span>
                            <span>{remaining} remaining</span>
                          </div>

                          <button
                            onClick={() => {
                              setSelectedTask(task);
                              setExtraClicks(MIN_CLICKS.toString());
                              setIsAddClicksOpen(true);
                            }}
                            style={{
                              width: "100%",
                              padding: "8px 0",
                              borderRadius: 9,
                              border: "1.5px solid rgba(255,255,255,0.1)",
                              background: "rgba(255,255,255,0.04)",
                              color: "rgba(255,255,255,0.55)",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                            }}
                          >
                            <TrendingUp className="w-3.5 h-3.5" />
                            Add More Clicks
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {doneTasks.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs text-white/40 font-semibold uppercase tracking-widest flex items-center gap-2 mt-4">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Completed ({doneTasks.length})
                    </p>
                    {doneTasks.map((task) => {
                      const isGame = task.taskType === "bot";
                      return (
                        <div
                          key={task.id}
                          style={{
                            borderRadius: 14,
                            border: "1.5px solid rgba(255,255,255,0.05)",
                            background: "rgba(255,255,255,0.02)",
                            padding: "12px 16px",
                            opacity: 0.65,
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            {isGame ? (
                              <Gamepad2 className="w-3.5 h-3.5 text-white/30" />
                            ) : (
                              <Users className="w-3.5 h-3.5 text-white/30" />
                            )}
                            <span className="text-xs text-white/35 uppercase font-bold">
                              {isGame ? "Game" : task.taskType === "channel" ? "Social" : task.taskType}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-white/70">{task.title}</p>
                          <p className="text-xs text-white/30 mt-0.5">
                            {task.totalClicksRequired} clicks
                          </p>
                          <p
                            className="text-xs font-bold mt-1"
                            style={{ color: task.status === "rejected" ? "#f87171" : "#4ade80" }}
                          >
                            {task.status === "rejected" ? "✗ Rejected" : "✓ Completed"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Verify info drawer */}
      <VerifyInfoDrawer open={showVerifyInfo} onClose={() => setShowVerifyInfo(false)} />

      {/* Delete confirm */}
      <AlertDialog open={!!taskToDelete} onOpenChange={(o) => !o && setTaskToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove "{taskToDelete?.title}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => taskToDelete && deleteTaskMutation.mutate(taskToDelete.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add clicks */}
      <AlertDialog open={isAddClicksOpen} onOpenChange={(o) => !o && setIsAddClicksOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add More Clicks</AlertDialogTitle>
            <AlertDialogDescription>
              Cost:{" "}
              <span className="text-white font-bold">
                {((parseInt(extraClicks) || 0) * TON_PER_CLICK).toFixed(3)} TON
              </span>{" "}
              for {parseInt(extraClicks) || 0} clicks
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2">
            <input
              type="number"
              min={MIN_CLICKS}
              step="100"
              placeholder={`Min ${MIN_CLICKS}`}
              value={extraClicks}
              onChange={(e) => setExtraClicks(e.target.value)}
              style={{
                width: "100%",
                padding: "11px 14px",
                borderRadius: 10,
                border: "1.5px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                fontSize: 14,
                outline: "none",
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const clicks = parseInt(extraClicks);
                if (clicks < MIN_CLICKS) {
                  showNotification(`Min ${MIN_CLICKS} clicks`, "error");
                  return;
                }
                if (!isAdmin && tonBalance < clicks * TON_PER_CLICK) {
                  showNotification("Insufficient TON balance", "error");
                  return;
                }
                selectedTask &&
                  increaseClicksMutation.mutate({ taskId: selectedTask.id, clicks });
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
