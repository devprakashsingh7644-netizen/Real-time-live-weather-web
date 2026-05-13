// ============================================================
// tracker.js — Mobile GPS tracker client logic
// Handles geolocation, Socket.IO connection, and UI updates
// ============================================================

// ── Auth check ──────────────────────────────────────────────
const token = localStorage.getItem('lt_token');
const userInfo = JSON.parse(localStorage.getItem('lt_user') || '{}');

if (!token || userInfo.role !== 'tracker') {
  window.location.href = '/login.html';
}

// ── DOM elements ────────────────────────────────────────────
const statusTitle = document.getElementById('statusTitle');
const deviceIdDisplay = document.getElementById('deviceIdDisplay');
const toggleBtn = document.getElementById('toggleBtn');
const statLat = document.getElementById('statLat');
const statLng = document.getElementById('statLng');
const statSpeed = document.getElementById('statSpeed');
const statAccuracy = document.getElementById('statAccuracy');
const updateCount = document.getElementById('updateCount');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');
const ring1 = document.getElementById('ring1');
const ring2 = document.getElementById('ring2');
const pulseInner = document.getElementById('pulseInner');

// ── State ───────────────────────────────────────────────────
let isTracking = false;
let watchId = null;
let sendCount = 0;
let lastSentTime = 0;
const MIN_SEND_INTERVAL = 3000; // Minimum 3 seconds between updates

// Display device ID
deviceIdDisplay.textContent = `Device ID: ${userInfo.deviceId || '—'}`;

// ── Socket.IO connection ────────────────────────────────────
const socket = io({
  auth: { token },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000
});

// ── Connection status handlers ──────────────────────────────
socket.on('connect', () => {
  console.log('[Socket] Connected:', socket.id);
  setConnectionStatus('connected', 'Connected');
});

socket.on('disconnect', (reason) => {
  console.log('[Socket] Disconnected:', reason);
  setConnectionStatus('disconnected', 'Disconnected');
});

socket.on('reconnect_attempt', (attempt) => {
  setConnectionStatus('connecting', `Reconnecting (${attempt})...`);
});

socket.on('connect_error', (err) => {
  console.error('[Socket] Connection error:', err.message);
  if (err.message.includes('Authentication')) {
    // Token expired or invalid — force re-login
    localStorage.removeItem('lt_token');
    localStorage.removeItem('lt_user');
    window.location.href = '/login.html';
  }
  setConnectionStatus('disconnected', 'Connection error');
});

// ── Update connection status UI ─────────────────────────────
function setConnectionStatus(state, text) {
  connDot.className = `dot ${state}`;
  connText.textContent = text;
}

// ── Toggle tracking on/off ──────────────────────────────────
function toggleTracking() {
  if (isTracking) {
    stopTracking();
  } else {
    startTracking();
  }
}

// ── Start GPS tracking ──────────────────────────────────────
function startTracking() {
  if (!navigator.geolocation) {
    statusTitle.textContent = '❌ Geolocation not supported';
    return;
  }

  // Request high-accuracy GPS
  watchId = navigator.geolocation.watchPosition(
    onPositionUpdate,
    onPositionError,
    {
      enableHighAccuracy: true,
      maximumAge: 2000,        // Accept cached position up to 2s old
      timeout: 10000           // Wait up to 10s for position
    }
  );

  isTracking = true;
  toggleBtn.innerHTML = '⏹ Stop Tracking';
  toggleBtn.classList.remove('btn-primary');
  toggleBtn.classList.add('btn-danger');
  statusTitle.textContent = '🟢 Tracking Active';

  // Start pulse animation
  ring1.classList.remove('paused');
  ring2.classList.remove('paused');
  pulseInner.classList.remove('inactive');
}

// ── Stop GPS tracking ───────────────────────────────────────
function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  isTracking = false;
  toggleBtn.innerHTML = '▶ Start Tracking';
  toggleBtn.classList.remove('btn-danger');
  toggleBtn.classList.add('btn-primary');
  statusTitle.textContent = 'GPS Tracker';

  // Stop pulse animation
  ring1.classList.add('paused');
  ring2.classList.add('paused');
  pulseInner.classList.add('inactive');
}

// ── Handle new GPS position ─────────────────────────────────
function onPositionUpdate(position) {
  const { latitude, longitude, speed, accuracy, heading, altitude } = position.coords;
  const now = Date.now();

  // Update UI immediately
  statLat.textContent = latitude.toFixed(6);
  statLng.textContent = longitude.toFixed(6);
  statSpeed.textContent = speed ? `${(speed * 3.6).toFixed(1)} km/h` : '0 km/h';
  statAccuracy.textContent = accuracy ? `±${accuracy.toFixed(0)}m` : '—';

  // Throttle: only send if enough time has passed since last emit
  if (now - lastSentTime < MIN_SEND_INTERVAL) return;
  lastSentTime = now;

  // Emit to server
  if (socket.connected) {
    socket.emit('location:update', {
      lat: latitude,
      lng: longitude,
      speed: speed || 0,
      accuracy: accuracy || 0,
      heading: heading || null,
      altitude: altitude || null,
      timestamp: now
    });

    sendCount++;
    updateCount.textContent = sendCount;
  }
}

// ── Handle GPS errors ───────────────────────────────────────
function onPositionError(error) {
  console.error('[GPS] Error:', error.message);
  switch (error.code) {
    case error.PERMISSION_DENIED:
      statusTitle.textContent = '❌ Location permission denied';
      stopTracking();
      break;
    case error.POSITION_UNAVAILABLE:
      statusTitle.textContent = '⚠️ Position unavailable';
      break;
    case error.TIMEOUT:
      statusTitle.textContent = '⏱ GPS timeout — retrying...';
      break;
  }
}

// ── Logout ──────────────────────────────────────────────────
function logout() {
  stopTracking();
  socket.disconnect();
  localStorage.removeItem('lt_token');
  localStorage.removeItem('lt_user');
  window.location.href = '/login.html';
}

// ── Handle page visibility (save battery) ───────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isTracking) {
    // Page is hidden but keep tracking (background GPS still works)
    console.log('[Tracker] Page hidden — GPS continues in background');
  }
});
