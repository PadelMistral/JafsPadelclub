/**
 * PADELUMINATIS SHARE UTILS V1
 * Generates beautiful match summary images using HTML5 Canvas.
 */

export async function generateMatchShareImage(analysis, matchData = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Set dimensions (1080x1080 for Instagram/WhatsApp)
    canvas.width = 1080;
    canvas.height = 1080;
    
    // 1. Background (Deep Gradient)
    const grad = ctx.createLinearGradient(0, 0, 0, 1080);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#020617');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1080);

    // Optional logo
    const logo = await loadImage(matchData.logoUrl || 'imagenes/Logojafs.png');
    if (logo) {
        const size = 96;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(logo, 1080 - size - 70, 90, size, size);
        ctx.globalAlpha = 1;
    }
    
    // 2. Court Accents (Padel Lines)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 4;
    ctx.strokeRect(80, 80, 920, 920);
    ctx.beginPath();
    ctx.moveTo(80, 540); ctx.lineTo(1000, 540);
    ctx.moveTo(540, 80); ctx.lineTo(540, 1000);
    ctx.stroke();
    
    // 3. Header Text
    ctx.fillStyle = '#c6ff00';
    ctx.font = 'bold 40px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText('MISION COMPLETADA', 540, 180);
    
    // 4. Result
    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 900 120px Rajdhani';
    ctx.fillText(analysis.sets || '6-4 6-3', 540, 320);
    
    // 5. Player Stats (Center)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.roundRect ? ctx.roundRect(140, 400, 800, 400, 40) : ctx.fillRect(140, 400, 800, 400);
    ctx.fill();
    
    // 6. Rating Delta
    const delta = analysis.delta || 0;
    ctx.fillStyle = delta >= 0 ? '#c6ff00' : '#ff4444';
    ctx.font = '900 180px Rajdhani';
    ctx.fillText(`${delta >= 0 ? '+' : ''}${delta}`, 540, 580);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '700 30px Inter';
    ctx.fillText('PUNTOS RANKING', 540, 630);
    
    // 7. New Rating & Level
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 50px Inter';
    ctx.textAlign = 'left';
    ctx.fillText(`NUEVO RATING: ${analysis.pointsAfter}`, 180, 740);
    
    ctx.textAlign = 'right';
    ctx.fillText(`DIVISION: ${analysis.levelBand || 'ORO'}`, 900, 740);
    // 8. Players (if provided)
    const players = Array.isArray(matchData.players) ? matchData.players : [];
    if (players.length) {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = '700 28px Rajdhani';
        const pLine = players.slice(0, 4).map(p => String(p || '').toUpperCase()).join('  ·  ');
        ctx.fillText(pLine, 540, 820);
    }

    
    // 8. Footer (Brand)
    ctx.fillStyle = '#c6ff00';
    ctx.font = 'bold 30px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('PADELUMINATIS CLUB', 540, 950);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '500 20px Inter';
    ctx.fillText('Sincronizado via Padeluminatis PWA', 540, 990);
    
    // 9. Logo placeholder (Optional: Add real logo)
    // For now we just use a star icon or similar
    
    return canvas.toDataURL('image/png');
}

export async function shareMatchResult(analysis, matchData) {
    const dataUrl = await generateMatchShareImage(analysis, matchData);
    
    if (navigator.share) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'mision_padel.png', { type: 'image/png' });
        
        try {
            await navigator.share({
                title: 'Mi Resultado Padeluminatis',
                text: `Mision completada. Gane ${analysis.delta} puntos en mi ultimo partido.`,
                files: [file]
            });
            return true;
        } catch (e) {
            console.warn('Sharing failed', e);
            downloadDataUrl(dataUrl, 'mision_padel.png');
        }
    } else {
        downloadDataUrl(dataUrl, 'mision_padel.png');
    }
}


export async function generateMatchPosterImage(matchData = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1080;
    canvas.height = 1080;

    const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1080);

    // Optional logo
    const logo = await loadImage(matchData.logoUrl || 'imagenes/Logojafs.png');
    if (logo) {
        const size = 110;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(logo, 90, 90, size, size);
        ctx.globalAlpha = 1;
    }

    // Court grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 3;
    ctx.strokeRect(90, 120, 900, 840);
    ctx.beginPath();
    ctx.moveTo(90, 540); ctx.lineTo(990, 540);
    ctx.moveTo(540, 120); ctx.lineTo(540, 960);
    ctx.stroke();

    // Header
    ctx.fillStyle = '#c6ff00';
    ctx.font = 'bold 38px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(matchData.title || 'PROXIMO PARTIDO', 540, 160);

    // Teams
    const teamA = Array.isArray(matchData.teamA) ? matchData.teamA : [];
    const teamB = Array.isArray(matchData.teamB) ? matchData.teamB : [];
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 56px Rajdhani';
    ctx.fillText(teamA.join('  · ').toUpperCase() || 'EQUIPO A', 540, 380);
    ctx.fillStyle = '#00d4ff';
    ctx.font = '900 64px Rajdhani';
    ctx.fillText('VS', 540, 470);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 56px Rajdhani';
    ctx.fillText(teamB.join('  · ').toUpperCase() || 'EQUIPO B', 540, 570);

    // Meta
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '700 28px Rajdhani';
    ctx.fillText(matchData.when || 'HORA POR CONFIRMAR', 540, 700);

    // Footer
    ctx.fillStyle = '#c6ff00';
    ctx.font = 'bold 30px Inter';
    ctx.fillText(matchData.club || 'PADELUMINATIS CLUB', 540, 950);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '500 20px Inter';
    ctx.fillText('Comparte en Instagram o WhatsApp', 540, 990);

    return canvas.toDataURL('image/png');
}

export async function shareMatchPoster(matchData = {}) {
    const dataUrl = await generateMatchPosterImage(matchData);
    if (navigator.share) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'cartel_partido.png', { type: 'image/png' });
        try {
            await navigator.share({
                title: 'Proximo Partido Padeluminatis',
                text: 'Ya esta listo el cartel del partido.',
                files: [file]
            });
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

