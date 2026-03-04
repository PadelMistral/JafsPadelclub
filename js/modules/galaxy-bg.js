/* =====================================================
   PADELUMINATIS GALAXY BACKGROUND V7.0
   Ultra-premium cosmic field with deep nebulae,
   layered parallax stars, aurora bands, and shooting stars.
   ===================================================== */

export function initGalaxyBackground() {
  const bg = document.querySelector(".sport-bg");
  if (!bg || bg.dataset.initialized) return;
  bg.dataset.initialized = "true";

  // Inject galaxy styles if not already present
  if (!document.getElementById('galaxy-v7-styles')) {
    const style = document.createElement('style');
    style.id = 'galaxy-v7-styles';
    style.textContent = `
      .sport-bg {
        position: fixed;
        inset: 0;
        z-index: -1;
        background: radial-gradient(ellipse at 20% 50%, #0a0e27 0%, #020617 50%, #000108 100%);
        overflow: hidden;
      }
      .starfield { position: absolute; inset: 0; pointer-events: none; }
      .star-layer { position: absolute; inset: 0; }

      .star {
        position: absolute;
        border-radius: 50%;
        animation: starTwinkle var(--duration, 4s) var(--delay, 0s) ease-in-out infinite alternate;
      }
      .star.tiny { width: 1px; height: 1px; background: rgba(200,220,255,0.5); }
      .star.small { width: 1.5px; height: 1.5px; background: rgba(200,220,255,0.6); }
      .star.medium { width: 2px; height: 2px; background: rgba(220,230,255,0.7); box-shadow: 0 0 3px rgba(200,220,255,0.3); }
      .star.large { width: 3px; height: 3px; background: rgba(240,245,255,0.85); box-shadow: 0 0 6px rgba(200,220,255,0.4); }

      .star.colored-cyan { background: rgba(0,212,255,0.8) !important; box-shadow: 0 0 8px rgba(0,212,255,0.5) !important; }
      .star.colored-purple { background: rgba(168,85,247,0.8) !important; box-shadow: 0 0 8px rgba(168,85,247,0.4) !important; }
      .star.colored-gold { background: rgba(250,204,21,0.8) !important; box-shadow: 0 0 8px rgba(250,204,21,0.4) !important; }
      .star.colored-emerald { background: rgba(52,211,153,0.8) !important; box-shadow: 0 0 8px rgba(52,211,153,0.4) !important; }
      .star.colored-ruby { background: rgba(248,113,113,0.8) !important; box-shadow: 0 0 8px rgba(248,113,113,0.4) !important; }
      .star.colored-lime { background: rgba(198,255,0,0.8) !important; box-shadow: 0 0 8px rgba(198,255,0,0.4) !important; }

      @keyframes starTwinkle {
        0% { opacity: 0.3; transform: scale(0.8); }
        50% { opacity: 1; transform: scale(1.2); }
        100% { opacity: 0.4; transform: scale(0.9); }
      }

      .cosmic-dust {
        position: absolute;
        inset: 0;
        background: 
          radial-gradient(circle at 15% 85%, rgba(0,212,255,0.04) 0%, transparent 50%),
          radial-gradient(circle at 85% 15%, rgba(168,85,247,0.04) 0%, transparent 50%),
          radial-gradient(circle at 50% 50%, rgba(198,255,0,0.02) 0%, transparent 60%);
        pointer-events: none;
      }

      .nebula {
        position: absolute;
        border-radius: 50%;
        filter: blur(80px);
        pointer-events: none;
        animation: nebulaFloat 30s ease-in-out infinite alternate;
      }
      .nebula-1 {
        width: 500px; height: 400px;
        top: -10%; left: -5%;
        background: radial-gradient(ellipse, rgba(0,212,255,0.08) 0%, rgba(59,130,246,0.04) 40%, transparent 70%);
      }
      .nebula-2 {
        width: 600px; height: 500px;
        bottom: -15%; right: -10%;
        background: radial-gradient(ellipse, rgba(168,85,247,0.07) 0%, rgba(236,72,153,0.03) 40%, transparent 70%);
        animation-delay: -10s;
      }
      .nebula-3 {
        width: 400px; height: 350px;
        top: 40%; left: 30%;
        background: radial-gradient(ellipse, rgba(198,255,0,0.04) 0%, rgba(52,211,153,0.02) 40%, transparent 70%);
        animation-delay: -20s;
      }
      .nebula-4 {
        width: 450px; height: 350px;
        top: 10%; right: 20%;
        background: radial-gradient(ellipse, rgba(250,204,21,0.04) 0%, rgba(255,159,67,0.02) 40%, transparent 70%);
        animation-delay: -15s;
      }

      @keyframes nebulaFloat {
        0% { transform: translate(0, 0) scale(1); opacity: 0.7; }
        33% { transform: translate(20px, -15px) scale(1.05); opacity: 1; }
        66% { transform: translate(-15px, 10px) scale(0.95); opacity: 0.8; }
        100% { transform: translate(10px, -5px) scale(1.02); opacity: 0.9; }
      }

      .aurora-band {
        position: absolute;
        width: 200%;
        height: 2px;
        left: -50%;
        opacity: 0;
        animation: auroraGlow 8s ease-in-out infinite;
        pointer-events: none;
      }
      .aurora-band-1 {
        top: 25%;
        background: linear-gradient(90deg, transparent 0%, rgba(0,212,255,0.15) 30%, rgba(168,85,247,0.1) 50%, rgba(0,212,255,0.15) 70%, transparent 100%);
        animation-delay: 0s;
      }
      .aurora-band-2 {
        top: 55%;
        background: linear-gradient(90deg, transparent 0%, rgba(198,255,0,0.1) 25%, rgba(52,211,153,0.08) 50%, rgba(198,255,0,0.1) 75%, transparent 100%);
        animation-delay: -4s;
      }
      .aurora-band-3 {
        top: 75%;
        background: linear-gradient(90deg, transparent 0%, rgba(236,72,153,0.08) 30%, rgba(168,85,247,0.06) 50%, rgba(250,204,21,0.08) 70%, transparent 100%);
        animation-delay: -2s;
      }

      @keyframes auroraGlow {
        0%, 100% { opacity: 0; transform: translateX(-5%); }
        30% { opacity: 0.6; }
        50% { opacity: 1; transform: translateX(5%); }
        70% { opacity: 0.4; }
      }

      .shooting-star {
        position: absolute;
        width: 100px;
        height: 1.5px;
        background: linear-gradient(90deg, rgba(255,255,255,0.9) 0%, rgba(0,212,255,0.5) 40%, transparent 100%);
        border-radius: 999px;
        animation: shootingStar var(--duration, 2s) linear forwards;
        pointer-events: none;
        transform-origin: left center;
      }

      @keyframes shootingStar {
        0% { transform: rotate(35deg) translateX(0); opacity: 1; width: 0; }
        20% { width: 120px; opacity: 1; }
        100% { transform: rotate(35deg) translateX(300px); opacity: 0; width: 60px; }
      }

      /* Depth-of-field particle mist */
      .particle-mist {
        position: absolute;
        inset: 0;
        background: 
          radial-gradient(circle at 30% 70%, rgba(0,212,255,0.015) 0%, transparent 40%),
          radial-gradient(circle at 70% 30%, rgba(168,85,247,0.015) 0%, transparent 40%);
        animation: mistDrift 20s ease-in-out infinite alternate;
        pointer-events: none;
      }

      @keyframes mistDrift {
        0% { transform: translate(0, 0); }
        100% { transform: translate(15px, -10px); }
      }
    `;
    document.head.appendChild(style);
  }

  // Create Starfield Container
  const starfield = document.createElement("div");
  starfield.className = "starfield";
  bg.appendChild(starfield);

  // Cosmic Dust Layer
  const cosmicDust = document.createElement("div");
  cosmicDust.className = "cosmic-dust";
  bg.appendChild(cosmicDust);

  // Particle Mist
  const mist = document.createElement("div");
  mist.className = "particle-mist";
  bg.appendChild(mist);

  // Star Layers
  const starLayers = [
    { class: "tiny", count: 200, depth: 1 },
    { class: "small", count: 120, depth: 2 },
    { class: "medium", count: 60, depth: 3 },
    { class: "large", count: 25, depth: 4 }
  ];

  const coloredStars = [
    "colored-cyan", "colored-purple", "colored-gold",
    "colored-emerald", "colored-ruby", "colored-lime"
  ];

  starLayers.forEach(layer => {
    const layerContainer = document.createElement("div");
    layerContainer.className = `star-layer layer-${layer.depth}`;
    starfield.appendChild(layerContainer);

    for (let i = 0; i < layer.count; i++) {
      const star = document.createElement("div");
      let extraClass = "";
      const colorChance = layer.class === "large" ? 0.45 : (layer.class === "medium" ? 0.25 : 0.06);
      if (Math.random() < colorChance) {
        extraClass = " " + coloredStars[Math.floor(Math.random() * coloredStars.length)];
      }
      star.className = `star ${layer.class}${extraClass}`;
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      const duration = 2 + Math.random() * 7;
      const delay = Math.random() * 12;
      star.style.setProperty("--duration", `${duration}s`);
      star.style.setProperty("--delay", `${delay}s`);
      layerContainer.appendChild(star);
    }
  });

  // Nebulae (4 total for richer depth)
  for (let i = 1; i <= 4; i++) {
    const nebula = document.createElement("div");
    nebula.className = `nebula nebula-${i}`;
    bg.appendChild(nebula);
  }

  // Aurora Bands
  for (let i = 1; i <= 3; i++) {
    const aurora = document.createElement("div");
    aurora.className = `aurora-band aurora-band-${i}`;
    bg.appendChild(aurora);
  }

  // Shooting Stars Generator
  const createShootingStar = () => {
    const shootingStar = document.createElement("div");
    shootingStar.className = "shooting-star";
    shootingStar.style.left = `${5 + Math.random() * 65}%`;
    shootingStar.style.top = `${Math.random() * 45}%`;
    const duration = 1.2 + Math.random() * 2;
    shootingStar.style.setProperty("--duration", `${duration}s`);
    bg.appendChild(shootingStar);
    setTimeout(() => shootingStar.remove(), duration * 1000 + 500);
  };

  // Spawn shooting stars
  const shootingStarInterval = setInterval(() => {
    if (Math.random() > 0.5) createShootingStar();
  }, 4000);

  setTimeout(() => createShootingStar(), 1500);
  setTimeout(() => createShootingStar(), 4000);
  setTimeout(() => createShootingStar(), 7000);

  // Cleanup function
  window.cleanupGalaxyBackground = () => {
    clearInterval(shootingStarInterval);
  };
}
