/* =====================================================
   PADELUMINATIS GALAXY BACKGROUND V6.0
   Dynamic star field with nebulae and shooting stars.
   ===================================================== */

export function initGalaxyBackground() {
  const bg = document.querySelector(".sport-bg");
  if (!bg || bg.dataset.initialized) return;
  bg.dataset.initialized = "true";

  // Create Starfield Container
  const starfield = document.createElement("div");
  starfield.className = "starfield";
  bg.appendChild(starfield);

  // Cosmic Dust Layer
  const cosmicDust = document.createElement("div");
  cosmicDust.className = "cosmic-dust";
  bg.appendChild(cosmicDust);

  // Star Types Configuration with Depth Layers
  const starLayers = [
    { class: "tiny", count: 180, speed: 1.2, depth: 1 },
    { class: "small", count: 100, speed: 1, depth: 2 },
    { class: "medium", count: 50, speed: 0.8, depth: 3 },
    { class: "large", count: 20, speed: 0.5, depth: 4 }
  ];

  const coloredStars = [
    "colored-cyan", 
    "colored-purple", 
    "colored-gold", 
    "colored-emerald", 
    "colored-ruby",
    "colored-sapphire"
  ];

  // Generate Multi-layered Stars
  starLayers.forEach(layer => {
    const layerContainer = document.createElement("div");
    layerContainer.className = `star-layer layer-${layer.depth}`;
    layerContainer.style.setProperty('--scroll-speed', layer.speed);
    starfield.appendChild(layerContainer);

    for (let i = 0; i < layer.count; i++) {
        const star = document.createElement("div");
        
        // Random colored star (chance based on size)
        let extraClass = "";
        const colorChance = layer.class === "large" ? 0.4 : (layer.class === "medium" ? 0.2 : 0.05);
        if (Math.random() < colorChance) {
          extraClass = " " + coloredStars[Math.floor(Math.random() * coloredStars.length)];
        }
        
        star.className = `star ${layer.class}${extraClass}`;
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        
        // Random animation timing
        const duration = 2 + Math.random() * 6;
        const delay = Math.random() * 10;
        star.style.setProperty("--duration", `${duration}s`);
        star.style.setProperty("--delay", `${delay}s`);
        
        layerContainer.appendChild(star);
    }
  });

  // Add Nebulae
  for (let i = 1; i <= 3; i++) {
    const nebula = document.createElement("div");
    nebula.className = `nebula nebula-${i}`;
    bg.appendChild(nebula);
  }

  // Shooting Stars Generator
  const createShootingStar = () => {
    const shootingStar = document.createElement("div");
    shootingStar.className = "shooting-star";
    
    // Random starting position in upper half
    shootingStar.style.left = `${10 + Math.random() * 60}%`;
    shootingStar.style.top = `${Math.random() * 40}%`;
    
    // Random duration
    const duration = 1.5 + Math.random() * 2;
    shootingStar.style.animationDuration = `${duration}s`;
    shootingStar.style.setProperty("--duration", `${duration}s`);
    
    bg.appendChild(shootingStar);
    
    // Remove after animation
    setTimeout(() => shootingStar.remove(), duration * 1000 + 500);
  };

  // Spawn shooting stars periodically
  const shootingStarInterval = setInterval(() => {
    if (Math.random() > 0.6) {
      createShootingStar();
    }
  }, 3000);

  // Initial shooting stars
  setTimeout(() => createShootingStar(), 2000);
  setTimeout(() => createShootingStar(), 5000);

  // Cleanup function
  window.cleanupGalaxyBackground = () => {
    clearInterval(shootingStarInterval);
  };

  console.log("Galaxy background initialized");
}




