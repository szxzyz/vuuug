import Layout from "@/components/Layout";
import Header from "@/components/Header";
import AdWatchingSection from "@/components/AdWatchingSection";
import LimitsSection from "@/components/LimitsSection";
import DailyActivityBonus from "@/components/DailyActivityBonus";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export default function Watch() {
  const { user } = useAuth();

  const { data: appSettings } = useQuery({
    queryKey: ["/api/app-settings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/app-settings");
      return res.json();
    },
    staleTime: 60000,
  });

  return (
    <Layout>
      <Header />
      <main className="max-w-md mx-auto px-4 pt-4 pb-28 bg-black min-h-screen">
        <AdWatchingSection user={user} />
        <LimitsSection
          dailyLimit={appSettings?.dailyAdLimit ?? 510}
          hourlyLimit={appSettings?.hourlyAdLimit ?? 63}
        />
        <DailyActivityBonus user={user} />
      </main>
    </Layout>
  );
}
