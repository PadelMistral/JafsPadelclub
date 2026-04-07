/* =============================================
   bracket-pro.js - Bracket visual profesional
   Padeluminatis Pro - Producción 2026
   ============================================= */

import { db } from "./firebase-service.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { getFriendlyTeamName } from "./utils/team-utils.js";

/**
 * Renderiza un bracket profesional en un contenedor dado.
 * @param {string} bracketId - ID del documento de la jornada en Firestore.
 * @param {HTMLElement} container - Contenedor donde se renderiza el bracket.
 */
export async function renderBracket(bracketId, container) {
  container.innerHTML = "";

  try {
    const bracketDoc = await getDoc(doc(db, "calendario", bracketId));
    if (!bracketDoc.exists()) {
      container.innerHTML = `<p style="color:#fff;">Bracket no encontrado.</p>`;
      return;
    }

    const roundsData = bracketDoc.data().rounds || [];
    const bracketWrap = document.createElement("div");
    bracketWrap.className = "bracket-wrap";

    roundsData.forEach((round, roundIndex) => {
      const roundDiv = document.createElement("div");
      roundDiv.className = "bracket-round";

      const roundLabel = document.createElement("div");
      roundLabel.className = "bracket-round-label";
      roundLabel.textContent = round.name || `Ronda ${roundIndex + 1}`;
      roundDiv.appendChild(roundLabel);

      (round.matches || []).forEach((match) => {
        const matchDiv = document.createElement("div");
        matchDiv.className = "bracket-match";

        const team1Div = document.createElement("div");
        team1Div.className = "bracket-team";
        team1Div.textContent = getFriendlyTeamName({ teamName: match.team1, side: "A" });
        if (match.winner === "team1") team1Div.classList.add("winner");

        const vsDiv = document.createElement("div");
        vsDiv.className = "bracket-vs";
        vsDiv.textContent = "VS";

        const team2Div = document.createElement("div");
        team2Div.className = "bracket-team";
        team2Div.textContent = getFriendlyTeamName({ teamName: match.team2, side: "B" });
        if (match.winner === "team2") team2Div.classList.add("winner");

        const resultDiv = document.createElement("div");
        resultDiv.className = "bracket-result";
        resultDiv.textContent = match.score || "";

        matchDiv.appendChild(team1Div);
        matchDiv.appendChild(vsDiv);
        matchDiv.appendChild(team2Div);
        matchDiv.appendChild(resultDiv);
        roundDiv.appendChild(matchDiv);
      });

      bracketWrap.appendChild(roundDiv);
    });

    container.appendChild(bracketWrap);
  } catch (error) {
    console.error("Error cargando bracket:", error);
    container.innerHTML = `<p style="color:#f87171;">Error cargando bracket</p>`;
  }
}
