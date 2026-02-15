import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { showNotification } from '@/components/AppNotification';
import Layout from '@/components/Layout';
import { Share2, Users, Copy, Loader2, Bug, DollarSign } from 'lucide-react';

interface User {
  id: string;
  username?: string;
  firstName?: string;
  referralCode?: string;
  [key: string]: any;
}

interface ReferralStats {
  totalInvites: number;
  successfulInvites: number;
  totalClaimed: string;
  availableBonus: string;
  readyToClaim: string;
  totalBugEarned?: number;
  totalUsdEarned?: number;
}

interface AppSettings {
  affiliateCommission?: number;
  referralRewardEnabled?: boolean;
  referralRewardUSD?: number;
  referralRewardPAD?: number;
}

export default function Affiliates() {
  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ['/api/auth/user'],
    retry: false,
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<ReferralStats>({
    queryKey: ['/api/referrals/stats'],
    retry: false,
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const { data: appSettings } = useQuery<AppSettings>({
    queryKey: ['/api/app-settings'],
    retry: false,
    staleTime: 120000,
    gcTime: 600000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const isLoading = userLoading || statsLoading;

  const botUsername = import.meta.env.VITE_BOT_USERNAME || 'MoneyAdzbot';
  // Use bot deep link format (?start=) for reliable referral tracking
  // This ensures the /start command is triggered and referral is processed via webhook
  const referralLink = user?.referralCode 
    ? `https://t.me/${botUsername}?start=${user.referralCode}`
    : '';

  const copyReferralLink = () => {
    if (referralLink) {
      navigator.clipboard.writeText(referralLink);
      showNotification('Link copied!', 'success');
    }
  };

  const [isSharing, setIsSharing] = useState(false);

  const shareReferralLink = async () => {
    if (!referralLink || isSharing) return;
    
    setIsSharing(true);
    
    try {
      const tgWebApp = window.Telegram?.WebApp as any;
      
      // Native Telegram share: Use shareMessage() with prepared message from backend
      if (tgWebApp?.shareMessage) {
        try {
          // First, prepare the message on the backend
          const response = await fetch('/api/share/prepare-message', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
          });
          const data = await response.json();
          
          if (data.success && data.messageId) {
            // Use the native Telegram share dialog with prepared message
            tgWebApp.shareMessage(data.messageId, (success: boolean) => {
              if (success) {
                showNotification('Message shared successfully!', 'success');
              }
              setIsSharing(false);
            });
            return;
          } else if (data.fallbackUrl) {
            // Backend returned fallback URL
            tgWebApp.openTelegramLink(data.fallbackUrl);
            setIsSharing(false);
            return;
          }
        } catch (error) {
          console.error('Prepare message error:', error);
        }
      }
      
      // Fallback: Use Telegram's native share URL dialog
      const shareTitle = `💵 Get paid for completing tasks and watching ads.`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareTitle)}`;
      
      if (tgWebApp?.openTelegramLink) {
        tgWebApp.openTelegramLink(shareUrl);
      } else {
        window.open(shareUrl, '_blank');
      }
    } catch (error) {
      console.error('Share error:', error);
    }
    
    setIsSharing(false);
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="flex gap-1 justify-center mb-4">
              <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <div className="text-foreground font-medium">Loading...</div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-3">
        <Card className="mb-4 minimal-card">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Users className="w-7 h-7 text-[#007BFF]" />
              <h1 className="text-2xl font-bold text-white">Affiliates program</h1>
            </div>
            
            <p className="text-sm text-center text-white leading-relaxed mb-4">
              Invite friends and get <span className="font-bold">{appSettings?.affiliateCommission || 10}%</span> of every ads completed by your referrals automatically added to your balance
            </p>
            
            {appSettings?.referralRewardEnabled && (
              <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-xs text-green-400 font-medium text-center">
                  Bonus: Earn <span className="font-bold">{appSettings.referralRewardPAD || 50} PAD</span> + <span className="font-bold">${appSettings.referralRewardUSD || 0.0005} USD</span> when your friend watches their first ad!
                </p>
              </div>
            )}
            
            <div className="flex items-center gap-2 mb-3">
              <Share2 className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-blue-400">Friend Invite Link</h3>
            </div>
            
            <div className="bg-muted/50 rounded-lg p-3 mb-3 overflow-x-auto text-sm text-foreground whitespace-nowrap">
              {referralLink}
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <Button
                className="h-12 btn-primary"
                onClick={copyReferralLink}
                disabled={!referralLink}
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
              
              <Button
                className="h-12 btn-primary"
                onClick={shareReferralLink}
                disabled={!referralLink || isSharing}
              >
                {isSharing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Share2 className="w-4 h-4 mr-2" />}
                {isSharing ? 'Sending...' : 'Share'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <Card className="minimal-card">
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground mb-1">Total Invites</div>
              <div className="text-xl font-bold text-[#e5e5e5]">{stats?.totalInvites || 0}</div>
            </CardContent>
          </Card>
          
          <Card className="minimal-card">
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground mb-1">Successful Invites</div>
              <div className="text-xl font-bold text-[#4cd3ff]">{stats?.successfulInvites || 0}</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <Card className="minimal-card">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Bug className="w-4 h-4 text-green-400" />
                <span className="text-xs text-muted-foreground">BUG Earned</span>
              </div>
              <div className="text-xl font-bold text-green-400">
                {(stats?.totalBugEarned || 0).toLocaleString()}
              </div>
            </CardContent>
          </Card>
          
          <Card className="minimal-card">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-muted-foreground">Total Earned</span>
              </div>
              <div className="text-xl font-bold text-emerald-400">
                ${(stats?.totalUsdEarned || 0).toFixed(3)}
              </div>
            </CardContent>
          </Card>
        </div>

      </main>
    </Layout>
  );
}
