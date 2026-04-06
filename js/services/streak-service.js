import { db, getDocsSafe, updateDocument } from "../firebase-service.js";
import { collection, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { computeCurrentStreakFromLogs } from "./streak-utils.js";

function toTs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchRankingLogsForUser(uid, maxLogs = 60) {
  if (!uid) return [];
  try {
    const orderedSnap = await getDocsSafe(
      query(collection(db, "rankingLogs"), where("uid", "==", uid), orderBy("timestamp", "desc"), limit(maxLogs)),
      `rankingLogs:${uid}`,
    );
    if (!orderedSnap?._errorCode) {
      return (orderedSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch {}

  const fallbackSnap = await getDocsSafe(
    query(collection(db, "rankingLogs"), where("uid", "==", uid), limit(maxLogs)),
    `rankingLogs-fallback:${uid}`,
  );
  return (fallbackSnap?.docs || [])
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => toTs(b?.timestamp) - toTs(a?.timestamp));
}

export async function fetchComputedStreak(uid, maxLogs = 60) {
  const logs = await fetchRankingLogsForUser(uid, maxLogs);
  return computeCurrentStreakFromLogs(logs);
}

export async function syncComputedStreakForUser(uid, userDoc = null, options = {}) {
  if (!uid) return Number(userDoc?.computedStreak ?? userDoc?.rachaActual ?? 0);
  const streak = await fetchComputedStreak(uid, options.maxLogs || 60);
  const previous = Number(
    Number.isFinite(Number(userDoc?.computedStreak))
      ? userDoc?.computedStreak
      : userDoc?.rachaActual,
  );

  if (!options.skipPersist && (!Number.isFinite(previous) || previous !== streak)) {
    try {
      await updateDocument("usuarios", uid, {
        computedStreak: streak,
        computedStreakUpdatedAt: new Date(),
      });
    } catch {}
  }

  return streak;
}

export async function enrichUsersWithComputedStreak(users = [], maxUsers = 24) {
  const subset = (users || []).slice(0, maxUsers);
  await Promise.allSettled(
    subset.map(async (user) => {
      const streak = await fetchComputedStreak(user?.id, 40);
      user.computedStreak = streak;
      return streak;
    }),
  );
  return users;
}
