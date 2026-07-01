import { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { blockedCountries } from "../shared/schema";
import { eq } from "drizzle-orm";

const COUNTRIES = [
  { code: "AF", name: "Afghanistan" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" },
  { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" },
  { code: "AG", name: "Antigua and Barbuda" },
  { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" },
  { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" },
  { code: "BB", name: "Barbados" },
  { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" },
  { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" },
  { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia" },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" },
  { code: "BR", name: "Brazil" },
  { code: "BN", name: "Brunei" },
  { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" },
  { code: "BI", name: "Burundi" },
  { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" },
  { code: "CA", name: "Canada" },
  { code: "CV", name: "Cape Verde" },
  { code: "CF", name: "Central African Republic" },
  { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" },
  { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo" },
  { code: "CD", name: "Congo (DRC)" },
  { code: "CR", name: "Costa Rica" },
  { code: "CI", name: "Cote d'Ivoire" },
  { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czech Republic" },
  { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" },
  { code: "DM", name: "Dominica" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" },
  { code: "GQ", name: "Equatorial Guinea" },
  { code: "ER", name: "Eritrea" },
  { code: "EE", name: "Estonia" },
  { code: "SZ", name: "Eswatini" },
  { code: "ET", name: "Ethiopia" },
  { code: "FJ", name: "Fiji" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" },
  { code: "GH", name: "Ghana" },
  { code: "GR", name: "Greece" },
  { code: "GD", name: "Grenada" },
  { code: "GT", name: "Guatemala" },
  { code: "GN", name: "Guinea" },
  { code: "GW", name: "Guinea-Bissau" },
  { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" },
  { code: "HN", name: "Honduras" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran" },
  { code: "IQ", name: "Iraq" },
  { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" },
  { code: "JO", name: "Jordan" },
  { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" },
  { code: "KI", name: "Kiribati" },
  { code: "KP", name: "North Korea" },
  { code: "KR", name: "South Korea" },
  { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Laos" },
  { code: "LV", name: "Latvia" },
  { code: "LB", name: "Lebanon" },
  { code: "LS", name: "Lesotho" },
  { code: "LR", name: "Liberia" },
  { code: "LY", name: "Libya" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MG", name: "Madagascar" },
  { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" },
  { code: "MV", name: "Maldives" },
  { code: "ML", name: "Mali" },
  { code: "MT", name: "Malta" },
  { code: "MH", name: "Marshall Islands" },
  { code: "MR", name: "Mauritania" },
  { code: "MU", name: "Mauritius" },
  { code: "MX", name: "Mexico" },
  { code: "FM", name: "Micronesia" },
  { code: "MD", name: "Moldova" },
  { code: "MC", name: "Monaco" },
  { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" },
  { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" },
  { code: "MM", name: "Myanmar" },
  { code: "NA", name: "Namibia" },
  { code: "NR", name: "Nauru" },
  { code: "NP", name: "Nepal" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" },
  { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" },
  { code: "MK", name: "North Macedonia" },
  { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman" },
  { code: "PK", name: "Pakistan" },
  { code: "PW", name: "Palau" },
  { code: "PS", name: "Palestine" },
  { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "QA", name: "Qatar" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia" },
  { code: "RW", name: "Rwanda" },
  { code: "KN", name: "Saint Kitts and Nevis" },
  { code: "LC", name: "Saint Lucia" },
  { code: "VC", name: "Saint Vincent and the Grenadines" },
  { code: "WS", name: "Samoa" },
  { code: "SM", name: "San Marino" },
  { code: "ST", name: "Sao Tome and Principe" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" },
  { code: "SC", name: "Seychelles" },
  { code: "SL", name: "Sierra Leone" },
  { code: "SG", name: "Singapore" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "SB", name: "Solomon Islands" },
  { code: "SO", name: "Somalia" },
  { code: "ZA", name: "South Africa" },
  { code: "SS", name: "South Sudan" },
  { code: "ES", name: "Spain" },
  { code: "LK", name: "Sri Lanka" },
  { code: "SD", name: "Sudan" },
  { code: "SR", name: "Suriname" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syria" },
  { code: "TW", name: "Taiwan" },
  { code: "TJ", name: "Tajikistan" },
  { code: "TZ", name: "Tanzania" },
  { code: "TH", name: "Thailand" },
  { code: "TL", name: "Timor-Leste" },
  { code: "TG", name: "Togo" },
  { code: "TO", name: "Tonga" },
  { code: "TT", name: "Trinidad and Tobago" },
  { code: "TN", name: "Tunisia" },
  { code: "TR", name: "Turkey" },
  { code: "TM", name: "Turkmenistan" },
  { code: "TV", name: "Tuvalu" },
  { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "UY", name: "Uruguay" },
  { code: "UZ", name: "Uzbekistan" },
  { code: "VU", name: "Vanuatu" },
  { code: "VA", name: "Vatican City" },
  { code: "VE", name: "Venezuela" },
  { code: "VN", name: "Vietnam" },
  { code: "YE", name: "Yemen" },
  { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
];

export function getAllCountries() {
  return COUNTRIES;
}

export function getClientIP(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string') {
    return realIp;
  }
  return req.socket?.remoteAddress || req.ip || '';
}

export interface CountryLookupResult {
  countryCode: string | null;
  countryName: string | null;
  isVPN: boolean;
  isProxy: boolean;
  isHosting: boolean;
}

// In-memory cache: avoid hammering ip-api.com on every request
const ipCache = new Map<string, { result: CountryLookupResult; expiresAt: number }>();
const IP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getCountryFromIP(ip: string): Promise<CountryLookupResult> {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return { countryCode: null, countryName: null, isVPN: false, isProxy: false, isHosting: false };
  }

  // Return cached result if still fresh
  const cached = ipCache.get(ip);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }
  
  try {
    // 3-second timeout so a slow/unreachable ip-api never hangs the page load
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    // Use https so it works on networks that block plain HTTP
    const response = await fetch(
      `https://ip-api.com/json/${ip}?fields=countryCode,country,status,proxy,hosting`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('IP-API request failed:', response.status);
      return { countryCode: null, countryName: null, isVPN: false, isProxy: false, isHosting: false };
    }
    const data = await response.json();
    if (data.status === 'success' && data.countryCode) {
      const result: CountryLookupResult = { 
        countryCode: data.countryCode, 
        countryName: data.country || null,
        isVPN: data.proxy === true,
        isProxy: data.proxy === true,
        isHosting: data.hosting === true
      };
      ipCache.set(ip, { result, expiresAt: Date.now() + IP_CACHE_TTL_MS });
      return result;
    }
    return { countryCode: null, countryName: null, isVPN: false, isProxy: false, isHosting: false };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.warn(`IP-API timeout for ${ip} — allowing access`);
    } else {
      console.error('Error getting country from IP:', error);
    }
    // On any failure (timeout, network error), allow access — never block legitimate users
    return { countryCode: null, countryName: null, isVPN: false, isProxy: false, isHosting: false };
  }
}

// Check if IP is using VPN, proxy, or hosting provider
export function isVPNOrProxy(result: CountryLookupResult): boolean {
  return result.isVPN || result.isProxy || result.isHosting;
}

async function isCountryBlocked(countryCode: string): Promise<boolean> {
  try {
    const result = await db.select()
      .from(blockedCountries)
      .where(eq(blockedCountries.countryCode, countryCode.toUpperCase()));
    return result.length > 0;
  } catch (error) {
    console.error('Error checking blocked country:', error);
    return false;
  }
}

export async function getBlockedCountries(): Promise<string[]> {
  try {
    const result = await db.select().from(blockedCountries);
    return result.map(row => row.countryCode);
  } catch (error) {
    console.error('Error getting blocked countries:', error);
    return [];
  }
}

export async function blockCountry(countryCode: string): Promise<boolean> {
  try {
    await db.insert(blockedCountries)
      .values({ countryCode: countryCode.toUpperCase() })
      .onConflictDoNothing();
    return true;
  } catch (error) {
    console.error('Error blocking country:', error);
    return false;
  }
}

export async function unblockCountry(countryCode: string): Promise<boolean> {
  try {
    await db.delete(blockedCountries)
      .where(eq(blockedCountries.countryCode, countryCode.toUpperCase()));
    return true;
  } catch (error) {
    console.error('Error unblocking country:', error);
    return false;
  }
}

export interface CountryCheckResult {
  blocked: boolean;
  country: string | null;
  isVPN: boolean;
  isProxy: boolean;
  isHosting: boolean;
  vpnBypass: boolean;
}

export async function checkCountry(ip: string): Promise<CountryCheckResult> {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return { blocked: false, country: null, isVPN: false, isProxy: false, isHosting: false, vpnBypass: false };
  }
  
  try {
    const result = await getCountryFromIP(ip);
    
    if (!result.countryCode) {
      return { blocked: false, country: null, isVPN: result.isVPN, isProxy: result.isProxy, isHosting: result.isHosting, vpnBypass: false };
    }
    
    const countryIsBlocked = await isCountryBlocked(result.countryCode);
    
    // VPN BYPASS LOGIC: If country is blocked BUT user is using VPN/proxy/hosting, ALLOW access
    const usingVPN = isVPNOrProxy(result);
    const vpnBypass = countryIsBlocked && usingVPN;
    
    // Final blocked status: blocked only if country is blocked AND NOT using VPN
    const finalBlocked = countryIsBlocked && !usingVPN;
    
    if (vpnBypass) {
      console.log(`🔐 VPN bypass granted for ${result.countryCode} (VPN: ${result.isVPN}, Proxy: ${result.isProxy}, Hosting: ${result.isHosting})`);
    }
    
    return { 
      blocked: finalBlocked, 
      country: result.countryCode,
      isVPN: result.isVPN,
      isProxy: result.isProxy,
      isHosting: result.isHosting,
      vpnBypass
    };
  } catch (error) {
    console.error('Error in checkCountry:', error);
    return { blocked: false, country: null, isVPN: false, isProxy: false, isHosting: false, vpnBypass: false };
  }
}

export function getBlockedHTML(): string {
  return BLOCKED_HTML;
}

const BLOCKED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not Available</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #000000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .container {
      text-align: center;
      padding: 40px;
    }
    .icon {
      margin-bottom: 24px;
    }
    .icon svg {
      width: 64px;
      height: 64px;
    }
    h1 {
      color: #ffffff;
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    p {
      color: #888888;
      font-size: 16px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
      </svg>
    </div>
    <h1>Not available in your country</h1>
    <p>This service is not accessible from your location.</p>
  </div>
</body>
</html>`;

// Check if user is admin based on Telegram ID
function isAdminUser(telegramId: string | null): boolean {
  if (!telegramId) return false;
  const adminId = process.env.TELEGRAM_ADMIN_ID;
  if (!adminId) return false;
  return adminId.toString() === telegramId.toString();
}

export async function countryBlockingMiddleware(req: Request, res: Response, next: NextFunction) {
  // Always allow API routes (authentication, admin endpoints, etc.)
  if (req.path.startsWith('/api/')) {
    return next();
  }
  
  // Allow static assets (css, js, images, fonts, etc.)
  if (req.path !== '/' && !req.path.endsWith('.html') && req.path.includes('.')) {
    return next();
  }
  
  try {
    // Check for admin via Telegram WebApp initData in URL query params (initial page load)
    const tgWebAppData = req.query.tgWebAppData as string;
    if (tgWebAppData) {
      try {
        const urlParams = new URLSearchParams(tgWebAppData);
        const userString = urlParams.get('user');
        if (userString) {
          const telegramUser = JSON.parse(decodeURIComponent(userString));
          if (isAdminUser(telegramUser.id?.toString())) {
            console.log('✅ Admin user detected via tgWebAppData, bypassing country block');
            return next();
          }
        }
      } catch (e) {
        // Continue with normal check if parsing fails
      }
    }
    
    // Check for admin via hash fragment data (Telegram Mini Apps send data in URL)
    const referer = req.headers.referer || req.headers.origin || '';
    if (referer) {
      try {
        const url = new URL(referer);
        const hashParams = new URLSearchParams(url.hash.replace('#', ''));
        const tgData = hashParams.get('tgWebAppData');
        if (tgData) {
          const dataParams = new URLSearchParams(tgData);
          const userString = dataParams.get('user');
          if (userString) {
            const telegramUser = JSON.parse(decodeURIComponent(userString));
            if (isAdminUser(telegramUser.id?.toString())) {
              console.log('✅ Admin user detected via referer hash, bypassing country block');
              return next();
            }
          }
        }
      } catch (e) {
        // Continue with normal check if parsing fails
      }
    }
    
    // Check if user is admin via custom headers (for subsequent requests)
    const telegramData = req.headers['x-telegram-data'] as string;
    if (telegramData) {
      try {
        const urlParams = new URLSearchParams(telegramData);
        const userString = urlParams.get('user');
        if (userString) {
          const telegramUser = JSON.parse(userString);
          if (isAdminUser(telegramUser.id?.toString())) {
            console.log('✅ Admin user detected in middleware, bypassing country block');
            return next();
          }
        }
      } catch (e) {
        // Continue with normal check if parsing fails
      }
    }
    
    // Also check admin ID from cached user header
    const cachedUserId = req.headers['x-user-id'] as string;
    if (isAdminUser(cachedUserId)) {
      console.log('✅ Admin user detected via cached ID in middleware, bypassing country block');
      return next();
    }
    
    // Step 1: Detect user IP from headers or socket
    const clientIP = getClientIP(req);
    
    // Skip blocking for local/development IPs
    if (!clientIP || clientIP === '127.0.0.1' || clientIP === '::1') {
      return next();
    }
    
    // Step 2: Convert IP to country via ip-api.com (includes VPN detection)
    const result = await getCountryFromIP(clientIP);
    
    if (!result.countryCode) {
      return next();
    }
    
    // Step 3: Check if country is blocked in database
    const countryIsBlocked = await isCountryBlocked(result.countryCode);
    
    // Step 4: VPN BYPASS - If using VPN/proxy/hosting, allow access even if country is blocked
    const usingVPN = isVPNOrProxy(result);
    
    if (countryIsBlocked && usingVPN) {
      console.log(`🔐 VPN bypass granted from ${result.countryCode} (IP: ${clientIP}, VPN: ${result.isVPN}, Hosting: ${result.isHosting})`);
      return next();
    }
    
    // Step 5: If blocked (and NOT using VPN), return block HTML page
    if (countryIsBlocked) {
      console.log(`🚫 Blocked access from ${result.countryCode} (IP: ${clientIP})`);
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(403).send(BLOCKED_HTML);
    }
    
    // Step 6: If allowed, continue to next()
    next();
  } catch (error) {
    console.error('Country blocking middleware error:', error);
    // On error, allow access to avoid blocking legitimate users
    next();
  }
}
