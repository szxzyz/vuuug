import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Globe, Check, Plus } from "lucide-react";
import { useLanguage, Language } from "@/hooks/useLanguage";
import { showNotification } from "@/components/AppNotification";
import TopUpPopup from "@/components/TopUpPopup";

const LANG_META: { code: Language; flag: string; name: string; label: string }[] = [
  { code: 'en', flag: '🇬🇧', name: 'English',            label: 'EN' },
  { code: 'ru', flag: '🇷🇺', name: 'Русский',            label: 'RU' },
  { code: 'ar', flag: '🇸🇦', name: 'العربية',             label: 'AR' },
  { code: 'uk', flag: '🇺🇦', name: 'Українська',          label: 'UK' },
  { code: 'de', flag: '🇩🇪', name: 'Deutsch',             label: 'DE' },
  { code: 'zh', flag: '🇨🇳', name: '中文',                label: 'ZH' },
  { code: 'pt', flag: '🇧🇷', name: 'Português (Brasil)',  label: 'PT' },
  { code: 'es', flag: '🇪🇸', name: 'Español',             label: 'ES' },
  { code: 'vi', flag: '🇻🇳', name: 'Tiếng Việt',          label: 'VI' },
  { code: 'bn', flag: '🇧🇩', name: 'বাংলা',               label: 'BN' },
];

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

  const ICON = 22;

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
    : tonBalance >= 0.01
    ? tonBalance.toFixed(2)
    : tonBalance > 0
    ? tonBalance.toFixed(4)
    : '0';

  const currentLangMeta = LANG_META.find(l => l.code === language) || LANG_META[0];

  const divider = (
    <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.10)', flexShrink: 0, margin: '0 2px' }} />
  );

  const balanceItem = (icon: React.ReactNode, value: string, label?: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, height: 36 }}>
      <div style={{ width: ICON, height: ICON, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.1 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '0.01em' }}>{value}</span>
        {label && <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>}
      </div>
    </div>
  );

  const langPicker = langPickerOpen && (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
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
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {LANG_META.map(({ code, flag, name }) => (
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
        </div>
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

  const headerBase = "fixed top-0 left-0 right-0 z-40 w-full";
  const headerStyle: React.CSSProperties = {
    background: '#000',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    height: 64,
    display: 'flex',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 16,
  };

  if (isHomePage) {
    return (
      <>
        {langPicker}
        {/* Floating language button — top-right, no layout impact */}
        <div style={{ position: 'fixed', top: 14, right: 14, zIndex: 40 }}>
          <button
            onClick={() => setLangPickerOpen(true)}
            className="active:scale-90 transition-transform"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px 6px 7px',
              borderRadius: 50,
              cursor: 'pointer',
              border: 'none',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.05) 100%)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            {/* Flag circle */}
            <div style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              lineHeight: 1,
              flexShrink: 0,
            }}>
              {currentLangMeta.flag}
            </div>
            {/* Label */}
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.85)',
              letterSpacing: '0.08em',
              lineHeight: 1,
            }}>
              {currentLangMeta.label}
            </span>
            {/* Tiny chevron */}
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ opacity: 0.4, marginLeft: -2 }}>
              <path d="M1.5 3L4 5.5L6.5 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </>
    );
  }

  if (isCreateTaskPage) {
    return (
      <>
        {langPicker}
        <TopUpPopup open={topUpOpen} onOpenChange={setTopUpOpen} />
        <div className={headerBase} style={headerStyle}>
          {balanceItem(
            <div style={{ width: ICON, height: ICON, borderRadius: '50%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img src="/pow-icon.png?v=2" alt="POW" style={{ width: '85%', height: '85%', objectFit: 'contain' }} />
            </div>,
            powFormatted
          )}

          {divider}

          {balanceItem(
            <img src="/images/ton.png" alt="TON" style={{ width: ICON, height: ICON, objectFit: 'cover', borderRadius: '50%' }} />,
            `${tonFormatted} TON`
          )}

          <div style={{ flex: 1 }} />

          <button
            onClick={() => setTopUpOpen(true)}
            className="flex items-center gap-1 text-white font-bold rounded-full active:scale-95 transition-transform"
            style={{
              background: 'linear-gradient(135deg, #4cd3ff 0%, #007BFF 100%)',
              boxShadow: '0 2px 10px rgba(0,123,255,0.4)',
              padding: '7px 14px',
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            <Plus style={{ width: 12, height: 12 }} />
            Top Up
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {langPicker}
      <div className={headerBase} style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'space-between' }}>
          {balanceItem(
            <img src="/star-bug.png" alt="STAR" style={{ width: ICON, height: ICON, objectFit: 'contain' }} />,
            starFormatted,
            'STAR'
          )}

          {divider}

          {balanceItem(
            <div style={{ width: ICON, height: ICON, borderRadius: '50%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img src="/pow-icon.png?v=2" alt="POW" style={{ width: '85%', height: '85%', objectFit: 'contain' }} />
            </div>,
            powFormatted,
            'POW'
          )}

          {divider}

          {balanceItem(
            <img src="/usdt.png" alt="USD" style={{ width: ICON, height: ICON, objectFit: 'contain' }} />,
            usdFormatted,
            'USD'
          )}

          {divider}

          {balanceItem(
            <img src="/images/ton.png" alt="TON" style={{ width: ICON, height: ICON, objectFit: 'cover', borderRadius: '50%' }} />,
            tonFormatted,
            'TON'
          )}
        </div>
      </div>
    </>
  );
}
