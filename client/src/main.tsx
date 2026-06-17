import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Telegram environment check — allow if Telegram WebApp SDK is present
// (initData can be empty on proxy/older clients — don't block on that alone)
const tg = (window as any).Telegram?.WebApp;
const isTelegram = !!(tg && (tg.initData !== undefined || tg.platform || tg.version));

if (!isTelegram && process.env.NODE_ENV === "production") {
  document.body.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #000; color: #ff4d4d; font-family: sans-serif; text-align: center; padding: 20px;">
      <h1 style="font-size: 24px; margin-bottom: 10px;">🛑 ACCESS DENIED</h1>
      <p style="font-size: 16px; line-height: 1.5;">This application is strictly locked to the Telegram environment.<br>External browsers or automation tools are permanently banned.</p>
      <div style="margin-top: 20px; font-size: 12px; opacity: 0.6;">Error Code: ENV_LOCK_VIOLATION</div>
    </div>
  `;
} else {
  // Security: Human Interaction Tracking
let interactionEntropy = 0;
let lastHeartbeat = Date.now();

if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', () => { interactionEntropy += 0.01; });
  window.addEventListener('click', () => { interactionEntropy += 1; });
  window.addEventListener('touchstart', () => { interactionEntropy += 0.5; });
  
  // Focus check
  window.addEventListener('blur', () => { interactionEntropy = 0; });
  
  // Heartbeat loop
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      lastHeartbeat = Date.now();
    }
  }, 5000);
}

// Global fetch wrapper to inject security proof
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const [url, config = {}] = args as [string, RequestInit];
  const isApi = typeof url === 'string' && url.includes('/api/');
  
  if (isApi) {
    const headers = new Headers(config.headers || {});
    headers.set('x-interaction-proof', JSON.stringify({
      entropy: Math.floor(interactionEntropy),
      timestamp: Date.now(),
      heartbeat: lastHeartbeat,
      visible: document.visibilityState === 'visible'
    }));
    config.headers = headers;
  }
  
  return originalFetch(url, config);
};

document.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("DOMContentLoaded", () => {
  document.body.style.webkitUserSelect = "none";
  document.body.style.userSelect = "none";
  document.body.style.webkitTouchCallout = "none";
});

createRoot(document.getElementById("root")!).render(<App />);
}
