import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

type Period = "week" | "2weeks" | "month";

interface ChartPoint {
  date: string;
  amount: number;
}

interface IncomeChartProps {
  title: string;
  subtitle: string;
  apiEndpoint: string;
}

const PERIODS: { key: Period; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "2weeks", label: "2 Weeks" },
  { key: "month", label: "Month" },
];

function generateDateRange(period: Period): string[] {
  const days = period === "week" ? 7 : period === "2weeks" ? 14 : 31;
  const dates: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    dates.push(`${dd}.${mm}`);
  }
  return dates;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div
        style={{
          background: "#1C1C1E",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          padding: "6px 10px",
        }}
      >
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, marginBottom: 2 }}>{label}</p>
        <p style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>
          ${payload[0].value.toFixed(4)}
        </p>
      </div>
    );
  }
  return null;
};

export default function IncomeChart({ title, subtitle, apiEndpoint }: IncomeChartProps) {
  const [period, setPeriod] = useState<Period>("week");

  const { data: rawData } = useQuery<ChartPoint[]>({
    queryKey: [apiEndpoint, period],
    queryFn: async () => {
      const res = await fetch(`${apiEndpoint}?period=${period}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
    retry: false,
  });

  const dateRange = generateDateRange(period);

  const chartData = dateRange.map((dateLabel) => {
    const found = (rawData || []).find((d) => d.date === dateLabel);
    return {
      date: dateLabel,
      amount: found ? found.amount : 0,
    };
  });

  const tickInterval = period === "week" ? 0 : period === "2weeks" ? 1 : 3;

  return (
    <div className="mb-2 px-1">
      <p style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>{title}</p>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 500, marginBottom: 16 }}>{subtitle}</p>

      <div
        style={{
          display: "flex",
          background: "#1C1C1E",
          borderRadius: 999,
          padding: "3px",
          marginBottom: 24,
        }}
      >
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: period === p.key ? 700 : 500,
              color: period === p.key ? "#000" : "rgba(255,255,255,0.4)",
              background: period === p.key ? "#fff" : "transparent",
              border: "none",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10, fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
            interval={tickInterval}
          />
          <YAxis
            domain={[0, 2]}
            ticks={[0, 0.5, 1, 1.5, 2]}
            tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10, fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => (v === 0 ? "0" : v.toString())}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.1)", strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey="amount"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#fff", strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
