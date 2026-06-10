interface AdFailurePopupProps {
  onClose: () => void;
}

export default function AdFailurePopup({ onClose }: AdFailurePopupProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      />
      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: 480,
        background: 'linear-gradient(160deg, #0d0d0f, #111118)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: '24px 24px 0 0',
        padding: '32px 24px',
        paddingBottom: 'max(32px, calc(env(safe-area-inset-bottom, 0px) + 28px))',
      }}>
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 24px' }} />

        {/* Red warning icon */}
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(239,68,68,0.12)',
          border: '1.5px solid rgba(239,68,68,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 18px',
        }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>

        {/* Title */}
        <h2 style={{ color: '#fff', fontSize: 19, fontWeight: 900, textAlign: 'center', margin: '0 0 14px' }}>
          Ad Not Counted
        </h2>

        {/* Message */}
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 1.65, textAlign: 'center', marginBottom: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0 }}>
            Keep the advertisement open for a <strong style={{ color: 'rgba(255,255,255,0.7)' }}>few seconds</strong> before returning to the app.
          </p>
          <p style={{ margin: 0 }}>
            Make sure to tap the <strong style={{ color: '#3b82f6' }}>blue button</strong> or banner link inside the advertisement whenever available.
          </p>
          <p style={{ margin: 0 }}>
            This helps verify engagement and may increase your rewards.
          </p>
        </div>

        {/* OK button */}
        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '14px 0',
            background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
            border: 'none',
            borderRadius: 14,
            color: '#fff',
            fontSize: 15,
            fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 4px 18px rgba(37,99,235,0.35)',
            letterSpacing: '0.02em',
          }}
          className="active:scale-95 transition-transform"
        >
          OK
        </button>
      </div>
    </div>
  );
}
