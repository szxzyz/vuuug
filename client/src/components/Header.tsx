import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Globe, Check, Plus } from "lucide-react";
import { useLanguage, Language } from "@/hooks/useLanguage";
import { showNotification } from "@/components/AppNotification";
import TopUpPopup from "@/components/TopUpPopup";

export default function Header() {
  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const [location] = useLocation();
  const { language, setLanguage, t } = useLanguage();
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);

  const isHomePage = location === "/";
  const isCreateTaskPage = location === "/create-task" || location === "/task/create";

  const ICON = 20;

  // ── Balance calculations ──────────────────────────────────────
  const usdBalance = parseFloat(user?.usdBalance || "0");
  const usdFormatted = usdBalance.toFixed(3);

  const weeklyStars = parseInt(user?.weeklyStars || "0");
  const starFormatted = weeklyStars >= 1000000
    ? (weeklyStars / 1000000).toFixed(1) + 'M'
    : weeklyStars >= 1000
    ? (weeklyStars / 1000).toFixed(1) + 'k'
    : weeklyStars.toString();

  const powBalance = parseFloat(user?.balance || "0");
  const powAmount = powBalance < 1 ? Math.round(powBalance * 10000000) : Math.round(powBalance);
  const powFormatted = powAmount >= 1000000
    ? (powAmount / 1000000).toFixed(1) + 'M'
    : powAmount >= 1000
    ? (powAmount / 1000).toFixed(1) + 'k'
    : powAmount.toString();

  const tonBalance = parseFloat(user?.tonBalance || "0");
  const tonFormatted = tonBalance >= 1000
    ? (tonBalance / 1000).toFixed(1) + 'k'
    : tonBalance.toFixed(2);

  const divider = (
    <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />
  );

  // ── Language picker popup (shared across pages) ───────────────
  const langPicker = langPickerOpen && (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={() => setLangPickerOpen(false)}
    >
      <div
        className="w-full max-w-sm mb-6 mx-4 rounded-2xl overflow-hidden"
        style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <p className="text-white text-sm font-semibold text-center">{t('select_language')}</p>
        </div>
        {([
          { code: 'en', flag: '🇬🇧', name: 'English' },
          { code: 'ru', flag: '🇷🇺', name: 'Русский' },
          { code: 'ar', flag: '🇸🇦', name: 'العربية' },
        ] as { code: Language; flag: string; name: string }[]).map(({ code, flag, name }) => (
          <button
            key={code}
            onClick={() => {
              setLanguage(code);
              showNotification(t('language_changed'), 'success');
              setLangPickerOpen(false);
            }}
            className="w-full flex items-center justify-between p-4 transition-all hover:bg-white/5 active:bg-white/10"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{flag}</span>
              <span className="text-white text-sm font-medium">{name}</span>
            </div>
            {language === code && (
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(0,123,255,0.2)', border: '1px solid rgba(0,123,255,0.5)' }}
              >
                <Check className="w-3 h-3 text-blue-400" />
              </div>
            )}
          </button>
        ))}
        <div className="p-4">
          <button
            onClick={() => setLangPickerOpen(false)}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white/60 transition-all hover:text-white"
            style={{ background: 'rgba(255,255,255,0.05)' }}
          >
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );

  // ── HOME PAGE: TON balance + Language button ──────────────────
  if (isHomePage) {
    return (
      <>
        {langPicker}
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-48px)] max-w-md h-12 bg-[#1C1C1E]/90 backdrop-blur-md rounded-[40px] shadow-2xl flex items-center justify-between px-4">
          {/* Language button — left side */}
          <button
            onClick={() => setLangPickerOpen(true)}
            className="flex items-center gap-1.5 active:scale-95 transition-transform"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <Globe style={{ width: 16, height: 16, color: 'rgba(255,255,255,0.55)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.04em' }}>
              {language === 'en' ? 'EN' : language === 'ru' ? 'RU' : 'AR'}
            </span>
          </button>

          {/* TON Balance — right side */}
          <div className="flex items-center gap-1.5">
            <img src="/images/ton.png" alt="TON" style={{ width: ICON, height: ICON, objectFit: 'cover', borderRadius: '50%', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{tonFormatted} TON</span>
          </div>
        </div>
      </>
    );
  }

  // ── CREATE-TASK PAGE: POW + TON + Top Up ─────────────────────
  if (isCreateTaskPage) {
    return (
      <>
        {langPicker}
        <TopUpPopup open={topUpOpen} onOpenChange={setTopUpOpen} />
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-32px)] max-w-md h-12 bg-[#1C1C1E]/90 backdrop-blur-md rounded-[40px] shadow-2xl flex items-center justify-between px-3">

          {/* LEFT: POW */}
          <div className="flex items-center gap-1" style={{ minWidth: 0 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#111', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img src="/pow-icon.png?v=2" alt="POW" style={{ width: '85%', height: '85%', objectFit: 'contain' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1, whiteSpace: 'nowrap' }}>{powFormatted}</span>
          </div>

          <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

          {/* CENTER: TON */}
          <div className="flex items-center gap-1" style={{ minWidth: 0 }}>
            <img src="/images/ton.png" alt="TON" style={{ width: 18, height: 18, objectFit: 'cover', borderRadius: '50%', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1, whiteSpace: 'nowrap' }}>{tonFormatted} TON</span>
          </div>

          <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

          {/* RIGHT: Top Up button — always visible */}
          <button
            onClick={() => setTopUpOpen(true)}
            className="flex items-center gap-1 text-white font-bold rounded-full active:scale-95 transition-transform"
            style={{
              background: 'linear-gradient(135deg, #4cd3ff 0%, #007BFF 100%)',
              boxShadow: '0 2px 10px rgba(0,123,255,0.5)',
              padding: '6px 12px',
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            <Plus style={{ width: 11, height: 11 }} />
            Top Up
          </button>

        </div>
      </>
    );
  }

  // ── ALL OTHER PAGES: Star + POW + USD + TON (icon side-by-side value, evenly spaced) ──
  return (
    <>
      {langPicker}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-48px)] max-w-md h-12 bg-[#1C1C1E]/90 backdrop-blur-md rounded-[40px] shadow-2xl flex items-center justify-between px-4">

        {/* STAR */}
        <div className="flex items-center gap-1">
          <img src="/star-bug.png" alt="STAR" style={{ width: ICON, height: ICON, objectFit: 'contain', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{starFormatted}</span>
        </div>

        <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

        {/* POW */}
        <div className="flex items-center gap-1">
          <div style={{ width: ICON, height: ICON, borderRadius: '50%', background: '#111', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <img src="/pow-icon.png?v=2" alt="POW" style={{ width: '85%', height: '85%', objectFit: 'contain' }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{powFormatted}</span>
        </div>

        <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

        {/* USD */}
        <div className="flex items-center gap-1">
          <img src="/usdt.png" alt="USD" style={{ width: ICON, height: ICON, objectFit: 'contain', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{usdFormatted}</span>
        </div>

        <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

        {/* TON */}
        <div className="flex items-center gap-1">
          <img src="/images/ton.png" alt="TON" style={{ width: ICON, height: ICON, objectFit: 'cover', borderRadius: '50%', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{tonFormatted}</span>
        </div>

      </div>
    </>
  );
}
