import { useQuery } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { apiRequest } from "@/lib/queryClient";
import { Megaphone, Users, ExternalLink } from "lucide-react";

const CARD = "rgba(255,255,255,0.07)";
const TEXT = "#fff";
const TEXT_DIM = "rgba(255,255,255,0.45)";
const PINK = "#ec4899";
const BLUE = "#3b82f6";

interface AmbassadorEntry {
  id: string;
  promoCodeName: string;
  channelId: string | null;
  channelTitle: string | null;
  channelUsername: string | null;
  subscriberCount: number | null;
  totalClaims: number;
  channelLink: string | null;
}

function AmbassadorCard({ amb }: { amb: AmbassadorEntry }) {
  const channelName = amb.channelTitle || amb.channelUsername || amb.promoCodeName;
  const joinLink = amb.channelLink || (amb.channelUsername ? `https://t.me/${amb.channelUsername}` : null);
  const REWARD = 2000;

  const handleJoin = () => {
    if (!joinLink) return;
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      if (joinLink.includes("t.me/") && tg.openTelegramLink) tg.openTelegramLink(joinLink);
      else if (tg.openLink) tg.openLink(joinLink);
      else window.open(joinLink, "_blank");
    } else {
      window.open(joinLink, "_blank");
    }
  };

  return (
    <div style={{
      background: CARD,
      borderRadius: 18,
      overflow: "hidden",
      marginBottom: 10,
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px" }}>
        {/* Avatar */}
        <div style={{
          width: 50, height: 50, borderRadius: 14, flexShrink: 0,
          background: `linear-gradient(135deg, ${PINK}22, ${BLUE}22)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: `1.5px solid ${PINK}40`,
        }}>
          <Megaphone style={{ width: 22, height: 22, color: PINK }} />
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: TEXT, fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
            {channelName}
          </div>
          {amb.subscriberCount != null && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
              <Users style={{ width: 11, height: 11, color: TEXT_DIM }} />
              <span style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 600 }}>
                {amb.subscriberCount.toLocaleString()} subscribers
              </span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <span style={{ color: PINK, fontSize: 12, fontWeight: 800 }}>+{REWARD.toLocaleString()}</span>
            <span style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 600 }}>POW</span>
          </div>
        </div>

        {/* Join Button */}
        {joinLink && (
          <button
            onClick={handleJoin}
            style={{
              flexShrink: 0,
              height: 36,
              padding: "0 14px",
              borderRadius: 10,
              border: "none",
              background: `linear-gradient(135deg, ${PINK}, #f472b6)`,
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              boxShadow: `0 2px 10px ${PINK}40`,
            }}
            className="active:scale-95 transition-transform"
          >
            <ExternalLink style={{ width: 12, height: 12 }} />
            Join
          </button>
        )}
      </div>
    </div>
  );
}

export default function AmbassadorDirectory() {
  const { data, isLoading } = useQuery<{ success: boolean; ambassadors: AmbassadorEntry[] }>({
    queryKey: ["/api/ambassadors/directory"],
    queryFn: () => apiRequest("GET", "/api/ambassadors/directory").then(r => r.json()),
    retry: false,
    staleTime: 60000,
  });

  const ambassadors = data?.ambassadors || [];

  return (
    <Layout>
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "16px 16px 20px" }}>
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 12,
              background: `linear-gradient(135deg, ${PINK}22, ${PINK}44)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              border: `1.5px solid ${PINK}40`,
            }}>
              <Megaphone style={{ width: 18, height: 18, color: PINK }} />
            </div>
            <div>
              <div style={{ color: TEXT, fontSize: 17, fontWeight: 800 }}>Ambassador Directory</div>
              <div style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 500 }}>Join channels · Earn 2,000 POW each</div>
            </div>
          </div>
        </div>

        {/* Info Banner */}
        <div style={{
          background: `${PINK}12`,
          border: `1px solid ${PINK}30`,
          borderRadius: 14,
          padding: "12px 14px",
          marginBottom: 18,
        }}>
          <p style={{ color: "#f9a8d4", fontSize: 12, fontWeight: 600, margin: 0 }}>
            💌 Join ambassador channels and use their promo codes to earn <strong>2,000 POW</strong> per channel!
          </p>
        </div>

        {/* Ambassador list */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
              {[0, 150, 300].map(d => (
                <div key={d} style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: PINK,
                  animation: "bounce 1s infinite",
                  animationDelay: `${d}ms`,
                }} />
              ))}
            </div>
          </div>
        ) : ambassadors.length === 0 ? (
          <div style={{
            background: CARD,
            borderRadius: 16,
            padding: "32px 20px",
            textAlign: "center",
          }}>
            <Megaphone style={{ width: 36, height: 36, color: TEXT_DIM, margin: "0 auto 12px" }} />
            <div style={{ color: TEXT_DIM, fontSize: 13, fontWeight: 600 }}>No ambassadors yet</div>
            <div style={{ color: TEXT_DIM, fontSize: 11, marginTop: 4 }}>Check back soon!</div>
          </div>
        ) : (
          <div>
            {ambassadors.map(amb => (
              <AmbassadorCard key={amb.id} amb={amb} />
            ))}
          </div>
        )}
      </main>
    </Layout>
  );
}
