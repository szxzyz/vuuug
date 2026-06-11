import { useAuth } from "@/hooks/useAuth";
import { useAdmin } from "@/hooks/useAdmin";
import Layout from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  CheckCircle, 
  FileText, 
  Clock, 
  TrendingUp, 
  Send, 
  Bot as BotIcon, 
  ArrowLeft, 
  Trash2,
  Info,
  CheckCircle2,
  Handshake,
  Sparkles
} from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import TopUpSheet from "@/components/TopUpSheet";
import { Plus } from "lucide-react";

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

export default function CreateTask() {
  const { user, isLoading } = useAuth();
  const { isAdmin } = useAdmin();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  
  const [activeTab, setActiveTab] = useState<"add-task" | "my-task">(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      return tabParam === "my-task" ? "my-task" : "add-task";
    }
    return "add-task";
  });
  const [taskType, setTaskType] = useState<"channel" | "bot" | "partner" | null>(null);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [totalClicks, setTotalClicks] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [additionalClicks, setAdditionalClicks] = useState("");
  const [isAddClicksDialogOpen, setIsAddClicksDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [showVerifyInfo, setShowVerifyInfo] = useState(false);

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    retry: false,
  });

  // Set default totalClicks and additionalClicks from admin settings
  useEffect(() => {
    if (appSettings?.minimumClicks && !totalClicks) {
      setTotalClicks(appSettings.minimumClicks.toString());
    }
    if (appSettings?.minimumClicks && !additionalClicks) {
      setAdditionalClicks(appSettings.minimumClicks.toString());
    }
  }, [appSettings]);

  // Prevent auto-scroll when task type changes
  useEffect(() => {
    if (taskType) {
      // Prevent any scroll behavior
      const scrollContainer = document.querySelector('.overflow-y-auto');
      if (scrollContainer) {
        const currentScroll = scrollContainer.scrollTop;
        scrollContainer.scrollTop = currentScroll;
        
        // Force scroll position to stay at current position
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = currentScroll;
        });
      }
    }
  }, [taskType]);

  // Use task-type-specific costs and rewards from admin settings
  const costPerClick = taskType === 'partner' 
    ? 0 
    : taskType === 'bot' 
      ? (appSettings?.botTaskCostUSD || 0.003) 
      : (appSettings?.channelTaskCostUSD || 0.003);
  const rewardPerClickPAD = taskType === 'partner'
    ? 5
    : taskType === 'bot'
      ? (appSettings?.botTaskRewardPAD || 20)
      : (appSettings?.channelTaskRewardPAD || 30);
  const minimumClicks = taskType === 'partner' ? 1 : (appSettings?.minimumClicks || 500);
  
  const clicksNum = parseInt(totalClicks) || 0;
  const totalCostUSD = costPerClick * clicksNum;
  const totalRewardsPAD = rewardPerClickPAD * clicksNum;
  const usdBalance = parseFloat((user as any)?.usdBalance || "0");
  const tonBalance = parseFloat((user as any)?.tonBalance || "0");
  const additionalCostUSD = costPerClick * (parseInt(additionalClicks) || 0);
  
  // Determine payment method based on user type
  // Admin uses USD, Regular users use TON
  const paymentCurrency = isAdmin ? "USD" : "TON";
  // TON cost per click from admin settings (separate for channel and bot)
  const tonCostPerClick = taskType === 'bot' 
    ? (appSettings?.botTaskCostTON || 0.0003)
    : (appSettings?.channelTaskCostTON || 0.0003);
  const totalCostTON = tonCostPerClick * clicksNum;
  const totalCost = isAdmin ? totalCostUSD : totalCostTON;
  const availableBalance = isAdmin ? usdBalance : tonBalance;
  const hasSufficientBalance = availableBalance >= totalCost;

  const { data: myTasksData, isLoading: myTasksLoading, refetch: refetchMyTasks } = useQuery<{
    success: boolean;
    tasks: Task[];
  }>({
    queryKey: ["/api/advertiser-tasks/my-tasks"],
    retry: false,
    refetchOnMount: true,
  });

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/advertiser-tasks/create", {
        taskType,
        title,
        link,
        totalClicksRequired: clicksNum,
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message);
      }
      return data;
    },
    onSuccess: async (data) => {
      showNotification("Task created successfully", "success");
      
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks/my-tasks"] });
      
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/advertiser-tasks/my-tasks"] }),
        queryClient.refetchQueries({ queryKey: ["/api/auth/user"] })
      ]);
      
      setTitle("");
      setLink("");
      setTotalClicks(appSettings?.minimumClicks?.toString() || "500");
      setTaskType("channel");
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
        additionalClicks: clicks
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message);
      }
      return data;
    },
    onSuccess: () => {
      showNotification("Clicks added successfully!", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks/my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setIsAddClicksDialogOpen(false);
      setSelectedTask(null);
      setAdditionalClicks(appSettings?.minimumClicks?.toString() || "500");
    },
    onError: (error: Error) => {
      showNotification(error.message || "Failed to add clicks", "error");
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await apiRequest("DELETE", `/api/advertiser-tasks/${taskId}`);
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message);
      }
      return data;
    },
    onSuccess: () => {
      showNotification("Task deleted successfully!", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks/my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setTaskToDelete(null);
    },
    onError: (error: Error) => {
      showNotification(error.message || "Failed to delete task", "error");
    },
  });

  const handleVerifyChannel = async () => {
    if (!link.trim()) {
      showNotification("Please enter a channel link first", "error");
      return;
    }

    setIsVerifying(true);
    try {
      const response = await apiRequest("POST", "/api/advertiser-tasks/verify-channel", {
        channelLink: link
      });
      const data = await response.json();
      
      if (data.success) {
        setIsVerified(true);
        showNotification("Channel verified successfully!", "success");
      } else {
        showNotification(data.message || "Verification failed", "error");
      }
    } catch (error) {
      showNotification("Failed to verify channel", "error");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();

    if (!taskType) {
      showNotification("Please select a task type", "error");
      return;
    }

    if (taskType === "partner" && !isAdmin) {
      showNotification("Only admins can create partner tasks", "error");
      return;
    }

    if (!title.trim()) {
      showNotification("Please enter a task title", "error");
      return;
    }

    const urlPattern = /(https?:\/\/|t\.me\/|\.com|\.net|\.org|\.io|www\.)/i;
    if (urlPattern.test(title)) {
      showNotification("Links are not allowed in task title", "error");
      return;
    }

    if (!link.trim()) {
      showNotification("Please enter a valid link", "error");
      return;
    }

    if (taskType !== "partner" && !link.startsWith("http") && !link.startsWith("t.me")) {
      showNotification("Please enter a valid Telegram link", "error");
      return;
    }

    if (clicksNum < minimumClicks) {
      showNotification(`Minimum clicks required: ${minimumClicks}`, "error");
      return;
    }

    if (taskType !== "partner" && !hasSufficientBalance) {
      showNotification(`Insufficient ${paymentCurrency} balance`, "error");
      return;
    }

    if (taskType === "channel" && !isVerified) {
      showNotification("Please verify your channel first", "error");
      return;
    }

    createTaskMutation.mutate();
  };

  const handleIncreaseClicks = () => {
    if (!selectedTask) return;

    const clicks = parseInt(additionalClicks);
    if (clicks < minimumClicks) {
      showNotification(`Minimum clicks required: ${minimumClicks}`, "error");
      return;
    }

    const additionalCostTON = tonCostPerClick * (parseInt(additionalClicks) || 0);
    const additionalCost = isAdmin ? additionalCostUSD : additionalCostTON;
    const balance = isAdmin ? usdBalance : tonBalance;
    const currency = isAdmin ? "USD" : "TON";

    if (balance < additionalCost) {
      showNotification(`Insufficient ${currency} balance`, "error");
      return;
    }

    increaseClicksMutation.mutate({ taskId: selectedTask.id, clicks });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin text-primary text-3xl mb-4">
              <i className="fas fa-spinner"></i>
            </div>
            <div className="text-foreground font-medium">Loading...</div>
          </div>
        </div>
      </Layout>
    );
  }

  const myTasks = myTasksData?.tasks || [];
  const activeMyTasks = myTasks.filter(t => t.status === "running" || t.status === "under_review" || t.status === "paused");
  const completedMyTasks = myTasks.filter(t => t.status === "completed" || t.status === "rejected");

  return (
    <Layout>
      <main ref={mainRef} className="max-w-md mx-auto px-4 pt-4 pb-24">
        {!isAdmin && (
          <div className="flex items-center justify-between mb-4 p-3 bg-gradient-to-r from-[#1A1A1A] to-[#0D1117] rounded-xl border border-[#2A2A2A] shadow-lg">
            <div className="flex items-center gap-2">
              <img src="/images/ton.png" alt="TON" className="w-5 h-5 object-cover rounded-full" />
              <span className="text-sm font-semibold text-white">{tonBalance.toFixed(4)} TON</span>
            </div>
            <TopUpSheet 
              trigger={
                <button className="flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-[#4cd3ff] to-[#007BFF] hover:from-[#6ddeff] hover:to-[#1a8cff] text-white text-xs font-semibold rounded-lg transition-all shadow-md">
                  <Plus className="w-3.5 h-3.5" />
                  Top Up
                </button>
              }
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-6">
          <Button
            type="button"
            variant="outline"
            className={`h-auto py-3 transition-all font-bold text-sm ${
              activeTab === "add-task" 
                ? "bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border-cyan-500 text-cyan-300 shadow-lg shadow-cyan-500/20" 
                : "hover:bg-cyan-500/10 hover:border-cyan-500/50 text-muted-foreground"
            }`}
            onClick={() => setActiveTab("add-task")}
          >
            Add Task
          </Button>
          <Button
            type="button"
            variant="outline"
            className={`h-auto py-3 transition-all font-bold text-sm ${
              activeTab === "my-task" 
                ? "bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border-blue-500 text-blue-300 shadow-lg shadow-blue-500/20" 
                : "hover:bg-blue-500/10 hover:border-blue-500/50 text-muted-foreground"
            }`}
            onClick={() => setActiveTab("my-task")}
          >
            My Task
          </Button>
        </div>

        {activeTab === "add-task" ? (
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium mb-2 block text-muted-foreground">Select Type:</Label>
              <div className={`grid gap-2 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <button
                  type="button"
                  className={`flex items-center justify-center p-2.5 rounded-lg border transition-all ${
                    taskType === "channel" 
                      ? "bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border-blue-500 shadow-lg shadow-blue-500/20" 
                      : "bg-[#1A1A1A] border-[#2A2A2A] hover:border-blue-500/50"
                  }`}
                  onClick={() => {
                    setTaskType("channel");
                    setIsVerified(false);
                  }}
                >
                  <Send className={`w-4 h-4 ${taskType === "channel" ? "text-blue-400" : "text-gray-400"}`} />
                </button>
                <button
                  type="button"
                  className={`flex items-center justify-center p-2.5 rounded-lg border transition-all ${
                    taskType === "bot" 
                      ? "bg-gradient-to-br from-purple-500/20 to-pink-500/20 border-purple-500 shadow-lg shadow-purple-500/20" 
                      : "bg-[#1A1A1A] border-[#2A2A2A] hover:border-purple-500/50"
                  }`}
                  onClick={() => setTaskType("bot")}
                >
                  <BotIcon className={`w-4 h-4 ${taskType === "bot" ? "text-purple-400" : "text-gray-400"}`} />
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    className={`flex items-center justify-center p-2.5 rounded-lg border transition-all ${
                      taskType === "partner" 
                        ? "bg-gradient-to-br from-green-500/20 to-emerald-500/20 border-green-500 shadow-lg shadow-green-500/20" 
                        : "bg-[#1A1A1A] border-[#2A2A2A] hover:border-green-500/50"
                    }`}
                    onClick={() => setTaskType("partner")}
                  >
                    <Handshake className={`w-4 h-4 ${taskType === "partner" ? "text-green-400" : "text-gray-400"}`} />
                  </button>
                )}
              </div>
            </div>

            {taskType && (
              <form onSubmit={handleCreateTask} className="space-y-4">
                <div>
                  <Label htmlFor="title">Task Title</Label>
                  <Input
                    id="title"
                    placeholder="Short description"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="link">
                    {taskType === "partner" ? "Task Link (Any URL)" : taskType === "channel" ? "Telegram Channel Link" : "Bot Link"}
                  </Label>
                  <Input
                    id="link"
                    type="text"
                    placeholder={taskType === "partner" ? "https://example.com/..." : taskType === "channel" ? "https://t.me/yourchannel" : "https://t.me/yourbot"}
                    value={link}
                    onChange={(e) => {
                      setLink(e.target.value);
                      setIsVerified(false);
                    }}
                    className="mt-1"
                  />
                  {taskType === "partner" && (
                    <p className="text-xs text-green-400 mt-1">Partner tasks: 5 PAD reward, any link type allowed</p>
                  )}
                </div>

                {taskType === "channel" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleVerifyChannel}
                        disabled={isVerifying || !link.trim()}
                        className={`flex-1 ${
                          isVerified 
                            ? 'border-green-500 bg-green-500/10 text-green-500' 
                            : link.trim() && (link.startsWith('http') || link.includes('t.me/'))
                            ? 'border-blue-500 bg-blue-500/10 text-blue-500'
                            : ''
                        }`}
                      >
                        {isVerifying ? (
                          <>
                            <div className="animate-spin mr-2">⏳</div>
                            Verifying...
                          </>
                        ) : isVerified ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            Verified
                          </>
                        ) : (
                          "Verify Channel"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowVerifyInfo(true)}
                        className="text-muted-foreground hover:text-white"
                      >
                        <Info className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                <div>
                  <Label htmlFor="clicks">Total Clicks Required</Label>
                  <Input
                    id="clicks"
                    type="number"
                    min={minimumClicks}
                    step="100"
                    placeholder={minimumClicks.toString()}
                    value={totalClicks}
                    onChange={(e) => setTotalClicks(e.target.value)}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum {minimumClicks} clicks
                  </p>
                </div>


                <Button
                  type="submit"
                  className="w-full btn-primary"
                  disabled={createTaskMutation.isPending || (taskType !== "partner" && !hasSufficientBalance) || (taskType === "channel" && !isVerified)}
                >
                  {createTaskMutation.isPending 
                    ? "Publishing..." 
                    : taskType === "partner" 
                      ? "Publish Partner Task" 
                      : `Pay ${totalCost.toFixed(4)} ${paymentCurrency} & Publish`}
                </Button>
              </form>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {myTasksLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin text-primary text-2xl mb-2">
                  <i className="fas fa-spinner"></i>
                </div>
                <p className="text-muted-foreground">Loading your tasks...</p>
              </div>
            ) : myTasks.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">No tasks created yet</p>
                <Button
                  className="btn-primary"
                  onClick={() => setActiveTab("add-task")}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Create Your First Task
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {activeMyTasks.length > 0 && (
                  <>
                    <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Active Tasks ({activeMyTasks.length})
                    </h2>
                    <div className="space-y-3">
                      {activeMyTasks.map((task) => {
                        const progress = (task.currentClicks / task.totalClicksRequired) * 100;
                        const remaining = task.totalClicksRequired - task.currentClicks;

                        return (
                          <Card key={task.id} className="minimal-card">
                            <CardContent className="pt-3 pb-3">
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  {task.taskType === "channel" ? (
                                    <Send className="w-4 h-4 text-primary" />
                                  ) : (
                                    <BotIcon className="w-4 h-4 text-primary" />
                                  )}
                                  <span className="text-xs text-muted-foreground uppercase">
                                    {task.taskType}
                                  </span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                  onClick={() => setTaskToDelete(task)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                              <h3 className="font-semibold text-white text-sm mb-1">{task.title}</h3>
                              <p className="text-xs text-muted-foreground mb-2">
                                {task.currentClicks} / {task.totalClicksRequired} clicks • {remaining} remaining
                              </p>

                              <div className="mb-2">
                                <div className="w-full bg-secondary rounded-full h-2">
                                  <div
                                    className="bg-primary h-2 rounded-full transition-all"
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                  <span>{progress.toFixed(1)}% complete</span>
                                  <span className={
                                    task.status === "running" ? "text-green-400" :
                                    task.status === "under_review" ? "text-yellow-400" :
                                    task.status === "paused" ? "text-orange-400" :
                                    "text-muted-foreground"
                                  }>
                                    {task.status === "running" ? "Running" : 
                                     task.status === "under_review" ? "Pending Review" :
                                     task.status === "paused" ? "Paused" :
                                     task.status}
                                  </span>
                                </div>
                              </div>

                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-8"
                                onClick={() => {
                                  setSelectedTask(task);
                                  setIsAddClicksDialogOpen(true);
                                }}
                              >
                                <TrendingUp className="w-3 h-3 mr-2" />
                                Add More Clicks (min +500)
                              </Button>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </>
                )}

                {completedMyTasks.length > 0 && (
                  <>
                    <h2 className="text-sm font-semibold text-white flex items-center gap-2 mt-6">
                      <CheckCircle className="w-4 h-4" />
                      Completed Tasks ({completedMyTasks.length})
                    </h2>
                    <div className="space-y-3">
                      {completedMyTasks.map((task) => (
                        <Card key={task.id} className="minimal-card opacity-60">
                          <CardContent className="pt-3 pb-3">
                            <div className="flex items-center gap-2 mb-1">
                              {task.taskType === "channel" ? (
                                <Send className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <BotIcon className="w-4 h-4 text-muted-foreground" />
                              )}
                              <span className="text-xs text-muted-foreground uppercase">
                                {task.taskType}
                              </span>
                            </div>
                            <h3 className="font-semibold text-white text-sm">{task.title}</h3>
                            <p className="text-xs text-muted-foreground">
                              {task.totalClicksRequired} clicks completed
                            </p>
                            <p className={`text-xs mt-1 ${task.status === "rejected" ? "text-red-500" : "text-green-500"}`}>
                              {task.status === "rejected" ? "✗ Rejected" : "✓ Completed"}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Add More Clicks Bottom Sheet */}
        <Drawer open={isAddClicksDialogOpen} onOpenChange={setIsAddClicksDialogOpen}>
          <DrawerContent className="frosted-glass border border-white/10">
            <DrawerHeader className="text-left">
              <DrawerTitle className="text-lg font-bold text-white">Add More Clicks</DrawerTitle>
            </DrawerHeader>
            {selectedTask && (
              <div className="space-y-4 px-4 pb-2">
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Task: <span className="text-white font-semibold">{selectedTask.title}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Current: {selectedTask.currentClicks} / {selectedTask.totalClicksRequired} clicks
                  </p>
                </div>

                <div>
                  <Label htmlFor="additional-clicks">Additional Clicks</Label>
                  <Input
                    id="additional-clicks"
                    type="number"
                    min={minimumClicks}
                    step="100"
                    value={additionalClicks}
                    onChange={(e) => setAdditionalClicks(e.target.value)}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum {minimumClicks} clicks
                  </p>
                </div>
              </div>
            )}
            <DrawerFooter className="pt-2">
              <Button
                className="w-full btn-primary"
                onClick={handleIncreaseClicks}
                disabled={increaseClicksMutation.isPending || (isAdmin ? usdBalance < additionalCostUSD : tonBalance < (tonCostPerClick * (parseInt(additionalClicks) || 0)))}
              >
                {increaseClicksMutation.isPending ? "Processing..." : `Pay & Add`}
              </Button>
              <DrawerClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSelectedTask(null);
                    setAdditionalClicks(appSettings?.minimumClicks?.toString() || "500");
                  }}
                >
                  Cancel
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
          <AlertDialogContent className="frosted-glass border border-white/10">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Task</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{taskToDelete?.title}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => taskToDelete && deleteTaskMutation.mutate(taskToDelete.id)}
                className="bg-red-500 hover:bg-red-600"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Verification Info Drawer - slides up from bottom */}
        <Drawer open={showVerifyInfo} onOpenChange={setShowVerifyInfo}>
          <DrawerContent className="frosted-glass border border-white/10">
            <DrawerHeader className="text-left">
              <DrawerTitle className="text-lg font-bold text-white">Channel Verification</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-2 space-y-3">
              <p className="text-sm font-semibold text-white">
                Subscription verification is available for Telegram channels and chats.
              </p>
              <p className="text-sm font-semibold text-white">
                In order for verification to work, <a href="https://t.me/PaidAdzbot" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-bold">add our bot to your group/channel.</a>
              </p>
            </div>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button variant="outline" className="w-full">Got it</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </main>
    </Layout>
  );
}
