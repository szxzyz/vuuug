import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { showNotification } from "@/components/AppNotification";
import {
  Shield, ShieldAlert, ShieldOff, Users, Search, GitBranch,
  Snowflake, Trash2, RotateCcw, Eye, AlertTriangle, Clock,
  ChevronDown, ChevronRight, Cpu, Wifi, Fingerprint, Wallet,
  MessageCircle, CheckCircle2, XCircle, Ban, RefreshCw, FileText,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReferralNode {
  userId: string;
  uid: string | null;
  username: string | null;
  telegramId: string | null;
  banned: boolean;
  underReview: boolean;
  rewardsFrozen: boolean;
  suspicionScore: number;
  balance: string;
  totalEarned: string;
  referralCount: number;
  deviceId: string | null;
  lastLoginIp: string | null;
  tonWalletAddress: string | null;
  registeredAt: string | null;
  children: ReferralNode[];
  depth: number;
}

interface FraudCluster {
  clusterType: 'device' | 'ip' | 'fingerprint' | 'wallet' | 'telegram';
  sharedValue: string;
  userIds: string[];
  users: Array<{ userId: string; uid: string | null; username: string | null; telegramId: string | null; banned: boolean; underReview: boolean }>;
}

interface NetworkAnalysis {
  rootUser: ReferralNode | null;
  treeSize: number;
  maxDepth: number;
  bannedCount: number;
  underReviewCount: number;
  frozenCount: number;
  clusters: FraudCluster[];
}

// ─── Action Dialog ─────────────────────────────────────────────────────────────

function ActionDialog({
  open,
  onClose,
  targetUserId,
  targetUsername,
  action,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  targetUserId: string;
  targetUsername: string;
  action: string;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const qc = useQueryClient();

  const actionMeta: Record<string, { label: string; color: string; icon: React.ReactNode; description: string }> = {
    ban_user: { label: "Ban User Only", color: "bg-red-600", icon: <Ban size={14}/>, description: "Permanently ban this account. Freezes rewards and blocks withdrawals." },
    ban_direct: { label: "Ban + Direct Referrals", color: "bg-orange-600", icon: <ShieldOff size={14}/>, description: "Ban this account and mark all direct referrals as Under Review." },
    ban_network: { label: "Ban Entire Network", color: "bg-rose-700", icon: <ShieldAlert size={14}/>, description: "Ban this account and mark ALL referral tree members as Under Review. Admin approval required to ban each one." },
    freeze: { label: "Freeze Rewards", color: "bg-blue-600", icon: <Snowflake size={14}/>, description: "Freeze pending rewards without banning. Account stays active." },
    unfreeze: { label: "Unfreeze Rewards", color: "bg-emerald-600", icon: <CheckCircle2 size={14}/>, description: "Unfreeze previously frozen rewards." },
    remove_earnings: { label: "Remove Referral Earnings", color: "bg-amber-600", icon: <Trash2 size={14}/>, description: "Remove all referral-sourced earnings from this account balance." },
    restore: { label: "Restore Account", color: "bg-green-600", icon: <RotateCcw size={14}/>, description: "Remove ban/review status and restore account to good standing." },
    mark_review: { label: "Mark Under Review", color: "bg-yellow-600", icon: <Eye size={14}/>, description: "Flag account for review and freeze rewards until admin completes review." },
  };

  const meta = actionMeta[action] ?? { label: action, color: "bg-gray-600", icon: <Shield size={14}/>, description: "" };

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/admin/fraud/action", { userId: targetUserId, action, reason }),
    onSuccess: () => {
      showNotification(`✅ ${meta.label} applied to ${targetUsername || targetUserId}`);
      qc.invalidateQueries({ queryKey: ["/api/admin/fraud"] });
      setReason("");
      onClose();
      onSuccess();
    },
    onError: (err: any) => {
      showNotification(`❌ ${err?.message || "Action failed"}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#111] border border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            {meta.icon} {meta.label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="bg-[#1a1a1a] rounded-lg p-3 text-sm text-gray-300">
            <p className="font-medium text-white mb-1">Target: <span className="text-[#4cd3ff]">{targetUsername || targetUserId}</span></p>
            <p>{meta.description}</p>
          </div>
          <div>
            <Label className="text-xs text-gray-400 mb-1 block">Reason (required) *</Label>
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Bot farm activity detected, multiple device fingerprints..."
              className="bg-[#1a1a1a] border-white/10 text-white placeholder-gray-500"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} className="border-white/10 text-gray-300">Cancel</Button>
            <Button
              className={`${meta.color} text-white hover:opacity-90`}
              disabled={!reason.trim() || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Processing..." : `Confirm ${meta.label}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Referral Tree Node ───────────────────────────────────────────────────────

function TreeNode({
  node,
  onAction,
}: {
  node: ReferralNode;
  onAction: (userId: string, username: string, action: string) => void;
}) {
  const [expanded, setExpanded] = useState(node.depth < 2);

  const statusBadge = () => {
    if (node.banned) return <Badge className="bg-red-600/20 text-red-400 border-red-600/30 text-[10px]">Banned</Badge>;
    if (node.underReview) return <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 text-[10px]">Under Review</Badge>;
    if (node.rewardsFrozen) return <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30 text-[10px]">Frozen</Badge>;
    return <Badge className="bg-green-600/20 text-green-400 border-green-600/30 text-[10px]">Active</Badge>;
  };

  const riskColor = node.suspicionScore >= 75 ? "text-red-400" : node.suspicionScore >= 45 ? "text-yellow-400" : "text-green-400";

  return (
    <div className="ml-4 border-l border-white/10 pl-3 mt-1">
      <div className="bg-[#1a1a1a] rounded-lg p-2.5 mb-1 border border-white/5 hover:border-white/15 transition-colors">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {node.children.length > 0 && (
              <button onClick={() => setExpanded(!expanded)} className="text-gray-500 hover:text-white flex-shrink-0">
                {expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
              </button>
            )}
            {node.children.length === 0 && <span className="w-[13px]"/>}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-white truncate">
                  {node.username || node.uid || node.userId.slice(0, 8)}
                </span>
                {statusBadge()}
                {node.children.length > 0 && (
                  <span className="text-[10px] text-gray-500">{node.children.length} refs</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-gray-500">UID: {node.uid || '—'}</span>
                <span className={`text-[10px] font-medium ${riskColor}`}>Risk: {node.suspicionScore}</span>
                <span className="text-[10px] text-gray-500">Bal: {parseInt(node.balance).toLocaleString()} PAD</span>
              </div>
            </div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            {!node.banned && !node.underReview && (
              <button
                onClick={() => onAction(node.userId, node.username || node.uid || '', 'mark_review')}
                className="text-yellow-500 hover:text-yellow-300 p-1 rounded"
                title="Mark Under Review"
              >
                <Eye size={12}/>
              </button>
            )}
            {!node.banned && (
              <button
                onClick={() => onAction(node.userId, node.username || node.uid || '', 'ban_user')}
                className="text-red-500 hover:text-red-300 p-1 rounded"
                title="Ban User"
              >
                <Ban size={12}/>
              </button>
            )}
            {node.banned && (
              <button
                onClick={() => onAction(node.userId, node.username || node.uid || '', 'restore')}
                className="text-green-500 hover:text-green-300 p-1 rounded"
                title="Restore Account"
              >
                <RotateCcw size={12}/>
              </button>
            )}
          </div>
        </div>
      </div>
      {expanded && node.children.map(child => (
        <TreeNode key={child.userId} node={child} onAction={onAction}/>
      ))}
    </div>
  );
}

// ─── Cluster Icon ─────────────────────────────────────────────────────────────

function ClusterIcon({ type }: { type: FraudCluster['clusterType'] }) {
  const icons: Record<string, React.ReactNode> = {
    device: <Cpu size={13} className="text-purple-400"/>,
    ip: <Wifi size={13} className="text-blue-400"/>,
    fingerprint: <Fingerprint size={13} className="text-orange-400"/>,
    wallet: <Wallet size={13} className="text-yellow-400"/>,
    telegram: <MessageCircle size={13} className="text-cyan-400"/>,
  };
  return <>{icons[type] ?? <Shield size={13}/>}</>;
}

// ─── Review Queue Tab ─────────────────────────────────────────────────────────

function ReviewQueueTab({ onInspect }: { onInspect: (userId: string) => void }) {
  const [action, setAction] = useState<{ userId: string; username: string; action: string } | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ success: boolean; queue: any[] }>({
    queryKey: ["/api/admin/fraud/review-queue"],
    queryFn: () => apiRequest("GET", "/api/admin/fraud/review-queue"),
    refetchInterval: 30_000,
  });

  const queue = data?.queue ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={15} className="text-yellow-400"/>
          <span className="text-sm font-medium text-white">Accounts Under Review</span>
          <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 text-xs">{queue.length}</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/admin/fraud/review-queue"] })} className="h-7 text-xs border-white/10">
          <RefreshCw size={11} className="mr-1"/> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-[#1a1a1a] rounded-lg animate-pulse"/>)}</div>
      ) : queue.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          <CheckCircle2 size={32} className="mx-auto mb-2 text-green-600/40"/>
          No accounts currently under review
        </div>
      ) : (
        <div className="space-y-2">
          {queue.map(user => (
            <div key={user.id} className="bg-[#1a1a1a] rounded-xl p-3 border border-yellow-600/20">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">{user.username || user.personal_code || user.id.slice(0, 8)}</span>
                    <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 text-[10px]">Under Review</Badge>
                    {parseInt(user.suspicion_score ?? '0') >= 56 && (
                      <Badge className="bg-red-600/20 text-red-400 border-red-600/30 text-[10px]">High Risk</Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {user.review_reason ?? 'No reason specified'}
                  </p>
                  <div className="flex gap-3 mt-1 text-[11px] text-gray-500">
                    <span>UID: {user.personal_code ?? '—'}</span>
                    <span>Refs: {user.referral_count ?? 0}</span>
                    <span>Bal: {parseInt(user.balance ?? 0).toLocaleString()} PAD</span>
                    <span>Risk: {user.suspicion_score ?? 0}</span>
                  </div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <Button size="sm" variant="outline" onClick={() => onInspect(user.id)}
                    className="h-7 text-xs border-white/10 text-[#4cd3ff] hover:text-[#4cd3ff]">
                    <GitBranch size={11} className="mr-1"/> Tree
                  </Button>
                  <Button size="sm" onClick={() => setAction({ userId: user.id, username: user.username || user.personal_code || '', action: 'ban_user' })}
                    className="h-7 text-xs bg-red-600/80 hover:bg-red-600 text-white">
                    <Ban size={11} className="mr-1"/> Ban
                  </Button>
                  <Button size="sm" onClick={() => setAction({ userId: user.id, username: user.username || user.personal_code || '', action: 'restore' })}
                    className="h-7 text-xs bg-green-700/80 hover:bg-green-700 text-white">
                    <RotateCcw size={11} className="mr-1"/> Clear
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {action && (
        <ActionDialog
          open
          onClose={() => setAction(null)}
          targetUserId={action.userId}
          targetUsername={action.username}
          action={action.action}
          onSuccess={() => qc.invalidateQueries({ queryKey: ["/api/admin/fraud/review-queue"] })}
        />
      )}
    </div>
  );
}

// ─── Network Inspector Tab ────────────────────────────────────────────────────

function NetworkInspectorTab({ initialUserId }: { initialUserId?: string }) {
  const [searchId, setSearchId] = useState(initialUserId ?? "");
  const [activeUserId, setActiveUserId] = useState(initialUserId ?? "");
  const [action, setAction] = useState<{ userId: string; username: string; action: string } | null>(null);
  const qc = useQueryClient();

  const { data, isLoading, isFetching } = useQuery<{ success: boolean } & NetworkAnalysis>({
    queryKey: ["/api/admin/fraud/network", activeUserId],
    queryFn: () => apiRequest("GET", `/api/admin/fraud/network/${activeUserId}`),
    enabled: !!activeUserId,
  });

  const handleSearch = () => {
    const trimmed = searchId.trim();
    if (trimmed) setActiveUserId(trimmed);
  };

  const clusterTypeLabel: Record<string, string> = {
    device: "Same Device ID",
    ip: "Same IP Address",
    fingerprint: "Same Browser Fingerprint",
    wallet: "Same TON Wallet",
    telegram: "Same Telegram Account",
  };

  const clusterTypeNote: Record<string, string> = {
    device: "Strong signal — likely same physical device.",
    ip: "Weak signal — may be shared WiFi/NAT. Review carefully.",
    fingerprint: "Medium signal — browser/OS match.",
    wallet: "Strong signal — shared withdrawal destination.",
    telegram: "Strong signal — same Telegram identity.",
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex gap-2">
        <Input
          value={searchId}
          onChange={e => setSearchId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Enter user ID or UID to inspect referral network..."
          className="bg-[#1a1a1a] border-white/10 text-white placeholder-gray-500 text-sm"
        />
        <Button onClick={handleSearch} className="bg-[#4cd3ff]/20 text-[#4cd3ff] border border-[#4cd3ff]/30 hover:bg-[#4cd3ff]/30 text-sm px-4">
          <Search size={14} className="mr-1.5"/> Inspect
        </Button>
      </div>

      {(isLoading || isFetching) && activeUserId && (
        <div className="text-center py-8">
          <div className="w-6 h-6 border-2 border-[#4cd3ff] border-t-transparent rounded-full animate-spin mx-auto mb-2"/>
          <p className="text-sm text-gray-500">Building referral tree...</p>
        </div>
      )}

      {data && !isLoading && (
        <div className="space-y-4">
          {/* Network Stats */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Tree Size", value: data.treeSize, color: "text-[#4cd3ff]" },
              { label: "Max Depth", value: data.maxDepth, color: "text-purple-400" },
              { label: "Banned", value: data.bannedCount, color: "text-red-400" },
              { label: "Under Review", value: data.underReviewCount, color: "text-yellow-400" },
              { label: "Frozen", value: data.frozenCount, color: "text-blue-400" },
              { label: "Clusters", value: data.clusters.length, color: "text-orange-400" },
            ].map(s => (
              <div key={s.label} className="bg-[#1a1a1a] rounded-lg p-2.5 text-center border border-white/5">
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-gray-500">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Root user actions */}
          {data.rootUser && (
            <div className="bg-[#1a1a1a] rounded-xl p-3 border border-white/10">
              <p className="text-xs text-gray-400 mb-2 font-medium">Actions on Root User</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { action: 'ban_user', label: 'Ban Only', icon: <Ban size={12}/>, color: 'bg-red-700/80 hover:bg-red-700' },
                  { action: 'ban_direct', label: 'Ban + Direct', icon: <ShieldOff size={12}/>, color: 'bg-orange-700/80 hover:bg-orange-700' },
                  { action: 'ban_network', label: 'Ban Network', icon: <ShieldAlert size={12}/>, color: 'bg-rose-800/80 hover:bg-rose-800' },
                  { action: 'freeze', label: 'Freeze', icon: <Snowflake size={12}/>, color: 'bg-blue-700/80 hover:bg-blue-700' },
                  { action: 'remove_earnings', label: 'Remove Earnings', icon: <Trash2 size={12}/>, color: 'bg-amber-700/80 hover:bg-amber-700' },
                  { action: 'mark_review', label: 'Mark Review', icon: <Eye size={12}/>, color: 'bg-yellow-700/80 hover:bg-yellow-700' },
                  { action: 'restore', label: 'Restore', icon: <RotateCcw size={12}/>, color: 'bg-green-700/80 hover:bg-green-700' },
                ].map(a => (
                  <Button key={a.action} size="sm"
                    className={`${a.color} text-white h-7 text-xs flex items-center gap-1`}
                    onClick={() => setAction({ userId: data.rootUser!.userId, username: data.rootUser!.username || data.rootUser!.uid || '', action: a.action })}>
                    {a.icon} {a.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Fraud Clusters */}
          {data.clusters.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-white flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-orange-400"/> Fraud Clusters Detected
              </p>
              {data.clusters.map((cluster, i) => (
                <div key={i} className="bg-[#1a1a1a] rounded-xl p-3 border border-orange-600/20">
                  <div className="flex items-start gap-2 mb-2">
                    <ClusterIcon type={cluster.clusterType}/>
                    <div>
                      <p className="text-xs font-medium text-white">{clusterTypeLabel[cluster.clusterType] ?? cluster.clusterType}</p>
                      <p className="text-[10px] text-gray-500">{clusterTypeNote[cluster.clusterType]}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 font-mono truncate max-w-xs">{cluster.sharedValue}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cluster.users.map(u => (
                      <div key={u.userId} className="flex items-center gap-1 bg-[#222] rounded px-2 py-0.5">
                        <span className="text-[10px] text-gray-300">{u.username || u.uid || u.userId.slice(0, 8)}</span>
                        {u.banned && <XCircle size={9} className="text-red-400"/>}
                        {u.underReview && <Clock size={9} className="text-yellow-400"/>}
                        <button
                          onClick={() => setAction({ userId: u.userId, username: u.username || u.uid || '', action: 'mark_review' })}
                          className="text-gray-500 hover:text-yellow-400 transition-colors"
                          title="Mark Under Review"
                        >
                          <Eye size={9}/>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Referral Tree */}
          {data.rootUser && (
            <div>
              <p className="text-sm font-medium text-white flex items-center gap-1.5 mb-2">
                <GitBranch size={14} className="text-[#4cd3ff]"/> Referral Tree
              </p>
              <div className="bg-[#0d0d0d] rounded-xl p-3 border border-white/5 max-h-96 overflow-y-auto">
                <TreeNode node={data.rootUser} onAction={(uid, uname, act) => setAction({ userId: uid, username: uname, action: act })}/>
              </div>
            </div>
          )}
        </div>
      )}

      {action && (
        <ActionDialog
          open
          onClose={() => setAction(null)}
          targetUserId={action.userId}
          targetUsername={action.username}
          action={action.action}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["/api/admin/fraud/network", activeUserId] });
            qc.invalidateQueries({ queryKey: ["/api/admin/fraud/review-queue"] });
          }}
        />
      )}
    </div>
  );
}

// ─── Moderation Log Tab ───────────────────────────────────────────────────────

function ModerationLogTab() {
  const [filterUserId, setFilterUserId] = useState("");
  const [activeFilter, setActiveFilter] = useState("");

  const { data, isLoading, refetch } = useQuery<{ success: boolean; logs: any[] }>({
    queryKey: ["/api/admin/fraud/moderation-logs", activeFilter],
    queryFn: () =>
      apiRequest("GET", `/api/admin/fraud/moderation-logs?limit=100${activeFilter ? `&userId=${activeFilter}` : ''}`),
    refetchInterval: 60_000,
  });

  const logs = data?.logs ?? [];

  const actionColors: Record<string, string> = {
    ban_user: "text-red-400",
    ban_direct: "text-orange-400",
    ban_network: "text-rose-400",
    freeze: "text-blue-400",
    unfreeze: "text-cyan-400",
    remove_earnings: "text-amber-400",
    restore: "text-green-400",
    mark_review: "text-yellow-400",
  };

  const actionLabels: Record<string, string> = {
    ban_user: "Banned (user only)",
    ban_direct: "Banned + Direct Refs",
    ban_network: "Banned Network",
    freeze: "Froze Rewards",
    unfreeze: "Unfroze Rewards",
    remove_earnings: "Removed Earnings",
    restore: "Restored Account",
    mark_review: "Marked Under Review",
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={filterUserId}
          onChange={e => setFilterUserId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && setActiveFilter(filterUserId.trim())}
          placeholder="Filter by user ID (optional)..."
          className="bg-[#1a1a1a] border-white/10 text-white placeholder-gray-500 text-sm"
        />
        <Button variant="outline" size="sm" onClick={() => setActiveFilter(filterUserId.trim())}
          className="border-white/10 text-gray-300 text-xs">Filter</Button>
        {activeFilter && (
          <Button variant="outline" size="sm" onClick={() => { setActiveFilter(""); setFilterUserId(""); }}
            className="border-white/10 text-gray-300 text-xs">Clear</Button>
        )}
        <Button variant="outline" size="sm" onClick={() => refetch()} className="border-white/10 text-gray-300">
          <RefreshCw size={12}/>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-[#1a1a1a] rounded-lg animate-pulse"/>)}</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          <FileText size={32} className="mx-auto mb-2 opacity-30"/>
          No moderation actions logged yet
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10">
                <TableHead className="text-gray-400 text-xs">Time</TableHead>
                <TableHead className="text-gray-400 text-xs">Admin</TableHead>
                <TableHead className="text-gray-400 text-xs">Target</TableHead>
                <TableHead className="text-gray-400 text-xs">Action</TableHead>
                <TableHead className="text-gray-400 text-xs">Reason</TableHead>
                <TableHead className="text-gray-400 text-xs">Affected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log: any) => (
                <TableRow key={log.id} className="border-white/5 hover:bg-white/3">
                  <TableCell className="text-[10px] text-gray-500 whitespace-nowrap py-2">
                    {new Date(log.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-gray-300 py-2">
                    {log.admin_name || log.admin_id || '—'}
                  </TableCell>
                  <TableCell className="text-xs text-[#4cd3ff] py-2 font-mono">
                    {log.target_user_uid || log.target_user_id?.slice(0, 8)}
                  </TableCell>
                  <TableCell className={`text-xs font-medium py-2 ${actionColors[log.action] ?? 'text-gray-300'}`}>
                    {actionLabels[log.action] ?? log.action}
                  </TableCell>
                  <TableCell className="text-xs text-gray-400 py-2 max-w-[180px] truncate">
                    {log.reason}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 py-2">
                    {Array.isArray(log.affected_user_ids) ? log.affected_user_ids.length : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function FraudNetworkPanel() {
  const [inspectUserId, setInspectUserId] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState("review");

  const handleInspect = (userId: string) => {
    setInspectUserId(userId);
    setActiveTab("inspect");
  };

  const { data: queueData } = useQuery<{ success: boolean; queue: any[] }>({
    queryKey: ["/api/admin/fraud/review-queue"],
    queryFn: () => apiRequest("GET", "/api/admin/fraud/review-queue"),
    refetchInterval: 60_000,
  });
  const queueCount = queueData?.queue?.length ?? 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield size={18} className="text-red-400"/>
        <h2 className="text-base font-semibold text-white">Anti-Fraud Referral Network</h2>
        {queueCount > 0 && (
          <Badge className="bg-yellow-600/30 text-yellow-400 border-yellow-600/40 text-xs">{queueCount} pending</Badge>
        )}
      </div>

      <div className="bg-[#0d0d0d] border border-amber-600/20 rounded-lg p-3 text-xs text-amber-300/80 flex items-start gap-2">
        <AlertTriangle size={13} className="flex-shrink-0 mt-0.5 text-amber-400"/>
        <p><strong>Policy:</strong> Referrals are never auto-banned. Default action is "Under Review". Always investigate clusters before banning. Use "Ban Only" to ban a single user; use "Ban Network" only with clear evidence.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-[#1a1a1a] border border-white/10 h-auto p-0.5 gap-0.5">
          <TabsTrigger value="review" className="text-xs px-3 py-1.5 flex items-center gap-1">
            <Clock size={12}/> Review Queue
            {queueCount > 0 && <span className="ml-1 bg-yellow-600 text-white rounded-full text-[9px] px-1.5">{queueCount}</span>}
          </TabsTrigger>
          <TabsTrigger value="inspect" className="text-xs px-3 py-1.5 flex items-center gap-1">
            <GitBranch size={12}/> Network Inspector
          </TabsTrigger>
          <TabsTrigger value="logs" className="text-xs px-3 py-1.5 flex items-center gap-1">
            <FileText size={12}/> Moderation Log
          </TabsTrigger>
        </TabsList>

        <div className="mt-3">
          <TabsContent value="review" className="mt-0">
            <ReviewQueueTab onInspect={handleInspect}/>
          </TabsContent>
          <TabsContent value="inspect" className="mt-0">
            <NetworkInspectorTab initialUserId={inspectUserId}/>
          </TabsContent>
          <TabsContent value="logs" className="mt-0">
            <ModerationLogTab/>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
