// event-tournament-engine.js

function hashSeed(input = "") {
  let h = 2166136261;
  const str = String(input || "seed");
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandomFactory(seedNum) {
  let x = seedNum || 123456789;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function shuffleSeeded(arr = [], seed = "") {
  const out = [...arr];
  const rnd = seededRandomFactory(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function normSide(v) {
  const s = String(v || "").toLowerCase();
  if (s.includes("der")) return "derecha";
  if (s.includes("rev")) return "reves";
  return "flex";
}

function getUserDisplayName(p = {}) {
  return p.nombre || p.nombreUsuario || p.displayName || "Jugador";
}

function teamNameFromPlayers(players = []) {
  if (!players.length) return "TBD";
  if (players.length === 1) return getUserDisplayName(players[0]);
  return `${getUserDisplayName(players[0])} / ${getUserDisplayName(players[1])}`;
}

function avgLevel(players = []) {
  if (!players.length) return 2.5;
  const vals = players.map((p) => Number(p.nivel || 2.5)).filter((n) => Number.isFinite(n));
  if (!vals.length) return 2.5;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function pairPlayers(entries = [], seed = "") {
  const normalized = entries.map((e, idx) => ({
    uid: e.uid,
    nombre: e.nombre || "Jugador",
    nivel: Number(e.nivel || 2.5),
    side: normSide(e.sidePreference),
    pairCode: String(e.pairCode || ""),
    _idx: idx,
  }));
  const shuffled = shuffleSeeded(normalized, `${seed}_pair`);
  const pairs = [];
  const unmatched = [];
  const locked = new Map();

  // First, build locked/manual pairs by pairCode when provided
  shuffled.forEach((p) => {
    const key = String(p.pairCode || "").trim().toLowerCase();
    if (!key) return;
    const arr = locked.get(key) || [];
    arr.push(p);
    locked.set(key, arr);
  });

  const used = new Set();
  locked.forEach((arr) => {
    while (arr.length >= 2) {
      const a = arr.shift();
      const b = arr.shift();
      if (!a || !b) break;
      used.add(a.uid);
      used.add(b.uid);
      pairs.push([a, b]);
    }
  });
  const right = shuffled.filter((p) => p.side === "derecha" && !used.has(p.uid));
  const left = shuffled.filter((p) => p.side === "reves" && !used.has(p.uid));
  const flex = shuffled.filter((p) => p.side === "flex" && !used.has(p.uid));

  const pick = (arr) => (arr.length ? arr.shift() : null);
  const addPair = (a, b) => {
    if (!a || !b) return;
    pairs.push([a, b]);
  };

  while (right.length && left.length) addPair(pick(right), pick(left));
  while (right.length && flex.length) addPair(pick(right), pick(flex));
  while (left.length && flex.length) addPair(pick(left), pick(flex));
  while (flex.length >= 2) addPair(pick(flex), pick(flex));
  while (right.length >= 2) addPair(pick(right), pick(right));
  while (left.length >= 2) addPair(pick(left), pick(left));

  unmatched.push(...right, ...left, ...flex);

  const teams = pairs.map((p, i) => ({
    id: `T${i + 1}`,
    name: teamNameFromPlayers(p),
    players: p,
    playerUids: p.map((x) => x.uid),
    avgLevel: Number(avgLevel(p).toFixed(2)),
  }));

  return { teams, unmatched };
}

export function buildEventTeams({ modalidad = "parejas", inscritos = [], seed = "" }) {
  const players = (inscritos || []).filter((x) => x?.uid);
  if (String(modalidad || "parejas") === "individual") {
    return { teams: buildIndividualTeams(players), unmatched: [] };
  }
  return pairPlayers(players, seed || "teams");
}

function buildIndividualTeams(entries = []) {
  return entries.map((e, i) => ({
    id: `T${i + 1}`,
    name: e.nombre || "Jugador",
    players: [{ uid: e.uid, nombre: e.nombre || "Jugador", nivel: Number(e.nivel || 2.5), side: normSide(e.sidePreference) }],
    playerUids: [e.uid],
    avgLevel: Number(Number(e.nivel || 2.5).toFixed(2)),
  }));
}

export function allocateGroups(teams = [], groupCount = 2, seed = "") {
  const safeCount = Math.max(1, Number(groupCount || 1));
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").slice(0, safeCount);
  const groups = {};
  letters.forEach((l) => { groups[l] = []; });

  const shuffled = shuffleSeeded(teams, `${seed}_groups`);
  const steps = [];

  shuffled.forEach((team, idx) => {
    const g = letters[idx % letters.length];
    groups[g].push(team.id);
    steps.push({ type: "draw", teamId: team.id, teamName: team.name, group: g, order: idx + 1 });
  });

  return { groups, steps };
}

export function generateRoundRobin(groupTeamIds = []) {
  const ids = [...groupTeamIds];
  if (ids.length < 2) return [];
  const rounds = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      rounds.push({ teamAId: ids[i], teamBId: ids[j] });
    }
  }
  return rounds;
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function generateKnockoutTree(teams = [], seed = "") {
  const shuffled = shuffleSeeded(teams, `${seed}_ko`);
  const bracketSize = nextPow2(Math.max(2, shuffled.length));
  const padded = [...shuffled];
  while (padded.length < bracketSize) padded.push(null);

  const rounds = [];
  let matchCount = bracketSize / 2;
  let r = 1;
  while (matchCount >= 1) {
    const row = [];
    for (let i = 0; i < matchCount; i += 1) {
      const code = `K_R${r}_M${i + 1}`;
      row.push({
        matchCode: code,
        round: r,
        phase: "knockout",
        slot: i + 1,
        sourceA: r === 1 ? null : `K_R${r - 1}_M${i * 2 + 1}`,
        sourceB: r === 1 ? null : `K_R${r - 1}_M${i * 2 + 2}`,
        teamAId: null,
        teamBId: null,
      });
    }
    rounds.push(row);
    matchCount = matchCount / 2;
    r += 1;
  }

  // Seed first round
  const first = rounds[0] || [];
  first.forEach((m, i) => {
    const a = padded[i * 2] || null;
    const b = padded[i * 2 + 1] || null;
    m.teamAId = a?.id || null;
    m.teamBId = b?.id || null;
  });

  return rounds;
}

function createBracketSkeleton(groups = {}) {
  const A = groups.A || [];
  const B = groups.B || [];
  return {
    rounds: [
      [
        { id: "SF1", phase: "semi", teamARef: { group: "A", pos: 1 }, teamBRef: { group: "B", pos: 2 }, winnerTo: "F1" },
        { id: "SF2", phase: "semi", teamARef: { group: "B", pos: 1 }, teamBRef: { group: "A", pos: 2 }, winnerTo: "F1" },
      ],
      [
        { id: "F1", phase: "final", teamARef: { from: "SF1" }, teamBRef: { from: "SF2" }, winnerTo: null },
      ],
    ],
    qualifiersPerGroup: 2,
    groupsUsed: Object.keys(groups),
    hints: {
      A1: A[0] || null,
      A2: A[1] || null,
      B1: B[0] || null,
      B2: B[1] || null,
    },
  };
}

function ensureMinimumTeams(teams = []) {
  if (teams.length < 4) {
    throw new Error("Se necesitan al menos 4 equipos para generar grupos y eliminatorias.");
  }
}

export function runTournamentDraw({ eventId, modalidad, inscritos = [], groupCount = 2, seed = "" }) {
  const safeSeed = `${eventId || "evento"}_${seed || Date.now()}`;
  const built = buildEventTeams({ modalidad, inscritos, seed: safeSeed });
  const teams = built.teams;
  const unmatched = built.unmatched;

  ensureMinimumTeams(teams);
  const { groups, steps } = allocateGroups(teams, groupCount, safeSeed);
  const bracket = createBracketSkeleton(groups);

  const groupMatches = [];
  Object.entries(groups).forEach(([group, teamIds]) => {
    const rr = generateRoundRobin(teamIds);
    rr.forEach((m, idx) => {
      groupMatches.push({
        id: `${group}_${idx + 1}`,
        phase: "group",
        group,
        round: idx + 1,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
      });
    });
  });

  return {
    seed: safeSeed,
    teams,
    unmatched,
    groups,
    drawSteps: steps,
    bracket,
    groupMatches,
  };
}

export function resolveTeamById(teams = [], id) {
  return teams.find((t) => t.id === id) || null;
}

export function computeGroupTable(matches = [], teams = [], pointsCfg = {}) {
  const pointsWin = Number(pointsCfg.win ?? 3);
  const pointsDraw = Number(pointsCfg.draw ?? 1);
  const pointsLoss = Number(pointsCfg.loss ?? 0);

  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const table = new Map();
  teams.forEach((t) => {
    table.set(t.id, {
      teamId: t.id,
      teamName: t.name,
      pj: 0,
      g: 0,
      e: 0,
      p: 0,
      pts: 0,
    });
  });

  matches
    .filter((m) => (m.phase === "group" || m.phase === "league") && m.estado === "jugado")
    .forEach((m) => {
      const a = table.get(m.teamAId);
      const b = table.get(m.teamBId);
      if (!a || !b) return;

      a.pj += 1;
      b.pj += 1;

      if (m.ganadorTeamId === m.teamAId) {
        a.g += 1;
        b.p += 1;
        a.pts += pointsWin;
        b.pts += pointsLoss;
      } else if (m.ganadorTeamId === m.teamBId) {
        b.g += 1;
        a.p += 1;
        b.pts += pointsWin;
        a.pts += pointsLoss;
      } else {
        a.e += 1;
        b.e += 1;
        a.pts += pointsDraw;
        b.pts += pointsDraw;
      }
    });

  return [...table.values()]
    .filter((r) => teamMap.has(r.teamId))
    .sort((x, y) => (y.pts - x.pts) || (y.g - x.g) || (x.p - y.p) || x.teamName.localeCompare(y.teamName));
}
