function asText(v) {
  return String(v || "").toLowerCase();
}

const PATTERN_DEFS = [
  {
    id: "net_volley",
    label: "volea en red",
    keywords: ["volea", "red", "bloqueo", "mano firme"],
    tacticalHint: "prioriza altura segura al fondo antes de cerrar en red",
  },
  {
    id: "lob_defense",
    label: "defensa con globo",
    keywords: ["globo", "salida de pared", "defensa", "fondo"],
    tacticalHint: "sube la trayectoria del globo y busca la esquina de reves rival",
  },
  {
    id: "unforced_errors",
    label: "errores no forzados",
    keywords: ["error", "precipit", "fallo", "regalo", "apresur"],
    tacticalHint: "juega una bola extra por punto antes de acelerar",
  },
  {
    id: "service_return",
    label: "resto de saque",
    keywords: ["resto", "saque", "devolucion", "servicio"],
    tacticalHint: "ajusta posicion inicial medio paso atras para leer mejor el saque",
  },
];

function collectDiaryCorpus(context) {
  return (context?.diary || []).map((e) => asText(e.text)).join(" | ");
}

function detectRepeatedPattern(context) {
  const corpus = collectDiaryCorpus(context);
  if (!corpus) return null;

  let best = null;
  for (const def of PATTERN_DEFS) {
    let hits = 0;
    for (const k of def.keywords) {
      const re = new RegExp(k, "g");
      hits += (corpus.match(re) || []).length;
    }
    if (!best || hits > best.hits) {
      best = { def, hits };
    }
  }

  if (!best || best.hits < 2) return null;
  const confidence = Math.min(0.95, 0.45 + best.hits * 0.08);
  return {
    id: best.def.id,
    summary: `Patron repetido detectado en ${best.def.label} (${best.hits} menciones recientes).`,
    tacticalHint: best.def.tacticalHint,
    confidence: Number(confidence.toFixed(2)),
  };
}

function getRivalAlert(context) {
  const headToHead = context?.rivals?.headToHead || [];
  if (!headToHead.length) return null;

  const critical = [...headToHead]
    .filter((h) => Number(h.games || 0) >= 2)
    .sort((a, b) => (Number(b.losses || 0) - Number(a.losses || 0)))[0];

  if (!critical) return null;
  const lossRate = critical.games ? critical.losses / critical.games : 0;
  if (lossRate < 0.55) return null;

  return {
    rivalUid: critical.rivalUid,
    summary: `Rival recurrente con balance exigente (${critical.losses}-${critical.wins} en contra).`,
    tacticalHint: "abre pista con globo profundo y evita acelerar la primera volea",
    confidence: Number(Math.min(0.9, 0.5 + lossRate / 2).toFixed(2)),
  };
}

function getRecentFormLine(context) {
  const wins = Number(context?.stats?.recentWins || 0);
  const losses = Number(context?.stats?.recentLosses || 0);
  const total = Number(context?.stats?.recentWindow || 0);
  if (!total) return "Sin muestra reciente suficiente";
  return `Forma reciente ${wins}-${losses} en ultimos ${total} partidos`;
}

function buildPreMatchAdvice(context, pattern, rivalAlert) {
  const form = getRecentFormLine(context);
  const base = [`${form}.`];

  if (pattern) {
    base.push(`Ajuste clave: ${pattern.tacticalHint}.`);
  }

  if (rivalAlert) {
    base.push(`Alerta rival: ${rivalAlert.summary} Recomendacion: ${rivalAlert.tacticalHint}.`);
  }

  if (!pattern && !rivalAlert) {
    base.push("Plan base: primer bloque de juego a margen alto y transiciones ordenadas a red.");
  }

  return base.join(" ");
}

function buildPostMatchAdvice(context, pattern) {
  const last = (context?.recentMatches || [])[0];
  if (!last?.outcome) {
    return "No hay resultado reciente suficiente para generar feedback post-partido fiable.";
  }

  const outcome = last.outcome.win ? "victoria" : "derrota";
  const msg = [`Ultimo partido registrado: ${outcome} (${last.outcome.wonSets}-${last.outcome.lostSets} en sets).`];

  if (pattern) {
    msg.push(`Patron a corregir: ${pattern.summary} Siguiente foco: ${pattern.tacticalHint}.`);
  } else {
    msg.push("Siguiente foco: mantener consistencia en los primeros 4 juegos del proximo partido.");
  }
  return msg.join(" ");
}

function buildTodaySuggestion(context, preAdvice) {
  const target = context?.target;
  if (!target?.date) {
    return `Sugerencia de hoy: ${preAdvice}`;
  }
  const d = new Date(target.date);
  const when = Number.isNaN(d.getTime())
    ? "proximo partido"
    : d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return `Sugerencia de hoy para ${when}: ${preAdvice}`;
}

export function buildCoachInsights(context) {
  const repeatedPattern = detectRepeatedPattern(context);
  const rivalAlert = getRivalAlert(context);
  const preMatchAdvice = buildPreMatchAdvice(context, repeatedPattern, rivalAlert);
  const postMatchAdvice = buildPostMatchAdvice(context, repeatedPattern);
  const todaySuggestion = buildTodaySuggestion(context, preMatchAdvice);

  return {
    preMatchAdvice,
    postMatchAdvice,
    repeatedPattern,
    rivalAlert,
    todaySuggestion,
  };
}
