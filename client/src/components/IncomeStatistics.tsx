import { useQuery } from "@tanstack/react-query";

interface UserStats {
  todayEarnings: string;
  weekEarnings: string;
  monthEarnings: string;
  totalEarnings: string;
}

function formatPOW(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return Math.round(n).toLocaleString();
}

const CARD = '#1C1C1E';

function StatCard({ label, value, isLoading }: { label: string; value: string; isLoading: boolean }) {
  const num = parseFloat(value || '0');
  const formatted = formatPOW(num);
  return (
    <div style={{ flex: 1, background: CARD, borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 500, marginBottom: 4 }}>{label}</p>
      {isLoading ? (
        <div style={{ height: 22, width: 60, background: 'rgba(255,255,255,0.08)', borderRadius: 6, marginBottom: 2 }} />
      ) : (
        <p style={{ fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px', lineHeight: 1.2, margin: 0 }}>
          {formatted} <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.45)' }}>POW</span>
        </p>
      )}
    </div>
  );
}

export default function IncomeStatistics() {
  const { data: stats, isLoading } = useQuery<UserStats>({
    queryKey: ['/api/user/stats'],
    retry: false,
    staleTime: 30000,
    refetchOnMount: true,
  });

  return (
    <div className="mt-5 px-1">
      <p style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
        Income Statistics
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <StatCard label="Today" value={stats?.todayEarnings ?? '0'} isLoading={isLoading} />
        <StatCard label="Weekly" value={stats?.weekEarnings ?? '0'} isLoading={isLoading} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        <StatCard label="Monthly" value={stats?.monthEarnings ?? '0'} isLoading={isLoading} />
        <StatCard label="All-Time" value={stats?.totalEarnings ?? '0'} isLoading={isLoading} />
      </div>
    </div>
  );
}
