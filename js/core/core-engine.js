import {
  observerAuth,
  getDocument,
  updatePresence,
} from "../firebase-service.js";
import {
  buildCompetitiveSnapshot,
  computeWinrate,
} from "./competitive-metrics.js";
import {
  buildLevelProgressState,
  getDivisionByRating,
  compareDivisionRank,
} from "../config/elo-system.js";
import {
  aggregateMonthlyImprovement,
  computeUserPercentiles,
  computeLeaderboardMetric,
} from "../modules/visual-intelligence.js";
import {
  buildAIContext,
  getDailySuggestion,
  handleAIQuery,
} from "../ai/ai-core.js";
import {
  createNotification,
  initAutoNotifications,
  cleanupAutoNotifications,
  listenToNotifications,
  markAsRead,
  markAsSeen,
} from "../services/notification-service.js";

const coreState = {
  uid: null,
  authUser: null,
  userDoc: null,
  initializedAt: 0,
  updatedAt: 0,
};

function stampState(partial = {}) {
  Object.assign(coreState, partial, { updatedAt: Date.now() });
}

export function getCoreState() {
  return { ...coreState };
}

export async function syncCoreUserDoc(uid) {
  if (!uid) return null;
  const userDoc = await getDocument("usuarios", uid);
  stampState({ uid, userDoc });
  return userDoc;
}

export function observeCoreSession({ onReady, onSignedOut } = {}) {
  return observerAuth(async (user) => {
    if (!user) {
      stampState({
        uid: null,
        authUser: null,
        userDoc: null,
        initializedAt: Date.now(),
      });
      if (typeof onSignedOut === "function") onSignedOut();
      return;
    }
    const userDoc = await getDocument("usuarios", user.uid);
    stampState({
      uid: user.uid,
      authUser: user,
      userDoc,
      initializedAt: coreState.initializedAt || Date.now(),
    });
    if (typeof onReady === "function") onReady({ user, userDoc });
  });
}

export function getCompetitiveState(user = {}) {
  const snapshot = buildCompetitiveSnapshot(user);
  const division = getDivisionByRating(snapshot.rating);
  const level = buildLevelProgressState({
    rating: snapshot.rating,
    levelOverride: Number(user?.nivel || 2.5),
  });
  return { snapshot, division, level };
}

export function computeCompetitiveWinrate(userOrWins, playedMaybe) {
  if (typeof userOrWins === "object" && userOrWins) {
    return computeWinrate(userOrWins?.victorias, userOrWins?.partidosJugados);
  }
  return computeWinrate(userOrWins, playedMaybe);
}

export function getDivisionMovement(pointsBefore, pointsNow) {
  return compareDivisionRank(Number(pointsBefore || 0), Number(pointsNow || 0));
}

export function getCoreDivisionByRating(rating) {
  return getDivisionByRating(rating);
}

export function getCoreLevelProgressState({ rating, levelOverride } = {}) {
  return buildLevelProgressState({ rating, levelOverride });
}

export function computeRankingContext(logs = [], days = 30) {
  return {
    monthlyImprovement: aggregateMonthlyImprovement(logs, days),
  };
}

export function aggregateCoreMonthlyImprovement(logs = [], days = 30) {
  return aggregateMonthlyImprovement(logs, days);
}

export function computeGlobalPercentiles({
  users = [],
  targetUid = "",
  monthlyImprovement = new Map(),
} = {}) {
  return computeUserPercentiles({ users, targetUid, monthlyImprovement });
}

export function computeCoreUserPercentiles(args = {}) {
  return computeUserPercentiles(args);
}

export function computeRankingMetric(user, metric, ctx) {
  return computeLeaderboardMetric(user, metric, ctx);
}

export async function getCoreAIContext({ uid, match } = {}) {
  return buildAIContext({ uid, match });
}

export async function getCoreDailySuggestion(uid) {
  return getDailySuggestion(uid);
}

export async function queryCoreAI({ uid, query, match = null, phase = "chat" } = {}) {
  return handleAIQuery({ uid, query, match, phase });
}

export async function sendCoreNotification(...args) {
  return createNotification(...args);
}

export function listenCoreNotifications(callback, options = {}) {
  return listenToNotifications(callback, options);
}

export async function markCoreNotificationRead(notifId) {
  return markAsRead(notifId);
}

export async function markCoreNotificationSeen(notifId) {
  return markAsSeen(notifId);
}

export async function initCoreNotifications(uid) {
  return initAutoNotifications(uid);
}

export function cleanupCoreNotifications() {
  return cleanupAutoNotifications();
}

export function startCorePresence(uid, intervalMs = 2 * 60 * 1000) {
  if (!uid) return () => {};
  updatePresence(uid).catch(() => {});
  const timer = setInterval(() => {
    updatePresence(uid).catch(() => {});
  }, intervalMs);
  return () => clearInterval(timer);
}
