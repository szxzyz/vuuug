import React from 'react';
import { X, Copy, Globe, MessageSquare, ShieldCheck, FileText, ExternalLink, Check, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { showNotification } from '@/components/AppNotification';

interface SettingsPopupProps {
  onClose: () => void;
}

export const SettingsPopup: React.FC<SettingsPopupProps> = ({ onClose }) => {
  const { user } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const [copied, setCopied] = React.useState(false);

  const [selectedLegal, setSelectedLegal] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Lock scroll on mount
    document.body.style.overflow = 'hidden';
    return () => {
      // Restore scroll on unmount
      document.body.style.overflow = 'unset';
    };
  }, []);

  const uid = (user as any)?.referralCode || '00000';

  const legalContent: Record<string, { title: string, content: React.ReactNode }> = {
    terms: {
      title: t('terms_conditions'),
      content: (
        <div className="space-y-4 text-gray-300 text-sm">
          <p className="text-[#4cd3ff] font-bold">Last Updated: December 26, 2025</p>
          <p>Welcome to Money Adz. By accessing or using this app, you agree to comply with these Terms & Conditions. If you do not agree, please do not use the app.</p>
          <div>
            <h4 className="text-white font-bold mb-1">1. Eligibility</h4>
            <p>Users must be at least 13 years old. You are responsible for maintaining the confidentiality of your account.</p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-1">2. App Usage</h4>
            <p>Money Adz allows users to earn PAD / BUG tokens through tasks, ads, and activities. Tokens earned in the app do not represent real money unless withdrawn according to app rules.</p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-1">3. Rewards & Withdrawals</h4>
            <p>Rewards depend on task completion and system rules. Withdrawals are subject to verification and minimum limits. Any attempt to exploit, abuse, or manipulate rewards may result in account suspension.</p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-1">4. Account Suspension</h4>
            <p>We reserve the right to suspend or terminate accounts involved in fake activity, multiple accounts, automated/bot usage, or abuse of rewards/bugs.</p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-1">5. Changes</h4>
            <p>We may update these terms at any time. Continued use of the app means you accept the updated terms.</p>
          </div>
        </div>
      )
    },
    privacy: {
      title: t('privacy_policy'),
      content: (
        <div className="space-y-4 text-gray-300 text-sm">
          <p>Money Adz respects your privacy.</p>
          <div>
            <h4 className="text-white font-bold mb-1">1. Information We Collect</h4>
            <p>We may collect User ID (UID), device & app usage data, task activity, and withdrawal history.</p>
            <div className="mt-2 flex items-start gap-2 text-rose-400 font-bold bg-rose-400/5 p-2 rounded-lg border border-rose-400/10">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
              <p>We do NOT collect: Passwords, personal banking details, or private messages.</p>
            </div>
          </div>
          <div>
            <h4 className="text-white font-bold mb-1">2. How We Use Data</h4>
            <p>To operate app features, prevent fraud/abuse, and improve app performance.</p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-1">3. Data Protection</h4>
            <p>Your data is stored securely. We do not sell or share personal data with third parties except when legally required.</p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-1">4. Ads & Analytics</h4>
            <p>Third-party ad networks may collect non-personal data for ad delivery. Money Adz is not responsible for external ad services.</p>
          </div>
        </div>
      )
    },
    acceptable: {
      title: t('acceptable_use'),
      content: (
        <div className="space-y-4 text-gray-300 text-sm">
          <p>To keep Money Adz fair for everyone, users must not:</p>
          <div>
            <h4 className="text-rose-400 font-bold mb-1 flex items-center gap-2">
              <X className="w-4 h-4" />
              Prohibited Activities
            </h4>
            <ul className="list-disc pl-5 space-y-1">
              <li>Create multiple accounts</li>
              <li>Use bots, scripts, or automation</li>
              <li>Exploit bugs</li>
              <li>Manipulate ads or tasks</li>
              <li>Attempt to hack or reverse-engineer the app</li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-1 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#4cd3ff]" />
              Consequences
            </h4>
            <p>If violations are detected, rewards may be revoked, accounts may be banned, and withdrawals blocked.</p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-1 flex items-center gap-2">
              <Check className="w-4 h-4 text-green-500" />
              Fair Play
            </h4>
            <p>All rewards are based on predefined logic.</p>
          </div>
        </div>
      )
    }
  };

  const copyUid = () => {
    navigator.clipboard.writeText(uid);
    setCopied(true);
    showNotification(t('copied'), 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const ALL_LANGUAGES: Array<import('@/hooks/useLanguage').Language> = [
    'en', 'ru', 'ar', 'uk', 'de', 'zh', 'pt', 'es', 'vi', 'bn',
  ];

  const LANGUAGE_LABELS: Record<string, string> = {
    en: 'English', ru: 'Русский', ar: 'العربية', uk: 'Українська',
    de: 'Deutsch', zh: '中文', pt: 'Português', es: 'Español',
    vi: 'Tiếng Việt', bn: 'বাংলা',
  };

  const cycleLanguage = async () => {
    const idx = ALL_LANGUAGES.indexOf(language as any);
    const next = ALL_LANGUAGES[(idx + 1) % ALL_LANGUAGES.length];
    setLanguage(next);
    // Persist to server so ambassador promo uses correct language image + caption
    try {
      await fetch('/api/user/language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
        credentials: 'include',
      });
    } catch {
      // Non-critical — localStorage is already updated
    }
  };

  const languageLabel = LANGUAGE_LABELS[language] ?? 'English';

  const openLink = (url: string) => {
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] px-4 animate-in fade-in duration-200 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-[#0d0d0d] rounded-2xl w-full max-w-sm max-h-[90vh] border border-[#1a1a1a] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            {/* My UID */}
            <LegalItem 
              icon={<Copy className="w-4 h-4 text-[#4cd3ff]" />} 
              label={`${t('my_uid')}: ${uid}`} 
              onClick={copyUid}
              rightIcon={copied ? <Check className="w-3 h-3 text-green-500" /> : <ChevronRight className="w-3 h-3 text-gray-600" />}
            />

            {/* Language */}
            <LegalItem 
              icon={<Globe className="w-4 h-4 text-purple-400" />} 
              label={`${t('language')}: ${languageLabel}`} 
              onClick={cycleLanguage}
              rightIcon={<RefreshCw className="w-3 h-3 text-gray-600" />}
            />

            {/* Admin Panel (Conditional) */}
            {(user as any)?.isAdmin && (
              <LegalItem 
                icon={<ShieldCheck className="w-4 h-4 text-red-500" />} 
                label="Admin Panel" 
                onClick={() => {
                  onClose();
                  window.location.href = '/admin';
                }}
              />
            )}

            {/* Contact Support */}
            <LegalItem 
              icon={<MessageSquare className="w-4 h-4 text-blue-400" />} 
              label={t('contact_support')} 
              onClick={() => openLink('http://t.me/szxzyz')}
              rightIcon={<ExternalLink className="w-3 h-3 text-gray-600" />}
            />

            {/* Legal Section */}
            <div className="pt-4 pb-2">
              <p className="text-gray-500 text-[10px] uppercase font-bold tracking-wider mb-3 px-1">{t('legal_info')}</p>
              <div className="space-y-2">
                <LegalItem 
                  icon={<ShieldCheck className="w-4 h-4 text-emerald-400" />} 
                  label={t('terms_conditions')} 
                  onClick={() => setSelectedLegal('terms')}
                />
                <LegalItem 
                  icon={<FileText className="w-4 h-4 text-orange-400" />} 
                  label={t('privacy_policy')} 
                  onClick={() => setSelectedLegal('privacy')}
                />
                <LegalItem 
                  icon={<ShieldCheck className="w-4 h-4 text-rose-400" />} 
                  label={t('acceptable_use')} 
                  onClick={() => setSelectedLegal('acceptable')}
                />
              </div>
            </div>
          </div>

          <Button
            onClick={onClose}
            className="w-full mt-6 h-12 bg-gradient-to-r from-[#4cd3ff] to-blue-600 text-black font-bold rounded-xl shadow-[0_0_20px_rgba(76,211,255,0.3)]"
          >
            {t('close')}
          </Button>
        </div>
      </div>

      {/* Legal Detail Overlay */}
      {selectedLegal && (
        <div className="absolute inset-0 bg-[#0d0d0d] z-[110] animate-in slide-in-from-right duration-300">
          <div className="h-full flex flex-col">
            <div className="p-6 border-b border-[#1a1a1a] flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                {selectedLegal === 'terms' && <ShieldCheck className="w-5 h-5 text-emerald-400" />}
                {selectedLegal === 'privacy' && <FileText className="w-5 h-5 text-orange-400" />}
                {selectedLegal === 'acceptable' && <ShieldCheck className="w-5 h-5 text-rose-400" />}
                {legalContent[selectedLegal].title}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {legalContent[selectedLegal].content}
            </div>
            <div className="p-6 border-t border-[#1a1a1a]">
              <Button
                onClick={() => setSelectedLegal(null)}
                className="w-full h-12 bg-[#1a1a1a] border border-[#2a2a2a] text-white font-bold rounded-xl"
              >
                Back
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const LegalItem = ({ icon, label, onClick, rightIcon }: { icon: React.ReactNode, label: string, onClick?: () => void, rightIcon?: React.ReactNode }) => (
  <div 
    onClick={onClick}
    className="bg-[#1a1a1a]/50 border border-[#2a2a2a] rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-[#1a1a1a] transition-all active:scale-[0.98]"
  >
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-lg bg-gray-800/50 flex items-center justify-center">
        {icon}
      </div>
      <span className="text-gray-300 text-xs font-medium">{label}</span>
    </div>
    {rightIcon || <ChevronRight className="w-3 h-3 text-gray-600" />}
  </div>
);
