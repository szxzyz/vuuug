interface LimitsSectionProps {
  dailyLimit?: number;
  hourlyLimit?: number;
}

export default function LimitsSection({ dailyLimit = 510, hourlyLimit = 63 }: LimitsSectionProps) {
  return (
    <div className="mb-4 px-1">
      <p style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
        Limits
      </p>
      <p className="text-[#888] text-xs leading-relaxed mb-3">
        Every day we analyze your account and set individual limits for Ads views per hour and per day. This is necessary for Us to count all your views.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#1C1C1E] rounded-xl px-3 py-2.5 flex items-center justify-between">
          <span className="text-[#666] text-[10px] font-semibold uppercase tracking-wide">Per day</span>
          <span className="text-white text-lg font-black">{dailyLimit}</span>
        </div>
        <div className="bg-[#1C1C1E] rounded-xl px-3 py-2.5 flex items-center justify-between">
          <span className="text-[#666] text-[10px] font-semibold uppercase tracking-wide">Per hour</span>
          <span className="text-white text-lg font-black">{hourlyLimit}</span>
        </div>
      </div>
    </div>
  );
}
