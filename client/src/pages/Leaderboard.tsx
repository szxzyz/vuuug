import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Users, Gem, UserPlus } from "lucide-react";
import { formatCompactNumber } from "@shared/constants";
import { formatCurrency } from "@/lib/utils";

// Helper function to format PAD with compact notation
const formatPADCompact = (value: string): string => {
  const numValue = parseFloat(value || '0');
  if (isNaN(numValue)) return '0 PAD';
  
  // If value is very small (< 1), it might be legacy TON format - convert to PAD
  // Otherwise, treat as PAD integer
  const padValue = numValue < 1 ? Math.round(numValue * 10000000) : Math.round(numValue);
  
  return `${formatCompactNumber(padValue)} PAD`;
};
import { useState } from "react";
import type { User } from "@shared/schema";

interface LeaderboardUser {
  rank: number;
  username: string;
  firstName: string;
  profileImage: string;
  userId: string;
}

interface EarnerUser extends LeaderboardUser {
  totalEarnings: string;
}

interface ReferrerUser extends LeaderboardUser {
  totalReferrals: number;
}

interface LeaderboardData {
  topEarners: EarnerUser[];
  topReferrers: ReferrerUser[];
  userEarnerRank?: { rank: number; totalEarnings: string } | null;
  userReferrerRank?: { rank: number; totalReferrals: number } | null;
}

export default function Leaderboard() {
  const { isLoading, user } = useAuth();
  const [activeTab, setActiveTab] = useState<'earners' | 'referrers'>('earners');

  const { data: leaderboardData, isLoading: leaderboardLoading } = useQuery<LeaderboardData>({
    queryKey: ["/api/leaderboard/monthly"],
    retry: false,
    refetchOnMount: true,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-primary text-3xl mb-4">
            <i className="fas fa-spinner"></i>
          </div>
          <div className="text-foreground font-medium">Loading...</div>
        </div>
      </div>
    );
  }

  const topEarners = leaderboardData?.topEarners || [];
  const topReferrers = leaderboardData?.topReferrers || [];

  const getRankEmoji = (rank: number) => {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return `#${rank}`;
    }
  };

  return (
    <Layout>
      <div className="h-full flex flex-col max-w-md mx-auto">
        {/* Sticky Header Section - Always visible below navigation */}
        <div className="sticky top-0 z-20 bg-black border-b border-[#1A1A1A] px-4 pt-3 pb-2">
          <div className="mb-2">
            <h1 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-primary" />
              Monthly Leaderboard
            </h1>
            <p className="text-xs text-muted-foreground">
              Top performers this month
            </p>
          </div>

          {/* Tab Switcher - Always visible */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => setActiveTab('earners')}
              className={`h-9 text-sm ${
                activeTab === 'earners'
                  ? 'btn-primary'
                  : 'bg-[#1C1C1E] border border-[#2A2A2A] text-muted-foreground hover:bg-[#2C2C2E]'
              }`}
            >
              <Trophy className="w-3.5 h-3.5 mr-1.5" />
              PAD Earners
            </Button>
            <Button
              onClick={() => setActiveTab('referrers')}
              className={`h-9 text-sm ${
                activeTab === 'referrers'
                  ? 'btn-primary'
                  : 'bg-[#1C1C1E] border border-[#2A2A2A] text-muted-foreground hover:bg-[#2C2C2E]'
              }`}
            >
              <Users className="w-3.5 h-3.5 mr-1.5" />
              Top Referrers
            </Button>
          </div>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-1">

        {/* PAD Earners Ranking */}
        {activeTab === 'earners' && (
          <div>
            {leaderboardLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin text-primary text-2xl mb-2">
                  <i className="fas fa-spinner"></i>
                </div>
                <p className="text-muted-foreground">Loading rankings...</p>
              </div>
            ) : topEarners.length === 0 ? (
              <Card className="minimal-card">
                <CardContent className="pt-6 pb-6 text-center">
                  <Trophy className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">No earnings data available</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Header Row */}
                <div className="flex items-center justify-between px-4 py-2 mb-2 text-xs font-semibold text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="w-6">Rank</span>
                    <span className="ml-8">Name</span>
                  </div>
                  <span>Balance</span>
                </div>

                <div className="space-y-2">
                  {topEarners.map((earner) => (
                    <Card key={earner.userId} className="minimal-card">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div className="text-base font-bold text-primary w-6 flex-shrink-0">
                              {getRankEmoji(earner.rank)}
                            </div>
                            {earner.profileImage ? (
                              <img 
                                src={earner.profileImage} 
                                alt={earner.firstName || 'User'}
                                className="w-9 h-9 rounded-full flex-shrink-0"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {(earner.firstName || '?').charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-white font-medium text-sm truncate">
                                {earner.firstName || 'Anonymous'}
                              </div>
                            </div>
                          </div>
                          <div className="text-primary text-sm font-bold flex-shrink-0">
                            {formatPADCompact(earner.totalEarnings)}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Top Referrers Ranking */}
        {activeTab === 'referrers' && (
          <div>
            {leaderboardLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin text-primary text-2xl mb-2">
                  <i className="fas fa-spinner"></i>
                </div>
                <p className="text-muted-foreground">Loading rankings...</p>
              </div>
            ) : topReferrers.length === 0 ? (
              <Card className="minimal-card">
                <CardContent className="pt-6 pb-6 text-center">
                  <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">No referrals data available</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Header Row */}
                <div className="flex items-center justify-between px-4 py-2 mb-2 text-xs font-semibold text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="w-6">Rank</span>
                    <span className="ml-8">Name</span>
                  </div>
                  <span>Referrals</span>
                </div>

                <div className="space-y-2 pb-4">
                  {topReferrers.map((referrer) => (
                    <Card key={referrer.userId} className="minimal-card">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div className="text-base font-bold text-primary w-6 flex-shrink-0">
                              {getRankEmoji(referrer.rank)}
                            </div>
                            {referrer.profileImage ? (
                              <img 
                                src={referrer.profileImage} 
                                alt={referrer.firstName || 'User'}
                                className="w-9 h-9 rounded-full flex-shrink-0"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {(referrer.firstName || '?').charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-white font-medium text-sm truncate">
                                {referrer.firstName || 'Anonymous'}
                              </div>
                            </div>
                          </div>
                          <div className="text-primary text-sm font-bold flex-shrink-0">
                            {referrer.totalReferrals} referrals
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        </div>

        {/* Sticky "Your Rank" Section at Bottom */}
        <div className="sticky bottom-0 z-20 border-t border-[#1A1A1A] bg-black/95 backdrop-blur-sm px-4 py-1.5">
          {activeTab === 'earners' ? (
            <Card className="minimal-card border-primary/30">
              <CardContent className="p-2">
                <div className="text-xs text-primary font-semibold mb-1">Your Rank</div>
                {leaderboardData?.userEarnerRank ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="text-base font-bold text-primary w-6 flex-shrink-0">
                        #{leaderboardData.userEarnerRank.rank}
                      </div>
                      {(user as User)?.profileImageUrl ? (
                        <img 
                          src={(user as User).profileImageUrl!} 
                          alt={(user as User).username || 'You'}
                          className="w-8 h-8 rounded-full flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {(user as User)?.username?.[0]?.toUpperCase() || 'Y'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium text-xs truncate">
                          {(user as User)?.username || 'You'}
                        </div>
                      </div>
                    </div>
                    <div className="text-primary text-xs font-bold flex-shrink-0">
                      {formatPADCompact(leaderboardData.userEarnerRank.totalEarnings)}
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground text-xs py-1">
                    Start earning PAD to appear on the leaderboard
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="minimal-card border-primary/30">
              <CardContent className="p-2">
                <div className="text-xs text-primary font-semibold mb-1">Your Rank</div>
                {leaderboardData?.userReferrerRank ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="text-base font-bold text-primary w-6 flex-shrink-0">
                        #{leaderboardData.userReferrerRank.rank}
                      </div>
                      {(user as User)?.profileImageUrl ? (
                        <img 
                          src={(user as User).profileImageUrl!} 
                          alt={(user as User).username || 'You'}
                          className="w-8 h-8 rounded-full flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {(user as User)?.username?.[0]?.toUpperCase() || 'Y'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium text-xs truncate">
                          {(user as User)?.username || 'You'}
                        </div>
                      </div>
                    </div>
                    <div className="text-primary text-xs font-bold flex-shrink-0">
                      {leaderboardData.userReferrerRank.totalReferrals} referrals
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground text-xs py-1">
                    Start inviting friends to appear on the leaderboard
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}
