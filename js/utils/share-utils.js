/**
 * PADELUMINATIS SHARE UTILS V2.0
 * Premium match poster with betting odds, player levels, and padel court background.
 */

export async function generateMatchShareImage(analysis, matchData = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1080;
    canvas.height = 1080;

    // Background gradient (Deep Dark Blue/Black)
    const grad = ctx.createLinearGradient(0, 0, 0, 1080);
    grad.addColorStop(0, '#040b1a');
    grad.addColorStop(1, '#020610');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1080);

    // Court lines (Ambient)
    drawCourtLines(ctx, 1080, 1080, 0.05);

    // Decorative glow behind score
    const scoreGlow = ctx.createRadialGradient(540, 480, 0, 540, 480, 300);
    scoreGlow.addColorStop(0, 'rgba(184, 255, 0, 0.08)');
    scoreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = scoreGlow;
    ctx.fillRect(240, 180, 600, 600);

    // Logo
    const logo = await loadImage(matchData.logoUrl || 'imagenes/Logojafs.png');
    if (logo) {
        ctx.globalAlpha = 0.8;
        ctx.drawImage(logo, 1080 / 2 - 50, 50, 100, 100);
        ctx.globalAlpha = 1;
    }

    // Header
    ctx.fillStyle = '#b8ff00';
    ctx.font = '900 42px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText('RESULTADO FINAL', 540, 200);

    // Subtitle
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '700 18px Rajdhani';
    ctx.fillText('MARCADOR OFICIAL DEL PARTIDO', 540, 235);

    // --- SCOREBOARD ---
    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 900 150px Rajdhani'; // Reduced from 180px
    ctx.textAlign = 'center';
    const scoreText = analysis.sets || 'Finalizado';
    ctx.fillText(scoreText, 540, 430); // Adjusted Y


    const winnerKey = String(matchData.winner || "").toUpperCase();

    // --- WINNER BANNER ---
    if (matchData.winner) {
        const teamAName = (matchData.teamA || []).map(p => (typeof p === 'object' ? p.name : p)).filter(Boolean).join(' & ') || 'Pareja A';
        const teamBName = (matchData.teamB || []).map(p => (typeof p === 'object' ? p.name : p)).filter(Boolean).join(' & ') || 'Pareja B';
        const winnerText = `GANADORES · ${winnerKey === 'A' ? teamAName : teamBName}`;
        ctx.fillStyle = '#b8ff00';
        ctx.font = '900 24px Rajdhani';
        ctx.fillText(winnerText.toUpperCase(), 540, 530);
    }

    // --- PLAYERS SECTION ---
    const players = Array.isArray(matchData.players) ? matchData.players : [];
    // Ensure all players are strings
    const cleanPlayers = players.map(p => {
        if (typeof p === 'object' && p !== null) return p.name || p.nombreUsuario || "Jugador";
        return String(p || "");
    });

    const teamA = (matchData.teamA || []).map(p => (typeof p === 'object' ? p.name : p)).filter(Boolean);
    const teamB = (matchData.teamB || []).map(p => (typeof p === 'object' ? p.name : p)).filter(Boolean);
    const teamAIsWinner = winnerKey === "A" || winnerKey === "1";
    const teamBIsWinner = winnerKey === "B" || winnerKey === "2";

    roundRect(ctx, 110, 610, 360, 180, 26, teamAIsWinner ? 'rgba(184,255,0,0.08)' : 'rgba(255,255,255,0.03)');
    roundRect(ctx, 610, 610, 360, 180, 26, teamBIsWinner ? 'rgba(184,255,0,0.08)' : 'rgba(255,255,255,0.03)');
    ctx.strokeStyle = teamAIsWinner ? 'rgba(184,255,0,0.32)' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(110, 610, 360, 180);
    ctx.strokeStyle = teamBIsWinner ? 'rgba(184,255,0,0.32)' : 'rgba(255,255,255,0.08)';
    ctx.strokeRect(610, 610, 360, 180);

    // Team A column
    ctx.textAlign = 'right';
    ctx.font = '700 32px Rajdhani';
    const levelsA = matchData.levelsA || [];
    teamA.forEach((name, i) => {
        const y = 680 + (i * 70);
        ctx.fillStyle = teamAIsWinner ? '#f4ffd0' : 'rgba(255,255,255,0.85)';
        ctx.fillText(String(name).toUpperCase(), 440, y);
        if (levelsA[i]) {
            ctx.fillStyle = '#b8ff00';
            ctx.font = '900 18px Rajdhani';
            ctx.fillText(`NV ${Number(levelsA[i]).toFixed(1)}`, 440, y + 25);
            ctx.font = '700 32px Rajdhani'; // restore
        }
    });

    // TEAM VS
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b8ff00';
    ctx.font = '900 40px Rajdhani';
    ctx.fillText('VS', 540, 715);

    // Team B column
    ctx.textAlign = 'left';
    ctx.font = '700 32px Rajdhani';
    const levelsB = matchData.levelsB || [];
    teamB.forEach((name, i) => {
        const y = 680 + (i * 70);
        ctx.fillStyle = teamBIsWinner ? '#f4ffd0' : 'rgba(255,255,255,0.85)';
        ctx.fillText(String(name).toUpperCase(), 640, y);
        if (levelsB[i]) {
            ctx.fillStyle = '#b8ff00';
            ctx.font = '900 18px Rajdhani';
            ctx.fillText(`NV ${Number(levelsB[i]).toFixed(1)}`, 640, y + 25);
            ctx.font = '700 32px Rajdhani'; // restore
        }
    });


    // Footer
    drawBrandFooter(ctx, 1080, 1080, matchData.club || 'JAFS PADEL');

    return canvas.toDataURL('image/png');
}


export async function shareMatchResult(analysis, matchData) {
    const dataUrl = await generateMatchShareImage(analysis, matchData);
    if (navigator.share) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'mision_padel.png', { type: 'image/png' });
        try {
            await navigator.share({ title: 'Mi resultado JafsPadel', text: `Mision completada. ${analysis.delta >= 0 ? 'Gane' : 'Perdi'} ${Math.abs(analysis.delta)} puntos.`, files: [file] });
            return true;
        } catch (e) { downloadDataUrl(dataUrl, 'mision_padel.png'); }
    } else { downloadDataUrl(dataUrl, 'mision_padel.png'); }
}

// ──────────────────────────────────────────────────
// MATCH POSTER V3 — Premium Hybrid (Upcoming / Played)
// ──────────────────────────────────────────────────
export async function generateMatchPosterImage(matchData = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1080;
    canvas.height = 1350;

    const isPlayed = Boolean(matchData.sets || matchData.winner);
    const accentColor = isPlayed ? '#b8ff00' : '#00d4ff';

    // === 1. BACKGROUND ===
    const grad = ctx.createLinearGradient(0, 0, 0, 1350);
    grad.addColorStop(0, '#020617');
    grad.addColorStop(0.3, '#0b1222');
    grad.addColorStop(0.7, '#070d1a');
    grad.addColorStop(1, '#02040a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1350);

    // === 2. COURT LINES (Realistic) ===
    drawCourtLines(ctx, 1080, 1350, 0.08);
    
    // Ambient circle
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(540, 675, 200, 0, Math.PI * 2); ctx.stroke();

    // === 3. HEADER & LOGO ===
    const logo = await loadImage(matchData.logoUrl || 'imagenes/Logojafs.png');
    if (logo) {
        ctx.globalAlpha = 1;
        ctx.drawImage(logo, 70, 60, 110, 110);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = accentColor;
    ctx.font = '900 48px Rajdhani';
    ctx.fillText('JAFS PADEL CLUB', 200, 105);
    
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '700 20px Rajdhani';
    ctx.letterSpacing = '5px';
    const hTitle = isPlayed ? 'RESULTADO FINAL' : (matchData.title || 'PRÓXIMO PARTIDO');
    ctx.fillText(hTitle.toUpperCase(), 202, 140);

    // === 4. DATE/TIME OR SCORE BAR ===
    const boxY = 240;
    const boxH = 160;
    roundRect(ctx, 60, boxY, 960, boxH, 24, 'rgba(255,255,255,0.02)');
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (isPlayed) {
        // PREMUM SCORE DISPLAY
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '900 16px Rajdhani';
        ctx.fillText('MARCADOR FINAL', 540, boxY + 35);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'italic 900 110px Rajdhani';
        ctx.save();
        ctx.shadowColor = 'rgba(184, 255, 0, 0.4)';
        ctx.shadowBlur = 20;
        ctx.fillText(matchData.sets || 'F', 540, boxY + 125);
        ctx.restore();
    } else {
        // UPCOMING DATE DISPLAY
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '900 16px Rajdhani';
        ctx.fillText('FECHA DEL ENCUENTRO', 540, boxY + 35);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 44px Rajdhani';
        ctx.fillText('📅  ' + (matchData.when || 'POR CONFIRMAR').toUpperCase(), 540, boxY + 105);
    }

    // === 5. TEAM PANELS ===
    const teamA = Array.isArray(matchData.teamA) ? matchData.teamA : [];
    const teamB = Array.isArray(matchData.teamB) ? matchData.teamB : [];
    const levelA = matchData.levelsA || [];
    const levelB = matchData.levelsB || [];
    const winnerKey = String(matchData.winner || "").toUpperCase();
    
    // Team A
    const isWinnerA = winnerKey === 'A';
    roundRect(ctx, 60, 440, 440, 320, 24, isWinnerA ? 'rgba(184,255,0,0.07)' : 'rgba(255,255,255,0.03)');
    ctx.strokeStyle = isWinnerA ? 'rgba(184,255,0,0.3)' : 'rgba(255,255,255,0.1)';
    ctx.stroke();
    
    ctx.textAlign = 'center';
    ctx.fillStyle = isWinnerA ? '#b8ff00' : 'rgba(255,255,255,0.3)';
    ctx.font = '900 14px Rajdhani';
    ctx.fillText('PAREJA 1', 280, 475);
    if (isWinnerA) {
        ctx.font = '900 12px Rajdhani';
        ctx.fillText('🏆 GANADORES', 280, 495);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px Rajdhani';
    ctx.fillText(String(teamA[0] || 'PLAYER 1').toUpperCase(), 280, 560);
    if (teamA[1]) {
        ctx.fillStyle = '#cccccc';
        ctx.fillText(String(teamA[1]).toUpperCase(), 280, 615);
    }

    if (levelA.length) {
        ctx.fillStyle = '#b8ff00';
        ctx.font = '900 22px Rajdhani';
        ctx.fillText(levelA.map(l => `NV ${Number(l || 0).toFixed(1)}`).join('  -  '), 280, 680);
    }

    // VS BADGE
    ctx.fillStyle = accentColor;
    ctx.beginPath(); ctx.arc(540, 600, 60, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#020617';
    ctx.font = '900 40px Rajdhani';
    ctx.fillText('VS', 540, 615);

    // Team B
    const isWinnerB = winnerKey === 'B';
    roundRect(ctx, 580, 440, 440, 320, 24, isWinnerB ? 'rgba(184,255,0,0.07)' : 'rgba(255,255,255,0.03)');
    ctx.strokeStyle = isWinnerB ? 'rgba(184,255,0,0.3)' : 'rgba(255,255,255,0.1)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = isWinnerB ? '#b8ff00' : 'rgba(255,255,255,0.3)';
    ctx.font = '900 14px Rajdhani';
    ctx.fillText('PAREJA 2', 800, 475);
    if (isWinnerB) {
        ctx.font = '900 12px Rajdhani';
        ctx.fillText('🏆 GANADORES', 800, 495);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px Rajdhani';
    ctx.fillText(String(teamB[0] || 'PLAYER 2').toUpperCase(), 800, 560);
    if (teamB[1]) {
        ctx.fillStyle = '#cccccc';
        ctx.fillText(String(teamB[1]).toUpperCase(), 800, 615);
    }

    if (levelB.length) {
        ctx.fillStyle = '#b8ff00';
        ctx.font = '900 22px Rajdhani';
        ctx.fillText(levelB.map(l => `NV ${Number(l || 0).toFixed(1)}`).join('  -  '), 800, 680);
    }

    // === 6. PROGNOSTIC OR WINNER CELEBRATION ===
    if (!isPlayed && (levelA.length || levelB.length)) {
        const avgA = levelA.reduce((a, b) => a + Number(b || 0), 0) / levelA.length;
        const avgB = levelB.reduce((a, b) => a + Number(b || 0), 0) / levelB.length;
        const pctA = Math.round((avgA / (avgA + avgB)) * 100);
        const pctB = 100 - pctA;

        roundRect(ctx, 240, 810, 600, 100, 20, 'rgba(255,255,255,0.03)');
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '900 12px Rajdhani';
        ctx.fillText('PROBABILIDAD DE VICTORIA', 540, 840);
        
        // Progress bar
        roundRect(ctx, 300, 855, 480, 14, 7, 'rgba(255,255,255,0.05)');
        ctx.fillStyle = '#00d4ff';
        const barAW = (pctA / 100) * 480;
        roundRect(ctx, 300, 855, barAW, 14, 7, '#00d4ff');
        
        ctx.fillStyle = '#00d4ff'; ctx.font = '900 24px Rajdhani'; ctx.fillText(`${pctA}%`, 270, 870);
        ctx.fillStyle = '#fff'; ctx.font = '900 24px Rajdhani'; ctx.fillText(`${pctB}%`, 810, 870);
    } else if (isPlayed) {
        // Winner text banner at bottom
        ctx.fillStyle = '#b8ff00';
        ctx.textAlign = 'center';
        ctx.font = '900 48px Rajdhani';
        ctx.fillText('RESULTADO: ' + (matchData.sets || 'Finalizado'), 540, 880);
        
        ctx.font = '900 24px Rajdhani';
        ctx.fillStyle = '#00d4ff';
        const ptsA = matchData.eloDiffA || 0;
        const ptsB = matchData.eloDiffB || 0;
        if (ptsA || ptsB) {
            ctx.fillText(`+${Math.round(isWinnerA ? ptsA : (isWinnerB ? ptsB : 0))} PUNTOS ELO`, 540, 920);
        }
    }

    // === 7. COURT GRAPHIC (BOTTOM) ===
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(340, 1000, 400, 240);
    ctx.beginPath(); ctx.moveTo(540, 1000); ctx.lineTo(540, 1240); ctx.stroke();
    ctx.restore();

    // === 8. FOOTER ===
    drawBrandFooter(ctx, 1080, 1350, matchData.club || 'JAFS PADEL CLUB');

    return canvas.toDataURL('image/png');
}

export async function shareMatchPoster(matchData = {}) {
    try {
        const dataUrl = await generateMatchPosterImage(matchData);
        downloadDataUrl(dataUrl, 'jafspadel_poster.png');
        return true;
    } catch (err) {
        console.error('Poster build fail', err);
        return false;
    }
}

/**
 * Generates a high-quality poster of the current event status
 */
export async function generateEventStatusPoster(data = {}) {
    const { 
        eventName = 'TORNEO', 
        organizer = 'JAFS PADEL',
        logo = '',
        played = [],
        scheduled = [],
        pending = [],
        standings = [], // Array of { title, rows: [{teamName, pts, pj, pg, pp, pf, pc}] }
    } = data;

    // 1. CALCULATE DYNAMIC HEIGHT
    let dynamicH = 450;
    if (played.length) dynamicH += 80 + (played.length * 60);
    if (scheduled.length) dynamicH += 80 + (scheduled.length * 65);
    if (pending.length) dynamicH += 80 + (pending.length * 55);
    if (standings.length) {
        standings.forEach(g => {
             dynamicH += 80 + (Math.min(g.rows.length, 6) * 45);
        });
    }
    dynamicH += 150;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1080;
    canvas.height = Math.max(1600, dynamicH);

    // === BACKGROUND ===
    const grd = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grd.addColorStop(0, '#020617');
    grd.addColorStop(0.3, '#0a0f2b');
    grd.addColorStop(0.7, '#071b26');
    grd.addColorStop(1, '#020617');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid background
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 60) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 60) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // === HEADER ===
    const titleY = 120;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#b8ff00';
    ctx.font = '900 36px Rajdhani';
    ctx.fillText('⚡ ESTADO DEL TORNEO', 80, titleY - 40);
    ctx.fillStyle = '#fff';
    ctx.font = '900 96px Rajdhani';
    const cleanEventName = String(eventName).toUpperCase().substring(0, 18);
    ctx.fillText(cleanEventName, 80, titleY + 50);
    ctx.fillStyle = '#00d4ff';
    ctx.font = '800 28px Rajdhani';
    ctx.fillText(new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase(), 80, titleY + 100);

    let currentY = titleY + 220;

    function renderRoundedBlock(y, h, borderColor) {
        roundRect(ctx, 80, y, 920, h, 24, 'rgba(0,0,0,0.6)');
        ctx.lineWidth = 2;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
    }

    // === STANDINGS ===
    if (standings.length) {
        ctx.fillStyle = '#b8ff00'; ctx.font = '900 34px Rajdhani'; ctx.fillText('📊 CLASIFICACIONES', 80, currentY);
        currentY += 50;
        
        for (const group of standings) {
            const rowCount = Math.min(group.rows.length, 6);
            const boxH = 90 + (rowCount * 45);
            renderRoundedBlock(currentY, boxH, 'rgba(184, 255, 0, 0.3)');
            
            ctx.fillStyle = '#b8ff00'; ctx.font = '900 28px Rajdhani'; ctx.fillText(`GRUPO ${group.title.toUpperCase()}`, 110, currentY + 45);
            ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '800 16px Rajdhani'; 
            ctx.fillText('EQUIPO', 120, currentY + 85);
            ctx.textAlign = 'center'; 
            ctx.fillText('PJ', 720, currentY + 85); 
            ctx.fillText('PTS', 920, currentY + 85); 
            ctx.textAlign = 'left';
            
            let rowY = currentY + 130;
            group.rows.slice(0, 6).forEach((row, i) => {
                ctx.fillStyle = (i === 0) ? '#fbbf24' : ((i === 1) ? '#94a3b8' : '#fff');
                const pColor = (i < 2) ? '#b8ff00' : '#fff';
                ctx.font = '800 22px Rajdhani'; 
                ctx.fillText(`${i+1}. ${String(row.teamName).toUpperCase()}`, 120, rowY);
                
                ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(row.pj, 720, rowY);
                ctx.fillStyle = pColor; ctx.font = '900 26px Rajdhani'; ctx.fillText(row.pts, 920, rowY); 
                ctx.textAlign = 'left';
                rowY += 45;
            });
            currentY += boxH + 40;
        }
    }

    // === PLAYED MATCHES ===
    if (played.length) {
        ctx.fillStyle = '#00d4ff'; ctx.font = '900 34px Rajdhani'; ctx.fillText('🏆 ÚLTIMOS RESULTADOS', 80, currentY);
        currentY += 50;
        played.slice(0, 8).forEach(m => {
            renderRoundedBlock(currentY, 50, 'rgba(0, 212, 255, 0.2)');
            ctx.fillStyle = '#fff'; ctx.font = '800 20px Rajdhani'; 
            const nameA = String(m.teamAName || 'Equipo A').substring(0, 18);
            const nameB = String(m.teamBName || 'Equipo B').substring(0, 18);
            ctx.fillText(`${nameA}   vs   ${nameB}`, 110, currentY + 33);
            
            ctx.textAlign = 'right'; 
            ctx.fillStyle = '#00d4ff'; ctx.font = '900 24px Rajdhani'; 
            ctx.fillText(m.resultado || '-', 960, currentY + 34); 
            ctx.textAlign = 'left';
            currentY += 65;
        });
        currentY += 30;
    }

    // === SCHEDULED MATCHES ===
    if (scheduled.length) {
        ctx.fillStyle = '#ff0055'; ctx.font = '900 34px Rajdhani'; ctx.fillText('🗓️ PRÓXIMOS ENCUENTROS', 80, currentY);
        currentY += 50;
        scheduled.slice(0, 6).forEach(m => {
            renderRoundedBlock(currentY, 50, 'rgba(255, 0, 85, 0.2)');
            ctx.fillStyle = '#fff'; ctx.font = '800 20px Rajdhani'; 
            const nameA = String(m.teamAName || 'Equipo A').substring(0, 18);
            const nameB = String(m.teamBName || 'Equipo B').substring(0, 18);
            ctx.fillText(`${nameA}   vs   ${nameB}`, 110, currentY + 33);
            
            ctx.textAlign = 'right'; 
            ctx.fillStyle = '#ff0055'; ctx.font = '900 20px Rajdhani'; 
            ctx.fillText(m.fechaStr || 'FECHA FIJADA', 960, currentY + 33); 
            ctx.textAlign = 'left';
            currentY += 65;
        });
        currentY += 30;
    }

    // === PENDING MATCHES ===
    if (pending.length) {
        ctx.fillStyle = '#fbbf24'; ctx.font = '900 34px Rajdhani'; ctx.fillText('⏳ PARTIDOS PENDIENTES', 80, currentY);
        currentY += 50;
        pending.slice(0, 8).forEach(m => {
            renderRoundedBlock(currentY, 40, 'rgba(251, 191, 36, 0.2)');
            ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '700 18px Rajdhani'; 
            const nameA = String(m.teamAName || 'Equipo A').substring(0, 18);
            const nameB = String(m.teamBName || 'Equipo B').substring(0, 18);
            ctx.fillText(`${nameA}   vs   ${nameB}`, 110, currentY + 27);
            
            ctx.textAlign = 'right'; 
            ctx.fillStyle = '#fbbf24'; ctx.font = '700 16px Rajdhani'; 
            ctx.fillText('¡PROPONER DÍA!', 960, currentY + 27); 
            ctx.textAlign = 'left';
            currentY += 55;
        });
    }

    // === FOOTER ===
    drawBrandFooter(ctx, 1080, canvas.height, organizer || 'JAFS PADEL');
    const dataUrl = canvas.toDataURL('image/png', 0.95);
    downloadDataUrl(dataUrl, `estado_${eventName.toLowerCase().replace(/\s+/g, '_')}.png`);
    return true;
}

export function downloadDataUrl(url, filename) {
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
}

function drawCourtLines(ctx, w, h, opacity = 0.04) {
    ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${opacity})`; ctx.lineWidth = 2;
    const margin = 100; ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);
    ctx.beginPath(); ctx.moveTo(w / 2, margin); ctx.lineTo(w / 2, h - margin); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin, h / 2); ctx.lineTo(w - margin, h / 2); ctx.stroke();
    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r, fillColor) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else { ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); }
    ctx.closePath();
    if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
}

function drawBrandFooter(ctx, w, h, club) {
    ctx.fillStyle = '#b8ff00'; ctx.font = '900 28px Rajdhani'; ctx.textAlign = 'center'; ctx.fillText(club.toUpperCase(), w / 2, h - 55);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '500 16px Rajdhani'; ctx.fillText('PADELUMINATIS PRO · COMPARTE EN INSTAGRAM O WHATSAPP', w / 2, h - 25);
}

function loadImage(src) {
    return new Promise((resolve) => {
        if (!src) return resolve(null);
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img); img.onerror = () => resolve(null);
        img.src = src;
    });
}



