import { useState } from "react";

interface SeasonEndOverlayProps {
  onClose: () => void;
  isLocked?: boolean;
}

export default function SeasonEndOverlay({ onClose, isLocked = false }: SeasonEndOverlayProps) {
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    if (isLocked) return;
    setIsClosing(true);
    setTimeout(() => onClose(), 280);
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        transition: 'opacity 0.28s ease',
        opacity: isClosing ? 0 : 1,
        padding: '24px',
      }}
    >
      <style>{`
        @keyframes overlayPop { 0%{opacity:0;transform:scale(0.92) translateY(16px)} 100%{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes iconPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
        @keyframes dotBlink { 0%,100%{opacity:0.3} 50%{opacity:1} }
      `}</style>

      <div style={{
        width: '100%', maxWidth: 360,
        animation: 'overlayPop 0.38s cubic-bezier(0.34,1.4,0.64,1) both',
        transform: isClosing ? 'scale(0.94) translateY(12px)' : undefined,
        transition: isClosing ? 'transform 0.28s ease' : undefined,
      }}>
        <div style={{
          background: '#0d0d0d',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 28,
          overflow: 'hidden',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(0,123,255,0.18) 0%, rgba(0,0,0,0) 60%)',
            padding: '36px 28px 28px',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{
                width: 80, height: 80,
                borderRadius: '50%',
                background: 'rgba(0,123,255,0.12)',
                border: '1.5px solid rgba(0,123,255,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 20px',
                animation: 'iconPulse 2.4s ease-in-out infinite',
              }}>
                <img src="/pow-icon.png" alt="POW" style={{ width: 48, height: 48, objectFit: 'contain' }} />
              </div>

              <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.3px' }}>
                Under Maintenance
              </h1>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: 0, letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 500 }}>
                Paid Adz · Back Soon
              </p>
            </div>

            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 16,
              padding: '18px 20px',
              marginBottom: 16,
              display: 'flex', flexDirection: 'column', gap: 16,
            }}>
              <Row icon="🔧" title="What's happening?" text="We're upgrading the platform to bring you faster rewards and better performance." />
              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
              <Row icon="⏱️" title="How long?" text="Estimated 24–48 hours. Your balance and account are fully safe." />
              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
              <Row icon="🔒" title="Your earnings?" text="All POW, Stars, and referrals are preserved. Nothing is lost." />
            </div>

            <div style={{
              background: 'rgba(0,123,255,0.08)',
              border: '1px solid rgba(0,123,255,0.2)',
              borderRadius: 12,
              padding: '12px 16px',
              marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {[0, 200, 400].map((d, i) => (
                  <div key={i} style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: '#007BFF',
                    animation: `dotBlink 1.4s ${d}ms ease-in-out infinite`,
                  }} />
                ))}
              </div>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', margin: 0, fontWeight: 500 }}>
                Maintenance in progress — check back soon
              </p>
            </div>

            <button
              onClick={handleClose}
              disabled={isLocked}
              style={{
                width: '100%',
                padding: '14px 0',
                borderRadius: 14,
                border: 'none',
                background: isLocked ? 'rgba(255,255,255,0.07)' : '#007BFF',
                color: isLocked ? 'rgba(255,255,255,0.3)' : '#fff',
                fontSize: 15,
                fontWeight: 700,
                cursor: isLocked ? 'not-allowed' : 'pointer',
                letterSpacing: '0.02em',
                transition: 'background 0.2s, transform 0.1s',
              }}
              onMouseDown={e => { if (!isLocked) (e.currentTarget.style.transform = 'scale(0.97)'); }}
              onMouseUp={e => { (e.currentTarget.style.transform = 'scale(1)'); }}
            >
              {isLocked ? 'Maintenance in Progress' : 'Got it'}
            </button>

            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', textAlign: 'center', margin: '14px 0 0', letterSpacing: '0.03em' }}>
              Need help? Contact us @PaidAdzBot
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.75)', margin: '0 0 3px', letterSpacing: '0.02em' }}>{title}</p>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', margin: 0, lineHeight: 1.5 }}>{text}</p>
      </div>
    </div>
  );
}
