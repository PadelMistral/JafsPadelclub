function isNativeApp() {
  try {
    const cap = window.Capacitor;
    if (!cap) return false;
    if (typeof cap.isNativePlatform === "function") return !!cap.isNativePlatform();
    const platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : "";
    return platform === "android" || platform === "ios";
  } catch {
    return false;
  }
}

function dataUrlToBase64(dataUrl) {
  return String(dataUrl || "").split(",")[1] || "";
}

function getNativePlugins() {
  try {
    return {
      Filesystem: window.Capacitor?.Plugins?.Filesystem || null,
      Share: window.Capacitor?.Plugins?.Share || null,
    };
  } catch {
    return { Filesystem: null, Share: null };
  }
}

async function dataUrlToFile(dataUrl, fileName = "padeluminatis_share.png") {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: "image/png" });
}

function roundRect(ctx, x, y, width, height, radius, fillStyle) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function drawBrandFooter(ctx, width, height, club = "JAFS PADEL CLUB") {
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.textAlign = "center";
  ctx.font = "700 18px Rajdhani, sans-serif";
  ctx.fillText(club, width / 2, height - 40);
}

function drawCourtLines(ctx, width, height, alpha = 0.08) {
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = 2;
  const marginX = width * 0.14;
  const top = height * 0.18;
  const courtH = height * 0.62;
  const courtW = width - marginX * 2;
  ctx.strokeRect(marginX, top, courtW, courtH);
  ctx.beginPath();
  ctx.moveTo(width / 2, top);
  ctx.lineTo(width / 2, top + courtH);
  ctx.moveTo(marginX, top + courtH / 2);
  ctx.lineTo(width - marginX, top + courtH / 2);
  ctx.stroke();
  ctx.restore();
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function shareImageDataUrl(dataUrl, { title, text, fileName } = {}) {
  const file = await dataUrlToFile(dataUrl, fileName || "padeluminatis.png");
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({ title, text, files: [file] });
      return true;
    } catch {}
  }

  if (isNativeApp()) {
    const { Filesystem, Share } = getNativePlugins();
    if (Filesystem?.writeFile && Share?.share) {
      try {
        const saved = await Filesystem.writeFile({
          path: fileName || "padeluminatis.png",
          data: dataUrlToBase64(dataUrl),
          directory: "CACHE",
        });
        await Share.share({
          title,
          text,
          url: saved?.uri,
          dialogTitle: "Compartir imagen",
        });
        return true;
      } catch {}
    }
  }
  return false;
}

export async function downloadDataUrl(url, filename = "padeluminatis.png") {
  if (isNativeApp()) {
    const { Filesystem, Share } = getNativePlugins();
    if (Filesystem?.writeFile && Share?.share) {
      try {
        const saved = await Filesystem.writeFile({
          path: `${Date.now()}_${filename}`,
          data: dataUrlToBase64(url),
          directory: "CACHE",
          recursive: true,
        });
        await Share.share({
          title: "Guardar o compartir",
          text: "Puedes guardarlo o compartirlo desde tu móvil.",
          url: saved?.uri,
          dialogTitle: "Guardar o compartir",
        });
        return true;
      } catch {}
    }
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

export async function generateMatchShareImage(analysis = {}, matchData = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 1080;
  canvas.height = 1080;

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#020617");
  grad.addColorStop(1, "#07111f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawCourtLines(ctx, canvas.width, canvas.height, 0.06);

  const logo = await loadImage(matchData.logoUrl || "imagenes/Logojafs.png");
  if (logo) ctx.drawImage(logo, 490, 48, 100, 100);

  ctx.fillStyle = "#b8ff00";
  ctx.textAlign = "center";
  ctx.font = "900 42px Rajdhani, sans-serif";
  ctx.fillText("RESULTADO FINAL", 540, 200);

  ctx.fillStyle = "#ffffff";
  ctx.font = "italic 900 148px Rajdhani, sans-serif";
  ctx.fillText(analysis.sets || matchData.sets || "6-4 6-4", 540, 420);

  const teamA = (matchData.teamA || []).map((p) => (typeof p === "object" ? p.name : p)).filter(Boolean);
  const teamB = (matchData.teamB || []).map((p) => (typeof p === "object" ? p.name : p)).filter(Boolean);
  const winnerKey = String(matchData.winner || "").toUpperCase();

  roundRect(ctx, 90, 580, 380, 180, 24, winnerKey === "A" ? "rgba(184,255,0,0.1)" : "rgba(255,255,255,0.04)");
  roundRect(ctx, 610, 580, 380, 180, 24, winnerKey === "B" ? "rgba(184,255,0,0.1)" : "rgba(255,255,255,0.04)");
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 34px Rajdhani, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText((teamA[0] || "Pareja 1").toUpperCase(), 280, 655);
  ctx.fillText((teamA[1] || "").toUpperCase(), 280, 710);
  ctx.fillText((teamB[0] || "Pareja 2").toUpperCase(), 800, 655);
  ctx.fillText((teamB[1] || "").toUpperCase(), 800, 710);
  ctx.fillStyle = "#00d4ff";
  ctx.font = "900 40px Rajdhani, sans-serif";
  ctx.fillText("VS", 540, 685);

  drawBrandFooter(ctx, canvas.width, canvas.height, matchData.club || "JAFS PADEL CLUB");
  return canvas.toDataURL("image/png");
}

export async function shareMatchResult(analysis = {}, matchData = {}) {
  const dataUrl = await generateMatchShareImage(analysis, matchData);
  const delta = Number(analysis.delta || 0);
  const shareText = `Resultado en Padeluminatis. ${delta >= 0 ? "He ganado" : "He perdido"} ${Math.abs(delta)} puntos.`;
  const ok = await shareImageDataUrl(dataUrl, {
    title: "Mi resultado",
    text: shareText,
    fileName: "padeluminatis_resultado.png",
  });
  if (!ok) await downloadDataUrl(dataUrl, "padeluminatis_resultado.png");
  return ok;
}

export async function generateMatchPosterImage(matchData = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 1080;
  canvas.height = 1350;

  const isPlayed = Boolean(matchData.sets || matchData.winner);
  const accentColor = isPlayed ? "#b8ff00" : "#00d4ff";
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#020617");
  grad.addColorStop(1, "#07111f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawCourtLines(ctx, canvas.width, canvas.height, 0.08);

  const logo = await loadImage(matchData.logoUrl || "imagenes/Logojafs.png");
  if (logo) ctx.drawImage(logo, 64, 54, 100, 100);

  ctx.textAlign = "left";
  ctx.fillStyle = accentColor;
  ctx.font = "900 48px Rajdhani, sans-serif";
  ctx.fillText("JAFS PADEL CLUB", 190, 104);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "700 20px Rajdhani, sans-serif";
  ctx.fillText((isPlayed ? "RESULTADO FINAL" : String(matchData.title || "PRÓXIMO PARTIDO")).toUpperCase(), 192, 142);

  roundRect(ctx, 60, 230, 960, 160, 24, "rgba(255,255,255,0.03)");
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(60, 230, 960, 160);

  ctx.textAlign = "center";
  if (isPlayed) {
    ctx.fillStyle = "#ffffff";
    ctx.font = "italic 900 108px Rajdhani, sans-serif";
    ctx.fillText(matchData.sets || "Finalizado", 540, 338);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 44px Rajdhani, sans-serif";
    ctx.fillText(String(matchData.when || "POR CONFIRMAR").toUpperCase(), 540, 324);
  }

  const teamA = Array.isArray(matchData.teamA) ? matchData.teamA : [];
  const teamB = Array.isArray(matchData.teamB) ? matchData.teamB : [];
  const winnerKey = String(matchData.winner || "").toUpperCase();
  const isWinnerA = winnerKey === "A" || winnerKey === "1";
  const isWinnerB = winnerKey === "B" || winnerKey === "2";

  roundRect(ctx, 60, 440, 440, 320, 24, isWinnerA ? "rgba(184,255,0,0.08)" : "rgba(255,255,255,0.03)");
  roundRect(ctx, 580, 440, 440, 320, 24, isWinnerB ? "rgba(184,255,0,0.08)" : "rgba(255,255,255,0.03)");

  ctx.textAlign = "center";
  ctx.fillStyle = isWinnerA ? "#b8ff00" : "rgba(255,255,255,0.4)";
  ctx.font = "900 18px Rajdhani, sans-serif";
  ctx.fillText("PAREJA 1", 280, 490);
  ctx.fillStyle = isWinnerB ? "#b8ff00" : "rgba(255,255,255,0.4)";
  ctx.fillText("PAREJA 2", 800, 490);

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 42px Rajdhani, sans-serif";
  ctx.fillText(String(teamA[0] || "Jugador 1").toUpperCase(), 280, 585);
  ctx.fillText(String(teamA[1] || "").toUpperCase(), 280, 640);
  ctx.fillText(String(teamB[0] || "Jugador 3").toUpperCase(), 800, 585);
  ctx.fillText(String(teamB[1] || "").toUpperCase(), 800, 640);

  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(540, 598, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#020617";
  ctx.font = "900 40px Rajdhani, sans-serif";
  ctx.fillText("VS", 540, 614);

  drawBrandFooter(ctx, canvas.width, canvas.height, matchData.club || "JAFS PADEL CLUB");
  return canvas.toDataURL("image/png");
}

export async function shareMatchPoster(matchData = {}) {
  try {
    const dataUrl = await generateMatchPosterImage(matchData);
    const title = String(matchData.title || "Cartel Padeluminatis");
    const when = String(matchData.when || "").trim();
    const shareText = when ? `${title}. ${when}` : `${title} en Padeluminatis`;
    const ok = await shareImageDataUrl(dataUrl, {
      title,
      text: shareText,
      fileName: "padeluminatis_poster.png",
    });
    if (!ok) await downloadDataUrl(dataUrl, "padeluminatis_poster.png");
    return true;
  } catch (err) {
    console.error("Poster build fail", err);
    return false;
  }
}
