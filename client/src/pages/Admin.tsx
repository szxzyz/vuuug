import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdmin } from "@/hooks/useAdmin";
import Layout from "@/components/Layout";
import { Link } from "wouter";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatCurrency } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Crown } from "lucide-react";

function formatLargeNumber(num: number): string {
  if (isNaN(num) || !isFinite(num)) {
    return '0';
  }
  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (absNum >= 1000000000000) {
    return sign + (absNum / 1000000000000).toFixed(1) + 'T';
  }
  if (absNum >= 1000000000) {
    return sign + (absNum / 1000000000).toFixed(1) + 'B';
  }
  if (absNum >= 1000000) {
    return sign + (absNum / 1000000).toFixed(1) + 'M';
  }
  if (absNum >= 1000) {
    return sign + (absNum / 1000).toFixed(1) + 'K';
  }
  return sign + Math.round(absNum).toLocaleString();
}

interface AdminStats {
  totalUsers: number;
  totalEarnings: string;
  totalWithdrawals: string;
  tonWithdrawn: string;
  pendingWithdrawals: number;
  successfulWithdrawals: number;
  rejectedWithdrawals: number;
  dailyActiveUsers: number;
  totalAdsWatched: number;
  todayAdsWatched: number;
  activePromos: number;
}

// Clean Minimal Stat Card Component
function StatCard({ icon, label, value, iconColor }: {
  icon: string;
  label: string;
  value: string;
  iconColor: string;
}) {
  return (
    <div className="bg-[#121212] border border-white/10 rounded-xl p-4 hover:border-[#4cd3ff]/40 transition-all">
      <div className={`w-9 h-9 rounded-lg bg-[#1a1a1a] flex items-center justify-center mb-3`}>
        <i className={`fas fa-${icon} ${iconColor}`}></i>
      </div>
      <p className="text-xs uppercase text-gray-500 tracking-wide mb-1">{label}</p>
      <p className="text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

export default function AdminPage() {
  const { toast } = useToast();
  const { isAdmin, isLoading: adminLoading } = useAdmin();
  const queryClient = useQueryClient();

  // Fetch admin stats
  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    refetchInterval: 30000,
    enabled: isAdmin,
  });

  // Fetch all users for management table
  const { data: usersData } = useQuery({
    queryKey: ["/api/admin/users"],
    queryFn: () => apiRequest("GET", "/api/admin/users").then(res => res.json()),
    refetchInterval: 30000,
    enabled: isAdmin,
  });

  // Fetch processed withdrawals
  const { data: payoutLogsData } = useQuery({
    queryKey: ["/api/admin/withdrawals/processed"],
    queryFn: () => apiRequest("GET", "/api/admin/withdrawals/processed").then(res => res.json()),
    refetchInterval: 30000,
    enabled: isAdmin,
  });

  if (adminLoading) {
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

  if (!isAdmin) {
    return (
      <Layout>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="text-red-500 text-5xl mb-4">
              <i className="fas fa-exclamation-triangle"></i>
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Access Denied</h1>
            <p className="text-muted-foreground mb-4">You don't have permission to access this page.</p>
            <Link href="/">
              <Button>Return Home</Button>
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <main className="max-w-7xl mx-auto px-4 pb-20 pt-3">
        {/* Slim Header */}
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Crown className="w-5 h-5 text-orange-600" />
            Admin Dashboard
          </h1>
          <Button 
            size="sm"
            variant="outline"
            onClick={() => {
              queryClient.invalidateQueries();
              toast({ title: "Refreshed" });
            }}
            className="h-8 px-3 text-xs"
          >
            <i className="fas fa-sync-alt"></i>
          </Button>
        </div>

        {/* Tabs Navigation - Move to Top */}
        <Tabs defaultValue="summary" className="w-full">
          <TabsList className="grid grid-cols-7 w-full mb-3">
            <TabsTrigger value="summary" className="text-xs">
              Summary
            </TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs">
              Tasks
            </TabsTrigger>
            <TabsTrigger value="users" className="text-xs">
              Users
            </TabsTrigger>
            <TabsTrigger value="promos" className="text-xs">
              Promos
            </TabsTrigger>
            <TabsTrigger value="payouts" className="text-xs">
              Payouts
            </TabsTrigger>
            <TabsTrigger value="bans" className="text-xs">
              Bans
            </TabsTrigger>
            <TabsTrigger value="settings" className="text-xs">
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Summary Tab - Clean Minimal Design */}
          <TabsContent value="summary" className="mt-0 space-y-4">
            {statsLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="bg-[#121212] h-28 rounded-xl animate-pulse border border-white/5" />
                ))}
              </div>
            ) : (
              <>
                {/* Clean Stat Cards Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard 
                    icon="users" 
                    label="Total Users" 
                    value={stats?.totalUsers?.toLocaleString() || '0'} 
                    iconColor="text-[#4cd3ff]"
                  />
                  <StatCard 
                    icon="user-check" 
                    label="Active Today" 
                    value={stats?.dailyActiveUsers?.toLocaleString() || '0'} 
                    iconColor="text-emerald-400"
                  />
                  <StatCard 
                    icon="play-circle" 
                    label="Total Ads" 
                    value={stats?.totalAdsWatched?.toLocaleString() || '0'} 
                    iconColor="text-purple-400"
                  />
                  <StatCard 
                    icon="bolt" 
                    label="Ads Today" 
                    value={stats?.todayAdsWatched?.toLocaleString() || '0'} 
                    iconColor="text-amber-400"
                  />
                  <StatCard 
                    icon="gem" 
                    label="PAD Earned" 
                    value={formatLargeNumber(parseFloat(stats?.totalEarnings || '0'))} 
                    iconColor="text-[#4cd3ff]"
                  />
                  <StatCard 
                    icon="dollar-sign" 
                    label="Withdrawn" 
                    value={'$' + parseFloat(stats?.totalWithdrawals || '0').toFixed(2)} 
                    iconColor="text-green-400"
                  />
                </div>

                {/* Withdrawal Status - Clean Card */}
                <div className="bg-[#121212] border border-white/10 rounded-xl p-4">
                  <p className="text-sm font-medium text-white mb-4">Withdrawal Requests</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center p-3 rounded-lg bg-[#1a1a1a]">
                      <p className="text-2xl font-bold text-amber-400">{stats?.pendingWithdrawals || 0}</p>
                      <p className="text-xs text-gray-500 mt-1">Pending</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-[#1a1a1a]">
                      <p className="text-2xl font-bold text-emerald-400">{stats?.successfulWithdrawals || 0}</p>
                      <p className="text-xs text-gray-500 mt-1">Approved</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-[#1a1a1a]">
                      <p className="text-2xl font-bold text-rose-400">{stats?.rejectedWithdrawals || 0}</p>
                      <p className="text-xs text-gray-500 mt-1">Rejected</p>
                    </div>
                  </div>
                </div>

              </>
            )}
          </TabsContent>

          {/* Task Management Tab */}
          <TabsContent value="tasks" className="mt-0">
            <TaskManagementSection />
          </TabsContent>

          {/* User Management Tab */}
          <TabsContent value="users" className="mt-0">
            <UserManagementSection usersData={usersData} />
          </TabsContent>

          {/* Promo Creator Tab */}
          <TabsContent value="promos" className="mt-0">
            <PromoCreatorSection />
          </TabsContent>

          {/* Payout Logs Tab */}
          <TabsContent value="payouts" className="mt-0">
            <PayoutLogsSection data={payoutLogsData} />
          </TabsContent>

          {/* Ban Logs Tab */}
          <TabsContent value="bans" className="mt-0">
            <BanLogsSection />
          </TabsContent>
          
          {/* Settings Tab */}
          <TabsContent value="settings" className="mt-0">
            <SettingsSection />
          </TabsContent>
        </Tabs>
      </main>
    </Layout>
  );
}

// Analytics Section with Live Charts
function AnalyticsSection({ stats }: { stats: AdminStats | undefined }) {
  const [timeFilter, setTimeFilter] = useState<'day' | 'week' | 'month'>('week');

  // Generate mock trend data (in production, fetch from API)
  const generateTrendData = () => {
    const points = timeFilter === 'day' ? 24 : timeFilter === 'week' ? 7 : 30;
    const data = [];
    for (let i = 0; i < points; i++) {
      const multiplier = (i + 1) / points;
      data.push({
        label: timeFilter === 'day' ? `${i}:00` : timeFilter === 'week' ? `Day ${i + 1}` : `Day ${i + 1}`,
        earnings: parseFloat(stats?.totalEarnings || '0') * multiplier * (0.8 + Math.random() * 0.4),
        withdrawals: parseFloat(stats?.totalWithdrawals || '0') * multiplier * (0.7 + Math.random() * 0.5),
      });
    }
    return data;
  };

  const chartData = generateTrendData();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center">
            <i className="fas fa-chart-area mr-2 text-blue-600"></i>
            Platform Trends
          </CardTitle>
          <div className="flex gap-2">
            {(['day', 'week', 'month'] as const).map((filter) => (
              <Button
                key={filter}
                size="sm"
                variant={timeFilter === filter ? 'default' : 'outline'}
                onClick={() => setTimeFilter(filter)}
                className="text-xs"
              >
                {filter === 'day' ? '24H' : filter === 'week' ? '7D' : '30D'}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="label" 
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
              />
              <YAxis 
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                tickFormatter={(value) => formatCurrency(value, false)}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
                formatter={(value: any) => [formatCurrency(value), '']}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="earnings" 
                stroke="#10b981" 
                strokeWidth={2}
                name="TON Earned"
                dot={{ fill: '#10b981', r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line 
                type="monotone" 
                dataKey="withdrawals" 
                stroke="#ef4444" 
                strokeWidth={2}
                name="📉 TON Withdrawn"
                dot={{ fill: '#ef4444', r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// Ban User Button Component
function BanUserButton({ user, onSuccess }: { user: any; onSuccess: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const handleBanToggle = async () => {
    setIsLoading(true);
    try {
      const response = await apiRequest('POST', '/api/admin/users/ban', {
        userId: user.id,
        banned: !user.banned,
        reason: banReason || (user.banned ? 'Unbanned by admin' : 'Banned by admin')
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: user.banned ? "User Unbanned" : "User Banned",
          description: result.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
        onSuccess();
      } else {
        throw new Error(result.message || 'Failed to update ban status');
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update user status",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setShowConfirmDialog(false);
      setBanReason('');
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant={user.banned ? "outline" : "destructive"}
        onClick={() => setShowConfirmDialog(true)}
        disabled={isLoading}
        className={user.banned ? "border-green-500 text-green-600 hover:bg-green-50" : ""}
      >
        {isLoading ? (
          <i className="fas fa-spinner fa-spin"></i>
        ) : user.banned ? (
          <><i className="fas fa-unlock mr-1"></i>Unban</>
        ) : (
          <><i className="fas fa-ban mr-1"></i>Ban</>
        )}
      </Button>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {user.banned ? (
                <><i className="fas fa-unlock text-green-600"></i> Unban User</>
              ) : (
                <><i className="fas fa-ban text-red-600"></i> Ban User</>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {user.banned 
                ? `Are you sure you want to unban ${user.username || user.firstName || 'this user'}?`
                : `Are you sure you want to ban ${user.username || user.firstName || 'this user'}? They will not be able to access the app.`
              }
            </p>
            {!user.banned && (
              <div>
                <Label htmlFor="ban-reason">Ban Reason (optional)</Label>
                <Input
                  id="ban-reason"
                  placeholder="e.g., Violation of terms"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
                Cancel
              </Button>
              <Button
                variant={user.banned ? "default" : "destructive"}
                onClick={handleBanToggle}
                disabled={isLoading}
              >
                {isLoading ? 'Processing...' : user.banned ? 'Unban User' : 'Ban User'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

type UserProfileTab = 'overview' | 'tasks' | 'ads' | 'referrals' | 'withdrawals' | 'bans';

function UserProfileTabs({ user, onClose }: { user: any; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<UserProfileTab>('overview');
  const { data: userTasks } = useQuery({
    queryKey: ["/api/admin/user-tasks", user.id],
    queryFn: () => apiRequest("GET", `/api/admin/user-tasks/${user.id}`).then(res => res.json()),
    enabled: activeTab === 'tasks',
  });
  const { data: userAds } = useQuery({
    queryKey: ["/api/admin/user-ads", user.id],
    queryFn: () => apiRequest("GET", `/api/admin/user-ads/${user.id}`).then(res => res.json()),
    enabled: activeTab === 'ads',
  });
  const { data: userReferrals } = useQuery({
    queryKey: ["/api/admin/user-referrals", user.id],
    queryFn: () => apiRequest("GET", `/api/admin/user-referrals/${user.id}`).then(res => res.json()),
    enabled: activeTab === 'referrals',
  });
  const { data: userWithdrawals } = useQuery({
    queryKey: ["/api/admin/user-withdrawals", user.id],
    queryFn: () => apiRequest("GET", `/api/admin/user-withdrawals/${user.id}`).then(res => res.json()),
    enabled: activeTab === 'withdrawals',
  });
  const { data: userBanHistory } = useQuery({
    queryKey: ["/api/admin/user-ban-history", user.id],
    queryFn: () => apiRequest("GET", `/api/admin/user-ban-history/${user.id}`).then(res => res.json()),
    enabled: activeTab === 'bans',
  });

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'tasks' as const, label: 'Tasks' },
    { id: 'ads' as const, label: 'Ads' },
    { id: 'referrals' as const, label: 'Referrals' },
    { id: 'withdrawals' as const, label: 'Withdrawals' },
    { id: 'bans' as const, label: 'Ban History' },
  ];

  const formatPAD = (value: any) => {
    const num = parseFloat(value || '0');
    if (isNaN(num) || !isFinite(num)) return '0';
    return Math.round(num).toLocaleString();
  };

  return (
    <div className="space-y-3 max-h-[70vh] overflow-y-auto text-sm">
      <div className="flex gap-1 flex-wrap border-b border-white/10 pb-2">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            size="sm"
            variant="ghost"
            onClick={() => setActiveTab(tab.id)}
            className={`text-xs h-7 ${activeTab === tab.id ? 'bg-[#4cd3ff]/20 text-[#4cd3ff]' : 'text-muted-foreground'}`}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/5 p-2 rounded">
              <p className="text-xs text-muted-foreground">UID</p>
              <p className="font-mono font-bold text-[#4cd3ff]">{user.referralCode || user.personalCode || 'N/A'}</p>
            </div>
            <div className="bg-white/5 p-2 rounded">
              <p className="text-xs text-muted-foreground">Join Date</p>
              <p className="text-sm">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</p>
            </div>
            <div className="bg-white/5 p-2 rounded">
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="text-sm">{user.firstName || 'N/A'} {user.lastName || ''}</p>
            </div>
            <div className="bg-white/5 p-2 rounded">
              <p className="text-xs text-muted-foreground">Username</p>
              <p className="text-sm">{user.username ? `@${user.username}` : 'N/A'}</p>
            </div>
          </div>
          
          <div className="bg-white/5 border border-white/10 p-3 rounded">
            <p className="text-xs text-muted-foreground mb-2">Balances</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-xs text-muted-foreground">PAD</p><p className="font-bold text-[#4cd3ff]">{formatPAD(user.balance)}</p></div>
              <div><p className="text-xs text-muted-foreground">TON</p><p className="font-bold text-purple-400">{parseFloat(user.tonBalance || '0').toFixed(4)}</p></div>
              <div><p className="text-xs text-muted-foreground">USD</p><p className="font-bold text-green-400">${parseFloat(user.usdBalance || '0').toFixed(2)}</p></div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 p-3 rounded">
            <p className="text-xs text-muted-foreground mb-2">Earnings</p>
            <div className="grid grid-cols-2 gap-2">
              <div><p className="text-xs text-muted-foreground">Total Earned</p><p className="font-bold text-emerald-400">{formatPAD(user.totalEarned)} PAD</p></div>
              <div><p className="text-xs text-muted-foreground">Total Withdrawn</p><p className="font-bold text-amber-400">${parseFloat(user.totalWithdrawn || '0').toFixed(2)} USD</p></div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 p-3 rounded">
            <p className="text-xs text-muted-foreground mb-2">Activity</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-xs text-muted-foreground">Friends</p><p className="font-bold">{user.friendsInvited || 0}</p></div>
              <div><p className="text-xs text-muted-foreground">Ads Watched</p><p className="font-bold">{user.adsWatched || 0}</p></div>
              <div><p className="text-xs text-muted-foreground">Tasks Done</p><p className="font-bold">{user.tasksCompleted || 0}</p></div>
            </div>
          </div>

          {user.referrerUid && (
            <div className="bg-white/5 border border-white/10 p-2 rounded">
              <p className="text-xs text-muted-foreground mb-1">Referred By</p>
              <p className="font-mono text-xs text-orange-400">{user.referrerUid}</p>
            </div>
          )}

          {(user.cwalletId || user.usdtWalletAddress || user.telegramStarsUsername) && (
            <div className="bg-white/5 border border-white/10 p-2 rounded">
              <p className="text-xs text-muted-foreground mb-1">Wallet Addresses</p>
              {user.cwalletId && <p className="font-mono text-xs text-[#4cd3ff] break-all">TON: {user.cwalletId}</p>}
              {user.usdtWalletAddress && <p className="font-mono text-xs text-green-400 break-all">USDT: {user.usdtWalletAddress}</p>}
              {user.telegramStarsUsername && <p className="font-mono text-xs text-yellow-400">Stars: @{user.telegramStarsUsername}</p>}
            </div>
          )}

          <div className="flex gap-2 items-center pt-2 border-t border-white/10">
            {user.banned ? (
              <Badge className="bg-red-600 text-xs">Banned</Badge>
            ) : (
              <Badge className="bg-green-600 text-xs">Active</Badge>
            )}
            {user.bannedReason && (
              <span className="text-xs text-muted-foreground">({user.bannedReason})</span>
            )}
            <div className="ml-auto">
              <BanUserButton user={user} onSuccess={onClose} />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground mb-2">Completed Tasks: {userTasks?.tasks?.length || 0}</div>
          {userTasks?.tasks?.length > 0 ? (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {userTasks.tasks.map((task: any) => (
                <div key={task.id} className="bg-white/5 p-2 rounded border border-white/10">
                  <p className="text-sm font-medium">{task.title || 'Task'}</p>
                  <p className="text-xs text-muted-foreground">Completed: {task.completedAt ? new Date(task.completedAt).toLocaleDateString() : 'N/A'}</p>
                  <p className="text-xs text-green-400">Reward: {formatPAD(task.reward)} PAD</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-4">No tasks completed</p>
          )}
        </div>
      )}

      {activeTab === 'ads' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-white/5 p-2 rounded text-center">
              <p className="text-xs text-muted-foreground">Total Ads</p>
              <p className="font-bold text-xl">{user.adsWatched || 0}</p>
            </div>
            <div className="bg-white/5 p-2 rounded text-center">
              <p className="text-xs text-muted-foreground">Today</p>
              <p className="font-bold text-xl">{user.dailyAdsWatched || 0}</p>
            </div>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <p className="text-xs text-muted-foreground">Since Last Withdrawal</p>
            <p className="font-bold">{user.adsWatchedSinceLastWithdrawal || 0}</p>
          </div>
        </div>
      )}

      {activeTab === 'referrals' && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground mb-2">Total Referrals: {userReferrals?.referrals?.length || user.friendsInvited || 0}</div>
          {userReferrals?.referrals?.length > 0 ? (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {userReferrals.referrals.map((ref: any) => (
                <div key={ref.id} className="bg-white/5 p-2 rounded border border-white/10">
                  <p className="text-sm font-mono text-[#4cd3ff]">{ref.refereeCode || ref.refereeId?.slice(0, 8) || 'N/A'}</p>
                  <p className="text-xs text-muted-foreground">Status: {ref.status}</p>
                  <p className="text-xs text-muted-foreground">Joined: {ref.createdAt ? new Date(ref.createdAt).toLocaleDateString() : 'N/A'}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-4">No referrals</p>
          )}
        </div>
      )}

      {activeTab === 'withdrawals' && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground mb-2">Total Withdrawals: {userWithdrawals?.withdrawals?.length || 0}</div>
          {userWithdrawals?.withdrawals?.length > 0 ? (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {userWithdrawals.withdrawals.map((w: any) => (
                <div key={w.id} className="bg-white/5 p-2 rounded border border-white/10">
                  <div className="flex justify-between items-center">
                    <p className="font-bold text-green-400">${parseFloat(w.amount || '0').toFixed(2)}</p>
                    <Badge className={w.status === 'success' || w.status === 'paid' ? 'bg-green-600' : w.status === 'rejected' ? 'bg-red-600' : 'bg-yellow-600'}>
                      {w.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">Method: {w.method || 'N/A'}</p>
                  <p className="text-xs text-muted-foreground">Date: {w.createdAt ? new Date(w.createdAt).toLocaleDateString() : 'N/A'}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-4">No withdrawals</p>
          )}
        </div>
      )}

      {activeTab === 'bans' && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground mb-2">
            Current Status: {user.banned ? <span className="text-red-400">Banned</span> : <span className="text-green-400">Active</span>}
          </div>
          {userBanHistory?.banLogs?.length > 0 ? (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {userBanHistory.banLogs.map((log: any) => (
                <div key={log.id} className="bg-white/5 p-2 rounded border border-white/10">
                  <div className="flex justify-between items-center">
                    <Badge className={log.banType === 'auto' ? 'bg-orange-600' : 'bg-purple-600'}>
                      {log.banType === 'auto' ? 'Auto' : 'Manual'}
                    </Badge>
                    <p className="text-xs text-muted-foreground">{log.createdAt ? new Date(log.createdAt).toLocaleDateString() : 'N/A'}</p>
                  </div>
                  <p className="text-sm mt-1">{log.reason || 'No reason provided'}</p>
                  {log.deviceId && <p className="text-xs text-muted-foreground">Device: {log.deviceId.slice(0, 12)}...</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-4">No ban history</p>
          )}
        </div>
      )}
    </div>
  );
}

type UserViewTab = 'list' | 'stats';

function UserManagementSection({ usersData }: { usersData: any }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [activeView, setActiveView] = useState<UserViewTab>('list');
  const itemsPerPage = 8;
  const users = usersData?.users || usersData || [];

  const filteredUsers = users.filter((user: any) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      user.personalCode?.toLowerCase().includes(search) ||
      user.referralCode?.toLowerCase().includes(search) ||
      user.firstName?.toLowerCase().includes(search)
    );
  });

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const bannedUsers = users.filter((u: any) => u.banned);
  const activeUsers = users.filter((u: any) => !u.banned);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  return (
    <>
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          <Button size="sm" variant="outline" onClick={() => setActiveView('list')} className={`text-xs h-7 ${activeView === 'list' ? 'bg-gradient-to-r from-[#4cd3ff]/20 to-[#4cd3ff]/10 border-[#4cd3ff] text-[#4cd3ff]' : 'border-white/20 text-muted-foreground hover:border-[#4cd3ff]/50'}`}>
            <i className="fas fa-list mr-1"></i>List ({users.length})
          </Button>
          <Button size="sm" variant="outline" onClick={() => setActiveView('stats')} className={`text-xs h-7 ${activeView === 'stats' ? 'bg-gradient-to-r from-[#4cd3ff]/20 to-[#4cd3ff]/10 border-[#4cd3ff] text-[#4cd3ff]' : 'border-white/20 text-muted-foreground hover:border-[#4cd3ff]/50'}`}>
            <i className="fas fa-chart-pie mr-1"></i>Stats
          </Button>
        </div>
        
        {activeView === 'list' && (
          <Input
            placeholder="Search by UID or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 text-sm"
          />
        )}

        {activeView === 'stats' ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gradient-to-br from-[#4cd3ff]/20 to-[#4cd3ff]/5 p-3 rounded text-center border border-[#4cd3ff]/30">
              <p className="text-2xl font-bold text-[#4cd3ff]">{users.length}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <div className="bg-gradient-to-br from-green-500/20 to-green-500/5 p-3 rounded text-center border border-green-500/30">
              <p className="text-2xl font-bold text-green-400">{activeUsers.length}</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
            <div className="bg-gradient-to-br from-red-500/20 to-red-500/5 p-3 rounded text-center border border-red-500/30">
              <p className="text-2xl font-bold text-red-400">{bannedUsers.length}</p>
              <p className="text-xs text-muted-foreground">Banned</p>
            </div>
            <div className="bg-gradient-to-br from-purple-500/20 to-purple-500/5 p-3 rounded text-center border border-purple-500/30">
              <p className="text-2xl font-bold text-purple-400">{users.filter((u: any) => u.cwalletId).length}</p>
              <p className="text-xs text-muted-foreground">Wallet</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto border border-white/10 rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">UID</TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Friends</TableHead>
                  <TableHead className="text-xs text-right">Earned</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-4 text-sm">
                      No users
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedUsers.map((user: any) => (
                    <TableRow key={user.id} className="hover:bg-muted/50">
                      <TableCell className="font-mono text-xs text-[#4cd3ff] py-2">{user.referralCode || user.personalCode || 'N/A'}{user.banned && <Badge className="ml-1 bg-red-600 text-[10px] px-1">Ban</Badge>}</TableCell>
                      <TableCell className="text-xs py-2">{user.firstName || 'User'}</TableCell>
                      <TableCell className="py-2"><Badge variant="outline" className="text-[10px]">{user.friendsInvited || 0}</Badge></TableCell>
                      <TableCell className="text-right text-xs font-semibold py-2">{formatCurrency(user.totalEarned || '0')}</TableCell>
                      <TableCell className="py-2"><Button size="sm" variant="ghost" onClick={() => setSelectedUser(user)} className="h-6 text-xs px-2"><i className="fas fa-eye"></i></Button></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
        
        {activeView === 'list' && totalPages > 1 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{filteredUsers.length} users</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-6 w-6 p-0"><i className="fas fa-chevron-left text-xs"></i></Button>
              <span className="px-2">{currentPage}/{totalPages}</span>
              <Button size="sm" variant="ghost" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="h-6 w-6 p-0"><i className="fas fa-chevron-right text-xs"></i></Button>
            </div>
          </div>
        )}
      </div>

      {/* User Detail Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <i className="fas fa-user-circle text-[#4cd3ff]"></i>
              UID: {selectedUser?.referralCode || selectedUser?.personalCode || 'N/A'}
            </DialogTitle>
          </DialogHeader>
          {selectedUser && <UserProfileTabs user={selectedUser} onClose={() => setSelectedUser(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

type PromoTab = 'create' | 'manage';

function PromoCreatorSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<PromoTab>('create');
  const [formData, setFormData] = useState({
    code: '',
    rewardAmount: '',
    rewardType: 'TON' as 'PAD' | 'TON' | 'USD' | 'BUG',
    usageLimit: '',
    perUserLimit: '1',
    expiresAt: ''
  });
  const [isCreating, setIsCreating] = useState(false);

  const handleGenerateCode = () => {
    const randomCode = 'PROMO' + Math.random().toString(36).substring(2, 10).toUpperCase();
    setFormData({ ...formData, code: randomCode });
    toast({ title: "Code Generated", description: randomCode });
  };

  const { data: promoCodesData } = useQuery({
    queryKey: ["/api/admin/promo-codes"],
    queryFn: () => apiRequest("GET", "/api/admin/promo-codes").then(res => res.json()),
    refetchInterval: 5000,
  });

  const handleCreate = async () => {
    if (!formData.code.trim() || !formData.rewardAmount) {
      toast({ title: "Error", description: "Code and amount required", variant: "destructive" });
      return;
    }
    const rewardAmount = parseFloat(formData.rewardAmount);
    if (isNaN(rewardAmount) || rewardAmount <= 0) {
      toast({ title: "Error", description: "Amount must be positive", variant: "destructive" });
      return;
    }

    setIsCreating(true);
    try {
      const response = await apiRequest('POST', '/api/promo-codes/create', {
        code: formData.code.trim().toUpperCase(),
        rewardAmount,
        rewardType: formData.rewardType,
        usageLimit: formData.usageLimit ? parseInt(formData.usageLimit) : null,
        perUserLimit: parseInt(formData.perUserLimit),
        expiresAt: formData.expiresAt || null
      });
      const result = await response.json();
      if (result.success) {
        toast({ title: "Created", description: `${rewardAmount} ${formData.rewardType}` });
        setFormData({ code: '', rewardAmount: '', rewardType: 'TON', usageLimit: '', perUserLimit: '1', expiresAt: '' });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/promo-codes"] });
        setActiveTab('manage');
      } else {
        throw new Error(result.message);
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  const promoCodes = promoCodesData?.promoCodes || [];
  const getPromoStatus = (promo: any) => {
    const now = new Date();
    const expiresAt = promo.expiresAt ? new Date(promo.expiresAt) : null;
    if (promo.usageLimit && promo.usageCount >= promo.usageLimit) return { label: 'Full', color: 'bg-orange-600' };
    if (expiresAt && now > expiresAt) return { label: 'Expired', color: 'bg-gray-600' };
    if (promo.isActive) return { label: 'Active', color: 'bg-green-600' };
    return { label: 'Off', color: 'bg-gray-600' };
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: "Copied", description: code });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => setActiveTab('create')} className={`text-xs h-7 ${activeTab === 'create' ? 'bg-gradient-to-r from-green-500/20 to-green-500/10 border-green-500 text-green-400' : 'border-white/20 text-muted-foreground hover:border-green-500/50'}`}>
          <i className="fas fa-plus mr-1"></i>Create
        </Button>
        <Button size="sm" variant="outline" onClick={() => setActiveTab('manage')} className={`text-xs h-7 ${activeTab === 'manage' ? 'bg-gradient-to-r from-[#4cd3ff]/20 to-[#4cd3ff]/10 border-[#4cd3ff] text-[#4cd3ff]' : 'border-white/20 text-muted-foreground hover:border-[#4cd3ff]/50'}`}>
          <i className="fas fa-list mr-1"></i>Manage ({promoCodes.length})
        </Button>
      </div>
      
      {activeTab === 'create' ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="PROMO CODE" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })} maxLength={20} className="flex-1 h-8 text-sm" />
            <Button type="button" variant="outline" onClick={handleGenerateCode} size="sm" className="h-8"><i className="fas fa-random"></i></Button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(['PAD', 'TON', 'USD', 'BUG'] as const).map(type => (
              <Button key={type} type="button" variant={formData.rewardType === type ? 'default' : 'outline'} onClick={() => setFormData({ ...formData, rewardType: type })} className="h-8 text-xs">{type}</Button>
            ))}
          </div>
          <Input type="number" placeholder={`Amount (${formData.rewardType})`} value={formData.rewardAmount} onChange={(e) => setFormData({ ...formData, rewardAmount: e.target.value })} min="0" className="h-8 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" placeholder="Max Claims" value={formData.usageLimit} onChange={(e) => setFormData({ ...formData, usageLimit: e.target.value })} min="1" className="h-8 text-sm" />
            <Input type="date" value={formData.expiresAt} onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })} className="h-8 text-sm" />
          </div>
          <Button onClick={handleCreate} disabled={isCreating} className="w-full h-8 text-sm">
            {isCreating ? <><i className="fas fa-spinner fa-spin mr-1"></i>Creating...</> : <><i className="fas fa-plus mr-1"></i>Create</>}
          </Button>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto border border-white/10 rounded-lg p-2">
          {promoCodes.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm"><i className="fas fa-gift text-2xl mb-2"></i><p>No codes</p></div>
          ) : (
            promoCodes.map((promo: any) => {
              const status = getPromoStatus(promo);
              return (
                <div key={promo.id} className="border border-white/10 rounded p-2 hover:bg-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <code className="font-bold text-sm bg-white/10 px-1.5 py-0.5 rounded text-[#4cd3ff]">{promo.code}</code>
                      <Button size="sm" variant="ghost" onClick={() => copyToClipboard(promo.code)} className="h-5 w-5 p-0"><i className="fas fa-copy text-[10px]"></i></Button>
                    </div>
                    <Badge className={`${status.color} text-[10px]`}>{status.label}</Badge>
                  </div>
                  <div className="flex justify-between text-xs mt-1 text-muted-foreground"><span>{promo.rewardType === 'USD' ? `$${parseFloat(promo.rewardAmount).toFixed(2)}` : `${Math.round(parseFloat(promo.rewardAmount))} ${promo.rewardType || 'PAD'}`}</span><span>{promo.usageCount || 0}/{promo.usageLimit || '∞'}</span></div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

type PayoutTab = 'all' | 'pending' | 'approved' | 'rejected';

function PayoutLogsSection({ data }: { data: any }) {
  const [statusFilter, setStatusFilter] = useState<PayoutTab>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const itemsPerPage = 6;
  const payouts = data?.withdrawals || [];

  const pendingCount = payouts.filter((p: any) => p.status === 'pending').length;
  const approvedCount = payouts.filter((p: any) => ['success', 'paid', 'Approved'].includes(p.status)).length;
  const rejectedCount = payouts.filter((p: any) => p.status === 'rejected').length;

  const filteredPayouts = payouts.filter((payout: any) => {
    const matchesStatus = statusFilter === 'all' ? true :
      statusFilter === 'approved' ? ['success', 'paid', 'Approved'].includes(payout.status) :
      statusFilter === 'rejected' ? payout.status === 'rejected' :
      statusFilter === 'pending' ? payout.status === 'pending' : true;
    const matchesSearch = searchQuery === '' ? true :
      (payout.user?.referralCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
       payout.user?.personalCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
       payout.details?.paymentDetails?.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  const totalPages = Math.ceil(filteredPayouts.length / itemsPerPage);
  const paginatedPayouts = filteredPayouts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => { setCurrentPage(1); }, [statusFilter, searchQuery]);

  const getStatusBadge = (status: string) => {
    if (['success', 'paid', 'Approved'].includes(status)) return <Badge className="bg-green-600 text-[10px] h-4">Done</Badge>;
    if (status === 'rejected') return <Badge className="bg-red-600 text-[10px] h-4">Fail</Badge>;
    return <Badge className="bg-yellow-600 text-[10px] h-4">Wait</Badge>;
  };

  const tabButtons: { key: PayoutTab; label: string; count: number; color: string }[] = [
    { key: 'all', label: 'All', count: payouts.length, color: '' },
    { key: 'pending', label: 'Pending', count: pendingCount, color: 'text-yellow-600' },
    { key: 'approved', label: 'Done', count: approvedCount, color: 'text-green-600' },
    { key: 'rejected', label: 'Reject', count: rejectedCount, color: 'text-red-600' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {tabButtons.map((tab) => {
          const isActive = statusFilter === tab.key;
          const activeColors = tab.key === 'pending' ? 'from-yellow-500/20 to-yellow-500/10 border-yellow-500 text-yellow-400' :
            tab.key === 'approved' ? 'from-green-500/20 to-green-500/10 border-green-500 text-green-400' :
            tab.key === 'rejected' ? 'from-red-500/20 to-red-500/10 border-red-500 text-red-400' :
            'from-[#4cd3ff]/20 to-[#4cd3ff]/10 border-[#4cd3ff] text-[#4cd3ff]';
          return (
            <Button key={tab.key} size="sm" variant="outline" onClick={() => setStatusFilter(tab.key)} className={`text-xs h-7 ${isActive ? `bg-gradient-to-r ${activeColors}` : 'border-white/20 text-muted-foreground hover:border-white/40'}`}>
              {tab.label} ({tab.count})
            </Button>
          );
        })}
      </div>
      <Input placeholder="Search user, UID, wallet..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 text-sm" />
      
      {paginatedPayouts.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm"><i className="fas fa-inbox text-2xl mb-2"></i><p>No payouts</p></div>
      ) : (
        <div className="overflow-x-auto max-h-[280px] overflow-y-auto border border-white/10 rounded-lg">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="text-xs">User</TableHead>
                <TableHead className="text-xs">Amount</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedPayouts.map((payout: any) => {
                const username = payout.user?.telegramUsername || payout.user?.username || payout.user?.firstName || payout.user?.referralCode || payout.user?.personalCode || 'N/A';
                const displayUsername = username.startsWith('@') ? username : (payout.user?.telegramUsername || payout.user?.username ? `@${payout.user?.telegramUsername || payout.user?.username}` : username);
                const usdAmount = parseFloat(payout.amount || '0');
                return (
                  <TableRow key={payout.id} className="hover:bg-white/5">
                    <TableCell className="text-xs py-2 font-medium text-[#4cd3ff]">{displayUsername}</TableCell>
                    <TableCell className="text-xs py-2 font-semibold text-green-400">${usdAmount.toFixed(2)}</TableCell>
                    <TableCell className="py-2">{getStatusBadge(payout.status)}</TableCell>
                    <TableCell className="text-[10px] py-2 text-muted-foreground">{new Date(payout.createdAt || payout.created_on).toLocaleDateString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{filteredPayouts.length} records</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-6 w-6 p-0"><i className="fas fa-chevron-left text-xs"></i></Button>
            <span className="px-2">{currentPage}/{totalPages}</span>
            <Button size="sm" variant="ghost" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="h-6 w-6 p-0"><i className="fas fa-chevron-right text-xs"></i></Button>
          </div>
        )}
      </div>
    </div>
  );
}

type BanViewTab = 'logs' | 'users';

function BanLogsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const [activeView, setActiveView] = useState<BanViewTab>('users');
  const [filterType, setFilterType] = useState<'all' | 'auto' | 'manual'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [unbanningId, setUnbanningId] = useState<string | null>(null);
  const itemsPerPage = 8;

  const { data: banLogsData, isLoading: logsLoading } = useQuery({
    queryKey: ["/api/admin/ban-logs"],
    queryFn: () => apiRequest("GET", "/api/admin/ban-logs?limit=200").then(res => res.json()),
    refetchInterval: 30000,
  });

  const { data: bannedUsersData, isLoading: usersLoading } = useQuery({
    queryKey: ["/api/admin/banned-users-details"],
    queryFn: () => apiRequest("GET", "/api/admin/banned-users-details").then(res => res.json()),
    refetchInterval: 30000,
  });

  const logs = banLogsData?.logs || [];
  const bannedUsers = bannedUsersData?.bannedUsers || [];

  const filteredLogs = logs.filter((log: any) => {
    if (filterType !== 'all' && log.banType !== filterType) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        log.bannedUserUid?.toLowerCase().includes(search) ||
        log.deviceId?.toLowerCase().includes(search) ||
        log.ip?.toLowerCase().includes(search) ||
        log.reason?.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const filteredUsers = bannedUsers.filter((user: any) => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        user.referralCode?.toLowerCase().includes(search) ||
        user.personalCode?.toLowerCase().includes(search) ||
        user.firstName?.toLowerCase().includes(search) ||
        user.deviceId?.toLowerCase().includes(search) ||
        user.lastLoginIp?.toLowerCase().includes(search) ||
        user.bannedReason?.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const totalPages = activeView === 'logs' 
    ? Math.ceil(filteredLogs.length / itemsPerPage)
    : Math.ceil(filteredUsers.length / itemsPerPage);
  
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const autoBanCount = logs.filter((l: any) => l.banType === 'auto').length;
  const manualBanCount = logs.filter((l: any) => l.banType === 'manual').length;

  const handleUnban = async (userId: string) => {
    setUnbanningId(userId);
    try {
      const response = await apiRequest('POST', `/api/admin/users/${userId}/unban`);
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "User Unbanned",
          description: "The user has been successfully unbanned",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/banned-users-details"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/ban-logs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      } else {
        throw new Error(result.message || 'Failed to unban user');
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to unban user",
        variant: "destructive",
      });
    } finally {
      setUnbanningId(null);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [activeView, filterType, searchTerm]);

  const isLoading = activeView === 'logs' ? logsLoading : usersLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-muted h-16 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="bg-muted h-48 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gradient-to-br from-red-500/20 to-red-500/5 p-3 rounded text-center border border-red-500/30">
          <p className="text-2xl font-bold text-red-400">{bannedUsers.length}</p>
          <p className="text-xs text-muted-foreground">Banned Users</p>
        </div>
        <div className="bg-gradient-to-br from-orange-500/20 to-orange-500/5 p-3 rounded text-center border border-orange-500/30">
          <p className="text-2xl font-bold text-orange-400">{autoBanCount}</p>
          <p className="text-xs text-muted-foreground">Auto Bans</p>
        </div>
        <div className="bg-gradient-to-br from-purple-500/20 to-purple-500/5 p-3 rounded text-center border border-purple-500/30">
          <p className="text-2xl font-bold text-purple-400">{manualBanCount}</p>
          <p className="text-xs text-muted-foreground">Manual Bans</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Button 
          size="sm" 
          variant="outline" 
          onClick={() => setActiveView('users')} 
          className={`text-xs h-7 ${activeView === 'users' ? 'bg-gradient-to-r from-red-500/20 to-red-500/10 border-red-500 text-red-400' : 'border-white/20 text-muted-foreground hover:border-red-500/50'}`}
        >
          <i className="fas fa-user-slash mr-1"></i>Banned Users ({bannedUsers.length})
        </Button>
        <Button 
          size="sm" 
          variant="outline" 
          onClick={() => setActiveView('logs')} 
          className={`text-xs h-7 ${activeView === 'logs' ? 'bg-gradient-to-r from-orange-500/20 to-orange-500/10 border-orange-500 text-orange-400' : 'border-white/20 text-muted-foreground hover:border-orange-500/50'}`}
        >
          <i className="fas fa-history mr-1"></i>Ban History ({logs.length})
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Input
          placeholder={activeView === 'logs' ? "Search by UID, IP, Device ID..." : "Search banned users..."}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-8 text-sm flex-1 min-w-[150px]"
        />
        {activeView === 'logs' && (
          <div className="flex gap-1">
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => setFilterType('all')} 
              className={`text-xs h-8 px-2 ${filterType === 'all' ? 'bg-white/10 border-white/30' : 'border-white/10'}`}
            >
              All
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => setFilterType('auto')} 
              className={`text-xs h-8 px-2 ${filterType === 'auto' ? 'bg-orange-500/20 border-orange-500' : 'border-white/10'}`}
            >
              Auto
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => setFilterType('manual')} 
              className={`text-xs h-8 px-2 ${filterType === 'manual' ? 'bg-purple-500/20 border-purple-500' : 'border-white/10'}`}
            >
              Manual
            </Button>
          </div>
        )}
      </div>

      {activeView === 'users' ? (
        filteredUsers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <i className="fas fa-check-circle text-2xl mb-2 text-green-500"></i>
            <p>No banned users</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto border border-white/10 rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">UID</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                  <TableHead className="text-xs">Referrer UID</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedUsers.map((user: any) => (
                  <TableRow key={user.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-xs text-[#4cd3ff] py-2">
                      {user.referralCode || user.personalCode || user.id?.slice(0, 8) || 'N/A'}
                    </TableCell>
                    <TableCell className="text-xs py-2 max-w-[150px] truncate" title={user.bannedReason}>
                      {user.bannedReason || 'No reason provided'}
                    </TableCell>
                    <TableCell className="font-mono text-xs py-2 text-orange-400" title={user.referrerUid}>
                      {user.referrerUid || 'Direct'}
                    </TableCell>
                    <TableCell className="text-[10px] text-muted-foreground py-2">
                      {user.bannedAt ? new Date(user.bannedAt).toLocaleDateString() : 'N/A'}
                    </TableCell>
                    <TableCell className="py-2">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => handleUnban(user.id)}
                        disabled={unbanningId === user.id}
                        className="h-6 text-xs px-2 border-green-500 text-green-400 hover:bg-green-500/20"
                      >
                        {unbanningId === user.id ? (
                          <i className="fas fa-spinner fa-spin"></i>
                        ) : (
                          <><i className="fas fa-unlock mr-1"></i>Unban</>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : (
        filteredLogs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <i className="fas fa-shield-alt text-2xl mb-2"></i>
            <p>No ban logs found</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto border border-white/10 rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">UID</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                  <TableHead className="text-xs">Referrer UID</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedLogs.map((log: any) => (
                  <TableRow key={log.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-xs text-[#4cd3ff] py-2">
                      {log.bannedUserUid || log.bannedUserId?.slice(0, 8) || 'N/A'}
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge className={`text-[10px] ${log.banType === 'auto' ? 'bg-orange-600' : 'bg-purple-600'}`}>
                        {log.banType === 'auto' ? 'Auto' : 'Manual'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs py-2 max-w-[120px] truncate" title={log.reason}>
                      {log.reason}
                    </TableCell>
                    <TableCell className="font-mono text-xs py-2 text-orange-400" title={log.referrerUid}>
                      {log.referrerUid || 'Direct'}
                    </TableCell>
                    <TableCell className="text-[10px] text-muted-foreground py-2">
                      {log.createdAt ? new Date(log.createdAt).toLocaleDateString() : 'N/A'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {activeView === 'logs' ? `${filteredLogs.length} ban logs` : `${filteredUsers.length} banned users`}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-6 w-6 p-0">
              <i className="fas fa-chevron-left text-xs"></i>
            </Button>
            <span className="px-2">{currentPage}/{totalPages}</span>
            <Button size="sm" variant="ghost" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="h-6 w-6 p-0">
              <i className="fas fa-chevron-right text-xs"></i>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type SettingsCategory = 'ads' | 'affiliates' | 'withdrawals' | 'tasks' | 'other';

function SettingsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('ads');
  
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["/api/admin/settings"],
    queryFn: () => apiRequest("GET", "/api/admin/settings").then(res => res.json()),
  });
  
  const [settings, setSettings] = useState({
    dailyAdLimit: '50',
    rewardPerAd: '2',
    l1CommissionPercent: '20',
    l2CommissionPercent: '4',
    walletChangeFee: '100',
    minimumWithdrawalUSD: '1.00',
    minimumWithdrawalTON: '0.5',
    withdrawalFeeTON: '5',
    withdrawalFeeUSD: '3',
    channelTaskCost: '0.003',
    botTaskCost: '0.003',
    channelTaskCostTON: '0.0003',
    botTaskCostTON: '0.0003',
    channelTaskReward: '30',
    botTaskReward: '20',
    partnerTaskReward: '5',
    minimumConvertPAD: '100',
    minimumClicks: '500',
    seasonBroadcastActive: false,
    referralRewardEnabled: false,
    referralRewardUSD: '0.0005',
    referralRewardPAD: '50',
    referralAdsRequired: '1',
    // Withdrawal requirements
    withdrawalAdRequirementEnabled: true,
    minimumAdsForWithdrawal: '100',
    withdrawalInviteRequirementEnabled: true,
    minimumInvitesForWithdrawal: '3',
    // Daily task rewards
    streakReward: '100',
    shareTaskReward: '1000',
    communityTaskReward: '1000',
    // BUG currency settings
    bugRewardPerAd: '1',
    bugRewardPerTask: '10',
    bugRewardPerReferral: '50',
    minimumBugForWithdrawal: '1000',
    padToBugRate: '1',
    minimumConvertPadToBug: '1000',
    bugPerUsd: '10000',
    withdrawalBugRequirementEnabled: true
  });
  
  useEffect(() => {
    if (settingsData) {
      setSettings({
        dailyAdLimit: settingsData.dailyAdLimit?.toString() || '50',
        rewardPerAd: settingsData.rewardPerAd?.toString() || '2',
        l1CommissionPercent: settingsData.l1CommissionPercent?.toString() || '20',
        l2CommissionPercent: settingsData.l2CommissionPercent?.toString() || '4',
        walletChangeFee: settingsData.walletChangeFee?.toString() || '100',
        minimumWithdrawalUSD: settingsData.minimumWithdrawalUSD?.toString() || '1.00',
        minimumWithdrawalTON: settingsData.minimumWithdrawalTON?.toString() || '0.5',
        withdrawalFeeTON: settingsData.withdrawalFeeTON?.toString() || '5',
        withdrawalFeeUSD: settingsData.withdrawalFeeUSD?.toString() || '3',
        channelTaskCost: settingsData.channelTaskCost?.toString() || '0.003',
        botTaskCost: settingsData.botTaskCost?.toString() || '0.003',
        channelTaskCostTON: settingsData.channelTaskCostTON?.toString() || '0.0003',
        botTaskCostTON: settingsData.botTaskCostTON?.toString() || '0.0003',
        channelTaskReward: settingsData.channelTaskReward?.toString() || '30',
        botTaskReward: settingsData.botTaskReward?.toString() || '20',
        partnerTaskReward: settingsData.partnerTaskReward?.toString() || '5',
        minimumConvertPAD: settingsData.minimumConvertPAD?.toString() || '100',
        minimumClicks: settingsData.minimumClicks?.toString() || '500',
        seasonBroadcastActive: settingsData.seasonBroadcastActive || false,
        referralRewardEnabled: settingsData.referralRewardEnabled || false,
        referralRewardUSD: settingsData.referralRewardUSD?.toString() || '0.0005',
        referralRewardPAD: settingsData.referralRewardPAD?.toString() || '50',
        referralAdsRequired: settingsData.referralAdsRequired?.toString() || '1',
        // Withdrawal requirements
        withdrawalAdRequirementEnabled: settingsData.withdrawalAdRequirementEnabled !== false,
        minimumAdsForWithdrawal: settingsData.minimumAdsForWithdrawal?.toString() || '100',
        withdrawalInviteRequirementEnabled: settingsData.withdrawalInviteRequirementEnabled !== false,
        minimumInvitesForWithdrawal: settingsData.minimumInvitesForWithdrawal?.toString() || '3',
        // Daily task rewards
        streakReward: settingsData.streakReward?.toString() || '100',
        shareTaskReward: settingsData.shareTaskReward?.toString() || '1000',
        communityTaskReward: settingsData.communityTaskReward?.toString() || '1000',
        // BUG currency settings
        bugRewardPerAd: settingsData.bugRewardPerAd?.toString() || '1',
        bugRewardPerTask: settingsData.bugRewardPerTask?.toString() || '10',
        bugRewardPerReferral: settingsData.bugRewardPerReferral?.toString() || '50',
        minimumBugForWithdrawal: settingsData.minimumBugForWithdrawal?.toString() || '1000',
        padToBugRate: settingsData.padToBugRate?.toString() || '1',
        minimumConvertPadToBug: settingsData.minimumConvertPadToBug?.toString() || '1000',
        bugPerUsd: settingsData.bugPerUsd?.toString() || '10000',
        withdrawalBugRequirementEnabled: settingsData.withdrawalBugRequirementEnabled !== false
      });
    }
  }, [settingsData]);
  
  const categories = [
    { id: 'ads' as const, label: 'Ads & Rewards', icon: 'play-circle' },
    { id: 'affiliates' as const, label: 'Affiliates', icon: 'users' },
    { id: 'withdrawals' as const, label: 'Withdrawals', icon: 'wallet' },
    { id: 'tasks' as const, label: 'Tasks', icon: 'tasks' },
    { id: 'bug' as const, label: 'BUG Currency', icon: 'bug' },
    { id: 'other' as const, label: 'Other', icon: 'cog' },
  ];
  
  const handleSaveSettings = async () => {
    const adLimit = parseInt(settings.dailyAdLimit);
    const reward = parseInt(settings.rewardPerAd);
    const walletFee = parseInt(settings.walletChangeFee);
    const minWithdrawalUSD = parseFloat(settings.minimumWithdrawalUSD);
    const minWithdrawalTON = parseFloat(settings.minimumWithdrawalTON);
    const withdrawalFeeTON = parseFloat(settings.withdrawalFeeTON);
    const withdrawalFeeUSD = parseFloat(settings.withdrawalFeeUSD);
    const channelCost = parseFloat(settings.channelTaskCost);
    const botCost = parseFloat(settings.botTaskCost);
    const channelCostTON = parseFloat(settings.channelTaskCostTON);
    const botCostTON = parseFloat(settings.botTaskCostTON);
    const channelReward = parseInt(settings.channelTaskReward);
    const botReward = parseInt(settings.botTaskReward);
    const partnerReward = parseInt(settings.partnerTaskReward);
    const minConvertPAD = parseInt(settings.minimumConvertPAD);
    const minClicks = parseInt(settings.minimumClicks);
    const refRewardUSD = parseFloat(settings.referralRewardUSD);
    const refRewardPAD = parseInt(settings.referralRewardPAD);
    
    if (isNaN(adLimit) || adLimit <= 0) {
      toast({
        title: "Validation Error",
        description: "Daily ad limit must be a positive number",
        variant: "destructive",
      });
      return;
    }
    
    if (isNaN(reward) || reward <= 0) {
      toast({
        title: "Validation Error",
        description: "Reward per ad must be a positive number",
        variant: "destructive",
      });
      return;
    }
    
    setIsSaving(true);
    try {
      const response = await apiRequest('PUT', '/api/admin/settings', {
        dailyAdLimit: adLimit,
        rewardPerAd: reward,
        l1CommissionPercent: parseFloat(settings.l1CommissionPercent) || 20,
        l2CommissionPercent: parseFloat(settings.l2CommissionPercent) || 4,
        walletChangeFee: walletFee,
        minimumWithdrawalUSD: minWithdrawalUSD,
        minimumWithdrawalTON: minWithdrawalTON,
        withdrawalFeeTON: withdrawalFeeTON,
        withdrawalFeeUSD: withdrawalFeeUSD,
        channelTaskCost: channelCost,
        botTaskCost: botCost,
        channelTaskCostTON: channelCostTON,
        botTaskCostTON: botCostTON,
        channelTaskReward: channelReward,
        botTaskReward: botReward,
        partnerTaskReward: partnerReward,
        minimumConvertPAD: minConvertPAD,
        minimumClicks: minClicks,
        seasonBroadcastActive: settings.seasonBroadcastActive,
        referralRewardEnabled: settings.referralRewardEnabled,
        referralRewardUSD: refRewardUSD,
        referralRewardPAD: refRewardPAD,
        referralAdsRequired: parseInt(settings.referralAdsRequired) || 1,
        withdrawalAdRequirementEnabled: settings.withdrawalAdRequirementEnabled,
        minimumAdsForWithdrawal: parseInt(settings.minimumAdsForWithdrawal) || 100,
        withdrawalInviteRequirementEnabled: settings.withdrawalInviteRequirementEnabled,
        minimumInvitesForWithdrawal: parseInt(settings.minimumInvitesForWithdrawal) || 3,
        streakReward: parseInt(settings.streakReward) || 100,
        shareTaskReward: parseInt(settings.shareTaskReward) || 1000,
        communityTaskReward: parseInt(settings.communityTaskReward) || 1000,
        // BUG currency settings
        bugRewardPerAd: parseInt(settings.bugRewardPerAd) || 1,
        bugRewardPerTask: parseInt(settings.bugRewardPerTask) || 10,
        bugRewardPerReferral: parseInt(settings.bugRewardPerReferral) || 50,
        minimumBugForWithdrawal: parseInt(settings.minimumBugForWithdrawal) || 1000,
        padToBugRate: parseInt(settings.padToBugRate) || 1,
        minimumConvertPadToBug: parseInt(settings.minimumConvertPadToBug) || 1000,
        bugPerUsd: parseInt(settings.bugPerUsd) || 10000,
        withdrawalBugRequirementEnabled: settings.withdrawalBugRequirementEnabled
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Settings Updated",
          description: "App settings have been updated successfully",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/app-settings"] });
      } else {
        throw new Error(result.message || 'Failed to update settings');
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update settings",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };
  
  if (isLoading) {
    return (
      <div className="text-center py-8">
        <i className="fas fa-spinner fa-spin text-3xl text-primary mb-2"></i>
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {categories.map((cat) => {
          const isActive = activeCategory === cat.id;
          const catColors = cat.id === 'ads' ? 'from-orange-500/20 to-orange-500/10 border-orange-500 text-orange-400' :
            cat.id === 'affiliates' ? 'from-green-500/20 to-green-500/10 border-green-500 text-green-400' :
            cat.id === 'withdrawals' ? 'from-emerald-500/20 to-emerald-500/10 border-emerald-500 text-emerald-400' :
            cat.id === 'tasks' ? 'from-cyan-500/20 to-cyan-500/10 border-[#4cd3ff] text-[#4cd3ff]' :
            cat.id === 'bug' ? 'from-lime-500/20 to-lime-500/10 border-lime-500 text-lime-400' :
            'from-purple-500/20 to-purple-500/10 border-purple-500 text-purple-400';
          return (
            <Button key={cat.id} size="sm" variant="outline" onClick={() => setActiveCategory(cat.id)} className={`text-xs h-7 ${isActive ? `bg-gradient-to-r ${catColors}` : 'border-white/20 text-muted-foreground hover:border-white/40'}`}>
              <i className={`fas fa-${cat.icon} mr-1`}></i>{cat.label}
            </Button>
          );
        })}
      </div>

      <div className="space-y-3">
        {activeCategory === 'ads' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="daily-ad-limit" className="text-sm font-semibold">
                <i className="fas fa-calendar-day mr-2 text-orange-600"></i>
                Daily Ad Limit
              </Label>
              <Input
                id="daily-ad-limit"
                type="number"
                value={settings.dailyAdLimit}
                onChange={(e) => setSettings({ ...settings, dailyAdLimit: e.target.value })}
                placeholder="50"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.dailyAdLimit || 50} ads/day
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="reward-per-ad" className="text-sm font-semibold">
                <i className="fas fa-gem mr-2 text-purple-600"></i>
                Reward Per Ad (PAD)
              </Label>
              <Input
                id="reward-per-ad"
                type="number"
                value={settings.rewardPerAd}
                onChange={(e) => setSettings({ ...settings, rewardPerAd: e.target.value })}
                placeholder="1000"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.rewardPerAd || 1000} PAD
              </p>
            </div>
          </div>
        )}

        {activeCategory === 'affiliates' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="l1-commission" className="text-sm font-semibold">
                <i className="fas fa-percent mr-2 text-green-600"></i>
                Level 1 Commission (%)
              </Label>
              <Input
                id="l1-commission"
                type="number"
                value={settings.l1CommissionPercent}
                onChange={(e) => setSettings({ ...settings, l1CommissionPercent: e.target.value })}
                placeholder="20"
                min="0"
                max="100"
                step="0.1"
              />
              <p className="text-xs text-muted-foreground">
                Direct referrals. Current: {settingsData?.l1CommissionPercent || 20}%
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="l2-commission" className="text-sm font-semibold">
                <i className="fas fa-percent mr-2 text-blue-500"></i>
                Level 2 Commission (%)
              </Label>
              <Input
                id="l2-commission"
                type="number"
                value={settings.l2CommissionPercent}
                onChange={(e) => setSettings({ ...settings, l2CommissionPercent: e.target.value })}
                placeholder="4"
                min="0"
                max="100"
                step="0.1"
              />
              <p className="text-xs text-muted-foreground">
                Referrals of referrals. Current: {settingsData?.l2CommissionPercent || 4}%
              </p>
            </div>

            <div className="space-y-2 p-3 border rounded-lg bg-green-50/5 border-green-500/20">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">
                  <i className="fas fa-gift mr-2 text-green-500"></i>
                  Referral Bonus
                </Label>
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, referralRewardEnabled: !settings.referralRewardEnabled })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    settings.referralRewardEnabled ? 'bg-green-500' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      settings.referralRewardEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <Label className="text-xs">PAD</Label>
                  <Input
                    type="number"
                    value={settings.referralRewardPAD}
                    onChange={(e) => setSettings({ ...settings, referralRewardPAD: e.target.value })}
                    placeholder="50"
                    disabled={!settings.referralRewardEnabled}
                    className={`h-8 ${!settings.referralRewardEnabled ? 'opacity-50' : ''}`}
                  />
                </div>
                <div>
                  <Label className="text-xs">USD</Label>
                  <Input
                    type="number"
                    value={settings.referralRewardUSD}
                    onChange={(e) => setSettings({ ...settings, referralRewardUSD: e.target.value })}
                    placeholder="0.0005"
                    step="0.0001"
                    disabled={!settings.referralRewardEnabled}
                    className={`h-8 ${!settings.referralRewardEnabled ? 'opacity-50' : ''}`}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="referral-ads-required" className="text-sm font-semibold">
                <i className="fas fa-play-circle mr-2 text-amber-500"></i>
                Ads Required for Bonus
              </Label>
              <Input
                id="referral-ads-required"
                type="number"
                value={settings.referralAdsRequired}
                onChange={(e) => setSettings({ ...settings, referralAdsRequired: e.target.value })}
                placeholder="1"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                Number of ads a referred user must watch to trigger the referral bonus. Current: {settingsData?.referralAdsRequired || 1}
              </p>
            </div>
          </div>
        )}

        {activeCategory === 'withdrawals' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="minimum-withdrawal-ton" className="text-sm font-semibold">
                <i className="fas fa-gem mr-2 text-blue-600"></i>
                Min USD (TON Method)
              </Label>
              <Input
                id="minimum-withdrawal-ton"
                type="number"
                value={settings.minimumWithdrawalTON}
                onChange={(e) => setSettings({ ...settings, minimumWithdrawalTON: e.target.value })}
                placeholder="0.5"
                min="0"
                step="0.01"
              />
              <p className="text-xs text-muted-foreground">
                Current: ${settingsData?.minimumWithdrawalTON || 0.5}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="withdrawal-fee-ton" className="text-sm font-semibold">
                <i className="fas fa-percent mr-2 text-blue-600"></i>
                TON Fee (%)
              </Label>
              <Input
                id="withdrawal-fee-ton"
                type="number"
                value={settings.withdrawalFeeTON}
                onChange={(e) => setSettings({ ...settings, withdrawalFeeTON: e.target.value })}
                placeholder="5"
                min="0"
                max="100"
                step="0.1"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.withdrawalFeeTON || 5}%
              </p>
            </div>

            <div className="space-y-2 p-3 border rounded-lg bg-emerald-50/5 border-emerald-500/20 md:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">
                  <i className="fas fa-play-circle mr-2 text-emerald-500"></i>
                  Withdrawal Ad Requirement
                </Label>
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, withdrawalAdRequirementEnabled: !settings.withdrawalAdRequirementEnabled })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    settings.withdrawalAdRequirementEnabled ? 'bg-emerald-500' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      settings.withdrawalAdRequirementEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {settings.withdrawalAdRequirementEnabled 
                  ? 'Users must watch ads before each withdrawal' 
                  : 'Ad requirement disabled - users can withdraw immediately'}
              </p>
              <div className="mt-2">
                <Label className="text-xs">Minimum Ads Required</Label>
                <Input
                  type="number"
                  value={settings.minimumAdsForWithdrawal}
                  onChange={(e) => setSettings({ ...settings, minimumAdsForWithdrawal: e.target.value })}
                  placeholder="100"
                  min="0"
                  disabled={!settings.withdrawalAdRequirementEnabled}
                  className={`h-8 mt-1 ${!settings.withdrawalAdRequirementEnabled ? 'opacity-50' : ''}`}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Current: {settingsData?.minimumAdsForWithdrawal || 100} ads (resets after each withdrawal)
                </p>
              </div>
            </div>

            <div className="space-y-2 p-3 border rounded-lg bg-blue-50/5 border-blue-500/20 md:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">
                  <i className="fas fa-user-plus mr-2 text-blue-500"></i>
                  Withdrawal Invite Requirement
                </Label>
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, withdrawalInviteRequirementEnabled: !settings.withdrawalInviteRequirementEnabled })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    settings.withdrawalInviteRequirementEnabled ? 'bg-blue-500' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      settings.withdrawalInviteRequirementEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {settings.withdrawalInviteRequirementEnabled 
                  ? 'Users must invite friends before withdrawing' 
                  : 'Invite requirement disabled - users can withdraw without invites'}
              </p>
              <div className="mt-2">
                <Label className="text-xs">Minimum Invites Required</Label>
                <Input
                  type="number"
                  value={settings.minimumInvitesForWithdrawal}
                  onChange={(e) => setSettings({ ...settings, minimumInvitesForWithdrawal: e.target.value })}
                  placeholder="3"
                  min="0"
                  disabled={!settings.withdrawalInviteRequirementEnabled}
                  className={`h-8 mt-1 ${!settings.withdrawalInviteRequirementEnabled ? 'opacity-50' : ''}`}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Current: {settingsData?.minimumInvitesForWithdrawal || 3} valid invites (friends who watched 1+ ads)
                </p>
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'tasks' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                <i className="fas fa-bullhorn mr-2 text-cyan-600"></i>
                Channel Task
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Cost (USD)</Label>
                  <Input
                    type="number"
                    value={settings.channelTaskCost}
                    onChange={(e) => setSettings({ ...settings, channelTaskCost: e.target.value })}
                    placeholder="0.003"
                    step="0.0001"
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Cost (TON)</Label>
                  <Input
                    type="number"
                    value={settings.channelTaskCostTON}
                    onChange={(e) => setSettings({ ...settings, channelTaskCostTON: e.target.value })}
                    placeholder="0.0003"
                    step="0.0001"
                    className="h-8"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Reward (PAD)</Label>
                <Input
                  type="number"
                  value={settings.channelTaskReward}
                  onChange={(e) => setSettings({ ...settings, channelTaskReward: e.target.value })}
                  placeholder="30"
                  className="h-8"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                <i className="fas fa-robot mr-2 text-purple-600"></i>
                Bot Task
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Cost (USD)</Label>
                  <Input
                    type="number"
                    value={settings.botTaskCost}
                    onChange={(e) => setSettings({ ...settings, botTaskCost: e.target.value })}
                    placeholder="0.003"
                    step="0.0001"
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Cost (TON)</Label>
                  <Input
                    type="number"
                    value={settings.botTaskCostTON}
                    onChange={(e) => setSettings({ ...settings, botTaskCostTON: e.target.value })}
                    placeholder="0.0003"
                    step="0.0001"
                    className="h-8"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Reward (PAD)</Label>
                <Input
                  type="number"
                  value={settings.botTaskReward}
                  onChange={(e) => setSettings({ ...settings, botTaskReward: e.target.value })}
                  placeholder="20"
                  className="h-8"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="partner-task-reward" className="text-sm font-semibold">
                <i className="fas fa-handshake mr-2 text-green-600"></i>
                Partner Task Reward (PAD)
              </Label>
              <Input
                id="partner-task-reward"
                type="number"
                value={settings.partnerTaskReward}
                onChange={(e) => setSettings({ ...settings, partnerTaskReward: e.target.value })}
                placeholder="5"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.partnerTaskReward || 5} PAD
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minimum-clicks" className="text-sm font-semibold">
                <i className="fas fa-mouse-pointer mr-2 text-pink-600"></i>
                Minimum Clicks
              </Label>
              <Input
                id="minimum-clicks"
                type="number"
                value={settings.minimumClicks}
                onChange={(e) => setSettings({ ...settings, minimumClicks: e.target.value })}
                placeholder="500"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.minimumClicks || 500} clicks
              </p>
            </div>
          </div>
        )}

        {activeCategory === 'bug' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="bug-reward-per-ad" className="text-sm font-semibold">
                <i className="fas fa-bug mr-2 text-lime-600"></i>
                BUG Per Ad Watch
              </Label>
              <Input
                id="bug-reward-per-ad"
                type="number"
                value={settings.bugRewardPerAd}
                onChange={(e) => setSettings({ ...settings, bugRewardPerAd: e.target.value })}
                placeholder="1"
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.bugRewardPerAd || 1} BUG
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bug-reward-per-task" className="text-sm font-semibold">
                <i className="fas fa-tasks mr-2 text-lime-600"></i>
                BUG Per Task
              </Label>
              <Input
                id="bug-reward-per-task"
                type="number"
                value={settings.bugRewardPerTask}
                onChange={(e) => setSettings({ ...settings, bugRewardPerTask: e.target.value })}
                placeholder="10"
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.bugRewardPerTask || 10} BUG
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bug-reward-per-referral" className="text-sm font-semibold">
                <i className="fas fa-users mr-2 text-lime-600"></i>
                BUG Per Referral
              </Label>
              <Input
                id="bug-reward-per-referral"
                type="number"
                value={settings.bugRewardPerReferral}
                onChange={(e) => setSettings({ ...settings, bugRewardPerReferral: e.target.value })}
                placeholder="50"
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.bugRewardPerReferral || 50} BUG
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minimum-bug-for-withdrawal" className="text-sm font-semibold">
                <i className="fas fa-wallet mr-2 text-lime-600"></i>
                Min BUG for Withdrawal
              </Label>
              <Input
                id="minimum-bug-for-withdrawal"
                type="number"
                value={settings.minimumBugForWithdrawal}
                onChange={(e) => setSettings({ ...settings, minimumBugForWithdrawal: e.target.value })}
                placeholder="1000"
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.minimumBugForWithdrawal || 1000} BUG (1000 BUG = $0.1)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pad-to-bug-rate" className="text-sm font-semibold">
                <i className="fas fa-exchange-alt mr-2 text-lime-600"></i>
                PAD to BUG Rate
              </Label>
              <Input
                id="pad-to-bug-rate"
                type="number"
                value={settings.padToBugRate}
                onChange={(e) => setSettings({ ...settings, padToBugRate: e.target.value })}
                placeholder="1"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                1 PAD = {settingsData?.padToBugRate || 1} BUG
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minimum-convert-pad-to-bug" className="text-sm font-semibold">
                <i className="fas fa-coins mr-2 text-lime-600"></i>
                Min PAD to Convert to BUG
              </Label>
              <Input
                id="minimum-convert-pad-to-bug"
                type="number"
                value={settings.minimumConvertPadToBug}
                onChange={(e) => setSettings({ ...settings, minimumConvertPadToBug: e.target.value })}
                placeholder="1000"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.minimumConvertPadToBug || 1000} PAD
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bug-per-usd" className="text-sm font-semibold">
                <i className="fas fa-dollar-sign mr-2 text-lime-600"></i>
                BUG per USD (Withdrawal)
              </Label>
              <Input
                id="bug-per-usd"
                type="number"
                value={settings.bugPerUsd}
                onChange={(e) => setSettings({ ...settings, bugPerUsd: e.target.value })}
                placeholder="10000"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                1 USD = {settingsData?.bugPerUsd || 10000} BUG required for withdrawal
              </p>
            </div>

            <div className="space-y-2 p-3 border rounded-lg bg-lime-50/5 border-lime-500/20 md:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">
                  <i className="fas fa-bug mr-2 text-lime-500"></i>
                  Withdrawal BUG Requirement
                </Label>
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, withdrawalBugRequirementEnabled: !settings.withdrawalBugRequirementEnabled })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    settings.withdrawalBugRequirementEnabled ? 'bg-lime-500' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      settings.withdrawalBugRequirementEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {settings.withdrawalBugRequirementEnabled 
                  ? 'Users must have enough BUG (based on USD amount × BUG per USD) to withdraw' 
                  : 'BUG requirement disabled - users can withdraw without BUG'}
              </p>
            </div>
          </div>
        )}

        {activeCategory === 'other' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="wallet-change-fee" className="text-sm font-semibold">
                <i className="fas fa-exchange-alt mr-2 text-yellow-600"></i>
                Wallet Change Fee (PAD)
              </Label>
              <Input
                id="wallet-change-fee"
                type="number"
                value={settings.walletChangeFee}
                onChange={(e) => setSettings({ ...settings, walletChangeFee: e.target.value })}
                placeholder="5000"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.walletChangeFee || 5000} PAD
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minimum-convert-pad" className="text-sm font-semibold">
                <i className="fas fa-repeat mr-2 text-indigo-600"></i>
                Min Convert (PAD)
              </Label>
              <Input
                id="minimum-convert-pad"
                type="number"
                value={settings.minimumConvertPAD}
                onChange={(e) => setSettings({ ...settings, minimumConvertPAD: e.target.value })}
                placeholder="100"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.minimumConvertPAD || 100} PAD
              </p>
            </div>

            <div className="space-y-2 p-3 border rounded-lg">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">
                  <i className="fas fa-broadcast-tower mr-2 text-cyan-600"></i>
                  Season Broadcast
                </Label>
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, seasonBroadcastActive: !settings.seasonBroadcastActive })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    settings.seasonBroadcastActive ? 'bg-green-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      settings.seasonBroadcastActive ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {settings.seasonBroadcastActive ? 'Active' : 'Inactive'}
              </p>
            </div>

            <Link href="/admin/country-controls">
              <div className="space-y-2 p-3 border border-blue-500/30 rounded-lg bg-gradient-to-r from-blue-500/10 to-blue-500/5 hover:border-blue-500/50 cursor-pointer transition-all">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold cursor-pointer">
                    <i className="fas fa-globe mr-2 text-blue-500"></i>
                    Country Controls
                  </Label>
                  <i className="fas fa-chevron-right text-blue-500 text-xs"></i>
                </div>
                <p className="text-xs text-muted-foreground">
                  Block or allow access from specific countries
                </p>
              </div>
            </Link>
          </div>
        )}
        
        <div className="pt-3 border-t flex gap-2">
          <Button
            onClick={handleSaveSettings}
            disabled={isSaving}
            size="sm"
          >
            {isSaving ? (
              <>
                <i className="fas fa-spinner fa-spin mr-2"></i>
                Saving...
              </>
            ) : (
              <>
                <i className="fas fa-save mr-2"></i>
                Save Settings
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface AdminTask {
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
  advertiserUid: string;
  advertiserName: string;
  advertiserTelegramUsername: string;
  createdAt: string;
  completedAt?: string;
}

function TaskManagementSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTaskFilter, setActiveTaskFilter] = useState<'pending' | 'all'>('pending');

  const { data: pendingTasksData, isLoading: pendingLoading } = useQuery({
    queryKey: ["/api/admin/pending-tasks"],
    queryFn: () => apiRequest("GET", "/api/admin/pending-tasks").then(res => res.json()),
    refetchInterval: 10000,
  });

  const { data: allTasksData, isLoading: allLoading } = useQuery({
    queryKey: ["/api/admin/all-tasks"],
    queryFn: () => apiRequest("GET", "/api/admin/all-tasks").then(res => res.json()),
    refetchInterval: 30000,
  });

  const approveTask = async (taskId: string) => {
    try {
      const res = await apiRequest("POST", `/api/admin/tasks/${taskId}/approve`);
      const data = await res.json();
      if (data.success) {
        toast({ title: "Task approved", description: "Task is now running" });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/all-tasks"] });
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to approve task", variant: "destructive" });
    }
  };

  const rejectTask = async (taskId: string) => {
    try {
      const res = await apiRequest("POST", `/api/admin/tasks/${taskId}/reject`);
      const data = await res.json();
      if (data.success) {
        toast({ title: "Task rejected" });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/all-tasks"] });
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to reject task", variant: "destructive" });
    }
  };

  const pauseTask = async (taskId: string) => {
    try {
      const res = await apiRequest("POST", `/api/admin/tasks/${taskId}/pause`);
      const data = await res.json();
      if (data.success) {
        toast({ title: "Task paused" });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/all-tasks"] });
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to pause task", variant: "destructive" });
    }
  };

  const resumeTask = async (taskId: string) => {
    try {
      const res = await apiRequest("POST", `/api/admin/tasks/${taskId}/resume`);
      const data = await res.json();
      if (data.success) {
        toast({ title: "Task resumed" });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/all-tasks"] });
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to resume task", variant: "destructive" });
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      const res = await apiRequest("DELETE", `/api/admin/tasks/${taskId}`);
      const data = await res.json();
      if (data.success) {
        toast({ title: "Task deleted" });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/all-tasks"] });
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete task", variant: "destructive" });
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      under_review: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      running: "bg-green-500/20 text-green-400 border-green-500/30",
      paused: "bg-orange-500/20 text-orange-400 border-orange-500/30",
      completed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      rejected: "bg-red-500/20 text-red-400 border-red-500/30",
    };
    const labels: Record<string, string> = {
      under_review: "Under Review",
      running: "Running",
      paused: "Paused",
      completed: "Completed",
      rejected: "Rejected",
    };
    return (
      <Badge className={`text-xs ${styles[status] || 'bg-gray-500/20 text-gray-400'}`}>
        {labels[status] || status}
      </Badge>
    );
  };

  const pendingTasks: AdminTask[] = pendingTasksData?.tasks || [];
  const allTasks: AdminTask[] = allTasksData?.tasks || [];
  const displayTasks = activeTaskFilter === 'pending' ? pendingTasks : allTasks;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={activeTaskFilter === 'pending' ? 'default' : 'outline'}
            onClick={() => setActiveTaskFilter('pending')}
            className="text-xs"
          >
            Pending Review ({pendingTasks.length})
          </Button>
          <Button
            size="sm"
            variant={activeTaskFilter === 'all' ? 'default' : 'outline'}
            onClick={() => setActiveTaskFilter('all')}
            className="text-xs"
          >
            All Tasks ({allTasks.length})
          </Button>
        </div>
        <Link href="/task/create">
          <Button size="sm" className="text-xs bg-[#4cd3ff] hover:bg-[#6ddeff] text-black">
            <i className="fas fa-plus mr-1.5"></i>
            Create Task
          </Button>
        </Link>
      </div>

      {(activeTaskFilter === 'pending' ? pendingLoading : allLoading) ? (
        <div className="text-center py-8">
          <i className="fas fa-spinner fa-spin text-2xl text-muted-foreground"></i>
        </div>
      ) : displayTasks.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {activeTaskFilter === 'pending' ? 'No pending tasks' : 'No tasks found'}
        </div>
      ) : (
        <div className="space-y-3">
          {displayTasks.map((task) => (
            <div key={task.id} className="bg-[#121212] border border-white/10 rounded-xl p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    {getStatusBadge(task.status)}
                    <span className="text-xs text-muted-foreground uppercase">{task.taskType}</span>
                  </div>
                  <h3 className="font-semibold text-white text-sm mb-1">{task.title}</h3>
                  <a 
                    href={task.link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline break-all"
                  >
                    {task.link}
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-xs">
                <div className="bg-[#1a1a1a] rounded-lg p-2">
                  <p className="text-gray-500 mb-0.5">UID</p>
                  <p className="text-white font-mono">{task.advertiserUid}</p>
                </div>
                <div className="bg-[#1a1a1a] rounded-lg p-2">
                  <p className="text-gray-500 mb-0.5">User</p>
                  <p className="text-white">{task.advertiserName}</p>
                </div>
                <div className="bg-[#1a1a1a] rounded-lg p-2">
                  <p className="text-gray-500 mb-0.5">Telegram</p>
                  <p className="text-white">@{task.advertiserTelegramUsername || 'N/A'}</p>
                </div>
                <div className="bg-[#1a1a1a] rounded-lg p-2">
                  <p className="text-gray-500 mb-0.5">Clicks</p>
                  <p className="text-white">{task.currentClicks}/{task.totalClicksRequired}</p>
                </div>
                <div className="bg-[#1a1a1a] rounded-lg p-2">
                  <p className="text-gray-500 mb-0.5">Amount</p>
                  <p className="text-white">${parseFloat(task.totalCost).toFixed(2)}</p>
                </div>
                <div className="bg-[#1a1a1a] rounded-lg p-2">
                  <p className="text-gray-500 mb-0.5">Created</p>
                  <p className="text-white">{new Date(task.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                {task.status === 'under_review' && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => approveTask(task.id)}
                      className="bg-green-600 hover:bg-green-700 text-white text-xs"
                    >
                      <i className="fas fa-check mr-1"></i>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => rejectTask(task.id)}
                      className="bg-red-600 hover:bg-red-700 text-white text-xs"
                    >
                      <i className="fas fa-times mr-1"></i>
                      Reject
                    </Button>
                  </>
                )}
                {task.status === 'running' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => pauseTask(task.id)}
                    className="text-xs"
                  >
                    <i className="fas fa-pause mr-1"></i>
                    Pause
                  </Button>
                )}
                {task.status === 'paused' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resumeTask(task.id)}
                    className="text-xs"
                  >
                    <i className="fas fa-play mr-1"></i>
                    Resume
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => deleteTask(task.id)}
                  className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <i className="fas fa-trash mr-1"></i>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
