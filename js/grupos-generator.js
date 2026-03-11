/* =============================================
   grupos-generator.js - Generador de grupos
   Padeluminatis Pro - Producción 2026
   ============================================= */

import { db } from './firebase.js';
import { collection, getDocs } from 'firebase/firestore';

/**
 * Genera grupos equilibrados para un evento.
 * @param {string} eventoId - ID del evento en Firestore.
 * @param {number} gruposCount - Número de grupos a generar.
 * @returns {Promise<Array>} - Array de grupos con equipos.
 */
export async function generarGrupos(eventoId, gruposCount = 4) {
  try {
    const equiposSnap = await getDocs(collection(db, `eventos/${eventoId}/equipos`));
    let equipos = equiposSnap.docs.map(doc => ({
      id: doc.id,
      nombre: doc.data().nombreEquipo,
      nivel: doc.data().nivel || 1 // nivel o ranking
    }));

    // Ordenar por nivel descendente
    equipos.sort((a, b) => b.nivel - a.nivel);

    // Inicializar grupos vacíos
    const grupos = Array.from({ length: gruposCount }, () => []);

    // Distribuir equipos de manera equilibrada
    let dir = 1; // dirección de distribución para equilibrio
    let groupIndex = 0;

    equipos.forEach(equipo => {
      grupos[groupIndex].push(equipo);

      if (dir === 1) {
        groupIndex++;
        if (groupIndex === gruposCount) {
          groupIndex = gruposCount - 1;
          dir = -1;
        }
      } else {
        groupIndex--;
        if (groupIndex < 0) {
          groupIndex = 0;
          dir = 1;
        }
      }
    });

    return grupos;

  } catch (error) {
    console.error('Error generando grupos:', error);
    return [];
  }
}

/**
 * Renderiza los grupos en un contenedor HTML.
 * @param {Array} grupos - Array de grupos generados.
 * @param {HTMLElement} container - Contenedor donde renderizar.
 */
export function renderGrupos(grupos, container) {
  container.innerHTML = '';
  grupos.forEach((grupo, index) => {
    const grupoDiv = document.createElement('div');
    grupoDiv.className = 'grupo-card';
    grupoDiv.innerHTML = `<h4>Grupo ${String.fromCharCode(65 + index)}</h4>`;

    grupo.forEach(equipo => {
      const equipoDiv = document.createElement('div');
      equipoDiv.className = 'equipo-item';
      equipoDiv.textContent = `${equipo.nombre} (Nivel: ${equipo.nivel})`;
      grupoDiv.appendChild(equipoDiv);
    });

    container.appendChild(grupoDiv);
  });
}