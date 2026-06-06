interface LimitsSectionProps {
  dailyLimit?: number;
  hourlyLimit?: number;
}

export default function LimitsSection({ dailyLimit = 510, hourlyLimit = 63 }: LimitsSectionProps) {
  return (
    <div className="rounded-2xl bg-[#111111] border border-white/5 mb-3 p-5">
      <h3 className="text-lg font-black text-white uppercase tracking-widest mb-2">
        Limits
      </h3>
      <p className="text-[#888] text-xs leading-relaxed mb-4">
        Every day we analyze your account and set individual limits for ads view per hour
        and per day. This is necessary for Us to count all your views.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#1C1C1E] rounded-xl p-4">
          <p className="text-[#888] text-xs mb-1">Ads per day</p>
          <p className="text-white text-3xl font-black">{dailyLimit}</p>
        </div>
        <div className="bg-[#1C1C1E] rounded-xl p-4">
          <p className="text-[#888] text-xs mb-1">Ads per hour</p>
          <p className="text-white text-3xl font-black">{hourlyLimit}</p>
        </div>
      </div>
    </div>
  );
}
