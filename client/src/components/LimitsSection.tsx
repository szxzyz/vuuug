interface LimitsSectionProps {
  dailyLimit?: number;
  hourlyLimit?: number;
}

export default function LimitsSection({ dailyLimit = 510, hourlyLimit = 63 }: LimitsSectionProps) {
  return (
    <div className="rounded-2xl bg-[#111111] border border-white/5 mb-3 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-black text-white uppercase tracking-widest">Limits</h3>
      </div>
      <p className="text-[#555] text-[10px] leading-relaxed mb-2.5">
        Daily limits are set per account. All views are counted accurately within these limits.
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
