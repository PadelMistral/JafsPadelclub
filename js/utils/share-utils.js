/**
 * PADELUMINATIS SHARE UTILS V2.0
 * Premium match poster with betting odds, player levels, and padel court background.
 */

export async function generateMatchShareImage(analysis, matchData = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1080;
    canvas.height = 1080;

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 1080);
    grad.addColorStop(0, '#0a1628');
    grad.addColorStop(1, '#020610');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1080);

    // Court lines
    drawCourtLines(ctx, 1080, 1080, 0.06);

    // Logo
    const logo = await loadImage(matchData.logoUrl || 'imagenes/Logojafs.png');
    if (logo) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(logo, 1080 - 160, 60, 100, 100);
        ctx.globalAlpha = 1;
    }

    // Header
    ctx.fillStyle = '#b8ff00';
    ctx.font = '900 42px Rajdhani';
    ctx.textAlign = 'left';
    ctx.fillText('MISIÓN COMPLETADA', 80, 120);

    // Subtitle
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '700 18px Rajdhani';
    ctx.fillText('RESULTADO OFICIAL', 82, 150);

    // Score big
    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 900 130px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(analysis.sets || '6-4 6-3', 540, 310);

    // Delta card
    const delta = analysis.delta || 0;
    roundRect(ctx, 200, 370, 680, 200, 30, 'rgba(255,255,255,0.04)');
    ctx.fillStyle = delta >= 0 ? '#b8ff00' : '#ff3b3b';
    ctx.font = '900 160px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(`${delta >= 0 ? '+' : ''}${delta}`, 540, 530);

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '900 22px Rajdhani';
    ctx.fillText('PUNTOS ELO', 540, 560);

    // Stats row
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 36px Rajdhani';
    ctx.textAlign = 'left';
    ctx.fillText(`ELO: ${analysis.pointsAfter || '---'}`, 140, 660);
    ctx.textAlign = 'right';
    ctx.fillText(`DIVISION: ${analysis.levelBand || 'ORO'}`, 940, 660);

    // Players
    const players = Array.isArray(matchData.players) ? matchData.players : [];
    if (players.length) {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '700 26px Rajdhani';
        const pLine = players.slice(0, 4).map(p => String(p || '').toUpperCase()).join('  ·  ');
        ctx.fillText(pLine, 540, 730);
    }

    // Footer
    drawBrandFooter(ctx, 1080, 1080, matchData.club || 'PADELUMINATIS CLUB');

    return canvas.toDataURL('image/png');
}

export async function shareMatchResult(analysis, matchData) {
    const dataUrl = await generateMatchShareImage(analysis, matchData);
    if (navigator.share) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'mision_padel.png', { type: 'image/png' });
        try {
            await navigator.share({ title: 'Mi Resultado Padeluminatis', text: `Misión completada. ${analysis.delta >= 0 ? 'Gané' : 'Perdí'} ${Math.abs(analysis.delta)} puntos.`, files: [file] });
            return true;
        } catch (e) { downloadDataUrl(dataUrl, 'mision_padel.png'); }
    } else { downloadDataUrl(dataUrl, 'mision_padel.png'); }
}

// ──────────────────────────────────────────────────
// MATCH POSTER V2 — With betting odds & player levels
// ──────────────────────────────────────────────────
export async function generateMatchPosterImage(matchData = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1080;
    canvas.height = 1350;

    // === 1. BACKGROUND — Deep sport gradient ===
    const grad = ctx.createLinearGradient(0, 0, 0, 1350);
    grad.addColorStop(0, '#040c1e');
    grad.addColorStop(0.3, '#0a1832');
    grad.addColorStop(0.7, '#0c1a2e');
    grad.addColorStop(1, '#030810');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1350);

    // === 2. PADEL COURT BACKGROUND (realistic) ===
    drawCourtLines(ctx, 1080, 1350, 0.04);
    // Extra court center circle
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(540, 650, 180, 0, Math.PI * 2);
    ctx.stroke();

    // === 3. DIAGONAL SPORT STRIPES ===
    ctx.save();
    // Cyan stripe
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#00d4ff';
    ctx.beginPath();
    ctx.moveTo(-60, 160); ctx.lineTo(1140, 80); ctx.lineTo(1140, 130); ctx.lineTo(-60, 210);
    ctx.closePath(); ctx.fill();
    // Lime stripe
    ctx.fillStyle = '#b8ff00';
    ctx.beginPath();
    ctx.moveTo(-60, 215); ctx.lineTo(1140, 135); ctx.lineTo(1140, 175); ctx.lineTo(-60, 255);
    ctx.closePath(); ctx.fill();
    // Bottom accent
    ctx.fillStyle = '#00d4ff';
    ctx.beginPath();
    ctx.moveTo(-60, 1180); ctx.lineTo(1140, 1130); ctx.lineTo(1140, 1160); ctx.lineTo(-60, 1210);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // === 4. LOGO ===
    const logo = await loadImage(matchData.logoUrl || 'imagenes/Logojafs.png');
    if (logo) {
        ctx.globalAlpha = 0.95;
        ctx.drawImage(logo, 870, 40, 130, 130);
        ctx.globalAlpha = 1;
    }

    // === 5. HEADER ===
    ctx.fillStyle = '#b8ff00';
    ctx.font = '900 52px Rajdhani';
    ctx.textAlign = 'left';
    ctx.fillText('PADELUMINATIS', 70, 105);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '700 18px Rajdhani';
    ctx.letterSpacing = '4px';
    ctx.fillText((matchData.title || 'PRÓXIMO PARTIDO').toUpperCase(), 72, 135);

    // === 6. DATE/TIME BAR ===
    const meta = matchData.when || 'HORA POR CONFIRMAR';
    roundRect(ctx, 60, 290, 960, 60, 14, 'rgba(0,180,255,0.08)');
    ctx.strokeStyle = 'rgba(0,180,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 24px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText('📅  ' + meta.toUpperCase(), 540, 330);

    // === 7. TEAMS LAYOUT ===
    const teamA = Array.isArray(matchData.teamA) ? matchData.teamA : [];
    const teamB = Array.isArray(matchData.teamB) ? matchData.teamB : [];
    const levelA = matchData.levelsA || [];
    const levelB = matchData.levelsB || [];
    const trim = (s = "") => String(s).trim().slice(0, 22);

    // Team A panel
    roundRect(ctx, 60, 400, 440, 280, 20, 'rgba(0,180,255,0.05)');
    ctx.strokeStyle = 'rgba(0,212,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Team A — Cyan accent top
    ctx.fillStyle = '#00d4ff';
    ctx.fillRect(60, 400, 440, 4);

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,212,255,0.5)';
    ctx.font = '900 14px Rajdhani';
    ctx.fillText('EQUIPO A', 280, 435);

    const nameA1 = trim(teamA[0] || 'JUGADOR 1');
    const nameA2 = trim(teamA[1] || '');
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 42px Rajdhani';
    ctx.fillText(nameA1.toUpperCase(), 280, 500);
    if (nameA2) {
        ctx.font = '700 32px Rajdhani';
        ctx.fillText(nameA2.toUpperCase(), 280, 545);
    }

    // Levels A
    if (levelA.length) {
        ctx.fillStyle = '#b8ff00';
        ctx.font = '900 20px Rajdhani';
        const lvlTextA = levelA.map((l, i) => `NV ${Number(l || 0).toFixed(1)}`).join('  ·  ');
        ctx.fillText(lvlTextA, 280, 595);
    }

    // Team B panel
    roundRect(ctx, 580, 400, 440, 280, 20, 'rgba(255,140,0,0.04)');
    ctx.strokeStyle = 'rgba(255,140,0,0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Team B — Orange accent top
    ctx.fillStyle = '#ff8c00';
    ctx.fillRect(580, 400, 440, 4);

    ctx.fillStyle = 'rgba(255,140,0,0.5)';
    ctx.font = '900 14px Rajdhani';
    ctx.fillText('EQUIPO B', 800, 435);

    const nameB1 = trim(teamB[0] || 'JUGADOR 3');
    const nameB2 = trim(teamB[1] || '');
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 42px Rajdhani';
    ctx.fillText(nameB1.toUpperCase(), 800, 500);
    if (nameB2) {
        ctx.font = '700 32px Rajdhani';
        ctx.fillText(nameB2.toUpperCase(), 800, 545);
    }

    // Levels B
    if (levelB.length) {
        ctx.fillStyle = '#ff8c00';
        ctx.font = '900 20px Rajdhani';
        const lvlTextB = levelB.map((l, i) => `NV ${Number(l || 0).toFixed(1)}`).join('  ·  ');
        ctx.fillText(lvlTextB, 800, 595);
    }

    // === 8. VS BADGE — Premium circular ===
    // Outer glow
    const vsGrad = ctx.createRadialGradient(540, 540, 0, 540, 540, 70);
    vsGrad.addColorStop(0, 'rgba(0,212,255,0.2)');
    vsGrad.addColorStop(1, 'rgba(0,212,255,0)');
    ctx.fillStyle = vsGrad;
    ctx.beginPath();
    ctx.arc(540, 540, 70, 0, Math.PI * 2);
    ctx.fill();
    // Circle
    ctx.fillStyle = '#00d4ff';
    ctx.beginPath();
    ctx.arc(540, 540, 48, 0, Math.PI * 2);
    ctx.fill();
    // Text
    ctx.fillStyle = '#040c1e';
    ctx.font = '900 36px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText('VS', 540, 554);

    // === 9. BETTING ODDS / WIN PROBABILITY ===
    const avgA = levelA.length ? levelA.reduce((a, b) => a + Number(b || 0), 0) / levelA.length : 2.5;
    const avgB = levelB.length ? levelB.reduce((a, b) => a + Number(b || 0), 0) / levelB.length : 2.5;
    const totalLvl = avgA + avgB;
    const pctA = totalLvl > 0 ? Math.round((avgA / totalLvl) * 100) : 50;
    const pctB = 100 - pctA;

    if (levelA.length || levelB.length) {
        // Odds card
        roundRect(ctx, 140, 730, 800, 140, 20, 'rgba(255,255,255,0.03)');
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '900 14px Rajdhani';
        ctx.textAlign = 'center';
        ctx.fillText('⚡ PRONÓSTICO BASADO EN NIVEL', 540, 765);

        // Bar background
        roundRect(ctx, 200, 785, 680, 28, 14, 'rgba(255,255,255,0.06)');

        // Team A bar (cyan)
        const barW = 680;
        const barAW = Math.max(40, (pctA / 100) * barW);
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(200, 785, barAW, 28, pctA >= 98 ? 14 : [14, 0, 0, 14]);
        else ctx.rect(200, 785, barAW, 28);
        ctx.clip();
        const barGradA = ctx.createLinearGradient(200, 0, 200 + barAW, 0);
        barGradA.addColorStop(0, '#00d4ff');
        barGradA.addColorStop(1, '#0090ff');
        ctx.fillStyle = barGradA;
        ctx.fillRect(200, 785, barAW, 28);
        ctx.restore();

        // Team B bar (orange) — fill rest
        ctx.save();
        ctx.beginPath();
        const barBStart = 200 + barAW;
        const barBW = barW - barAW;
        if (ctx.roundRect) ctx.roundRect(barBStart, 785, barBW, 28, pctB >= 98 ? 14 : [0, 14, 14, 0]);
        else ctx.rect(barBStart, 785, barBW, 28);
        ctx.clip();
        const barGradB = ctx.createLinearGradient(barBStart, 0, 880, 0);
        barGradB.addColorStop(0, '#ff8c00');
        barGradB.addColorStop(1, '#ff5500');
        ctx.fillStyle = barGradB;
        ctx.fillRect(barBStart, 785, barBW, 28);
        ctx.restore();

        // Percentages
        ctx.fillStyle = '#00d4ff';
        ctx.font = '900 40px Rajdhani';
        ctx.textAlign = 'left';
        ctx.fillText(`${pctA}%`, 200, 862);

        ctx.fillStyle = '#ff8c00';
        ctx.textAlign = 'right';
        ctx.fillText(`${pctB}%`, 880, 862);
    }

    // === 10. PISTA DE PADEL ILLUSTRATION (bottom) ===
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    // Court box
    ctx.strokeRect(240, 920, 600, 320);
    // Center line
    ctx.beginPath();
    ctx.moveTo(540, 920); ctx.lineTo(540, 1240);
    ctx.stroke();
    // Service boxes
    ctx.beginPath();
    ctx.moveTo(240, 1080); ctx.lineTo(840, 1080);
    ctx.stroke();
    // Service lines
    ctx.beginPath();
    ctx.moveTo(390, 920); ctx.lineTo(390, 1080);
    ctx.moveTo(690, 920); ctx.lineTo(690, 1080);
    ctx.moveTo(390, 1080); ctx.lineTo(390, 1240);
    ctx.moveTo(690, 1080); ctx.lineTo(690, 1240);
    ctx.stroke();
    ctx.restore();

    // === 11. FOOTER ===
    drawBrandFooter(ctx, 1080, 1350, matchData.club || 'PADELUMINATIS CLUB');

    return canvas.toDataURL('image/png');
}

export async function shareMatchPoster(matchData = {}) {
    const dataUrl = await generateMatchPosterImage(matchData);
    if (navigator.share) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'cartel_partido.png', { type: 'image/png' });
        try {
            await navigator.share({ title: 'Próximo Partido Padeluminatis', text: 'Ya está listo el cartel del partido.', files: [file] });
            return true;
        } catch (e) {
            console.warn('Sharing failed', e);
            downloadDataUrl(dataUrl, 'cartel_partido.png');
        }
    } else {
        downloadDataUrl(dataUrl, 'cartel_partido.png');
    }
    return false;
}

// ─── HELPERS ───

function drawCourtLines(ctx, w, h, opacity = 0.04) {
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${opacity})`;
    ctx.lineWidth = 2;
    // Outer court
    const margin = 100;
    ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);
    // Center vertical
    ctx.beginPath();
    ctx.moveTo(w / 2, margin); ctx.lineTo(w / 2, h - margin);
    ctx.stroke();
    // Center horizontal
    ctx.beginPath();
    ctx.moveTo(margin, h / 2); ctx.lineTo(w - margin, h / 2);
    ctx.stroke();
    // Service line vertical
    ctx.lineWidth = 1;
    const quarter = (w - margin * 2) / 4;
    ctx.beginPath();
    ctx.moveTo(margin + quarter, margin); ctx.lineTo(margin + quarter, h - margin);
    ctx.moveTo(w - margin - quarter, margin); ctx.lineTo(w - margin - quarter, h - margin);
    ctx.stroke();
    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r, fillColor) {
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(x, y, w, h, r);
    } else {
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
    }
    ctx.closePath();
    if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fill();
    }
}

function drawBrandFooter(ctx, w, h, club) {
    ctx.fillStyle = '#b8ff00';
    ctx.font = '900 28px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(club.toUpperCase(), w / 2, h - 55);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '500 16px Rajdhani';
    ctx.fillText('PADELUMINATIS PRO · COMPARTE EN INSTAGRAM O WHATSAPP', w / 2, h - 25);
}

function downloadDataUrl(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
}

function loadImage(src) {
    return new Promise((resolve) => {
        if (!src) return resolve(null);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}
