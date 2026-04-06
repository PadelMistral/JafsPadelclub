import { getMatchPlayers, toDateSafe, isFinishedMatch } from "../utils/match-utils.js";

function avg(values = [], fallback = 2.5) {
  const valid = values.map(Number).filter((n) => Number.isFinite(n));
  if (!valid.length) return fallback;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSide(value = "") {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("der")) return "derecha";
  if (raw.includes("rev")) return "reves";
  return "flex";
}

function getTeamSideFromPlayers(players = [], uid) {
  const index = (players || []).indexOf(uid);
  if (index === -1) return null;
  return index <= 1 ? "A" : "B";
}

function buildInteractionStats(userUid, occupiedUids = [], historyMatches = []) {
  const base = new Map();
  occupiedUids.forEach((uid) => {
    if (uid) base.set(uid, { partnered: 0, rivaled: 0, total: 0 });
  });
  if (!userUid || !base.size) return base;

  historyMatches
    .filter((m) => isFinishedMatch(m))
    .filter((m) => getMatchPlayers(m).includes(userUid))
    .slice(-16)
    .forEach((match) => {
      const players = getMatchPlayers(match).filter(Boolean);
      const mySide = getTeamSideFromPlayers(players, userUid);
      if (!mySide) return;

      base.forEach((stats, rivalUid) => {
        if (!players.includes(rivalUid)) return;
        const side = getTeamSideFromPlayers(players, rivalUid);
        if (!side) return;
        stats.total += 1;
        if (side === mySide) stats.partnered += 1;
        else stats.rivaled += 1;
      });
    });

  return base;
}

export function scoreMatchForUser(match, user, playerMetaResolver = null, context = {}) {
  if (!match || !user) {
    return { total: 0, reasons: [], headline: "sin datos", tone: "neutral" };
  }

  const userLevel = Number(user.nivel || 2.5);
  const userSide = normalizeSide(user.posicionPreferida || user.sidePreference || user.posicion || "");
  const players = getMatchPlayers(match).filter(Boolean);
  const occupiedUids = players.filter((uid) => uid !== user.uid);
  const rivals = occupiedUids
    .map((uid) => (typeof playerMetaResolver === "function" ? playerMetaResolver(uid) : null))
    .filter(Boolean);

  const rivalAvg = avg(rivals.map((r) => r?.nivel), userLevel);
  const diff = Math.abs(userLevel - rivalAvg);
  const freeSlots = Math.max(0, 4 - players.length);
  const date = toDateSafe(match.fecha);
  const hoursUntil = date ? Math.max(0, (date.getTime() - Date.now()) / 3600000) : 999;
  const interactionStats = buildInteractionStats(user.uid, occupiedUids, context?.historyMatches || []);
  const interactionTotals = [...interactionStats.values()];
  const repeatedTotal = interactionTotals.reduce((sum, row) => sum + row.total, 0);
  const repeatPartners = interactionTotals.reduce((sum, row) => sum + row.partnered, 0);
  const repeatRivals = interactionTotals.reduce((sum, row) => sum + row.rivaled, 0);

  let total = 0;
  const reasons = [];
  let headline = "encaje moderado";
  let tone = "soft";

  const levelScore = Math.max(0, 40 - Math.round(diff * 18));
  total += levelScore;
  if (diff <= 0.35) reasons.push("nivel muy compatible");
  else if (diff <= 0.65) reasons.push("partido equilibrado");

  const sideNeed = (() => {
    if (userSide === "flex") return 10;
    const sameSideCount = rivals.filter((r) => normalizeSide(r?.posicionPreferida || r?.sidePreference || "") === userSide).length;
    const oppositeSideCount = rivals.filter((r) => {
      const side = normalizeSide(r?.posicionPreferida || r?.sidePreference || "");
      return userSide === "derecha" ? side === "reves" : side === "derecha";
    }).length;
    if (oppositeSideCount > sameSideCount) return 18;
    if (oppositeSideCount === sameSideCount) return 11;
    return 5;
  })();
  total += sideNeed;
  if (sideNeed >= 14) reasons.push("encaje bueno por lado");

  const freshnessScore = (() => {
    if (!occupiedUids.length) return 10;
    if (repeatedTotal === 0) return 14;
    if (repeatedTotal <= 2) return 8;
    if (repeatedTotal >= 6) return -8;
    return 1;
  })();
  total += freshnessScore;
  if (freshnessScore >= 12) reasons.push("caras nuevas para variar");
  else if (freshnessScore >= 6) reasons.push("rotación saludable");
  else if (freshnessScore < 0) reasons.push("grupo muy repetido");

  const availabilityScore = hoursUntil <= 36 ? 20 : hoursUntil <= 72 ? 12 : 4;
  total += availabilityScore;
  if (hoursUntil <= 10) reasons.push("sale pronto");
  else if (availabilityScore >= 12) reasons.push("fecha cercana");

  const slotScore = freeSlots === 1 ? 18 : freeSlots === 2 ? 12 : freeSlots === 3 ? 6 : 0;
  total += slotScore;
  if (freeSlots === 1) reasons.push("solo falta 1 jugador");
  else if (slotScore >= 12) reasons.push("fácil de cerrar");

  const publicBonus = !match.visibility || match.visibility === "public" || match.visibilidad === "public" ? 8 : 0;
  total += publicBonus;
  if (publicBonus) reasons.push("acceso abierto");

  const challengeBonus = String(match.col || "").includes("Reto") ? 6 : 2;
  total += challengeBonus;
  if (challengeBonus >= 6 && repeatRivals > 0) reasons.push("rivalidad ya conocida");
  else if (challengeBonus >= 6) reasons.push("reto competitivo");

  if (repeatPartners >= 3) total -= 4;

  total = clamp(Math.round(total), 0, 99);
  if (total >= 80) {
    headline = "muy buena opción";
    tone = "strong";
  } else if (total >= 64) {
    headline = "buen encaje";
    tone = "good";
  } else if (total >= 46) {
    headline = "encaje moderado";
    tone = "soft";
  } else {
    headline = "solo si te encaja";
    tone = "neutral";
  }

  return {
    total,
    headline,
    tone,
    reasons: reasons.slice(0, 3),
    levelGap: Number(diff.toFixed(2)),
    rivalAverageLevel: Number(rivalAvg.toFixed(2)),
    freeSlots,
    hoursUntil: Number(hoursUntil.toFixed(1)),
    repeatedTotal,
    repeatPartners,
    repeatRivals,
  };
}
