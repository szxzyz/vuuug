import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAdmin } from "@/hooks/useAdmin";
import Layout from "@/components/Layout";
import { Link } from "wouter";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatCurrency } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Crown, BarChart2, ClipboardList, Users, Tag, Wallet, ShieldOff, Trophy, Settings, Shield, Star, CheckCircle2, XCircle, Megaphone, AlertTriangle, Plus, Minus, Wrench, Target, Hash, ShieldAlert, Eye, Trash2 } from "lucide-react";
import { showNotification } from "@/components/AppNotification";

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

// ── Weekly Contest Reset Section ──────────────────────────────────────────
function ContestSection() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [weekLabel, setWeekLabel] = useState('');
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; usersReset?: number; winnersNotified?: boolean } | null>(null);

  const { data: leaderboard, isLoading: lbLoading, refetch: refetchLb } = useQuery<{ entries: { rank: number; userId: string; username: string; firstName: string; starBalance: number; prize: string }[] }>({
    queryKey: ['/api/leaderboard/weekly'],
    queryFn: () => fetch('/api/leaderboard/weekly').then(r => r.json()),
    refetchInterval: 30000,
  });

  const entries = leaderboard?.entries ?? (Array.isArray(leaderboard) ? leaderboard as any[] : []);

  const rankEmoji = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`;

  async function handleReset() {
    setResetting(true);
    setResult(null);
    try {
      const res = await apiRequest('POST', '/api/admin/contest/reset', weekLabel.trim() ? { weekLabel: weekLabel.trim() } : {});
      const data = await res.json();
      setResult(data);
      if (data.success) {
        refetchLb();
      }
    } catch (e: any) {
      setResult({ success: false, message: e.message || 'Request failed' });
    } finally {
      setResetting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Current standings card */}
      <div className="bg-[#121212] border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            <i className="fas fa-star text-amber-400"></i> Current Standings
          </p>
          <button onClick={() => refetchLb()} className="text-xs text-gray-500 hover:text-white transition-colors">
            <i className="fas fa-sync-alt"></i>
          </button>
        </div>

        {lbLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-8 bg-[#1a1a1a] rounded animate-pulse" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No participants yet this week.</p>
        ) : (
          <div className="space-y-1.5">
            {entries.slice(0, 10).map((e: any, i: number) => {
              const rank = e.rank ?? i + 1;
              const name = e.firstName || e.username || `User ${rank}`;
              const stars = (e.starBalance ?? e.weeklyStars ?? 0).toLocaleString();
              const prize = e.prize ?? '';
              return (
                <div key={e.userId ?? i} className="flex items-center justify-between bg-[#1a1a1a] rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-sm w-6 shrink-0">{rankEmoji(rank)}</span>
                    <span className="text-sm text-white truncate">{name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-xs text-amber-400 font-semibold flex items-center gap-1"><Star size={11} className="inline"/>{stars}</span>
                    {prize && <span className="text-xs text-emerald-400 font-semibold">{prize}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Result banner */}
      {result && (
        <div className={`rounded-xl p-4 border text-sm ${result.success ? 'bg-emerald-900/30 border-emerald-500/40 text-emerald-300' : 'bg-rose-900/30 border-rose-500/40 text-rose-300'}`}>
          <p className="font-semibold mb-1 flex items-center gap-1">{result.success ? <CheckCircle2 size={14}/> : <XCircle size={14}/>}{result.success ? 'Reset Complete' : 'Reset Failed'}</p>
          <p>{result.message}</p>
          {result.success && (
            <div className="mt-2 flex gap-4 text-xs text-white/60">
              <span className="flex items-center gap-1"><Users size={11}/>Users reset: <b className="text-white">{result.usersReset}</b></span>
              <span className="flex items-center gap-1"><Megaphone size={11}/>Notified: <b className="text-white">{result.winnersNotified ? 'Yes' : 'No'}</b></span>
            </div>
          )}
        </div>
      )}

      {/* Optional week label + reset button */}
      <div className="bg-[#121212] border border-white/10 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-white">End Contest & Reset</p>
        <p className="text-xs text-gray-500">
          This will send winner notifications to all admins via Telegram, then reset <b className="text-white">star_balance</b> and <b className="text-white">weekly_stars</b> to 0 for every user. This cannot be undone.
        </p>
        <div className="space-y-1.5">
          <label className="text-xs text-gray-500">Week label override <span className="text-gray-600">(optional — leave blank to use last ISO week)</span></label>
          <Input
            value={weekLabel}
            onChange={e => setWeekLabel(e.target.value)}
            placeholder="e.g. 2026-W24"
            className="h-8 text-sm bg-[#1a1a1a] border-white/10"
          />
        </div>
        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={resetting}
          className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold h-10"
        >
          {resetting ? (
            <><i className="fas fa-spinner fa-spin mr-2"></i>Resetting…</>
          ) : (
            <><i className="fas fa-trophy mr-2"></i>End Contest & Reset All Stars</>
          )}
        </Button>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-[#121212] border border-white/10 text-white max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <i className="fas fa-exclamation-triangle text-amber-400"></i> Confirm Reset
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <p className="text-sm text-gray-300">
              You are about to end the weekly contest. This will:
            </p>
            <ul className="text-sm text-gray-400 space-y-1 list-none pl-2">
              <li className="flex items-center gap-1"><Megaphone size={12}/>Send winner list to all admins on Telegram</li>
              <li className="flex items-center gap-1"><Star size={12}/>Reset <b className="text-white">star_balance</b> + <b className="text-white">weekly_stars</b> to 0</li>
              <li className="flex items-center gap-1"><Hash size={12}/>Affect <b className="text-white">{entries.length > 0 ? `${entries.length}+` : 'all'}</b> users</li>
            </ul>
            {weekLabel.trim() && (
              <p className="text-xs bg-amber-900/30 border border-amber-500/30 text-amber-300 rounded-lg px-3 py-2">
                Week override: <b>{weekLabel.trim()}</b>
              </p>
            )}
            <p className="text-xs text-rose-400 font-medium flex items-center gap-1"><AlertTriangle size={12}/>This action cannot be undone.</p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} className="flex-1 h-9 border-white/10 text-gray-300">
                Cancel
              </Button>
              <Button
                onClick={handleReset}
                disabled={resetting}
                className="flex-1 h-9 bg-rose-600 hover:bg-rose-700 text-white font-semibold"
              >
                {resetting ? <i className="fas fa-spinner fa-spin"></i> : 'Yes, Reset Now'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminPage() {
  const { isAdmin, isLoading: adminLoading, role, can } = useAdmin();
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

  // Fetch pending withdrawals
  const { data: pendingWithdrawalsData, refetch: refetchPending } = useQuery({
    queryKey: ["/api/admin/withdrawals/pending"],
    queryFn: () => apiRequest("GET", "/api/admin/withdrawals/pending").then(res => res.json()),
    refetchInterval: 15000,
    enabled: isAdmin,
  });

  // Fetch processed withdrawals
  const { data: processedWithdrawalsData, refetch: refetchProcessed } = useQuery({
    queryKey: ["/api/admin/withdrawals/processed"],
    queryFn: () => apiRequest("GET", "/api/admin/withdrawals/processed").then(res => res.json()),
    refetchInterval: 30000,
    enabled: isAdmin,
  });

  // Combine pending + processed into one list (pending first)
  const payoutLogsData = {
    withdrawals: [
      ...(pendingWithdrawalsData?.withdrawals || []),
      ...(processedWithdrawalsData?.withdrawals || []),
    ]
  };

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
              showNotification("Refreshed");
            }}
            className="h-8 px-3 text-xs"
          >
            <i className="fas fa-sync-alt"></i>
          </Button>
        </div>

        {/* Tabs Navigation - Move to Top */}
        <Tabs defaultValue="summary" className="w-full">
          <div className="overflow-x-auto mb-3 [&::-webkit-scrollbar]:hidden" style={{ WebkitOverflowScrolling: 'touch' } as any}>
          <TabsList className="flex w-max min-w-full h-auto p-1 gap-0.5">
            {([
              { value: 'summary',  icon: <BarChart2 size={13}/>,    label: 'Summary' },
              { value: 'tasks',    icon: <ClipboardList size={13}/>, label: 'Tasks' },
              { value: 'users',    icon: <Users size={13}/>,         label: 'Users' },
              { value: 'promos',   icon: <Tag size={13}/>,           label: 'Promos' },
              { value: 'payouts',  icon: <Wallet size={13}/>,        label: 'Payouts' },
              { value: 'bans',     icon: <ShieldOff size={13}/>,     label: 'Bans' },
              { value: 'security', icon: <ShieldAlert size={13}/>,   label: 'Security' },
              { value: 'contest',  icon: <Trophy size={13}/>,        label: 'Contest' },
              { value: 'settings', icon: <Settings size={13}/>,      label: 'Settings' },
              ...(can('manage_admins') ? [{ value: 'admins', icon: <Shield size={13}/>, label: 'Admins' }] : []),
            ] as { value: string; icon: React.ReactNode; label: string }[]).map(tab => (
              <TabsTrigger key={tab.value} value={tab.value} className="flex-shrink-0 text-xs px-3 py-1.5 whitespace-nowrap flex items-center gap-1">
                {tab.icon}{tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          </div>

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
                    label="POW Earned" 
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
          
          {/* Security Tab */}
          <TabsContent value="security" className="mt-0">
            <SecuritySection />
          </TabsContent>

          {/* Contest Tab */}
          <TabsContent value="contest" className="mt-0">
            <ContestSection />
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="mt-0">
            <SettingsSection />
          </TabsContent>

          {can('manage_admins') && (
            <TabsContent value="admins" className="mt-0">
              <AdminManagementSection />
            </TabsContent>
          )}
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
        showNotification(result.message);
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
        onSuccess();
      } else {
        throw new Error(result.message || 'Failed to update ban status');
      }
    } catch (error: any) {
      showNotification(error.message || "Failed to update user status", "error");
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

type UserProfileTab = 'overview' | 'tasks' | 'ads' | 'referrals' | 'withdrawals' | 'bans' | 'balance';

function UserProfileTabs({ user, onClose }: { user: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<UserProfileTab>('overview');
  const [balanceForm, setBalanceForm] = useState({ action: 'add', currency: 'pow', amount: '', reason: '' });
  const [isAdjusting, setIsAdjusting] = useState(false);

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
  const { data: balanceLog } = useQuery({
    queryKey: ["/api/admin/balance-log", user.id],
    queryFn: () => apiRequest("GET", `/api/admin/users/${user.id}/balance-log`).then(res => res.json()),
    enabled: activeTab === 'balance',
  });

  const handleAdjustBalance = async () => {
    const amt = parseFloat(balanceForm.amount);
    if (isNaN(amt) || amt < 0) { showNotification('Enter valid amount', 'error'); return; }
    setIsAdjusting(true);
    try {
      const res = await apiRequest('POST', `/api/admin/users/${user.id}/adjust-balance`, balanceForm);
      const data = await res.json();
      if (data.success) {
        showNotification(`Balance updated: ${data.previous} → ${data.newBalance}`, 'success');
        setBalanceForm({ ...balanceForm, amount: '', reason: '' });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/balance-log", user.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      } else {
        showNotification(data.error || 'Failed', 'error');
      }
    } catch (e: any) {
      showNotification(e.message || 'Error', 'error');
    } finally {
      setIsAdjusting(false);
    }
  };

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'balance' as const, label: 'Balance' },
    { id: 'tasks' as const, label: 'Tasks' },
    { id: 'ads' as const, label: 'Ads' },
    { id: 'referrals' as const, label: 'Referrals' },
    { id: 'withdrawals' as const, label: 'Withdrawals' },
    { id: 'bans' as const, label: 'Bans' },
  ];

  const formatPOW = (value: any) => {
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
              <div><p className="text-xs text-muted-foreground">POW</p><p className="font-bold text-[#4cd3ff]">{formatPOW(user.balance)}</p></div>
              <div><p className="text-xs text-muted-foreground">TON</p><p className="font-bold text-purple-400">{parseFloat(user.tonBalance || '0').toFixed(4)}</p></div>
              <div><p className="text-xs text-muted-foreground">USD</p><p className="font-bold text-green-400">${parseFloat(user.usdBalance || '0').toFixed(2)}</p></div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 p-3 rounded">
            <p className="text-xs text-muted-foreground mb-2">Earnings</p>
            <div className="grid grid-cols-2 gap-2">
              <div><p className="text-xs text-muted-foreground">Total Earned</p><p className="font-bold text-emerald-400">{formatPOW(user.totalEarned)} POW</p></div>
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
                  <p className="text-xs text-green-400">Reward: {formatPOW(task.reward)} POW</p>
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

      {activeTab === 'balance' && (
        <div className="space-y-3">
          <div className="bg-white/5 border border-white/10 p-3 rounded">
            <p className="text-xs text-muted-foreground mb-2 font-semibold">Current Balances</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-xs text-muted-foreground">POW</p><p className="font-bold text-[#4cd3ff]">{Math.round(parseFloat(user.balance || '0')).toLocaleString()}</p></div>
              <div><p className="text-xs text-muted-foreground">STAR</p><p className="font-bold text-yellow-400">{Math.round(parseFloat(user.starBalance || '0'))}</p></div>
              <div><p className="text-xs text-muted-foreground">USD</p><p className="font-bold text-green-400">${parseFloat(user.usdBalance || '0').toFixed(2)}</p></div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 p-3 rounded space-y-2">
            <p className="text-xs text-muted-foreground font-semibold">Adjust Balance</p>
            <div className="grid grid-cols-3 gap-1">
              {(['add', 'deduct', 'set'] as const).map(a => (
                <Button key={a} size="sm" variant={balanceForm.action === a ? 'default' : 'outline'}
                  onClick={() => setBalanceForm(f => ({ ...f, action: a }))}
                  className={`h-7 text-xs ${balanceForm.action === a && a === 'add' ? 'bg-green-600' : balanceForm.action === a && a === 'deduct' ? 'bg-red-600' : balanceForm.action === a ? 'bg-blue-600' : ''}`}>
                  {a === 'add' ? <><Plus size={11}/>Add</> : a === 'deduct' ? <><Minus size={11}/>Deduct</> : <><Wrench size={11}/>Set</>}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(['pow', 'star', 'usd'] as const).map(c => (
                <Button key={c} size="sm" variant={balanceForm.currency === c ? 'default' : 'outline'}
                  onClick={() => setBalanceForm(f => ({ ...f, currency: c }))}
                  className="h-7 text-xs">
                  {c.toUpperCase()}
                </Button>
              ))}
            </div>
            <Input type="number" placeholder="Amount" value={balanceForm.amount} min="0"
              onChange={e => setBalanceForm(f => ({ ...f, amount: e.target.value }))} className="h-8 text-sm" />
            <Input placeholder="Reason (optional)" value={balanceForm.reason}
              onChange={e => setBalanceForm(f => ({ ...f, reason: e.target.value }))} className="h-8 text-sm" />
            <Button onClick={handleAdjustBalance} disabled={isAdjusting || !balanceForm.amount} className="w-full h-8 text-sm">
              {isAdjusting ? 'Processing...' : <span className="flex items-center gap-1 justify-center">{balanceForm.action === 'add' ? <Plus size={12}/> : balanceForm.action === 'deduct' ? <Minus size={12}/> : <Wrench size={12}/>}{balanceForm.action === 'add' ? 'Add' : balanceForm.action === 'deduct' ? 'Deduct' : 'Set'} {balanceForm.amount || '0'} {balanceForm.currency.toUpperCase()}</span>}
            </Button>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2 font-semibold">Adjustment History</p>
            {(balanceLog?.logs?.length || 0) === 0 ? (
              <p className="text-center text-muted-foreground py-3 text-xs">No adjustments</p>
            ) : (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {balanceLog.logs.map((log: any) => (
                  <div key={log.id} className="bg-white/5 p-2 rounded border border-white/10 text-xs">
                    <div className="flex justify-between items-center">
                      <span className={log.type === 'addition' ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                        {log.type === 'addition' ? '+' : '-'}{parseFloat(log.amount).toLocaleString()}
                      </span>
                      <span className="text-muted-foreground">{log.source?.replace('admin_', '')}</span>
                      <span className="text-muted-foreground">{log.createdAt ? new Date(log.createdAt).toLocaleDateString() : 'N/A'}</span>
                    </div>
                    {log.description && <p className="text-muted-foreground mt-0.5">{log.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
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
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim().toLowerCase();
    return (
      user.personalCode?.toLowerCase().includes(search) ||
      user.referralCode?.toLowerCase().includes(search) ||
      user.firstName?.toLowerCase().includes(search) ||
      user.lastName?.toLowerCase().includes(search) ||
      user.username?.toLowerCase().includes(search) ||
      user.telegramId?.toString().includes(search) ||
      user.telegram_id?.toString().includes(search) ||
      fullName.includes(search)
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
            placeholder="Search by name, @username, UID, Telegram ID..."
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
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<PromoTab>('create');
  const [formData, setFormData] = useState({
    code: '',
    rewardAmount: '',
    rewardType: 'TON' as 'POW' | 'TON' | 'USD' | 'STAR',
    usageLimit: '',
    perUserLimit: '1',
    expiresAt: ''
  });
  const [isCreating, setIsCreating] = useState(false);

  const handleGenerateCode = () => {
    const randomCode = 'PROMO' + Math.random().toString(36).substring(2, 10).toUpperCase();
    setFormData({ ...formData, code: randomCode });
    showNotification(randomCode);
  };

  const { data: promoCodesData } = useQuery({
    queryKey: ["/api/admin/promo-codes"],
    queryFn: () => apiRequest("GET", "/api/admin/promo-codes").then(res => res.json()),
    refetchInterval: 5000,
  });

  const handleCreate = async () => {
    if (!formData.code.trim() || !formData.rewardAmount) {
      showNotification("Code and amount required", "error");
      return;
    }
    const rewardAmount = parseFloat(formData.rewardAmount);
    if (isNaN(rewardAmount) || rewardAmount <= 0) {
      showNotification("Amount must be positive", "error");
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
        showNotification(`${rewardAmount} ${formData.rewardType}`);
        setFormData({ code: '', rewardAmount: '', rewardType: 'TON', usageLimit: '', perUserLimit: '1', expiresAt: '' });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/promo-codes"] });
        setActiveTab('manage');
      } else {
        throw new Error(result.message);
      }
    } catch (error: any) {
      showNotification(error.message, "error");
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
    showNotification(code);
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
            {(['POW', 'TON', 'USD', 'STAR'] as const).map(type => (
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
        <div className="space-y-2 max-h-[350px] overflow-y-auto border border-white/10 rounded-lg p-2">
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
                    <div className="flex items-center gap-1">
                      <Badge className={`${status.color} text-[10px]`}>{status.label}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className={`h-6 text-[10px] px-2 ${promo.isActive ? 'border-red-500/50 text-red-400 hover:bg-red-500/10' : 'border-green-500/50 text-green-400 hover:bg-green-500/10'}`}
                        onClick={async () => {
                          try {
                            const res = await apiRequest('PUT', `/api/admin/promo-codes/${promo.id}`, { isActive: !promo.isActive });
                            const d = await res.json();
                            if (d.success) {
                              showNotification(promo.isActive ? 'Code disabled' : 'Code enabled', 'success');
                              queryClient.invalidateQueries({ queryKey: ["/api/admin/promo-codes"] });
                            }
                          } catch (e) { showNotification('Failed', 'error'); }
                        }}
                      >
                        {promo.isActive ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs mt-1 text-muted-foreground"><span>{promo.rewardType === 'USD' ? `$${parseFloat(promo.rewardAmount).toFixed(2)}` : `${Math.round(parseFloat(promo.rewardAmount))} ${promo.rewardType || 'POW'}`}</span><span>{promo.usageCount || 0}/{promo.usageLimit || '∞'}</span></div>
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
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<PayoutTab>('pending');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const itemsPerPage = 10;
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/admin/withdrawals/pending'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/withdrawals/processed'] });
  };

  const handleApprove = async (withdrawalId: string) => {
    setActionLoading(withdrawalId + '_approve');
    try {
      const res = await apiRequest('POST', `/api/admin/withdrawals/${withdrawalId}/approve`, { adminNotes: 'Approved via admin panel' });
      const d = await res.json();
      if (d.success) {
        showNotification('✅ Withdrawal approved', 'success');
        refreshAll();
      } else {
        showNotification(d.message || 'Failed to approve', 'error');
      }
    } catch { showNotification('Failed to approve', 'error'); }
    setActionLoading(null);
  };

  const openRejectDialog = (withdrawalId: string) => {
    setRejectTarget(withdrawalId);
    setRejectReason('');
    setRejectDialogOpen(true);
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setActionLoading(rejectTarget + '_reject');
    setRejectDialogOpen(false);
    try {
      const res = await apiRequest('POST', `/api/admin/withdrawals/${rejectTarget}/reject`, { reason: rejectReason || 'Rejected by admin', adminNotes: rejectReason || 'Rejected by admin' });
      const d = await res.json();
      if (d.success) {
        showNotification('❌ Withdrawal rejected', 'success');
        refreshAll();
      } else {
        showNotification(d.message || 'Failed to reject', 'error');
      }
    } catch { showNotification('Failed to reject', 'error'); }
    setActionLoading(null);
    setRejectTarget(null);
  };

  const openAnalytics = async (userId: string) => {
    setAnalyticsOpen(true);
    setAnalyticsData(null);
    setAnalyticsLoading(true);
    try {
      const res = await apiRequest('GET', `/api/admin/users/${userId}/analytics`);
      const d = await res.json();
      if (d.success) setAnalyticsData(d.analytics);
    } catch (e) { /* ignore */ }
    setAnalyticsLoading(false);
  };
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
                <TableHead className="text-xs">Wallet</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedPayouts.map((payout: any) => {
                const username = payout.user?.username || payout.user?.firstName || payout.user?.telegram_id || 'N/A';
                const displayUsername = payout.user?.username ? `@${payout.user.username}` : (payout.user?.firstName || payout.user?.telegram_id || 'N/A');
                const usdAmount = parseFloat(payout.amount || '0');
                const isPending = payout.status === 'pending';
                const isApprovingThis = actionLoading === payout.id + '_approve';
                const isRejectingThis = actionLoading === payout.id + '_reject';
                const wallet = payout.details?.walletAddress || payout.details?.paymentDetails || payout.details?.address || '—';
                return (
                  <TableRow key={payout.id} className={`hover:bg-white/5 ${isPending ? 'bg-yellow-500/5' : ''}`}>
                    <TableCell className="text-xs py-2">
                      <div className="font-medium text-[#4cd3ff]">{displayUsername}</div>
                      <div className="text-[10px] text-muted-foreground">${usdAmount.toFixed(4)}</div>
                    </TableCell>
                    <TableCell className="text-xs py-2 font-semibold text-green-400">${usdAmount.toFixed(2)}</TableCell>
                    <TableCell className="text-[10px] py-2 text-muted-foreground max-w-[80px]">
                      <span className="truncate block font-mono" title={wallet}>{wallet.length > 12 ? wallet.slice(0, 10) + '…' : wallet}</span>
                    </TableCell>
                    <TableCell className="py-2">{getStatusBadge(payout.status)}</TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-1">
                        {isPending && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => handleApprove(payout.id)} disabled={!!actionLoading} className="h-6 px-2 text-[10px] text-green-400 hover:bg-green-500/10 border border-green-500/30">
                              {isApprovingThis ? <i className="fas fa-spinner fa-spin"></i> : '✓'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openRejectDialog(payout.id)} disabled={!!actionLoading} className="h-6 px-2 text-[10px] text-red-400 hover:bg-red-500/10 border border-red-500/30">
                              {isRejectingThis ? <i className="fas fa-spinner fa-spin"></i> : '✗'}
                            </Button>
                          </>
                        )}
                        {payout.userId && (
                          <Button size="sm" variant="ghost" onClick={() => openAnalytics(payout.userId)} className="h-6 px-2 text-[10px] text-[#4cd3ff] hover:bg-[#4cd3ff]/10">
                            <i className="fas fa-chart-bar"></i>
                          </Button>
                        )}
                      </div>
                    </TableCell>
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

      {/* Analytics Dialog */}
      <Dialog open={analyticsOpen} onOpenChange={setAnalyticsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <i className="fas fa-chart-bar text-[#4cd3ff]"></i>
              User Analytics
            </DialogTitle>
          </DialogHeader>
          {analyticsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <i className="fas fa-spinner fa-spin mr-2"></i>Loading...
            </div>
          ) : analyticsData ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/5 rounded-lg p-2 space-y-0.5">
                  <div className="text-muted-foreground">UID</div>
                  <div className="font-mono font-bold text-[#4cd3ff]">{analyticsData.uid || 'N/A'}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-2 space-y-0.5">
                  <div className="text-muted-foreground">Account Age</div>
                  <div className="font-bold">{analyticsData.ageDays}d</div>
                </div>
                <div className="bg-white/5 rounded-lg p-2 space-y-0.5">
                  <div className="text-muted-foreground">Ads Watched</div>
                  <div className="font-bold text-green-400">{analyticsData.adsWatched}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-2 space-y-0.5">
                  <div className="text-muted-foreground">Tasks Done</div>
                  <div className="font-bold text-blue-400">{analyticsData.tasksCompleted}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-2 space-y-0.5">
                  <div className="text-muted-foreground">Total Friends</div>
                  <div className="font-bold">{analyticsData.totalFriends}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-2 space-y-0.5">
                  <div className="text-muted-foreground">Active Friends</div>
                  <div className="font-bold text-green-400">{analyticsData.activeFriends}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-2 space-y-0.5">
                  <div className="text-muted-foreground">POW Balance</div>
                  <div className="font-bold text-yellow-400">{parseInt(analyticsData.balance || '0').toLocaleString()}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-2 space-y-0.5">
                  <div className="text-muted-foreground">USD Balance</div>
                  <div className="font-bold text-green-400">${parseFloat(analyticsData.usdBalance || '0').toFixed(4)}</div>
                </div>
              </div>
              {analyticsData.banned && (
                <div className="text-xs text-red-400 bg-red-500/10 rounded-lg p-2 flex items-center gap-2">
                  <i className="fas fa-ban"></i> This user is banned
                </div>
              )}
              {analyticsData.recentTransactions?.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Recent Transactions</div>
                  <div className="space-y-1 max-h-[120px] overflow-y-auto">
                    {analyticsData.recentTransactions.map((tx: any) => (
                      <div key={tx.id} className="flex items-center justify-between text-[10px] bg-white/5 rounded px-2 py-1">
                        <span className="text-muted-foreground truncate max-w-[120px]">{tx.type || tx.transactionType}</span>
                        <span className={tx.direction === 'credit' || tx.amount > 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                          {tx.direction === 'credit' ? '+' : ''}{tx.amountUsd ? `$${parseFloat(tx.amountUsd).toFixed(4)}` : `${parseInt(tx.amount || '0').toLocaleString()} POW`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-sm">No data available</div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Reason Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <i className="fas fa-times-circle text-red-400"></i>
              Reject Withdrawal
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Optionally provide a rejection reason for the user.</p>
            <Input
              placeholder="Reason (optional)..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setRejectDialogOpen(false)} className="text-xs h-8">
                Cancel
              </Button>
              <Button size="sm" onClick={handleReject} className="text-xs h-8 bg-red-600 hover:bg-red-700 text-white">
                Confirm Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type BanViewTab = 'logs' | 'users';

function BanLogsSection() {
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
        showNotification("The user has been successfully unbanned");
        queryClient.invalidateQueries({ queryKey: ["/api/admin/banned-users-details"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/ban-logs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      } else {
        throw new Error(result.message || 'Failed to unban user');
      }
    } catch (error: any) {
      showNotification(error.message || "Failed to unban user", "error");
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

type SettingsCategory = 'ads' | 'affiliates' | 'withdrawals' | 'tasks' | 'bug' | 'missions' | 'other';

function SettingsSection() {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('ads');
  const [isRepairingReferrals, setIsRepairingReferrals] = useState(false);
  const [referralRepairResult, setReferralRepairResult] = useState<{
    usersLinked: number;
    referralsCreated: number;
    referralsActivated: number;
    errors: number;
  } | null>(null);

  const handleReferralRepair = async () => {
    setIsRepairingReferrals(true);
    setReferralRepairResult(null);
    try {
      const res = await apiRequest("POST", "/api/admin/referrals/sync");
      const data = await res.json();
      if (data.success) {
        setReferralRepairResult(data.stats);
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      }
    } catch (err) {
      console.error("Referral repair failed:", err);
    } finally {
      setIsRepairingReferrals(false);
    }
  };
  
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["/api/admin/settings"],
    queryFn: () => apiRequest("GET", "/api/admin/settings").then(res => res.json()),
  });
  
  const [settings, setSettings] = useState({
    dailyAdLimit: '50',
    hourlyAdLimit: '63',
    rewardPerAd: '2',
    l1CommissionPercent: '20',
    l2CommissionPercent: '4',
    walletChangeFee: '100',
    minimumWithdrawalUSD: '1.00',
    minimumWithdrawalTON: '0.5',
    withdrawalFeeTON: '5',
    withdrawalFeeUSD: '3',
    withdrawalGroupChatId: '-1002480439556',
    channelTaskCost: '0.003',
    botTaskCost: '0.003',
    channelTaskCostTON: '0.0003',
    botTaskCostTON: '0.0003',
    channelTaskReward: '30',
    botTaskReward: '20',
    partnerTaskReward: '5',
    minimumConvertPOW: '100',
    minimumClicks: '500',
    seasonBroadcastActive: false,
    referralRewardEnabled: false,
    referralRewardPOWEnabled: false,
    referralRewardUSDEnabled: false,
    referralRewardUSD: '0.0005',
    referralRewardPOW: '50',
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
    // STAR currency settings (weekly contest only)
    starRewardPerAd: '1',
    starRewardPerTask: '10',
    powToStarRate: '1',
    minimumConvertPowToStar: '1000',
    weeklyGiveawayAmount: '10',
    weeklyContestEndDate: '',
    monetagMissionReward: '50',
    monetagMissionLimit: '10',
    adexiumMissionReward: '50',
    adexiumMissionLimit: '10',
    gigaPubMissionReward: '50',
    gigaPubMissionLimit: '10',
    monetixMissionReward: '1500',
    monetixMissionLimit: '25',
  });
  
  useEffect(() => {
    if (settingsData) {
      setSettings({
        dailyAdLimit: settingsData.dailyAdLimit?.toString() || '50',
        hourlyAdLimit: settingsData.hourlyAdLimit?.toString() || '63',
        rewardPerAd: settingsData.rewardPerAd?.toString() || '2',
        l1CommissionPercent: settingsData.l1CommissionPercent?.toString() || '20',
        l2CommissionPercent: settingsData.l2CommissionPercent?.toString() || '4',
        walletChangeFee: settingsData.walletChangeFee?.toString() || '100',
        minimumWithdrawalUSD: settingsData.minimumWithdrawalUSD?.toString() || '1.00',
        minimumWithdrawalTON: settingsData.minimumWithdrawalTON?.toString() || '0.5',
        withdrawalFeeTON: settingsData.withdrawalFeeTON?.toString() || '5',
        withdrawalFeeUSD: settingsData.withdrawalFeeUSD?.toString() || '3',
        withdrawalGroupChatId: settingsData.withdrawalGroupChatId?.toString() || '-1002480439556',
        channelTaskCost: settingsData.channelTaskCost?.toString() || '0.003',
        botTaskCost: settingsData.botTaskCost?.toString() || '0.003',
        channelTaskCostTON: settingsData.channelTaskCostTON?.toString() || '0.0003',
        botTaskCostTON: settingsData.botTaskCostTON?.toString() || '0.0003',
        channelTaskReward: settingsData.channelTaskReward?.toString() || '30',
        botTaskReward: settingsData.botTaskReward?.toString() || '20',
        partnerTaskReward: settingsData.partnerTaskReward?.toString() || '5',
        minimumConvertPOW: settingsData.minimumConvertPOW?.toString() || '100',
        minimumClicks: settingsData.minimumClicks?.toString() || '500',
        seasonBroadcastActive: settingsData.seasonBroadcastActive || false,
        referralRewardEnabled: settingsData.referralRewardEnabled || false,
        referralRewardPOWEnabled: settingsData.referralRewardPOWEnabled || false,
        referralRewardUSDEnabled: settingsData.referralRewardUSDEnabled || false,
        referralRewardUSD: settingsData.referralRewardUSD?.toString() || '0.0005',
        referralRewardPOW: settingsData.referralRewardPOW?.toString() || '50',
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
        // STAR currency settings (weekly contest only)
        starRewardPerAd: settingsData.starRewardPerAd?.toString() || '1',
        starRewardPerTask: settingsData.starRewardPerTask?.toString() || '10',
        powToStarRate: settingsData.powToStarRate?.toString() || '1',
        minimumConvertPowToStar: settingsData.minimumConvertPowToStar?.toString() || '1000',
        weeklyGiveawayAmount: settingsData.weeklyGiveawayAmount?.toString() || '10',
        weeklyContestEndDate: settingsData.weeklyContestEndDate?.toString() || '',
        monetagMissionReward: settingsData.monetagMissionReward?.toString() || '50',
        monetagMissionLimit: settingsData.monetagMissionLimit?.toString() || '10',
        adexiumMissionReward: settingsData.adexiumMissionReward?.toString() || '50',
        adexiumMissionLimit: settingsData.adexiumMissionLimit?.toString() || '10',
        gigaPubMissionReward: settingsData.gigaPubMissionReward?.toString() || '50',
        gigaPubMissionLimit: settingsData.gigaPubMissionLimit?.toString() || '10',
        monetixMissionReward: settingsData.monetixMissionReward?.toString() || '1500',
        monetixMissionLimit: settingsData.monetixMissionLimit?.toString() || '25',
      });
    }
  }, [settingsData]);
  
  const categories = [
    { id: 'ads' as const, label: 'Ads & Rewards', icon: 'play-circle' },
    { id: 'affiliates' as const, label: 'Affiliates', icon: 'users' },
    { id: 'withdrawals' as const, label: 'Withdrawals', icon: 'wallet' },
    { id: 'tasks' as const, label: 'Tasks', icon: 'tasks' },
    { id: 'bug' as const, label: 'STAR Currency', icon: 'star' },
    { id: 'missions' as const, label: 'Missions / ADS', icon: 'tv' },
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
    const minConvertPAD = parseInt(settings.minimumConvertPOW);
    const minClicks = parseInt(settings.minimumClicks);
    const refRewardUSD = parseFloat(settings.referralRewardUSD);
    const refRewardPAD = parseInt(settings.referralRewardPOW);
    
    if (isNaN(adLimit) || adLimit <= 0) {
      showNotification("Daily ad limit must be a positive number", "error");
      return;
    }
    
    if (isNaN(reward) || reward <= 0) {
      showNotification("Reward per ad must be a positive number", "error");
      return;
    }
    
    setIsSaving(true);
    try {
      const response = await apiRequest('PUT', '/api/admin/settings', {
        dailyAdLimit: adLimit,
        hourlyAdLimit: parseInt(settings.hourlyAdLimit) || 63,
        rewardPerAd: reward,
        l1CommissionPercent: parseFloat(settings.l1CommissionPercent) || 20,
        l2CommissionPercent: parseFloat(settings.l2CommissionPercent) || 4,
        walletChangeFee: walletFee,
        minimumWithdrawalUSD: minWithdrawalUSD,
        minimumWithdrawalTON: minWithdrawalTON,
        withdrawalFeeTON: withdrawalFeeTON,
        withdrawalFeeUSD: withdrawalFeeUSD,
        withdrawalGroupChatId: settings.withdrawalGroupChatId,
        channelTaskCost: channelCost,
        botTaskCost: botCost,
        channelTaskCostTON: channelCostTON,
        botTaskCostTON: botCostTON,
        channelTaskReward: channelReward,
        botTaskReward: botReward,
        partnerTaskReward: partnerReward,
        minimumConvertPOW: minConvertPAD,
        minimumClicks: minClicks,
        seasonBroadcastActive: settings.seasonBroadcastActive,
        referralRewardEnabled: settings.referralRewardPOWEnabled || settings.referralRewardUSDEnabled,
        referralRewardPOWEnabled: settings.referralRewardPOWEnabled,
        referralRewardUSDEnabled: settings.referralRewardUSDEnabled,
        referralRewardUSD: refRewardUSD,
        referralRewardPOW: refRewardPAD,
        referralAdsRequired: parseInt(settings.referralAdsRequired) || 1,
        withdrawalAdRequirementEnabled: settings.withdrawalAdRequirementEnabled,
        minimumAdsForWithdrawal: parseInt(settings.minimumAdsForWithdrawal) || 100,
        withdrawalInviteRequirementEnabled: settings.withdrawalInviteRequirementEnabled,
        minimumInvitesForWithdrawal: parseInt(settings.minimumInvitesForWithdrawal) || 3,
        streakReward: parseInt(settings.streakReward) || 100,
        shareTaskReward: parseInt(settings.shareTaskReward) || 1000,
        communityTaskReward: parseInt(settings.communityTaskReward) || 1000,
        // STAR currency settings (weekly contest only)
        starRewardPerAd: parseInt(settings.starRewardPerAd) || 1,
        starRewardPerTask: parseInt(settings.starRewardPerTask) || 10,
        powToStarRate: parseInt(settings.powToStarRate) || 1,
        minimumConvertPowToStar: parseInt(settings.minimumConvertPowToStar) || 1000,
        weeklyGiveawayAmount: parseFloat(settings.weeklyGiveawayAmount) || 10,
        weeklyContestEndDate: settings.weeklyContestEndDate || '',
        monetagMissionReward: parseInt(settings.monetagMissionReward) || 50,
        monetagMissionLimit: parseInt(settings.monetagMissionLimit) || 10,
        adexiumMissionReward: parseInt(settings.adexiumMissionReward) || 50,
        adexiumMissionLimit: parseInt(settings.adexiumMissionLimit) || 10,
        gigaPubMissionReward: parseInt(settings.gigaPubMissionReward) || 50,
        gigaPubMissionLimit: parseInt(settings.gigaPubMissionLimit) || 10,
        monetixMissionReward: parseInt(settings.monetixMissionReward) || 1500,
        monetixMissionLimit: parseInt(settings.monetixMissionLimit) || 25,
        shareReferralReward: parseInt((settings as any).shareReferralReward) || 1000,
        checkAnnouncementReward: parseInt((settings as any).checkAnnouncementReward) || 1000,
        adsgramCheckinReward: parseInt((settings as any).adsgramCheckinReward) || 1000,
        firstActiveReferralReward: parseInt((settings as any).firstActiveReferralReward) || 2500,
      });
      
      const result = await response.json();
      
      if (result.success) {
        showNotification("Settings updated successfully", "success");
        queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/app-settings"] });
      } else {
        throw new Error(result.message || 'Failed to update settings');
      }
    } catch (error: any) {
      showNotification(error.message || "Failed to update settings", "error");
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
                placeholder="510"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.dailyAdLimit || 510} ads/day
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hourly-ad-limit" className="text-sm font-semibold">
                <i className="fas fa-clock mr-2 text-orange-400"></i>
                Hourly Ad Limit
              </Label>
              <Input
                id="hourly-ad-limit"
                type="number"
                value={settings.hourlyAdLimit}
                onChange={(e) => setSettings({ ...settings, hourlyAdLimit: e.target.value })}
                placeholder="63"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.hourlyAdLimit || 63} ads/hour — shown on Watch page
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="reward-per-ad" className="text-sm font-semibold">
                <i className="fas fa-gem mr-2 text-purple-600"></i>
                Reward Per Ad (POW)
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
                Current: {settingsData?.rewardPerAd || 1000} POW per ad
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

            <div className="space-y-2 p-3 border rounded-lg bg-green-50/5 border-green-500/20 md:col-span-2">
              <Label className="text-sm font-semibold block mb-2">
                <i className="fas fa-gift mr-2 text-green-500"></i>
                Referral Bonus — When friend watches 1 ad
              </Label>
              <p className="text-xs text-muted-foreground mb-3">Enable POW and/or USD independently. Users receive whichever are enabled. Affiliate page shows accordingly.</p>

              <div className="grid grid-cols-1 gap-3">
                {/* PAD Toggle */}
                <div className="flex items-start gap-3 p-2 rounded-lg bg-white/5">
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, referralRewardPOWEnabled: !settings.referralRewardPOWEnabled })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors mt-0.5 flex-shrink-0 ${
                      settings.referralRewardPOWEnabled ? 'bg-green-500' : 'bg-gray-600'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${settings.referralRewardPOWEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                  <div className="flex-1">
                    <Label className="text-xs font-semibold text-green-400">POW Reward</Label>
                    <Input
                      type="number"
                      value={settings.referralRewardPOW}
                      onChange={(e) => setSettings({ ...settings, referralRewardPOW: e.target.value })}
                      placeholder="50"
                      disabled={!settings.referralRewardPOWEnabled}
                      className={`h-8 mt-1 ${!settings.referralRewardPOWEnabled ? 'opacity-50' : ''}`}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Current: {settingsData?.referralRewardPOW || 50} POW per referral</p>
                  </div>
                </div>

                {/* USD Toggle */}
                <div className="flex items-start gap-3 p-2 rounded-lg bg-white/5">
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, referralRewardUSDEnabled: !settings.referralRewardUSDEnabled })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors mt-0.5 flex-shrink-0 ${
                      settings.referralRewardUSDEnabled ? 'bg-blue-500' : 'bg-gray-600'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${settings.referralRewardUSDEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                  <div className="flex-1">
                    <Label className="text-xs font-semibold text-blue-400">USD Reward</Label>
                    <Input
                      type="number"
                      value={settings.referralRewardUSD}
                      onChange={(e) => setSettings({ ...settings, referralRewardUSD: e.target.value })}
                      placeholder="0.0005"
                      step="0.0001"
                      disabled={!settings.referralRewardUSDEnabled}
                      className={`h-8 mt-1 ${!settings.referralRewardUSDEnabled ? 'opacity-50' : ''}`}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Current: ${settingsData?.referralRewardUSD || 0.0005} per referral</p>
                  </div>
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

            <div className="space-y-2 md:col-span-2 p-3 border rounded-lg bg-blue-50/5 border-blue-500/20">
              <Label htmlFor="withdrawal-group-chat-id" className="text-sm font-semibold">
                <i className="fab fa-telegram mr-2 text-blue-500"></i>
                Withdrawal Group Chat ID
              </Label>
              <Input
                id="withdrawal-group-chat-id"
                type="text"
                value={settings.withdrawalGroupChatId}
                onChange={(e) => setSettings({ ...settings, withdrawalGroupChatId: e.target.value })}
                placeholder="-1002480439556"
              />
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground flex-1">
                  Telegram group/channel ID jahan withdrawal approvals post hoein. Current: {settingsData?.withdrawalGroupChatId || '-1002480439556'}
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const r = await fetch('/api/admin/withdrawals/test-group-notification', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                      const d = await r.json();
                      alert(d.message);
                    } catch (e) {
                      alert('Error: ' + String(e));
                    }
                  }}
                  className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
                >
                  Test Post
                </button>
              </div>
            </div>

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
                <Label className="text-xs">Reward (POW)</Label>
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
                <Label className="text-xs">Reward (POW)</Label>
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
                Partner Task Reward (POW)
              </Label>
              <Input
                id="partner-task-reward"
                type="number"
                value={settings.partnerTaskReward}
                onChange={(e) => setSettings({ ...settings, partnerTaskReward: e.target.value })}
                placeholder="5"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.partnerTaskReward || 5} POW
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
                <i className="fas fa-star mr-2 text-lime-600"></i>
                STAR Per Ad Watch
              </Label>
              <Input
                id="bug-reward-per-ad"
                type="number"
                value={settings.starRewardPerAd}
                onChange={(e) => setSettings({ ...settings, starRewardPerAd: e.target.value })}
                placeholder="1"
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.starRewardPerAd || 1} STAR
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bug-reward-per-task" className="text-sm font-semibold">
                <i className="fas fa-tasks mr-2 text-lime-600"></i>
                STAR Per Task
              </Label>
              <Input
                id="bug-reward-per-task"
                type="number"
                value={settings.starRewardPerTask}
                onChange={(e) => setSettings({ ...settings, starRewardPerTask: e.target.value })}
                placeholder="10"
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.starRewardPerTask || 10} STAR
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pad-to-bug-rate" className="text-sm font-semibold">
                <i className="fas fa-exchange-alt mr-2 text-lime-600"></i>
                POW to STAR Rate
              </Label>
              <Input
                id="pad-to-bug-rate"
                type="number"
                value={settings.powToStarRate}
                onChange={(e) => setSettings({ ...settings, powToStarRate: e.target.value })}
                placeholder="1"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                1 POW = {settingsData?.powToStarRate || 1} STAR
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minimum-convert-pad-to-bug" className="text-sm font-semibold">
                <i className="fas fa-coins mr-2 text-lime-600"></i>
                Min POW to Convert to STAR
              </Label>
              <Input
                id="minimum-convert-pad-to-bug"
                type="number"
                value={settings.minimumConvertPowToStar}
                onChange={(e) => setSettings({ ...settings, minimumConvertPowToStar: e.target.value })}
                placeholder="1000"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.minimumConvertPowToStar || 1000} POW
              </p>
            </div>

          </div>
        )}

        {activeCategory === 'missions' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2 p-3 border rounded-lg bg-[#4cd3ff]/5 border-[#4cd3ff]/20">
              <p className="text-xs text-[#4cd3ff] font-semibold mb-1">📺 Mission Page — Ad Platforms</p>
              <p className="text-xs text-muted-foreground">Set reward (POW per ad) and daily ad limit for each platform shown on the Missions page.</p>
            </div>

            {/* Monetag */}
            <div className="space-y-2 p-3 border rounded-lg border-orange-500/20 bg-orange-500/5">
              <Label className="text-sm font-semibold text-orange-400">
                <i className="fas fa-bolt mr-2"></i>Monetag
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Reward (POW/ad)</Label>
                  <Input
                    type="number"
                    value={settings.monetagMissionReward}
                    onChange={(e) => setSettings({ ...settings, monetagMissionReward: e.target.value })}
                    placeholder="50"
                    min="1"
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Daily Limit</Label>
                  <Input
                    type="number"
                    value={settings.monetagMissionLimit}
                    onChange={(e) => setSettings({ ...settings, monetagMissionLimit: e.target.value })}
                    placeholder="10"
                    min="1"
                    className="h-8"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Current: {settingsData?.monetagMissionReward || 50} POW · {settingsData?.monetagMissionLimit || 10} ads/day</p>
            </div>

            {/* GiGaPub */}
            <div className="space-y-2 p-3 border rounded-lg border-purple-500/20 bg-purple-500/5">
              <Label className="text-sm font-semibold text-purple-400">
                <i className="fas fa-globe mr-2"></i>GiGaPub
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Reward (POW/ad)</Label>
                  <Input
                    type="number"
                    value={settings.gigaPubMissionReward}
                    onChange={(e) => setSettings({ ...settings, gigaPubMissionReward: e.target.value })}
                    placeholder="50"
                    min="1"
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Daily Limit</Label>
                  <Input
                    type="number"
                    value={settings.gigaPubMissionLimit}
                    onChange={(e) => setSettings({ ...settings, gigaPubMissionLimit: e.target.value })}
                    placeholder="10"
                    min="1"
                    className="h-8"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Current: {settingsData?.gigaPubMissionReward || 50} POW · {settingsData?.gigaPubMissionLimit || 10} ads/day</p>
            </div>

            {/* Monetix */}
            <div className="space-y-2 p-3 border rounded-lg border-green-500/20 bg-green-500/5">
              <Label className="text-sm font-semibold text-green-400">
                <i className="fas fa-coins mr-2"></i>Monetix
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Reward (POW/ad)</Label>
                  <Input
                    type="number"
                    value={settings.monetixMissionReward}
                    onChange={(e) => setSettings({ ...settings, monetixMissionReward: e.target.value })}
                    placeholder="1500"
                    min="1"
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Daily Limit</Label>
                  <Input
                    type="number"
                    value={settings.monetixMissionLimit}
                    onChange={(e) => setSettings({ ...settings, monetixMissionLimit: e.target.value })}
                    placeholder="25"
                    min="1"
                    className="h-8"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Current: {settingsData?.monetixMissionReward || 1500} POW · {settingsData?.monetixMissionLimit || 25} ads/day</p>
            </div>

            {/* Daily Missions Divider */}
            <div className="md:col-span-2 p-3 border rounded-lg bg-purple-500/5 border-purple-500/20">
              <p className="text-xs text-purple-400 font-semibold mb-1 flex items-center gap-1"><CheckCircle2 size={12}/>Daily Mission Rewards</p>
              <p className="text-xs text-muted-foreground">Rewards given when users complete daily missions (once per day).</p>
            </div>

            {/* Share Referral Mission */}
            <div className="p-3 border rounded-lg border-blue-500/20 bg-blue-500/5">
              <Label className="text-xs font-semibold text-blue-400 block mb-2">🔗 Share Referral (daily)</Label>
              <Input type="number" value={(settings as any).shareReferralReward || '1000'}
                onChange={(e) => setSettings({ ...settings, shareReferralReward: e.target.value } as any)}
                placeholder="1000" min="0" className="h-8" />
            </div>

            {/* Check Announcement Mission */}
            <div className="p-3 border rounded-lg border-cyan-500/20 bg-cyan-500/5">
              <Label className="text-xs font-semibold text-cyan-400 block mb-2">📢 Check Announcement (daily)</Label>
              <Input type="number" value={(settings as any).checkAnnouncementReward || '1000'}
                onChange={(e) => setSettings({ ...settings, checkAnnouncementReward: e.target.value } as any)}
                placeholder="1000" min="0" className="h-8" />
            </div>

            {/* Adsgram Checkin Mission */}
            <div className="p-3 border rounded-lg border-orange-500/20 bg-orange-500/5">
              <Label className="text-xs font-semibold text-orange-400 flex items-center gap-1 mb-2"><Target size={12}/>Adsgram Check-in (daily)</Label>
              <Input type="number" value={(settings as any).adsgramCheckinReward || '1000'}
                onChange={(e) => setSettings({ ...settings, adsgramCheckinReward: e.target.value } as any)}
                placeholder="1000" min="0" className="h-8" />
            </div>

            {/* First Active Referral Mission */}
            <div className="p-3 border rounded-lg border-yellow-500/20 bg-yellow-500/5">
              <Label className="text-xs font-semibold text-yellow-400 flex items-center gap-1 mb-2"><Star size={12}/>First Active Referral (one-time)</Label>
              <Input type="number" value={(settings as any).firstActiveReferralReward || '2500'}
                onChange={(e) => setSettings({ ...settings, firstActiveReferralReward: e.target.value } as any)}
                placeholder="2500" min="0" className="h-8" />
            </div>
          </div>
        )}

        {activeCategory === 'other' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2 md:col-span-2 p-3 border rounded-lg border-yellow-500/20 bg-yellow-500/5">
              <Label htmlFor="weekly-giveaway-amount" className="text-sm font-semibold text-yellow-400">
                <i className="fas fa-trophy mr-2"></i>Weekly Giveaway Prize Pool (USD)
              </Label>
              <Input
                id="weekly-giveaway-amount"
                type="number"
                value={settings.weeklyGiveawayAmount}
                onChange={(e) => setSettings({ ...settings, weeklyGiveawayAmount: e.target.value })}
                placeholder="10"
                min="0"
                step="0.5"
              />
              <p className="text-xs text-muted-foreground">
                Displayed on the Home page weekly contest banner. Current: ${settingsData?.weeklyGiveawayAmount || 10}
              </p>
            </div>

            <div className="space-y-2 md:col-span-2 p-3 border rounded-lg border-cyan-500/20 bg-cyan-500/5">
              <Label htmlFor="weekly-contest-end" className="text-sm font-semibold text-cyan-400">
                <i className="fas fa-clock mr-2"></i>Weekly Contest End Date
              </Label>
              <Input
                id="weekly-contest-end"
                type="datetime-local"
                value={settings.weeklyContestEndDate}
                onChange={(e) => setSettings({ ...settings, weeklyContestEndDate: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Timer shown on Leaderboard Contest Info tab. Current: {settingsData?.weeklyContestEndDate || 'Not set'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wallet-change-fee" className="text-sm font-semibold">
                <i className="fas fa-exchange-alt mr-2 text-yellow-600"></i>
                Wallet Change Fee (POW)
              </Label>
              <Input
                id="wallet-change-fee"
                type="number"
                value={settings.walletChangeFee}
                onChange={(e) => setSettings({ ...settings, walletChangeFee: e.target.value })}
                placeholder="5000"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.walletChangeFee || 5000} POW
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minimum-convert-pad" className="text-sm font-semibold">
                <i className="fas fa-repeat mr-2 text-indigo-600"></i>
                Min Convert (POW)
              </Label>
              <Input
                id="minimum-convert-pad"
                type="number"
                value={settings.minimumConvertPOW}
                onChange={(e) => setSettings({ ...settings, minimumConvertPOW: e.target.value })}
                placeholder="100"
              />
              <p className="text-xs text-muted-foreground">
                Current: {settingsData?.minimumConvertPOW || 100} POW
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
        
        {/* Maintenance Tools */}
        <div className="pt-3 border-t border-white/10">
          <p className="text-xs font-semibold text-white/70 uppercase tracking-wider mb-3">
            <i className="fas fa-wrench mr-2 text-amber-400"></i>
            Maintenance Tools
          </p>

          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">Referral Repair</p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  Syncs friend counts for all users whose <code className="text-amber-300">referrals</code> rows are missing or mismatched. Also activates pending referral bonuses for users who already qualify.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReferralRepair}
                disabled={isRepairingReferrals}
                className="flex-shrink-0 border-amber-400/40 text-amber-300 hover:bg-amber-400/10 hover:border-amber-400 h-8 text-xs px-3"
              >
                {isRepairingReferrals ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-1.5"></i>
                    Running…
                  </>
                ) : (
                  <>
                    <i className="fas fa-tools mr-1.5"></i>
                    Run Repair
                  </>
                )}
              </Button>
            </div>

            {referralRepairResult && (
              <div className="bg-[#121212] border border-white/5 rounded-lg p-3 grid grid-cols-4 gap-2">
                <div className="text-center">
                  <p className="text-lg font-bold text-[#4cd3ff]">{referralRepairResult.usersLinked}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Linked</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-emerald-400">{referralRepairResult.referralsCreated}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Created</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-purple-400">{referralRepairResult.referralsActivated}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Activated</p>
                </div>
                <div className="text-center">
                  <p className={`text-lg font-bold ${referralRepairResult.errors > 0 ? 'text-rose-400' : 'text-gray-500'}`}>
                    {referralRepairResult.errors}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Errors</p>
                </div>
              </div>
            )}
          </div>
        </div>

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
  const queryClient = useQueryClient();
  const [activeTaskFilter, setActiveTaskFilter] = useState<'pending' | 'all'>('pending');
  const [editingTask, setEditingTask] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', totalClicksRequired: '', costPerClick: '', status: '' });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const openEdit = (task: any) => {
    setEditForm({
      title: task.title || '',
      description: task.description || '',
      totalClicksRequired: task.totalClicksRequired?.toString() || '',
      costPerClick: task.costPerClick?.toString() || '',
      status: task.status || '',
    });
    setEditingTask(task);
  };

  const handleSaveEdit = async () => {
    if (!editingTask) return;
    setIsSavingEdit(true);
    try {
      const res = await apiRequest('PUT', `/api/admin/tasks/${editingTask.id}/edit`, editForm);
      const data = await res.json();
      if (data.success) {
        showNotification('Task updated', 'success');
        setEditingTask(null);
        queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/all-tasks"] });
      } else {
        showNotification(data.error || 'Failed', 'error');
      }
    } catch (e: any) {
      showNotification(e.message || 'Error', 'error');
    } finally {
      setIsSavingEdit(false);
    }
  };

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
        showNotification("Task is now running");
        queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/all-tasks"] });
      } else {
        showNotification(data.message, "error");
      }
    } catch (error) {
      showNotification("Failed to approve task", "error");
    }
  };

  const rejectTask = async (taskId: string) => {
    try {
      const res = await apiRequest("POST", `/api/admin/tasks/${taskId}/reject`);
      const data = await res.json();
      if (data.success) {
        showNotification("Task rejected");
        queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/all-tasks"] });
      } else {
        showNotification(data.message, "error");
      }
    } catch (error) {
      showNotification("Failed to reject task", "error");
    }
  };

  const pauseTask = async (taskId: string) => {
    try {
      const res = await apiRequest("POST", `/api/admin/tasks/${taskId}/pause`);
      const data = await res.json();
      if (data.success) {
        showNotification("Task paused");
        queryClient.invalidateQueries({ queryKey: ["/api/admin/all-tasks"] });
      } else {
        showNotification(data.message, "error");
      }
    } catch (error) {
      showNotification("Failed to pause task", "error");
    }
  };

  const resumeTask = async (taskId: string) => {
    try {
      const res = await apiRequest("POST", `/api/admin/tasks/${taskId}/resume`);
      const data = await res.json();
      if (data.success) {
        showNotification("Task resumed");
        queryClient.invalidateQueries({ queryKey: ["/api/admin/all-tasks"] });
      } else {
        showNotification(data.message, "error");
      }
    } catch (error) {
      showNotification("Failed to resume task", "error");
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      const res = await apiRequest("DELETE", `/api/admin/tasks/${taskId}`);
      const data = await res.json();
      if (data.success) {
        showNotification("Task deleted");
        queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/all-tasks"] });
      } else {
        showNotification(data.message, "error");
      }
    } catch (error) {
      showNotification("Failed to delete task", "error");
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
                  onClick={() => openEdit(task)}
                  className="text-xs text-[#4cd3ff] hover:text-[#6ddeff] hover:bg-[#4cd3ff]/10"
                >
                  <i className="fas fa-pencil-alt mr-1"></i>
                  Edit
                </Button>
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

      {/* Task Edit Dialog */}
      <Dialog open={!!editingTask} onOpenChange={() => setEditingTask(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <i className="fas fa-pencil-alt text-[#4cd3ff]"></i>
              Edit Task
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Title</label>
              <Input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Description (optional)</label>
              <Input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className="h-8 text-sm mt-1" placeholder="Short description..." />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Total Clicks</label>
                <Input type="number" value={editForm.totalClicksRequired} onChange={e => setEditForm(f => ({ ...f, totalClicksRequired: e.target.value }))} className="h-8 text-sm mt-1" min="1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Cost/Click (TON)</label>
                <Input type="number" value={editForm.costPerClick} onChange={e => setEditForm(f => ({ ...f, costPerClick: e.target.value }))} className="h-8 text-sm mt-1" step="0.0001" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                className="w-full mt-1 h-8 text-sm rounded-md border border-white/20 bg-background px-2">
                <option value="under_review">Under Review</option>
                <option value="running">Running</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditingTask(null)} className="flex-1 text-xs">Cancel</Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={isSavingEdit} className="flex-1 text-xs">
                {isSavingEdit ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Admin Management Section ---
type AdminRoleType = 'super_admin' | 'finance' | 'moderator' | 'content';

const ROLE_LABELS: Record<AdminRoleType, string> = {
  super_admin: 'Super Admin',
  finance: 'Finance',
  moderator: 'Moderator',
  content: 'Content',
};

const ROLE_COLORS: Record<AdminRoleType, string> = {
  super_admin: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  finance: 'text-green-400 bg-green-500/10 border-green-500/30',
  moderator: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  content: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
};

const ROLE_DEFAULT_PERMS: Record<AdminRoleType, string[]> = {
  super_admin: ['view_stats','manage_users','manage_withdrawals','manage_tasks','manage_settings','manage_promos','manage_admins','manage_bans'],
  finance: ['view_stats', 'manage_withdrawals'],
  moderator: ['view_stats', 'manage_users', 'manage_bans'],
  content: ['view_stats', 'manage_tasks'],
};

const ALL_ADMIN_PERMISSIONS = [
  'view_stats',
  'manage_users',
  'manage_withdrawals',
  'manage_tasks',
  'manage_settings',
  'manage_promos',
  'manage_admins',
  'manage_bans',
];

interface AdminRecord {
  telegramId: string;
  name: string;
  role: AdminRoleType;
  permissions: string[];
  addedBy: string | null;
  isPrimary: boolean;
  createdAt: string | null;
}

function AdminManagementSection() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminRecord | null>(null);
  const [form, setForm] = useState({
    telegramId: '',
    name: '',
    role: 'moderator' as AdminRoleType,
    permissions: ROLE_DEFAULT_PERMS['moderator'] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ admins: AdminRecord[] }>({
    queryKey: ['/api/admin/admins'],
    queryFn: () => apiRequest('GET', '/api/admin/admins').then(r => r.json()),
    refetchInterval: 15000,
  });

  const admins = data?.admins ?? [];

  const handleRoleChange = (role: AdminRoleType) => {
    setForm(f => ({ ...f, role, permissions: ROLE_DEFAULT_PERMS[role] }));
  };

  const togglePermission = (perm: string) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(perm)
        ? f.permissions.filter(p => p !== perm)
        : [...f.permissions, perm],
    }));
  };

  const openAdd = () => {
    setEditingAdmin(null);
    setForm({ telegramId: '', name: '', role: 'moderator', permissions: ROLE_DEFAULT_PERMS['moderator'] });
    setShowAddForm(true);
  };

  const openEdit = (admin: AdminRecord) => {
    setEditingAdmin(admin);
    setForm({ telegramId: admin.telegramId, name: '', role: admin.role, permissions: admin.permissions });
    setShowAddForm(true);
  };

  const handleSave = async () => {
    if (!form.telegramId.trim()) {
      showNotification('Telegram ID is required', 'destructive');
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest('POST', '/api/admin/admins', {
        telegramId: form.telegramId.trim(),
        name: form.name.trim() || 'Admin',
        role: form.role,
        permissions: form.permissions,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed');
      }
      showNotification(editingAdmin ? 'Admin updated' : 'Admin added');
      setShowAddForm(false);
      queryClient.invalidateQueries({ queryKey: ['/api/admin/admins'] });
    } catch (e: any) {
      showNotification(e.message || 'Error saving admin', 'destructive');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (telegramId: string) => {
    setRemoving(telegramId);
    try {
      const res = await apiRequest('DELETE', `/api/admin/admins/${telegramId}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed');
      }
      showNotification('Admin removed');
      queryClient.invalidateQueries({ queryKey: ['/api/admin/admins'] });
    } catch (e: any) {
      showNotification(e.message || 'Error removing admin', 'destructive');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Admin Management</h2>
          <p className="text-xs text-gray-500 mt-0.5">Control who has admin access and what they can do</p>
        </div>
        <Button size="sm" onClick={openAdd} className="bg-[#4cd3ff] hover:bg-[#3ab8e0] text-black text-xs h-8 px-3">
          <i className="fas fa-plus mr-1.5"></i>
          Add Admin
        </Button>
      </div>

      {/* Role reference cards */}
      <div className="grid grid-cols-2 gap-2">
        {(Object.entries(ROLE_LABELS) as [AdminRoleType, string][]).map(([r, label]) => (
          <div key={r} className="bg-[#121212] border border-white/10 rounded-lg p-3">
            <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${ROLE_COLORS[r]}`}>{label}</span>
            <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
              {ROLE_DEFAULT_PERMS[r].map(p => p.replace('manage_', '').replace(/_/g, ' ')).join(', ')}
            </p>
          </div>
        ))}
      </div>

      {/* Admin list */}
      {isLoading ? (
        <div className="text-center py-8 text-gray-500 text-sm">Loading admins...</div>
      ) : admins.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">No admins configured</div>
      ) : (
        <div className="space-y-2">
          {admins.map(admin => (
            <div key={admin.telegramId} className="bg-[#121212] border border-white/10 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">{admin.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${ROLE_COLORS[admin.role as AdminRoleType] || 'text-gray-400 bg-gray-500/10 border-gray-500/30'}`}>
                      {ROLE_LABELS[admin.role as AdminRoleType] || admin.role}
                    </span>
                    {admin.isPrimary && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border text-yellow-400 bg-yellow-500/10 border-yellow-500/30 font-medium">ENV</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">ID: {admin.telegramId}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {admin.permissions.map(p => (
                      <span key={p} className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
                        {p.replace('manage_', '').replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => openEdit(admin)} className="h-7 px-2 text-[10px] border-white/20 text-gray-300">
                    <i className="fas fa-edit"></i>
                  </Button>
                  {!admin.isPrimary && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRemove(admin.telegramId)}
                      disabled={removing === admin.telegramId}
                      className="h-7 px-2 text-[10px] border-red-500/30 text-red-400 hover:bg-red-500/10"
                    >
                      {removing === admin.telegramId ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-trash"></i>}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent className="bg-[#0d0d0d] border border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">{editingAdmin ? 'Edit Admin' : 'Add New Admin'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-xs text-gray-400 mb-1.5 block">Telegram User ID</Label>
              <Input
                value={form.telegramId}
                onChange={e => setForm(f => ({ ...f, telegramId: e.target.value }))}
                disabled={!!editingAdmin}
                placeholder="e.g. 123456789"
                className="bg-[#1a1a1a] border-white/10 text-white text-sm h-9"
              />
              {!editingAdmin && <p className="text-[10px] text-gray-500 mt-1">Find by forwarding a message to @userinfobot</p>}
            </div>

            <div>
              <Label className="text-xs text-gray-400 mb-1.5 block">Display Name</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Admin name"
                className="bg-[#1a1a1a] border-white/10 text-white text-sm h-9"
              />
            </div>

            <div>
              <Label className="text-xs text-gray-400 mb-1.5 block">Role</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(ROLE_LABELS) as [AdminRoleType, string][]).map(([r, label]) => (
                  <button
                    key={r}
                    onClick={() => handleRoleChange(r)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                      form.role === r
                        ? `${ROLE_COLORS[r]} border-current`
                        : 'bg-[#1a1a1a] border-white/10 text-gray-400 hover:border-white/20'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs text-gray-400 mb-1.5 block">Permissions (fine-tune)</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_ADMIN_PERMISSIONS.map(perm => (
                  <button
                    key={perm}
                    onClick={() => togglePermission(perm)}
                    className={`text-[10px] px-2 py-1.5 rounded border text-left transition-all ${
                      form.permissions.includes(perm)
                        ? 'bg-[#4cd3ff]/10 border-[#4cd3ff]/40 text-[#4cd3ff]'
                        : 'bg-[#1a1a1a] border-white/10 text-gray-500 hover:border-white/20'
                    }`}
                  >
                    <i className={`fas fa-check mr-1.5 ${form.permissions.includes(perm) ? 'opacity-100' : 'opacity-0'}`}></i>
                    {perm.replace('manage_', '').replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1 border-white/10 text-gray-300 text-xs" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
              <Button className="flex-1 bg-[#4cd3ff] hover:bg-[#3ab8e0] text-black text-xs" onClick={handleSave} disabled={saving}>
                {saving ? <i className="fas fa-spinner fa-spin mr-1.5"></i> : null}
                {editingAdmin ? 'Save Changes' : 'Add Admin'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY SECTION — Risk score dashboard
// ─────────────────────────────────────────────────────────────────────────────
function SecuritySection() {
  const queryClient = useQueryClient();
  const [minScore, setMinScore] = useState(1);
  const [filterLevel, setFilterLevel] = useState<'ALL' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const itemsPerPage = 10;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/api/admin/suspicious-users', minScore],
    queryFn: () =>
      apiRequest('GET', `/api/admin/suspicious-users?limit=200&minScore=${minScore}`)
        .then(r => r.json()),
    refetchInterval: 60000,
  });

  const allUsers: any[] = data?.users || [];
  const summary = data?.summary || { critical: 0, high: 0, medium: 0, total: 0 };

  const filtered = allUsers.filter(u => {
    if (filterLevel !== 'ALL' && u.riskLevel !== filterLevel) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (
        u.username?.toLowerCase().includes(s) ||
        u.firstName?.toLowerCase().includes(s) ||
        u.referralCode?.toLowerCase().includes(s) ||
        u.lastLoginIp?.includes(s) ||
        u.platform?.toLowerCase().includes(s) ||
        u.flagReason?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleClear = async (userId: string) => {
    setClearingId(userId);
    try {
      const res = await apiRequest('POST', `/api/admin/users/${userId}/clear-suspicion`);
      const result = await res.json();
      if (result.success) {
        showNotification('Suspicion score cleared');
        queryClient.invalidateQueries({ queryKey: ['/api/admin/suspicious-users'] });
      } else {
        throw new Error(result.message);
      }
    } catch (e: any) {
      showNotification(e.message || 'Failed to clear score', 'error');
    } finally {
      setClearingId(null);
    }
  };

  const riskColor = (level: string) => {
    if (level === 'CRITICAL') return 'text-red-400 border-red-500/40 bg-red-500/10';
    if (level === 'HIGH')     return 'text-orange-400 border-orange-500/40 bg-orange-500/10';
    if (level === 'MEDIUM')   return 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10';
    return 'text-gray-400 border-white/10 bg-white/5';
  };

  const platformIcon = (p: string) => {
    if (p === 'android')  return '🤖';
    if (p === 'ios')      return '🍎';
    if (p === 'tdesktop') return '🖥️';
    if (p === 'web' || p === 'webz' || p === 'webk') return '🌐';
    if (p === 'script')   return '⚠️';
    return '❓';
  };

  const scoreBar = (score: number) => {
    const pct = Math.min(100, score);
    const color = score >= 76 ? 'bg-red-500' : score >= 56 ? 'bg-orange-500' : score >= 31 ? 'bg-yellow-500' : 'bg-emerald-500';
    return (
      <div className="w-full bg-white/10 rounded-full h-1.5 mt-1">
        <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-gradient-to-br from-red-500/20 to-red-500/5 p-3 rounded text-center border border-red-500/30 cursor-pointer" onClick={() => { setFilterLevel('CRITICAL'); setCurrentPage(1); }}>
          <p className="text-2xl font-bold text-red-400">{summary.critical}</p>
          <p className="text-xs text-muted-foreground">Critical</p>
        </div>
        <div className="bg-gradient-to-br from-orange-500/20 to-orange-500/5 p-3 rounded text-center border border-orange-500/30 cursor-pointer" onClick={() => { setFilterLevel('HIGH'); setCurrentPage(1); }}>
          <p className="text-2xl font-bold text-orange-400">{summary.high}</p>
          <p className="text-xs text-muted-foreground">High</p>
        </div>
        <div className="bg-gradient-to-br from-yellow-500/20 to-yellow-500/5 p-3 rounded text-center border border-yellow-500/30 cursor-pointer" onClick={() => { setFilterLevel('MEDIUM'); setCurrentPage(1); }}>
          <p className="text-2xl font-bold text-yellow-400">{summary.medium}</p>
          <p className="text-xs text-muted-foreground">Medium</p>
        </div>
        <div className="bg-gradient-to-br from-[#4cd3ff]/20 to-[#4cd3ff]/5 p-3 rounded text-center border border-[#4cd3ff]/30 cursor-pointer" onClick={() => { setFilterLevel('ALL'); setCurrentPage(1); }}>
          <p className="text-2xl font-bold text-[#4cd3ff]">{summary.total}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <Input
          placeholder="Search user, IP, platform…"
          value={searchTerm}
          onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          className="h-7 text-xs flex-1 min-w-[160px] bg-[#121212] border-white/10"
        />
        {(['ALL', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map(level => (
          <Button
            key={level}
            size="sm"
            variant="outline"
            onClick={() => { setFilterLevel(level); setCurrentPage(1); }}
            className={`text-xs h-7 ${filterLevel === level
              ? level === 'CRITICAL' ? 'bg-red-500/20 border-red-500 text-red-400'
              : level === 'HIGH'     ? 'bg-orange-500/20 border-orange-500 text-orange-400'
              : level === 'MEDIUM'   ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400'
              : 'bg-[#4cd3ff]/20 border-[#4cd3ff] text-[#4cd3ff]'
              : 'border-white/20 text-muted-foreground'}`}
          >
            {level}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => refetch()} className="h-7 text-xs text-muted-foreground">
          <i className="fas fa-sync mr-1 text-[10px]"></i> Refresh
        </Button>
      </div>

      {/* Min Score slider */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="shrink-0">Min score: <span className="text-white font-medium">{minScore}</span></span>
        <input
          type="range" min={1} max={76} value={minScore}
          onChange={e => { setMinScore(+e.target.value); setCurrentPage(1); }}
          className="flex-1 accent-[#4cd3ff]"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-muted h-14 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ShieldAlert size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No suspicious users found</p>
          <p className="text-xs mt-1">Lower the minimum score or remove filters</p>
        </div>
      ) : (
        <div className="space-y-2">
          {paginated.map((user: any) => (
            <div key={user.id} className="bg-[#121212] border border-white/10 rounded-xl overflow-hidden">
              {/* Row */}
              <div className="flex items-center gap-3 p-3">
                {/* Score badge */}
                <div className={`shrink-0 w-12 h-12 rounded-lg flex flex-col items-center justify-center border ${riskColor(user.riskLevel)}`}>
                  <span className="text-lg font-bold leading-none">{user.suspicionScore}</span>
                  <span className="text-[9px] uppercase tracking-wide opacity-70">{user.riskLevel}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">
                      {user.firstName || user.username || user.referralCode || user.id.slice(0, 8)}
                    </span>
                    {user.username && <span className="text-xs text-muted-foreground">@{user.username}</span>}
                    <span className="text-xs" title={user.platform}>{platformIcon(user.platform)} {user.platform}</span>
                    {user.flagged && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1 border-orange-500/50 text-orange-400">Flagged</Badge>
                    )}
                    {user.banned && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1 border-red-500/50 text-red-400">Banned</Badge>
                    )}
                  </div>
                  {scoreBar(user.suspicionScore)}
                  <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                    <span>IP: {user.lastLoginIp || '—'}</span>
                    <span>Ads: {user.adsWatched ?? 0}</span>
                    {user.appVersion && <span>v{user.appVersion}</span>}
                    {user.lastLoginAt && <span>{new Date(user.lastLoginAt).toLocaleDateString()}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-[#4cd3ff]"
                    onClick={() => setExpandedId(expandedId === user.id ? null : user.id)}
                    title="View details"
                  >
                    <Eye size={13} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-400"
                    onClick={() => handleClear(user.id)}
                    disabled={clearingId === user.id}
                    title="Clear suspicion score"
                  >
                    {clearingId === user.id
                      ? <i className="fas fa-spinner fa-spin text-[10px]" />
                      : <Trash2 size={13} />}
                  </Button>
                </div>
              </div>

              {/* Expanded details */}
              {expandedId === user.id && (
                <div className="border-t border-white/10 px-3 py-2 bg-[#0d0d0d] space-y-1.5">
                  {user.flagReason && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Flag reason: </span>
                      <span className="text-orange-300">{user.flagReason}</span>
                    </div>
                  )}
                  {user.lastLoginUserAgent && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">User-Agent: </span>
                      <span className="text-gray-300 break-all">{user.lastLoginUserAgent.slice(0, 200)}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div><span className="text-muted-foreground">Telegram ID: </span><span className="text-gray-300">{user.telegramId || '—'}</span></div>
                    <div><span className="text-muted-foreground">Referral: </span><span className="text-gray-300">{user.referralCode || '—'}</span></div>
                    <div><span className="text-muted-foreground">Balance: </span><span className="text-gray-300">{user.balance ?? 0} POW</span></div>
                    <div><span className="text-muted-foreground">Joined: </span><span className="text-gray-300">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</span></div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] border-red-500/40 text-red-400 hover:bg-red-500/10"
                      onClick={() => handleClear(user.id)}
                      disabled={clearingId === user.id}
                    >
                      <Trash2 size={10} className="mr-1" /> Clear Score & Unflag
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 pt-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
                ← Prev
              </Button>
              <span className="text-xs text-muted-foreground">{currentPage} / {totalPages}</span>
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                Next →
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
