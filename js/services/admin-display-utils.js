export function resolveAdminActorLabel(actorEmail = "", actorUid = "", users = []) {
  if (actorEmail) return actorEmail;
  const uid = String(actorUid || "").trim();
  if (!uid) return "admin";
  const known = (users || []).find((u) => u.id === uid);
  if (known) return known.nombreUsuario || known.nombre || known.email || "admin";
  return uid.length > 18 ? "admin" : uid;
}

export function resolveAdminEntityLabel(entityType = "", entityId = "", data = {}) {
  const type = String(entityType || "").toLowerCase();
  const id = String(entityId || "").trim();
  if (!id) return "global";

  if (type === "usuarios") {
    const known = (data.users || []).find((u) => u.id === id);
    if (known) return known.nombreUsuario || known.nombre || known.email || "Jugador";
  }

  if (type === "invitados") {
    const guest = (data.guestProfiles || []).find((g) => g.id === id);
    if (guest) return guest.nombreUsuario || guest.nombre || "Invitado";
  }

  if (type.includes("partido")) {
    const match = (data.matchesArr || []).find((m) => m.id === id);
    if (match && typeof data.getMatchLabel === "function") return data.getMatchLabel(match);
    return `Partido ${id.slice(0, 6)}`;
  }

  if (type === "eventos") {
    const event = (data.eventsArr || []).find((ev) => ev.id === id);
    if (event) return event.nombre || event.titulo || "Evento";
    return `Evento ${id.slice(0, 6)}`;
  }

  return id.length > 18 ? `${type || "item"} ${id.slice(0, 6)}` : id;
}

