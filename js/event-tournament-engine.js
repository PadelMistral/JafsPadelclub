// event-tournament-engine.js - Refactored for better name resolution and robustness
export function hashSeed(input = "") {
  let h = 2166136261;
  const str = String(input || "seed");
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRandomFactory(seedNum) {
  let x = seedNum || 123456789;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

export function shuffleSeeded(arr = [], seed = "") {
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

export function teamNameFromPlayers(players = []) {
  if (!players || !players.length) return "TBD";
  if (players.length === 1) return getUserDisplayName(players[0]);
  const n1 = getUserDisplayName(players[0]);
  const n2 = getUserDisplayName(players[1]);
  // Shorten names if they are too long for the card
  const short = (n) => n.split(" ")[0];
  return `${short(n1)} / ${short(n2)}`;
}

function avgLevel(players = []) {
  if (!players.length) return 2.5;
  const vals = players.map((p) => Number(p.nivel || 2.5)).filter((n) => Number.isFinite(n));
  if (!vals.length) return 2.5;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function pairPlayers(entries = [], seed = "") {
  const normalized = (entries || []).map((e, idx) => ({
    uid: e.uid,
    nombre: e.nombre || "Jugador",
    nivel: Number(e.nivel || 2.5),
    side: normSide(e.sidePreference),
    pairCode: String(e.pairCode || ""),
    _idx: idx,
  }));
  
  const shuffled = shuffleSeeded(normalized, `${seed}_pair`);
  const pairs = [];
  const used = new Set();
  const locked = new Map();

  // 1. Locked pairs by pairCode
  shuffled.forEach((p) => {
    const key = String(p.pairCode || "").trim();
    if (!key) return;
    const arr = locked.get(key) || [];
    arr.push(p);
    locked.set(key, arr);
  });

  locked.forEach((arr) => {
    while (arr.length >= 2) {
      const a = arr.shift();
      const b = arr.shift();
      pairs.push([a, b]);
      used.add(a.uid);
      used.add(b.uid);
    }
  });

  // 2. Pair by sides
  const right = shuffled.filter(p => p.side === 'derecha' && !used.has(p.uid));
  const left = shuffled.filter(p => p.side === 'reves' && !used.has(p.uid));
  const flex = shuffled.filter(p => p.side === 'flex' && !used.has(p.uid));

  const pick = (arr) => arr.shift();

  while (right.length && left.length) pairs.push([pick(right), pick(left)]);
  while (right.length && flex.length) pairs.push([pick(right), pick(flex)]);
  while (left.length && flex.length) pairs.push([pick(left), pick(flex)]);
  while (flex.length >= 2) pairs.push([pick(flex), pick(flex)]);
  
  // Clean up extras
  const leftovers = [...right, ...left, ...flex];
  while (leftovers.length >= 2) pairs.push([pick(leftovers), pick(leftovers)]);

  const finalUnmatched = leftovers;

  const teams = pairs.map((p, i) => ({
    id: `T${i + 1}`,
    name: teamNameFromPlayers(p),
    players: p,
    playerUids: p.map(x => x.uid),
    avgLevel: Number(avgLevel(p).toFixed(2))
  }));

  return { teams, unmatched: finalUnmatched };
}

export function buildEventTeams({ modalidad = "parejas", inscritos = [], seed = "" }) {
  const players = (inscritos || []).filter(x => x && x.uid);
  if (modalidad === 'individual') {
    return {
      teams: players.map((p, i) => ({
        id: `T${i+1}`,
        name: getUserDisplayName(p),
        players: [p],
        playerUids: [p.uid],
        avgLevel: Number(p.nivel || 2.5)
      })),
      unmatched: []
    };
  }
  return pairPlayers(players, seed);
}

export function allocateGroups(teams = [], groupCount = 2, seed = "") {
  const count = Math.max(1, groupCount);
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").slice(0, count);
  const groups = {};
  letters.forEach(l => groups[l] = []);

  const shuffled = shuffleSeeded(teams, `${seed}_groups`);
  const steps = [];

  shuffled.forEach((team, idx) => {
    const g = letters[idx % letters.length];
    groups[g].push(team.id);
    steps.push({ type: 'draw', teamId: team.id, teamName: team.name, group: g, order: idx + 1 });
  });

  return { groups, steps };
}

export function generateRoundRobin(teamIds = []) {
  const matches = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      matches.push({ teamAId: teamIds[i], teamBId: teamIds[j] });
    }
  }
  return matches;
}

export function generateKnockoutTree(teams = [], seed = "") {
  const shuffled = shuffleSeeded(teams, `${seed}_ko`);
  const size = Math.pow(2, Math.ceil(Math.log2(Math.max(2, shuffled.length))));
  const padded = [...shuffled];
  while (padded.length < size) padded.push(null);

  const rounds = [];
  let mCount = size / 2;
  let rIndex = 1;

  while (mCount >= 1) {
    const roundMatches = [];
    for (let i = 0; i < mCount; i++) {
        roundMatches.push({
            matchCode: `K_R${rIndex}_M${i+1}`,
            round: rIndex,
            phase: 'knockout',
            slot: i + 1,
            teamAId: rIndex === 1 ? (padded[i*2]?.id || null) : null,
            teamBId: rIndex === 1 ? (padded[i*2+1]?.id || null) : null,
            teamAName: rIndex === 1 ? (padded[i*2]?.name || null) : null,
            teamBName: rIndex === 1 ? (padded[i*2+1]?.name || null) : null,
            sourceA: rIndex > 1 ? `K_R${rIndex-1}_M${i*2+1}` : null,
            sourceB: rIndex > 1 ? `K_R${rIndex-1}_M${i*2+2}` : null
        });
    }
    rounds.push(roundMatches);
    mCount /= 2;
    rIndex++;
  }
  return rounds;
}

export function computeGroupTable(matches = [], teams = [], cfg = {}) {
  const win = cfg.win ?? 3;
  const draw = cfg.draw ?? 1;
  const loss = cfg.loss ?? 0;

  const table = new Map(teams.map(t => [t.id, { teamId: t.id, teamName: t.name, pj:0, g:0, e:0, p:0, pts:0, pf:0, pc:0, dif:0 }]));

  matches.filter(m => m.estado === 'jugado').forEach(m => {
    const a = table.get(m.teamAId);
    const b = table.get(m.teamBId);
    if (!a || !b) return;

    a.pj++; b.pj++;

    const rawResult = typeof m.resultado === 'string' ? m.resultado : (m.resultado?.sets || '');
    const pairs = String(rawResult || '').match(/\d+\s*-\s*\d+/g) || [];
    let gamesA = 0;
    let gamesB = 0;
    let setsA = 0;
    let setsB = 0;
    pairs.forEach((s) => {
      const parts = s.split('-').map(Number);
      if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return;
      gamesA += parts[0];
      gamesB += parts[1];
      if (parts[0] > parts[1]) setsA += 1;
      if (parts[1] > parts[0]) setsB += 1;
    });
    let winnerTeamId = m.ganadorTeamId;
    if (!winnerTeamId && setsA !== setsB) {
      winnerTeamId = setsA > setsB ? m.teamAId : m.teamBId;
    }

    if (winnerTeamId === m.teamAId) {
        a.g++; b.p++; a.pts += win; b.pts += loss;
    } else if (winnerTeamId === m.teamBId) {
        b.g++; a.p++; b.pts += win; a.pts += loss;
    } else {
        a.e++; b.e++; a.pts += draw; b.pts += draw;
    }
    a.pf += gamesA;
    a.pc += gamesB;
    b.pf += gamesB;
    b.pc += gamesA;
    a.dif = a.pf - a.pc;
    b.dif = b.pf - b.pc;
  });

  return [...table.values()].sort((x, y) => (y.pts - x.pts) || (y.g - x.g) || (x.p - y.p));
}
