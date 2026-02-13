/* js/external-data.js - External APIs Service v2.0 */

/**
 * Fetches "Padel Tip of the Day"
 */
export async function getDailyTip() {
    const tips = [
        { title: "El Globo", content: "El globo es el golpe más importante. No busques ganar el punto, busca recuperar la red.", category: "Táctica" },
        { title: "Posición en Red", content: "No te pegues a la red. Quédate a unos 2 metros para cubrir bien el globo y la volea.", category: "Posicionamiento" },
        { title: "Saque", content: "El saque no es para hacer Ace, es para tomar la iniciativa. Saca al cristal lateral.", category: "Técnica" },
        { title: "La Nevera", content: "Si te hacen la nevera, mantén la calma y mantente activo. Entra cruzado cuando puedas.", category: "Mental" },
        { title: "Comunicación", content: "Habla con tu pareja antes, durante y después de cada punto. 'Mía', 'Tuya', 'Voy'.", category: "Equipo" },
        { title: "Vidrios", content: "Deja pasar la bola. El cristal es tu amigo, te da tiempo para colocarte mejor.", category: "Defensa" }
    ];
    const today = new Date().getDay();
    return tips[today % tips.length];
}

/**
 * Fetches current weather and hourly forecast (Open-Meteo)
 */
export async function getDetailedWeather() {
    try {
        // Location refined for Valencia Benicalap (latitude=39.4938, longitude=-0.3896)
        const url = `https://api.open-meteo.com/v1/forecast?latitude=39.4938&longitude=-0.3896&current=temperature_2m,relative_humidity_2m,precipitation,rain,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=10`;
        const res = await fetch(url);
        const data = await res.json();
        return data;

    } catch (e) {
        console.warn("Weather API Error:", e);
        return null;
    }
}

/**
 * Get weather for a specific date and hour
 */
export async function getWeatherForMatch(dateString, hour) {
    try {
        const date = new Date(dateString);
        const lat = 39.4938;
        const lon = -0.3896;
        const YYYYMMDD = date.toISOString().split('T')[0];
        
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,rain,showers,snowfall,wind_speed_10m&start_date=${YYYYMMDD}&end_date=${YYYYMMDD}`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data && data.hourly) {
            return {
                temp: data.hourly.temperature_2m[hour],
                rain: data.hourly.rain[hour] || data.hourly.showers[hour],
                wind: data.hourly.wind_speed_10m[hour]
            };
        }
        return null;
    } catch(e) {
        return null;
    }
}


