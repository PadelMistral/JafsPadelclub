import { db, observerAuth, getDocument } from './firebase-service.js';
import { initAppUI, showToast, showSidePreferenceModal } from './ui-core.js';
import { doc, onSnapshot, collection, query, where, addDoc, updateDoc, deleteDoc, serverTimestamp, getDocs } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { injectHeader, injectNavbar } from './modules/ui-loader.js';
import { runTournamentDraw, resolveTeamById, computeGroupTable, buildEventTeams, generateRoundRobin, generateKnockoutTree } from './event-tournament-engine.js';
import { processMatchResults } from './ranking-service.js';

initAppUI('event-detail');
const eventId = new URLSearchParams(window.location.search).get('id');
const requestedTab = new URLSearchParams(window.location.search).get('tab');
let currentUser = null;
let currentUserData = null;
let currentEvent = null;
let eventMatches = [];
let unsubMatches = null;

if (!eventId) window.location.replace('eventos.html');

document.addEventListener('DOMContentLoaded', () => {
  observerAuth(async (u) => {
    if (!u) return window.location.replace('index.html');
    currentUser = u;
    currentUserData = await getDocument('usuarios', u.uid);
    await injectHeader(currentUserData || {});
    injectNavbar('events');
    bindTabs();
    subEvent();
    subMatches();
    const p = new URLSearchParams(window.location.search);
    if (p.get('admin') === '1') setTimeout(() => document.querySelector('.ed-tab[data-tab="admin"]')?.click(), 200);
    else if (requestedTab) setTimeout(() => document.querySelector(`.ed-tab[data-tab="${requestedTab}"]`)?.click(), 200);
  });
});

function canAdmin() { return currentUserData?.rol === 'Admin' || currentEvent?.organizadorId === currentUser?.uid; }
function isInscribed() { return (currentEvent?.inscritos || []).some((i) => i.uid === currentUser?.uid); }

function subEvent() {
  onSnapshot(doc(db, 'eventos', eventId), (s) => {
    if (!s.exists()) return window.location.replace('eventos.html');
    currentEvent = { id: s.id, ...s.data() };
    renderPage();
  });
}

function subMatches() {
  if (unsubMatches) { try { unsubMatches(); } catch (_) {} }
  unsubMatches = onSnapshot(query(collection(db, 'eventoPartidos'), where('eventoId', '==', eventId)), (s) => {
    eventMatches = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPane(document.querySelector('.ed-tab.active')?.dataset.tab || 'info');
  });
}

function bindTabs() {
  document.querySelectorAll('.ed-tab').forEach((b) => {
    b.onclick = () => {
      const tab = b.dataset.tab;
      if (tab === 'admin' && !canAdmin()) return;
      document.querySelectorAll('.ed-tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.ed-pane').forEach((x) => x.classList.add('hidden'));
      b.classList.add('active');
      document.getElementById(`pane-${tab}`)?.classList.remove('hidden');
      renderPane(tab);
    };
  });
}

function renderPage() {
  const ev = currentEvent || {};
  const fmt = { league: 'Liga', knockout: 'Eliminatoria', league_knockout: 'Liga + Eliminatoria' };
  document.getElementById('ed-hero-content').innerHTML = `<div class="ed-badge ${ev.formato === 'knockout' ? 'knockout' : 'league'}"><i class="fas fa-trophy"></i> ${fmt[ev.formato] || 'Evento'}</div><h1 class="ed-title">${ev.nombre || 'Evento'}</h1><div class="ed-organizer">Organiza: ${ev.organizadorNombre || 'Club'}</div>`;
  const inscritos = (ev.inscritos || []).length;
  const teams = (ev.teams || []).length;
  document.getElementById('ed-stats-strip').innerHTML = `<div class="ed-stat-box"><span class="ed-stat-val">${inscritos}/${Number(ev.plazasMax || 16)}</span><span class="ed-stat-lbl">Inscritos</span></div><div class="ed-stat-box"><span class="ed-stat-val">${teams}</span><span class="ed-stat-lbl">Equipos</span></div><div class="ed-stat-box"><span class="ed-stat-val">${String(ev.estado || 'draft').toUpperCase()}</span><span class="ed-stat-lbl">Estado</span></div>`;
  document.getElementById('btn-ed-admin')?.classList.toggle('hidden', !canAdmin());
  renderActionBar();
  renderPane(document.querySelector('.ed-tab.active')?.dataset.tab || 'info');
}

function renderPane(tab) {
  const pane = document.getElementById(`pane-${tab}`);
  if (!pane || !currentEvent) return;
  if (tab === 'info') return renderInfo(pane);
  if (tab === 'clasificacion') return renderStanding(pane);
  if (tab === 'bracket') return renderBracket(pane);
  if (tab === 'partidos') return renderMatches(pane);
  if (tab === 'admin') return renderAdmin(pane);
}

function renderInfo(p) {
  const ev = currentEvent;
  p.innerHTML = `<div class="ed-info-card"><h3 class="ed-info-title"><i class="fas fa-circle-info"></i> Detalles</h3><p class="ed-info-text">${ev.descripcion || 'Sin descripción.'}</p><div class="ed-info-grid"><div class="ed-info-item"><i class="fas fa-calendar"></i><div class="ed-info-col"><span class="ed-info-label">Inicio</span><span class="ed-info-val">${fmtDate(ev.fechaInicio)}</span></div></div><div class="ed-info-item"><i class="fas fa-hourglass-half"></i><div class="ed-info-col"><span class="ed-info-label">Cierre</span><span class="ed-info-val">${fmtDate(ev.fechaInscripcion)}</span></div></div><div class="ed-info-item"><i class="fas fa-user-group"></i><div class="ed-info-col"><span class="ed-info-label">Modalidad</span><span class="ed-info-val">${ev.modalidad || 'parejas'}</span></div></div><div class="ed-info-item"><i class="fas fa-diagram-project"></i><div class="ed-info-col"><span class="ed-info-label">Formato</span><span class="ed-info-val">${ev.formato || 'league_knockout'}</span></div></div></div><div style="margin-top:12px;"><a class="btn-ev-join" style="text-decoration:none;display:inline-flex;padding:10px 12px;" href="evento-sorteo.html?id=${ev.id}">Sorteo y cuadro</a></div></div>`;
}

function tableHtml(title, rows) {
  return `<div class="ed-info-card" style="margin-bottom:12px;"><h3 class="ed-info-title"><i class="fas fa-list-ol"></i> ${title}</h3><table class="ed-standing-table"><thead><tr class="text-[10px] text-muted uppercase font-black tracking-widest"><th class="text-left px-3">#</th><th class="text-left">Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th class="text-right">PTS</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="ed-standing-row"><td class="px-3">${i+1}</td><td class="font-bold">${r.teamName}</td><td class="text-center">${r.pj}</td><td class="text-center">${r.g}</td><td class="text-center">${r.e}</td><td class="text-center">${r.p}</td><td class="text-right font-black text-primary">${r.pts}</td></tr>`).join('') || '<tr><td colspan="7" class="px-3 py-3 opacity-60">Sin partidos jugados.</td></tr>'}</tbody></table></div>`;
}

function renderStanding(p) {
  const ev = currentEvent, teams = ev.teams || [];
  if (!teams.length) return p.innerHTML = `<div class="empty-state">La clasificación aparecerá tras generar equipos.</div>`;
  const cfg = { win: Number(ev.puntosVictoria || 3), draw: Number(ev.puntosEmpate || 1), loss: Number(ev.puntosDerrota || 0) };
  if (ev.formato === 'league') return p.innerHTML = tableHtml('Clasificación Liga', computeGroupTable(eventMatches.filter(m=>m.phase==='league'), teams, cfg));
  if (ev.formato === 'league_knockout') {
    const groups = ev.groups || {};
    p.innerHTML = Object.keys(groups).map((g)=>{ const gTeams=(groups[g]||[]).map(id=>resolveTeamById(teams,id)).filter(Boolean); return tableHtml(`Grupo ${g}`, computeGroupTable(eventMatches.filter(m=>m.phase==='group'&&m.group===g), gTeams, cfg)); }).join('') || `<div class="empty-state">Sin grupos.</div>`;
    return;
  }
  p.innerHTML = `<div class="ed-info-card">${(teams||[]).map(t=>`<div class="ed-match-card"><div class="ed-m-vs"><span>${t.name}</span><div class="vs-label">${isEliminated(t.id)?'ELIMINADO':'ACTIVO'}</div></div></div>`).join('')}</div>`;
}

function isEliminated(teamId){
  return eventMatches.some(m=>m.phase==='knockout'&&m.estado==='jugado'&&m.ganadorTeamId&&(m.teamAId===teamId||m.teamBId===teamId)&&m.ganadorTeamId!==teamId);
}

function renderBracket(p) {
  const ev = currentEvent; const byName = new Map((ev.teams||[]).map(t=>[t.id,t.name]));
  const nm=(id,fb)=>byName.get(id)||fb||'TBD';
  if (ev.formato==='league') return p.innerHTML = `<div class="empty-state">Evento de liga (sin bracket).</div>`;
  if (ev.formato==='league_knockout') {
    const semis=eventMatches.filter(m=>m.phase==='semi').sort((a,b)=>String(a.matchCode||'').localeCompare(String(b.matchCode||'')));
    const final=eventMatches.filter(m=>m.phase==='final');
    return p.innerHTML = `<div class="bracket-wrap"><div class="bracket-round"><div class="bracket-round-label">Semifinales</div>${semis.map(m=>bcard(nm(m.teamAId,m.teamAName),nm(m.teamBId,m.teamBName),m)).join('')}</div><div class="bracket-round"><div class="bracket-round-label">Final</div>${final.map(m=>bcard(nm(m.teamAId,m.teamAName),nm(m.teamBId,m.teamBName),m)).join('')}</div></div>`;
  }
  const rounds=[...new Set(eventMatches.filter(m=>m.phase==='knockout').map(m=>Number(m.round||1)))].sort((a,b)=>a-b);
  p.innerHTML = `<div class="bracket-wrap">${rounds.map(r=>`<div class="bracket-round"><div class="bracket-round-label">Ronda ${r}</div>${eventMatches.filter(m=>m.phase==='knockout'&&Number(m.round||1)===r).sort((a,b)=>Number(a.slot||1)-Number(b.slot||1)).map(m=>bcard(nm(m.teamAId,m.teamAName),nm(m.teamBId,m.teamBName),m)).join('')}</div>`).join('')}</div>`;
}

function bcard(a,b,m){ const wa=m.ganadorTeamId&&m.ganadorTeamId===m.teamAId, wb=m.ganadorTeamId&&m.ganadorTeamId===m.teamBId; return `<div class="bracket-match ${m.ganadorTeamId?'played':''}"><div class="bracket-team ${wa?'winner':(m.ganadorTeamId?'loser':'')}">${a}</div><div class="bracket-vs">VS</div><div class="bracket-team ${wb?'winner':(m.ganadorTeamId?'loser':'')}">${b}</div>${m.resultado?`<div class="bracket-result">${m.resultado}</div>`:''}</div>`; }
function matchPhaseLabel(m){ if(m.phase==='league') return `Liga · J${m.round||1}`; if(m.phase==='group') return `Grupo ${m.group||''} · J${m.round||1}`; if(m.phase==='semi') return 'Semifinal'; if(m.phase==='final') return 'Final'; if(m.phase==='knockout') return `Eliminatoria · R${m.round||1}`; return 'Partido'; }
function canManage(m){ return !!m && !!currentUser && (canAdmin() || (m.playerUids||[]).includes(currentUser.uid)); }
function renderMatches(p){ const list=[...eventMatches].sort((a,b)=>String(a.phase).localeCompare(String(b.phase))||Number(a.round||1)-Number(b.round||1)||Number(a.slot||1)-Number(b.slot||1)); if(!list.length) return p.innerHTML='<div class="empty-state">No hay partidos generados.</div>'; p.innerHTML=`<div class="flex-col gap-3">${list.map(m=>`<div class="ed-match-card ${String(m.estado||'')==='jugado'?'closed':''}"><div class="ed-m-ronda">${matchPhaseLabel(m)}</div><div class="ed-m-vs"><span class="${m.ganadorTeamId===m.teamAId?'winner':''}">${m.teamAName||'TBD'}</span><div class="vs-label">VS</div><span class="${m.ganadorTeamId===m.teamBId?'winner':''}">${m.teamBName||'TBD'}</span></div><div class="ed-m-res">${m.resultado||'--'} · ${m.fecha?fmtDate(m.fecha):'Sin fecha'}</div>${canManage(m)?`<div style="margin-top:10px;display:flex;gap:8px;"><button class="btn btn-sm btn-ghost" onclick="window.programarEventoPartido('${m.id}')">Programar</button><button class="btn btn-sm btn-ghost" onclick="window.cerrarEventoPartido('${m.id}')">Resultado</button></div>`:''}</div>`).join('')}</div>`; }

function renderAdmin(p){ const ev=currentEvent; const canGen=(ev.inscritos||[]).length>=4 && ev.drawState?.status!=='completed'; p.innerHTML=`<div class="ed-admin-grid"><div class="ed-admin-box"><h3>Configuración</h3><div class="form-group mb-3"><label class="form-label-sm">Nombre</label><input id="adm-ev-name" class="input sm" value="${escapeHtml(ev.nombre||'')}" /></div><div class="form-group mb-3"><label class="form-label-sm">Estado</label><select id="adm-ev-state" class="input sm">${['draft','inscripcion','activo','finalizado','cancelado'].map(s=>`<option value="${s}" ${ev.estado===s?'selected':''}>${s}</option>`).join('')}</select></div><button class="btn btn-sm btn-primary w-full" onclick="window.saveBasicEdits()">Guardar</button></div><div class="ed-admin-box"><h3>Generación</h3><button class="btn btn-sm btn-ghost w-full" ${canGen?'':'disabled'} onclick="window.finalizarInscripcionYSortear()">Finalizar inscripción y generar</button></div><div class="ed-admin-box border-sport-red/30"><h3 class="text-sport-red">Zona peligrosa</h3><button class="btn btn-sm btn-ghost text-sport-red w-full" onclick="window.deleteEventED()">Eliminar evento</button></div></div>`; }

function renderActionBar(){ const ev=currentEvent, bar=document.getElementById('ed-action-bar'), c=document.getElementById('ed-action-content'); if(!bar||!c||!ev) return; if(ev.estado==='inscripcion'&&!isInscribed()){ bar.classList.remove('hidden'); c.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn-ed-primary" style="flex:1;min-width:180px;" onclick="window.inscribirseEventoED()">INSCRIBIRSE</button><a class="btn-ev-detail" style="flex:1;min-width:180px;text-decoration:none;display:flex;align-items:center;justify-content:center;" href="evento-sorteo.html?id=${ev.id}">Ver evento</a></div>`; return; } if(isInscribed()||canAdmin()){ bar.classList.remove('hidden'); c.innerHTML=`<div class="flex-row items-center justify-center gap-3 p-3 bg-sport-green/10 border border-sport-green/20 rounded-2xl"><i class="fas fa-check-circle text-sport-green"></i><span class="text-[12px] font-black text-sport-green uppercase italic">${isInscribed()?'Inscrito':'Modo organizador'}</span><a href="evento-sorteo.html?id=${ev.id}" class="text-[10px] font-bold text-primary">Sorteo</a>${isInscribed()?'<button class="text-[10px] text-sport-red/70 hover:text-sport-red font-bold" onclick="window.cancelInscripcionED()">Darse de baja</button>':''}</div>`; return; } bar.classList.add('hidden'); }

window.cancelInscripcionED = async ()=>{ if(!confirm('¿Cancelar inscripción?')) return; try{ await updateDoc(doc(db,'eventos',eventId),{ inscritos:(currentEvent.inscritos||[]).filter(i=>i.uid!==currentUser.uid), updatedAt:serverTimestamp() }); showToast('Evento','Baja completada.','info'); }catch(e){ showToast('Error',e?.message||'No se pudo cancelar.','error'); } };
window.saveBasicEdits = async ()=>{ if(!canAdmin()) return; const name=String(document.getElementById('adm-ev-name')?.value||'').trim(); const state=String(document.getElementById('adm-ev-state')?.value||'draft'); if(!name) return showToast('Evento','Nombre requerido.','warning'); try{ await updateDoc(doc(db,'eventos',eventId),{ nombre:name, estado:state, groupCount:Math.min(4,Math.max(2,Number(currentEvent?.groupCount||2))), updatedAt:serverTimestamp() }); showToast('Evento','Guardado.','success'); }catch(e){ showToast('Error',e?.message||'No se pudo guardar.','error'); } };

window.finalizarInscripcionYSortear = async ()=>{ if(!canAdmin()) return; const ev=currentEvent; if(!ev) return; if(ev.drawState?.status==='completed') return showToast('Torneo','Ya generado.','info'); try{ const seed=`${Date.now()}`; const built=buildEventTeams({ modalidad:ev.modalidad||'parejas', inscritos:ev.inscritos||[], seed:`${ev.id}_${seed}` }); const teams=built.teams||[]; if(teams.length<2) return showToast('Torneo','Mínimo 2 equipos.','warning'); const prev=await getDocs(query(collection(db,'eventoPartidos'), where('eventoId','==',ev.id))); await Promise.all(prev.docs.map(d=>deleteDoc(doc(db,'eventoPartidos',d.id)))); let drawSteps=[]; const groups={}; let bracket=null; const f=String(ev.formato||'league_knockout'); if(f==='league'){ const rr=generateRoundRobin(teams.map(t=>t.id)); for(let i=0;i<rr.length;i+=1){ const m=rr[i], ta=resolveTeamById(teams,m.teamAId), tb=resolveTeamById(teams,m.teamBId); await addDoc(collection(db,'eventoPartidos'),{ eventoId:ev.id,tipo:'evento',phase:'league',round:i+1,teamAId:m.teamAId,teamBId:m.teamBId,teamAName:ta?.name||'TBD',teamBName:tb?.name||'TBD',playerUids:[...new Set([...(ta?.playerUids||[]),...(tb?.playerUids||[])])],resultado:null,ganadorTeamId:null,estado:'pendiente',fecha:null,createdAt:serverTimestamp()}); } groups.L=teams.map(t=>t.id);} else if(f==='knockout'){ const rounds=generateKnockoutTree(teams,`${ev.id}_${seed}`); for(const r of rounds) for(const m of r){ const ta=resolveTeamById(teams,m.teamAId), tb=resolveTeamById(teams,m.teamBId); await addDoc(collection(db,'eventoPartidos'),{ eventoId:ev.id,tipo:'evento',phase:'knockout',matchCode:m.matchCode,round:m.round,slot:m.slot,sourceA:m.sourceA,sourceB:m.sourceB,teamAId:m.teamAId,teamBId:m.teamBId,teamAName:ta?.name||null,teamBName:tb?.name||null,playerUids:[...new Set([...(ta?.playerUids||[]),...(tb?.playerUids||[])])],resultado:null,ganadorTeamId:null,estado:'pendiente',fecha:null,createdAt:serverTimestamp()}); } } else { const draw=runTournamentDraw({ eventId:ev.id, modalidad:ev.modalidad||'parejas', inscritos:ev.inscritos||[], groupCount:Math.min(4,Math.max(2,Number(ev.groupCount||2))), seed }); drawSteps=draw.drawSteps||[]; Object.assign(groups,draw.groups||{}); bracket=draw.bracket||null; for(const gm of draw.groupMatches){ const ta=resolveTeamById(draw.teams,gm.teamAId), tb=resolveTeamById(draw.teams,gm.teamBId); await addDoc(collection(db,'eventoPartidos'),{ eventoId:ev.id,tipo:'evento',phase:'group',group:gm.group,round:gm.round,teamAId:gm.teamAId,teamBId:gm.teamBId,teamAName:ta?.name||'TBD',teamBName:tb?.name||'TBD',playerUids:[...new Set([...(ta?.playerUids||[]),...(tb?.playerUids||[])])],resultado:null,ganadorTeamId:null,estado:'pendiente',fecha:null,createdAt:serverTimestamp()}); } for(const code of ['SF1','SF2']) await addDoc(collection(db,'eventoPartidos'),{ eventoId:ev.id,tipo:'evento',phase:'semi',matchCode:code,round:1,teamAId:null,teamBId:null,teamAName:'Por definir',teamBName:'Por definir',playerUids:[],resultado:null,ganadorTeamId:null,estado:'pendiente',fecha:null,createdAt:serverTimestamp()}); await addDoc(collection(db,'eventoPartidos'),{ eventoId:ev.id,tipo:'evento',phase:'final',matchCode:'F1',round:2,teamAId:null,teamBId:null,teamAName:'Ganador SF1',teamBName:'Ganador SF2',playerUids:[],resultado:null,ganadorTeamId:null,estado:'pendiente',fecha:null,createdAt:serverTimestamp()}); }
await updateDoc(doc(db,'eventos',ev.id),{ estado:'activo',teams,groups,drawState:{ status:'completed',seed,steps:drawSteps,completedAt:new Date().toISOString(),executedBy:currentUser.uid,version:Date.now() },...(bracket?{bracket}:{}),unmatched:built.unmatched||[],updatedAt:serverTimestamp() }); showToast('Torneo','Estructura generada.','success'); setTimeout(()=>window.location.href=`evento-sorteo.html?id=${ev.id}`,400);}catch(e){ showToast('Error',e?.message||'No se pudo generar.','error'); } };
window.programarEventoPartido = async (matchId)=>{ const m=eventMatches.find(x=>x.id===matchId); if(!m||!canManage(m)) return; const raw=prompt('Fecha y hora (YYYY-MM-DDTHH:mm)', m.fecha?toLocalInput(m.fecha):''); if(!raw) return; const d=new Date(raw); if(!Number.isFinite(d.getTime())) return showToast('Fecha','Formato no válido.','warning'); try{ await updateDoc(doc(db,'eventoPartidos',matchId),{ fecha:d, updatedAt:serverTimestamp() }); showToast('Partido','Fecha guardada.','success'); }catch(e){ showToast('Error',e?.message||'No se pudo programar.','error'); } };

window.cerrarEventoPartido = async (matchId)=>{ const m=eventMatches.find(x=>x.id===matchId); if(!m||!canManage(m)) return; const r=prompt('Resultado (ej: 6-4 7-5):', m.resultado||''); if(!r) return; const g=String(prompt('Ganador: A o B','A')||'').trim().toUpperCase(); if(!['A','B'].includes(g)) return showToast('Partido','Ganador inválido.','warning'); const winner=g==='A'?m.teamAId:m.teamBId; if(!winner) return showToast('Partido','Equipos no definidos.','warning'); try{ await updateDoc(doc(db,'eventoPartidos',matchId),{ resultado:r, ganadorTeamId:winner, estado:'jugado', updatedAt:serverTimestamp() }); await syncCompetition(); showToast('Partido','Resultado guardado.','success'); }catch(e){ showToast('Error',e?.message||'No se pudo guardar.','error'); } };

async function syncCompetition(){ const ev=currentEvent; if(!ev?.id) return; const s=await getDocs(query(collection(db,'eventoPartidos'), where('eventoId','==',ev.id))); const matches=s.docs.map(d=>({id:d.id,...d.data()})); const byTeam=new Map((ev.teams||[]).map(t=>[t.id,t])); const f=String(ev.formato||'league_knockout'); if(f==='league') return syncLeague(matches); if(f==='knockout') return syncKnockout(matches,byTeam); return syncLeagueKnock(matches,byTeam); }
async function syncLeague(matches){ const m=matches.filter(x=>x.phase==='league'); if(!m.length||!m.every(x=>x.estado==='jugado')) return; const t=computeGroupTable(m,currentEvent.teams||[],{ win:Number(currentEvent.puntosVictoria||3), draw:Number(currentEvent.puntosEmpate||1), loss:Number(currentEvent.puntosDerrota||0) }); const c=t[0]; await updateDoc(doc(db,'eventos',currentEvent.id),{ estado:'finalizado', championTeamId:c?.teamId||null, championTeamName:c?.teamName||null, updatedAt:serverTimestamp() }); }

async function syncKnockout(matches,byTeam){ const ko=matches.filter(x=>x.phase==='knockout'); const byCode=new Map(ko.map(x=>[x.matchCode,x])); for(const m of ko.filter(x=>Number(x.round||1)===1)){ if(m.estado==='jugado') continue; if(!!m.teamAId!==!!m.teamBId){ const w=m.teamAId||m.teamBId; await updateDoc(doc(db,'eventoPartidos',m.id),{ ganadorTeamId:w, estado:'jugado', resultado:'BYE', updatedAt:serverTimestamp() }); m.ganadorTeamId=w; m.estado='jugado'; }} const rounds=[...new Set(ko.map(x=>Number(x.round||1)))].sort((a,b)=>a-b); for(const r of rounds){ if(r<=1) continue; for(const m of ko.filter(x=>Number(x.round||1)===r)){ const a=byCode.get(m.sourceA)?.ganadorTeamId||null, b=byCode.get(m.sourceB)?.ganadorTeamId||null; if(m.teamAId!==a||m.teamBId!==b){ const ta=byTeam.get(a||''), tb=byTeam.get(b||''); await updateDoc(doc(db,'eventoPartidos',m.id),{ teamAId:a, teamBId:b, teamAName:ta?.name||null, teamBName:tb?.name||null, playerUids:[...new Set([...(ta?.playerUids||[]),...(tb?.playerUids||[])])], updatedAt:serverTimestamp() }); } if(m.estado!=='jugado'&&!!a!==!!b) await updateDoc(doc(db,'eventoPartidos',m.id),{ ganadorTeamId:a||b, estado:'jugado', resultado:'BYE', updatedAt:serverTimestamp() }); }} const s=await getDocs(query(collection(db,'eventoPartidos'), where('eventoId','==',currentEvent.id))); const all=s.docs.map(d=>({id:d.id,...d.data()})); const max=Math.max(...all.filter(x=>x.phase==='knockout').map(x=>Number(x.round||1)),1); const fin=all.find(x=>x.phase==='knockout'&&Number(x.round||1)===max&&Number(x.slot||1)===1); if(fin?.estado==='jugado'&&fin?.ganadorTeamId) await updateDoc(doc(db,'eventos',currentEvent.id),{ estado:'finalizado', championTeamId:fin.ganadorTeamId, championTeamName:byTeam.get(fin.ganadorTeamId)?.name||'Campeón', updatedAt:serverTimestamp() }); }

async function syncLeagueKnock(matches,byTeam){ await promoteGroups(matches,byTeam); await promoteFinal(matches,byTeam); const s=await getDocs(query(collection(db,'eventoPartidos'), where('eventoId','==',currentEvent.id))); const all=s.docs.map(d=>({id:d.id,...d.data()})); const fin=all.find(x=>x.phase==='final'); if(fin?.estado==='jugado'&&fin?.ganadorTeamId) await updateDoc(doc(db,'eventos',currentEvent.id),{ estado:'finalizado', championTeamId:fin.ganadorTeamId, championTeamName:byTeam.get(fin.ganadorTeamId)?.name||'Campeón', updatedAt:serverTimestamp() }); }
async function promoteGroups(matches,byTeam){ const groups=currentEvent.groups||{}; const keys=Object.keys(groups); if(keys.length<2) return; const gm=matches.filter(x=>x.phase==='group'); if(!gm.length||!gm.every(x=>x.estado==='jugado')) return; const q=[]; keys.forEach((g)=>{ const gTeams=(groups[g]||[]).map(id=>byTeam.get(id)).filter(Boolean); const t=computeGroupTable(gm.filter(x=>x.group===g),gTeams,{ win:Number(currentEvent.puntosVictoria||3), draw:Number(currentEvent.puntosEmpate||1), loss:Number(currentEvent.puntosDerrota||0)}); if(t[0]?.teamId) q.push(t[0].teamId); if(t[1]?.teamId) q.push(t[1].teamId);}); if(q.length<4) return; const semis=matches.filter(x=>x.phase==='semi').sort((a,b)=>String(a.matchCode||'').localeCompare(String(b.matchCode||''))); if(semis.length<2) return; if(semis[0].teamAId||semis[0].teamBId||semis[1].teamAId||semis[1].teamBId) return; const sh=[...q].sort(()=>Math.random()-0.5); const as=[{m:semis[0],a:sh[0],b:sh[1]},{m:semis[1],a:sh[2],b:sh[3]}]; for(const x of as){ const ta=byTeam.get(x.a),tb=byTeam.get(x.b); await updateDoc(doc(db,'eventoPartidos',x.m.id),{ teamAId:x.a, teamBId:x.b, teamAName:ta?.name||'TBD', teamBName:tb?.name||'TBD', playerUids:[...new Set([...(ta?.playerUids||[]),...(tb?.playerUids||[])])], updatedAt:serverTimestamp() }); }}
async function promoteFinal(matches,byTeam){ const semis=matches.filter(x=>x.phase==='semi'), fin=matches.find(x=>x.phase==='final'); if(!fin||semis.length<2) return; const w=semis.filter(x=>x.estado==='jugado'&&x.ganadorTeamId).map(x=>x.ganadorTeamId); if(w.length<2) return; if(fin.teamAId===w[0]&&fin.teamBId===w[1]) return; const ta=byTeam.get(w[0]),tb=byTeam.get(w[1]); await updateDoc(doc(db,'eventoPartidos',fin.id),{ teamAId:w[0], teamBId:w[1], teamAName:ta?.name||'Ganador SF1', teamBName:tb?.name||'Ganador SF2', playerUids:[...new Set([...(ta?.playerUids||[]),...(tb?.playerUids||[])])], updatedAt:serverTimestamp() }); }

window.deleteEventED = async ()=>{ if(!canAdmin()) return; if(!confirm('¿Eliminar evento permanentemente?')) return; try{ const s=await getDocs(query(collection(db,'eventoPartidos'), where('eventoId','==',eventId))); await Promise.all(s.docs.map(d=>deleteDoc(doc(db,'eventoPartidos',d.id)))); await deleteDoc(doc(db,'eventos',eventId)); showToast('Evento','Evento eliminado.','info'); setTimeout(()=>window.location.href='eventos.html',700);}catch(e){ showToast('Error',e?.message||'No se pudo eliminar.','error'); } };

function normalizeSide(raw){ const s=String(raw||'').toLowerCase(); if(s.includes('der')) return 'derecha'; if(s.includes('rev')) return 'reves'; return 'flex'; }
function fmtDate(d){ if(!d) return '-'; const x=d?.toDate?d.toDate():new Date(d); if(!Number.isFinite(x.getTime())) return '-'; return x.toLocaleString('es-ES',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function toLocalInput(d){ const x=d?.toDate?d.toDate():new Date(d); if(!Number.isFinite(x.getTime())) return ''; const z=(n)=>String(n).padStart(2,'0'); return `${x.getFullYear()}-${z(x.getMonth()+1)}-${z(x.getDate())}T${z(x.getHours())}:${z(x.getMinutes())}`; }
function escapeHtml(raw=''){ return String(raw).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }

/* ---- Event automation overrides v2 ---- */
async function notifyUsersV2(uids = [], title = "Evento", message = "", data = {}) {
  const uniq = [...new Set((uids || []).filter(Boolean))];
  if (!uniq.length || !currentUser?.uid) return;
  await Promise.all(
    uniq.map(async (uid) => {
      try {
        await addDoc(collection(db, "notificaciones"), {
          destinatario: uid,
          receptorId: uid,
          remitente: currentUser.uid,
          tipo: "evento",
          type: "evento",
          titulo: title,
          mensaje: message,
          enlace: `evento-detalle.html?id=${eventId}&tab=partidos`,
          data,
          leido: false,
          seen: false,
          read: false,
          uid,
          title,
          message,
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      } catch (_) {}
    }),
  );
}

window.inscribirseEventoED = async () => {
  const ev = currentEvent;
  if (!ev) return;
  if (String(ev.estado || "") !== "inscripcion") return showToast("Evento", "La inscripcion esta cerrada.", "warning");
  if ((ev.inscritos || []).length >= Number(ev.plazasMax || 16)) return showToast("Evento", "No quedan plazas.", "warning");
  if (isInscribed()) return showToast("Evento", "Ya estas inscrito.", "info");

  const myLevel = Number(currentUserData?.nivel || 2.5);
  if (Number.isFinite(Number(ev.nivelMin)) && myLevel < Number(ev.nivelMin)) {
    return showToast("Nivel insuficiente", `Necesitas nivel ${Number(ev.nivelMin).toFixed(1)} o superior.`, "warning");
  }
  if (Number.isFinite(Number(ev.nivelMax)) && myLevel > Number(ev.nivelMax)) {
    return showToast("Nivel no valido", `Este evento admite maximo ${Number(ev.nivelMax).toFixed(1)}.`, "warning");
  }

  const pref = await showSidePreferenceModal();
  if (pref == null) return;
  let pairCode = "";
  if (String(ev.modalidad || "parejas") === "parejas" && ev.companeroObligatorio === true) {
    const code = prompt("Código de pareja (igual para ambos)", "pareja-1");
    if (code === null) return;
    pairCode = String(code || "").trim().toLowerCase();
    if (!pairCode) return showToast("Pareja", "Debes indicar código.", "warning");
  }

  const entry = {
    uid: currentUser.uid,
    nombre: currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador",
    nivel: myLevel,
    sidePreference: pref,
    pairCode,
    inscritoEn: new Date().toISOString(),
  };

  try {
    await updateDoc(doc(db, "eventos", eventId), {
      inscritos: [...(ev.inscritos || []), entry],
      updatedAt: serverTimestamp(),
    });
    showToast("Evento", "Inscripcion completada.", "success");
    await notifyUsersV2([currentUser.uid], "Inscripcion realizada", `Te has inscrito en ${ev.nombre || "el evento"}.`, {
      type: "event_joined",
      eventId,
    });
  } catch (err) {
    showToast("Error", err?.message || "No se pudo inscribir.", "error");
  }
};

window.programarEventoPartido = async (matchId) => {
  const m = eventMatches.find((x) => x.id === matchId);
  if (!m || !canManage(m)) return;
  const raw = prompt("Fecha y hora (YYYY-MM-DDTHH:mm)", m.fecha ? toLocalInput(m.fecha) : "");
  if (!raw) return;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return showToast("Fecha", "Formato no valido.", "warning");
  try {
    await updateDoc(doc(db, "eventoPartidos", matchId), { fecha: d, updatedAt: serverTimestamp() });
    showToast("Partido", "Fecha guardada.", "success");
    await notifyUsersV2(m.playerUids || [], "Partido de evento programado", `${m.teamAName || "Equipo A"} vs ${m.teamBName || "Equipo B"}: ${fmtDate(d)}.`, {
      type: "event_match_scheduled",
      matchId,
      eventId,
    });
  } catch (e) {
    showToast("Error", e?.message || "No se pudo programar.", "error");
  }
};

function groupTopTwoV2(groupKey, matches, groups, byTeam) {
  const gTeams = (groups[groupKey] || []).map((id) => byTeam.get(id)).filter(Boolean);
  const table = computeGroupTable(
    matches.filter((x) => x.phase === "group" && x.group === groupKey),
    gTeams,
    {
      win: Number(currentEvent.puntosVictoria || 3),
      draw: Number(currentEvent.puntosEmpate || 1),
      loss: Number(currentEvent.puntosDerrota || 0),
    },
  );
  return [table[0]?.teamId || null, table[1]?.teamId || null];
}

async function promoteGroupsV2(matches, byTeam) {
  const groups = currentEvent.groups || {};
  const keys = Object.keys(groups);
  if (keys.length < 2) return;
  const gm = matches.filter((x) => x.phase === "group");
  if (!gm.length || !gm.every((x) => x.estado === "jugado")) return;

  const semis = matches
    .filter((x) => x.phase === "semi")
    .sort((a, b) => String(a.matchCode || "").localeCompare(String(b.matchCode || "")));
  if (semis.length < 2) return;
  if (semis[0].teamAId || semis[0].teamBId || semis[1].teamAId || semis[1].teamBId) return;

  let assignments = [];
  if (groups.A && groups.B) {
    const [a1, a2] = groupTopTwoV2("A", matches, groups, byTeam);
    const [b1, b2] = groupTopTwoV2("B", matches, groups, byTeam);
    assignments = [{ m: semis[0], a: a1, b: b2 }, { m: semis[1], a: b1, b: a2 }];
  } else {
    const ranked = [];
    keys.forEach((g) => {
      const [g1, g2] = groupTopTwoV2(g, matches, groups, byTeam);
      if (g1) ranked.push(g1);
      if (g2) ranked.push(g2);
    });
    if (ranked.length < 4) return;
    assignments = [{ m: semis[0], a: ranked[0], b: ranked[3] }, { m: semis[1], a: ranked[1], b: ranked[2] }];
  }

  for (const x of assignments) {
    if (!x.a || !x.b) continue;
    const ta = byTeam.get(x.a);
    const tb = byTeam.get(x.b);
    await updateDoc(doc(db, "eventoPartidos", x.m.id), {
      teamAId: x.a,
      teamBId: x.b,
      teamAName: ta?.name || "TBD",
      teamBName: tb?.name || "TBD",
      playerUids: [...new Set([...(ta?.playerUids || []), ...(tb?.playerUids || [])])],
      updatedAt: serverTimestamp(),
    });
  }
}

async function promoteFinalV2(matches, byTeam) {
  const semis = matches.filter((x) => x.phase === "semi");
  const fin = matches.find((x) => x.phase === "final");
  if (!fin || semis.length < 2) return;
  const winners = semis.filter((x) => x.estado === "jugado" && x.ganadorTeamId).map((x) => x.ganadorTeamId);
  if (winners.length < 2) return;
  if (fin.teamAId === winners[0] && fin.teamBId === winners[1]) return;
  const ta = byTeam.get(winners[0]);
  const tb = byTeam.get(winners[1]);
  await updateDoc(doc(db, "eventoPartidos", fin.id), {
    teamAId: winners[0],
    teamBId: winners[1],
    teamAName: ta?.name || "Ganador SF1",
    teamBName: tb?.name || "Ganador SF2",
    playerUids: [...new Set([...(ta?.playerUids || []), ...(tb?.playerUids || [])])],
    updatedAt: serverTimestamp(),
  });
}

async function syncLeagueKnockV2(matches, byTeam) {
  await promoteGroupsV2(matches, byTeam);
  await promoteFinalV2(matches, byTeam);
  const s = await getDocs(query(collection(db, "eventoPartidos"), where("eventoId", "==", currentEvent.id)));
  const all = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  const fin = all.find((x) => x.phase === "final");
  if (fin?.estado === "jugado" && fin?.ganadorTeamId) {
    await updateDoc(doc(db, "eventos", currentEvent.id), {
      estado: "finalizado",
      championTeamId: fin.ganadorTeamId,
      championTeamName: byTeam.get(fin.ganadorTeamId)?.name || "Campeon",
      updatedAt: serverTimestamp(),
    });
  }
}

async function syncCompetitionV2() {
  const ev = currentEvent;
  if (!ev?.id) return;
  const s = await getDocs(query(collection(db, "eventoPartidos"), where("eventoId", "==", ev.id)));
  const matches = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byTeam = new Map((ev.teams || []).map((t) => [t.id, t]));
  const f = String(ev.formato || "league_knockout");
  if (f === "league") return syncLeague(matches);
  if (f === "knockout") return syncKnockout(matches, byTeam);
  return syncLeagueKnockV2(matches, byTeam);
}

window.cerrarEventoPartido = async (matchId) => {
  const m = eventMatches.find((x) => x.id === matchId);
  if (!m || !canManage(m)) return;
  const r = prompt("Resultado (ej: 6-4 7-5):", m.resultado || "");
  if (!r || !r.trim()) return;
  if (!m.playerUids || m.playerUids.length !== 4) {
    showToast("Partido", "Faltan jugadores en el partido para aplicar puntuación ELO.", "warning");
    return;
  }
  try {
    const rankingSync = await processMatchResults(matchId, "eventoPartidos", r.trim(), {});
    if (!rankingSync?.success) {
      showToast("Partido", rankingSync?.error || "No se pudo aplicar el resultado (formato o jugadores).", "error");
      return;
    }
    await syncCompetitionV2();
    await notifyUsersV2(m.playerUids || [], "Resultado registrado", `${m.teamAName || "Equipo A"} vs ${m.teamBName || "Equipo B"}: ${r}.`, {
      type: "event_result",
      matchId,
      eventId,
    });
    showToast("Partido", "Resultado guardado y puntuación ELO actualizada.", "success");
  } catch (e) {
    showToast("Error", e?.message || "No se pudo guardar.", "error");
  }
};
