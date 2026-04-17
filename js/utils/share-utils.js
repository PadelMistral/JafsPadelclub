/**
 * PADELUMINATIS SHARE UTILS V2.0
 * Premium match poster with betting odds, player levels, and padel court background.
 */

function isNativeApp() {
    try {
        const cap = window.Capacitor;
        if (!cap) return false;
        if (typeof cap.isNativePlatform === 'function') return !!cap.isNativePlatform();
        const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : '';
        return platform === 'android' || platform === 'ios';
    } catch (_) {
        return false;
    }
}

async function dataUrlToFile(dataUrl, fileName = 'padeluminatis_share.png') {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], fileName, { type: 'image/png' });
}

function dataUrlToBase64(dataUrl) {
    return String(dataUrl || '').split(',')[1] || '';
}

function getNativePlugins() {
    try {
        return {
            Filesystem: window.Capacitor?.Plugins?.Filesystem || null,
            Share: window.Capacitor?.Plugins?.Share || null,
        };
    } catch (_) {
        return { Filesystem: null, Share: null };
    }
}

function buildSocialShareLinks(text = '') {
    const encoded = encodeURIComponent(text || 'Comparte PADELUMINATIS');
    return {
        whatsapp: `https://wa.me/?text=${encoded}`,
        telegram: `https://t.me/share/url?url=&text=${encoded}`,
        instagram: null,
    };
}

function showSocialShareFallback(dataUrl, text = '') {
    const links = buildSocialShareLinks(text);
    const existing = document.getElementById('poster-share-fallback');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'poster-share-fallback';
    overlay.className = 'modal-overlay active modal-stack-front';
    overlay.innerHTML = `
        <div class="modal-card glass-strong" style="max-width:380px;">
            <div class="modal-header">
                <h3 class="modal-title">Compartir cartel</h3>
                <button class="close-btn" type="button">&times;</button>
            </div>
            <div class="modal-body" style="display:grid; gap:12px;">
                <p class="text-[11px] text-white/70 leading-relaxed">En este dispositivo no se ha abierto la hoja nativa. Puedes descargar el cartel o enviarlo por una app.</p>
                <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px;">
                    <a href="${links.whatsapp}" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration:none;"><i class="fab fa-whatsapp"></i> WhatsApp</a>
                    <a href="${links.telegram}" target="_blank" rel="noopener" class="btn btn-ghost" style="text-decoration:none;"><i class="fab fa-telegram"></i> Telegram</a>
                    <button type="button" class="btn btn-ghost" data-download-share><i class="fas fa-download"></i> Guardar</button>
                </div>
                <p class="text-[10px] text-white/45">Instagram suele usar la hoja nativa del movil. Si no sale directa, guarda el cartel y luego subelo desde Instagram.</p>
            </div>
        </div>
    `;
    overlay.querySelector('.close-btn')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
    });
    overlay.querySelector('[data-download-share]')?.addEventListener('click', () => {
        downloadDataUrl(dataUrl, 'padeluminatis_poster.png');
        overlay.remove();
    });
    document.body.appendChild(overlay);
}

async function shareImageDataUrl(dataUrl, {
    title = 'PADELUMINATIS',
    text = 'Comparte tu cartel',
    fileName = 'padeluminatis_poster.png',
} = {}) {
    const file = await dataUrlToFile(dataUrl, fileName);

    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        try {
            await navigator.share({ title, text, files: [file] });
            return true;
        } catch (_) {}
    }

    if (isNativeApp()) {
        const { Filesystem, Share } = getNativePlugins();
        if (Filesystem?.writeFile && Share?.share) {
            try {
                const saved = await Filesystem.writeFile({
                    path: fileName,
                    data: dataUrlToBase64(dataUrl),
                    directory: 'CACHE',
                });
                await Share.share({
                    title,
                    text,
                    url: saved?.uri,
                    dialogTitle: 'Compartir cartel',
                });
                return true;
            } catch (_) {}
        }
    }

    showSocialShareFallback(dataUrl, text);
    return false;
}

async function saveImageToNativeDevice(dataUrl, fileName = 'padeluminatis_poster.png') {
    if (!isNativeApp()) return false;
    const { Filesystem, Share } = getNativePlugins();
    if (!Filesystem?.writeFile || !Share?.share) return false;
    try {
        const stamp = Date.now();
        const cleanName = String(fileName || 'padeluminatis_poster.png').replace(/[^\w.\-]+/g, '_');
        const saved = await Filesystem.writeFile({
            path: `${stamp}_${cleanName}`,
            data: dataUrlToBase64(dataUrl),
            directory: 'CACHE',
            recursive: true,
        });
        await Share.share({
            title: 'Guardar o compartir cartel',
            text: 'Puedes guardarlo o compartirlo por WhatsApp, Instagram o Telegram.',
            url: saved?.uri,
            dialogTitle: 'Guardar o compartir',
        });
        return true;
    } catch (_) {
        return false;
    }
}

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
    const shareText = `Mision completada en PADELUMINATIS. ${analysis.delta >= 0 ? 'Gane' : 'Perdi'} ${Math.abs(analysis.delta)} puntos.`;
    const ok = await shareImageDataUrl(dataUrl, {
        title: 'Mi resultado PADELUMINATIS',
        text: shareText,
        fileName: 'padeluminatis_resultado.png',
    });
    if (!ok) downloadDataUrl(dataUrl, 'padeluminatis_resultado.png');
    return ok;
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
        // SCORE: show real sets or 'FINALIZADO' - never 'F' alone
        const displayScore = matchData.sets && String(matchData.sets).trim().length > 1
            ? String(matchData.sets).trim()
            : (matchData.resultado || matchData.score || 'FINALIZADO');
        ctx.fillStyle = '#ffffff';
        ctx.font = 'italic 900 110px Rajdhani';
        ctx.save();
        ctx.shadowColor = 'rgba(184, 255, 0, 0.4)';
        ctx.shadowBlur = 20;
        ctx.fillText(displayScore, 540, boxY + 125);
        ctx.restore();

        // Winner label under score
        if (matchData.winner) {
            const winnerKey2 = String(matchData.winner || '').toUpperCase();
            const teamAArr = Array.isArray(matchData.teamA) ? matchData.teamA : [];
            const teamBArr = Array.isArray(matchData.teamB) ? matchData.teamB : [];
            const winTeam = winnerKey2 === 'A'
                ? teamAArr.map(p => typeof p === 'object' ? (p.name || p.nombreUsuario || 'J') : p).join(' & ')
                : teamBArr.map(p => typeof p === 'object' ? (p.name || p.nombreUsuario || 'J') : p).join(' & ');
            ctx.fillStyle = 'rgba(184,255,0,0.9)';
            ctx.font = '900 18px Rajdhani';
            ctx.fillText(`🏆 GANADORES: ${winTeam.toUpperCase()}`, 540, boxY + 152);
        }
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
        // Winner celebration banner
        const displaySets = matchData.sets && String(matchData.sets).trim().length > 1
            ? String(matchData.sets).trim()
            : (matchData.resultado || 'FINALIZADO');
        const winnerKeyB = String(matchData.winner || '').toUpperCase();
        const teamAF = Array.isArray(matchData.teamA) ? matchData.teamA : [];
        const teamBF = Array.isArray(matchData.teamB) ? matchData.teamB : [];
        const winnerNameF = winnerKeyB === 'A'
            ? teamAF.map(p => typeof p === 'object' ? (p.name || 'J') : p).join(' & ')
            : teamBF.map(p => typeof p === 'object' ? (p.name || 'J') : p).join(' & ');

        // Draw points under players
        const ptsA = matchData.eloDiffA || 0;
        const ptsB = matchData.eloDiffB || 0;
        
        ctx.textAlign = 'center';
        if (ptsA) {
            ctx.fillStyle = ptsA >= 0 ? '#b8ff00' : '#ff3366';
            ctx.font = '900 24px Rajdhani';
            ctx.fillText(`${ptsA > 0 ? '+' : ''}${Math.round(ptsA)} PTS`, 280, 730);
        }
        if (ptsB) {
            ctx.fillStyle = ptsB >= 0 ? '#b8ff00' : '#ff3366';
            ctx.font = '900 24px Rajdhani';
            ctx.fillText(`${ptsB > 0 ? '+' : ''}${Math.round(ptsB)} PTS`, 800, 730);
        }

        // Banner fondo
        roundRect(ctx, 80, 800, 920, 120, 20, 'rgba(184,255,0,0.06)');
        ctx.strokeStyle = 'rgba(184,255,0,0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#b8ff00';
        ctx.textAlign = 'center';
        ctx.font = '900 48px Rajdhani';
        ctx.fillText('MARCADOR: ' + displaySets, 540, 855);

        if (winnerNameF) {
            ctx.font = '900 26px Rajdhani';
            ctx.fillStyle = '#ffffff';
            ctx.fillText('🏆 ' + winnerNameF.toUpperCase() + ' GANAN', 540, 895);
        }

        if (matchData.summary) {
            // Function to wrap text
            const wrapText = (context, text, x, y, maxWidth, lineHeight) => {
                const words = text.split(' ');
                let line = '';
                for(let n = 0; n < words.length; n++) {
                  let testLine = line + words[n] + ' ';
                  let metrics = context.measureText(testLine);
                  let testWidth = metrics.width;
                  if (testWidth > maxWidth && n > 0) {
                    context.fillText(line.trim(), x, y);
                    line = words[n] + ' ';
                    y += lineHeight;
                  } else {
                    line = testLine;
                  }
                }
                context.fillText(line.trim(), x, y);
            };

            // AI Summary background
            roundRect(ctx, 80, 950, 920, 160, 20, 'rgba(255,255,255,0.03)');
            
            ctx.fillStyle = '#00d4ff';
            ctx.font = '900 18px Rajdhani';
            ctx.textAlign = 'left';
            ctx.fillText('RESUMEN TÁCTICO DE IA', 110, 985);
            
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.font = '500 18px Rajdhani';
            const cleanSummary = String(matchData.summary).replace(/<br>/g, " ").substring(0, 320);
            wrapText(ctx, cleanSummary + (cleanSummary.length >= 320 ? "..." : ""), 110, 1020, 860, 28);
        } else {
            // === 7. COURT GRAPHIC (BOTTOM) ===
            ctx.save();
            ctx.globalAlpha = 0.08;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(340, 1000, 400, 240);
            ctx.beginPath(); ctx.moveTo(540, 1000); ctx.lineTo(540, 1240); ctx.stroke();
            ctx.restore();
        }
    }

    // === 8. FOOTER ===
    drawBrandFooter(ctx, 1080, 1350, matchData.club || 'JAFS PADEL CLUB');

    return canvas.toDataURL('image/png');
}

export async function shareMatchPoster(matchData = {}) {
    try {
        const dataUrl = await generateMatchPosterImage(matchData);
        const title = String(matchData.title || 'Cartel PADELUMINATIS');
        const when = String(matchData.when || '').trim();
        const shareText = when ? `${title} · ${when}` : `${title} en PADELUMINATIS`;
        const ok = await shareImageDataUrl(dataUrl, {
            title,
            text: shareText,
            fileName: 'padeluminatis_poster.png',
        });
        if (!ok) downloadDataUrl(dataUrl, 'padeluminatis_poster.png');
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
        eventFormat = 'Evento',
        registeredCount = 0,
        teamCount = 0,
        groupDraw = [],
        logo = '',
        played = [],
        scheduled = [],
        pending = [],
        standings = [],
    } = data;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1920;
    canvas.height = 1080;

    // === BACKGROUND (16:9) ===
    const grd = ctx.createLinearGradient(0, 0, 1920, 1080);
    grd.addColorStop(0, '#020617');
    grd.addColorStop(0.3, '#0a0f2b');
    grd.addColorStop(0.7, '#071b26');
    grd.addColorStop(1, '#020617');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 1920, 1080);

    // GRID Decorativo
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 1920; x += 60) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1080); ctx.stroke();
    }
    for (let y = 0; y <= 1080; y += 60) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1920, y); ctx.stroke();
    }

    // Logo opcional
    const logoImg = await loadImage(logo || 'imagenes/Logojafs.png');
    if (logoImg) {
        ctx.globalAlpha = 0.5;
        ctx.drawImage(logoImg, 1920 / 2 - 250, 1080 / 2 - 250, 500, 500);
        ctx.globalAlpha = 1;
    }

    // === HEADER ===
    ctx.textAlign = 'left';
    ctx.fillStyle = '#b8ff00';
    ctx.font = '900 36px Rajdhani';
    ctx.fillText('⚡ ESTADO DEL EVENTO', 80, 80);
    ctx.fillStyle = '#fff';
    ctx.font = '900 72px Rajdhani';
    ctx.fillText(String(eventName).toUpperCase().substring(0, 25), 80, 150);
    ctx.fillStyle = '#00d4ff';
    ctx.font = '800 28px Rajdhani';
    ctx.fillText(new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase(), 80, 200);

    // Layout configs
    function renderRoundedBlock(x, y, w, h, borderColor) {
        roundRect(ctx, x, y, w, h, 16, 'rgba(0,0,0,0.65)');
        ctx.lineWidth = 2;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
    }

    // COLUMNA 1: INFO GENERAL & CLASIFICACIÓN
    const c1X = 80;
    const cW = 540;
    renderRoundedBlock(c1X, 240, cW, 110, 'rgba(0, 212, 255, 0.25)');
    ctx.fillStyle = '#00d4ff'; ctx.font = '900 24px Rajdhani'; ctx.fillText('RESUMEN', c1X + 20, 280);
    ctx.fillStyle = '#fff'; ctx.font = '800 20px Rajdhani'; 
    ctx.fillText(`FMT: ${String(eventFormat).toUpperCase()}`, c1X + 20, 320);
    ctx.fillText(`EQUI: ${teamCount}`, c1X + 220, 320);
    ctx.fillText(`JUG: ${registeredCount}`, c1X + 400, 320);

    let c1Y = 380;
    if (standings.length) {
        ctx.fillStyle = '#b8ff00'; ctx.font = '900 28px Rajdhani'; ctx.fillText('📊 CLASIFICACIÓN', c1X, c1Y);
        c1Y += 30;
        standings.slice(0, 2).forEach(group => {
            const rowCount = Math.min(group.rows.length, 6);
            const boxH = 50 + (rowCount * 34);
            renderRoundedBlock(c1X, c1Y, cW, boxH, 'rgba(184, 255, 0, 0.3)');
            ctx.fillStyle = '#b8ff00'; ctx.font = '900 22px Rajdhani'; ctx.fillText(`GRUPO ${group.title.toUpperCase()}`, c1X + 20, c1Y + 30);
            ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '800 14px Rajdhani'; 
            ctx.fillText('EQUIPO', c1X + 20, c1Y + 50); ctx.fillText('PJ', c1X + 400, c1Y + 50); ctx.fillText('PTS', c1X + 480, c1Y + 50); 
            
            let rowY = c1Y + 80;
            group.rows.slice(0, 6).forEach((row, i) => {
                ctx.fillStyle = (i === 0) ? '#fbbf24' : '#fff';
                ctx.font = '800 18px Rajdhani'; 
                ctx.fillText(`${i+1}. ${String(row.teamName).toUpperCase().substring(0,20)}`, c1X + 20, rowY);
                ctx.fillText(row.pj, c1X + 400, rowY);
                ctx.fillStyle = (i < 2) ? '#b8ff00' : '#fff'; ctx.font = '900 20px Rajdhani';
                ctx.fillText(row.pts, c1X + 480, rowY); 
                rowY += 34;
            });
            c1Y += boxH + 20;
        });
    } else if (groupDraw.length) {
        ctx.fillStyle = '#fbbf24'; ctx.font = '900 28px Rajdhani'; ctx.fillText('SORTEO DE GRUPOS', c1X, c1Y); c1Y += 35;
        groupDraw.slice(0, 2).forEach(group => {
            const teams = Array.isArray(group.teams) ? group.teams.slice(0, 8) : [];
            const boxH = 50 + (Math.max(1, teams.length) * 28);
            renderRoundedBlock(c1X, c1Y, cW, boxH, 'rgba(251, 191, 36, 0.25)');
            ctx.fillStyle = '#fbbf24'; ctx.font = '900 22px Rajdhani'; ctx.fillText(String(group.title).toUpperCase(), c1X + 20, c1Y + 30);
            let rowY = c1Y + 65;
            ctx.fillStyle = '#fff'; ctx.font = '800 18px Rajdhani';
            teams.forEach((tName, i) => { ctx.fillText(`${i+1}. ${String(tName).toUpperCase()}`, c1X + 20, rowY); rowY += 28; });
            c1Y += boxH + 20;
        });
    }

    // COLUMNA 2: PARTIDOS JUGADOS O PROGRAMADOS
    const c2X = 660; 
    let c2Y = 120;
    if (played.length) {
        ctx.fillStyle = '#00d4ff'; ctx.font = '900 30px Rajdhani'; ctx.fillText('🏆 ÚLTIMOS RESULTADOS', c2X, c2Y); c2Y += 40;
        played.slice(0, 10).forEach(m => {
            renderRoundedBlock(c2X, c2Y, cW, 56, 'rgba(0, 212, 255, 0.2)');
            ctx.fillStyle = '#fff'; ctx.font = '800 18px Rajdhani'; 
            const nA = String(m.teamAName || 'A').substring(0, 15); const nB = String(m.teamBName || 'B').substring(0, 15);
            ctx.fillText(`${nA} vs ${nB}`, c2X + 20, c2Y + 35);
            ctx.textAlign = 'right'; ctx.fillStyle = '#00d4ff'; ctx.font = '900 22px Rajdhani'; 
            ctx.fillText(m.resultado || '-', c2X + cW - 20, c2Y + 36); ctx.textAlign = 'left';
            c2Y += 66;
        });
    }

    // COLUMNA 3: PROGRAMADOS / PENDIENTES
    const c3X = 1240;
    let c3Y = 120;
    if (scheduled.length) {
        ctx.fillStyle = '#ff0055'; ctx.font = '900 30px Rajdhani'; ctx.fillText('🗓️ PRÓXIMOS PARTIDOS', c3X, c3Y); c3Y += 40;
        scheduled.slice(0, 7).forEach(m => {
            renderRoundedBlock(c3X, c3Y, 600, 56, 'rgba(255, 0, 85, 0.2)');
            ctx.fillStyle = '#fff'; ctx.font = '800 18px Rajdhani'; 
            const nA = String(m.teamAName || 'A').substring(0, 16); const nB = String(m.teamBName || 'B').substring(0, 16);
            ctx.fillText(`${nA} vs ${nB}`, c3X + 20, c3Y + 35);
            ctx.textAlign = 'right'; ctx.fillStyle = '#ff0055'; ctx.font = '900 18px Rajdhani'; 
            ctx.fillText(m.fechaStr || 'FIJADO', c3X + 580, c3Y + 35); ctx.textAlign = 'left';
            c3Y += 66;
        });
    } else if (pending.length) {
        ctx.fillStyle = '#fbbf24'; ctx.font = '900 30px Rajdhani'; ctx.fillText('⏳ ENCUENTROS PENDIENTES', c3X, c3Y); c3Y += 40;
        pending.slice(0, 10).forEach(m => {
            renderRoundedBlock(c3X, c3Y, 600, 50, 'rgba(251, 191, 36, 0.2)');
            ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '700 16px Rajdhani'; 
            const nA = String(m.teamAName || 'A').substring(0, 18); const nB = String(m.teamBName || 'B').substring(0, 18);
            ctx.fillText(`${nA} vs ${nB}`, c3X + 20, c3Y + 32);
            ctx.textAlign = 'right'; ctx.fillStyle = '#fbbf24'; ctx.font = '700 15px Rajdhani'; 
            ctx.fillText('¡JUEGUEN!', c3X + 580, c3Y + 32); ctx.textAlign = 'left';
            c3Y += 60;
        });
    }

    // === FOOTER COMPLETO 16:9 ===
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b8ff00'; ctx.font = '900 32px Rajdhani'; 
    ctx.fillText(String(organizer).toUpperCase(), 1920/2, 1010);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '500 18px Rajdhani'; 
    ctx.fillText('PADELUMINATIS APPS · MANTÉN PRESIONADO PARA COMPARTIR O GUARDAR', 1920/2, 1045);

    const dataUrl = canvas.toDataURL('image/png', 0.95);
    return await downloadDataUrl(dataUrl, `estado_${eventName.toLowerCase().replace(/\s+/g, '_')}.png`);
}

export async function downloadDataUrl(url, filename) {
    if (isNativeApp()) {
        const saved = await saveImageToNativeDevice(url, filename);
        if (saved) return true;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
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



