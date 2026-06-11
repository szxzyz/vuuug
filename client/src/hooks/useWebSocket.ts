import { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { showNotification } from '@/components/AppNotification';
import { apiRequest } from '@/lib/queryClient';
import { useQueryClient } from '@tanstack/react-query';

interface WebSocketMessage {
  type: string;
  message?: string;
  amount?: string;
  timestamp?: string;
  data?: any;
}

export function useWebSocket() {
  const { user } = useAuth() as { user: any };
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSessionToken = async (): Promise<string | null> => {
    try {
      const response = await apiRequest('GET', '/api/auth/session-token');
      const data = await response.json();
      return data.sessionToken;
    } catch (error) {
      console.error('Error fetching session token:', error);
      return null;
    }
  };

  const connect = async () => {
    if (!user?.id) return;

    // Fetch session token before connecting
    const sessionToken = await fetchSessionToken();
    if (!sessionToken) {
      console.error('❌ Failed to obtain session token, cannot connect WebSocket');
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        setIsConnected(true);
        
        // Authenticate with session token
        ws.send(JSON.stringify({
          type: 'auth',
          sessionToken: sessionToken
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setMessages(prev => [...prev.slice(-9), message]); // Keep last 10 messages

          // Handle different message types
          switch (message.type) {
            case 'connected':
              // Silently handle connection confirmation without showing toast
              console.log('✅ WebSocket authenticated successfully');
              break;
              
            case 'auth_error':
              console.error('❌ WebSocket authentication error:', message.message);
              showNotification("Connection error", "error");
              break;
              
            case 'ad_reward':
              // Notification is already handled in AdWatchingSection
              // Just invalidate queries to update the balance
              queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
              queryClient.invalidateQueries({ queryKey: ['/api/user/stats'] });
              break;
              
            case 'withdrawal_requested':
              // ✅ FIX: Show proper notification message for withdrawal request
              showNotification("You have sent a withdrawal request.", "success");
              // Invalidate queries to update UI
              queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] });
              queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
              break;
              
            case 'withdrawal_approved':
              showNotification("Withdrawal approved!", "success");
              // Invalidate withdrawal queries to update UI immediately (user + admin)
              queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] });
              queryClient.invalidateQueries({ queryKey: ['/api/admin/withdrawals/pending'] });
              queryClient.invalidateQueries({ queryKey: ['/api/admin/withdrawals/processed'] });
              queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
              queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
              queryClient.invalidateQueries({ queryKey: ['/api/user/stats'] });
              break;
              
            case 'withdrawal_rejected':
              showNotification("Withdrawal rejected", "error");
              // Invalidate withdrawal queries to update UI immediately (user + admin)
              queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] });
              queryClient.invalidateQueries({ queryKey: ['/api/admin/withdrawals/pending'] });
              queryClient.invalidateQueries({ queryKey: ['/api/admin/withdrawals/processed'] });
              queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
              queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
              queryClient.invalidateQueries({ queryKey: ['/api/user/stats'] });
              break;
              
            case 'referral_bonus':
              showNotification("Referral bonus!", "success", parseFloat(message.amount || '0'));
              break;
              
            case 'balance_update':
              console.log('💰 Real-time balance update received:', message);
              
              // Force update the cache with new balance values
              queryClient.setQueryData(['/api/auth/user'], (oldUser: any) => {
                if (!oldUser) return oldUser;
                return {
                  ...oldUser,
                  tonBalance: (message as any).tonBalance ?? oldUser.tonBalance,
                  balance: (message as any).balance ?? oldUser.balance,
                  usdBalance: (message as any).usdBalance ?? oldUser.usdBalance,
                  bugBalance: (message as any).bugBalance ?? oldUser.bugBalance,
                };
              });
              
              // Also invalidate to ensure everything is perfectly in sync
              queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
              
              if (message.message) {
                showNotification("Balance Updated", "success");
              }
              break;
              
            case 'promotion_approved':
              showNotification("Promotion approved!", "success");
              break;
              
            case 'promotion_rejected':
              showNotification("Promotion rejected", "error");
              break;
              
            case 'task_deleted':
              showNotification("Task deleted", "error");
              break;
              
            case 'task_removed':
              // Broadcast event for real-time task list updates
              const taskRemovedEvent = new CustomEvent('taskRemoved', { 
                detail: { promotionId: (message as any).promotionId } 
              });
              window.dispatchEvent(taskRemovedEvent);
              break;
              
            case 'taskPaymentSuccess':
              // Payment success notification for task creation
              showNotification(message.message || "Payment successful!", "success");
              queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
              break;
              
            case 'task:created':
              // New task created - update feed for all users
              queryClient.invalidateQueries({ queryKey: ['/api/advertiser-tasks'] });
              queryClient.invalidateQueries({ queryKey: ['/api/advertiser-tasks/my-tasks'] });
              console.log('✨ New task created - feed updated');
              break;
              
            case 'settings_updated':
              // Admin updated app settings - refresh for all users
              showNotification("Settings updated by admin", "success");
              queryClient.invalidateQueries({ queryKey: ['/api/app-settings'] });
              queryClient.invalidateQueries({ queryKey: ['/api/admin/settings'] });
              console.log('⚙️ App settings updated by admin - refreshing');
              break;
              
            case 'country_blocked':
              // Admin blocked a country - dispatch event for App.tsx to handle
              console.log('🚫 Country blocked:', (message as any).countryCode);
              window.dispatchEvent(new CustomEvent('countryBlockChanged', { 
                detail: { 
                  action: 'blocked',
                  countryCode: (message as any).countryCode 
                } 
              }));
              break;
              
            case 'country_unblocked':
              // Admin unblocked a country - dispatch event for App.tsx to handle
              console.log('✅ Country unblocked:', (message as any).countryCode);
              window.dispatchEvent(new CustomEvent('countryBlockChanged', { 
                detail: { 
                  action: 'unblocked',
                  countryCode: (message as any).countryCode 
                } 
              }));
              break;
              
            default:
              // Remove default black notifications to prevent duplicates
              // Only log unhandled messages for debugging
              if (message.message) {
                console.log('📬 Unhandled WebSocket message:', message);
              }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        setIsConnected(false);
        
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setIsConnected(false);
      };
    } catch (error) {
      console.error('❌ Failed to create WebSocket connection:', error);
    }
  };

  useEffect(() => {
    if (user?.id) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [user?.id]);

  const sendMessage = (message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  return {
    isConnected,
    messages,
    sendMessage
  };
}