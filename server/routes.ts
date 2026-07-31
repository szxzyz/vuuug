import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { WebSocketServer, WebSocket } from 'ws';
import { alias } from "drizzle-orm/pg-core";
import { 
  insertEarningSchema, 
  users, 
  earnings, 
  referrals, 
  referralCommissions,
  withdrawals,
  userBalances,
  dailyTasks,
  promoCodes,
  promoCodeUsage,
  transactions,
  adminSettings,
  advertiserTasks,
  taskClicks,
  channelPenaltyCases,
  spinData,
  spinHistory,
  dailyMissions,
  missionAdClaims,
  adSessions,
  adminRoles,
  ambassadorApplications,
  ambassadors,
  ambassadorEarnings,
} from "../shared/schema";
import { db } from "./db";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import crypto from "crypto";
import { sendTelegramMessage, sendUserTelegramNotification, sendWelcomeMessage, handleTelegramMessage, setupTelegramWebhook, verifyChannelMembership, sendSharePhotoToChat, withdrawalAdminMessages } from "./telegram";
import { authenticateTelegram, requireAuth } from "./auth";
import {
  requireVerifiedSession,
  requireStrictAuth,
  securityLog,
  authRateLimit,
  adWatchRateLimit,
  withdrawRateLimit,
  walletMutationRateLimit,
  taskRateLimit,
} from "./securityMiddleware";
import { isAuthenticated } from "./replitAuth";
import { computeRiskScore, analyzeAdBehavior, checkRateLimit } from "./fraudDetection";
import { config, getChannelConfig } from "./config";