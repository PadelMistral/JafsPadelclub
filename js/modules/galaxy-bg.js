/* js/modules/galaxy-bg.js - Dynamic Star Generator */

export function initGalaxyBackground() {
  const bg = document.querySelector(".sport-bg");
  if (!bg || bg.dataset.initialized) return;
  bg.dataset.initialized = "true";

  // Create Starfield Container
  const starfield = document.createElement("div");
  starfield.className = "starfield";
  bg.appendChild(starfield);

  // Generate Stars
  const starCount = 150;
  for (let i = 0; i < starCount; i++) {
    const star = document.createElement("div");
    const rand = Math.random();

    let className = "star";
    if (rand > 0.98) className = "star giant";
    else if (rand > 0.95) className = "star large sport-green";
    else if (rand > 0.9) className = "star large sport-yellow";
    else if (rand > 0.75) className = "star large";

    star.className = className;
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;

    const isLarge = className.includes("large");
    const isGiant = className.includes("giant");
    let size = Math.random() * 2 + 1;
    if (isGiant) size = Math.random() * 4 + 4;
    else if (isLarge) size = Math.random() * 3 + 2.5;

    star.style.width = `${size}px`;
    star.style.height = `${size}px`;

    star.style.setProperty("--duration", `${Math.random() * 4 + 2}s`);
    star.style.setProperty("--delay", `${Math.random() * 5}s`);
    starfield.appendChild(star);
  }

  // Add Nebulas
  for (let i = 1; i <= 3; i++) {
    const nebula = document.createElement("div");
    nebula.className = `nebula nebula-${i}`;
    bg.appendChild(nebula);
  }

  // Add Shooting Stars (occasional)
  setInterval(() => {
    if (Math.random() > 0.7) {
      const ss = document.createElement("div");
      ss.className = "shooting-star";
      ss.style.left = `${Math.random() * 50}%`;
      ss.style.top = `${Math.random() * 30}%`;
      ss.style.animationDuration = `${Math.random() * 2 + 2}s`;
      bg.appendChild(ss);
      setTimeout(() => ss.remove(), 5000);
    }
  }, 4000);
}
