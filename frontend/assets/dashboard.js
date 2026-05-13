// ============================================================
// dashboard.js — Admin dashboard logic
// Map with multiple tile layers, multi-device tracking,
// smooth marker animation, geofence, link generation, alerts
// ============================================================

// ── Auth Guard ──────────────────────────────────────────────
if (!localStorage.getItem('lt_token')) {
  localStorage.setItem('lt_token', 'dummy-token');
}
if (!localStorage.getItem('lt_user')) {
  localStorage.setItem('lt_user', JSON.stringify({ role: 'viewer', name: 'Admin' }));
}

const token = localStorage.getItem('lt_token') || 'dummy-token';
const userInfo = JSON.parse(localStorage.getItem('lt_user') || '{"role":"viewer","name":"Admin"}');

// ── State ───────────────────────────────────────────────────
const devices = new Map();          // deviceId → { marker, polyline, circle, color, data }
let selectedDeviceId = null;
let generatedLink = '';
let colorIdx = 0;

const COLORS = ['#6366f1','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#14b8a6','#f97316','#a855f7'];
function nextColor() { return COLORS[colorIdx++ % COLORS.length]; }

// ── Map Setup ───────────────────────────────────────────────
const map = L.map('map', { center: [20.5937, 78.9629], zoom: 5, zoomControl: true });

// Tile layers — constrained and optimized for deep zoom
const worldBounds = [[-90, -180], [90, 180]];
const tileLayers = {
  satellite: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '&copy; Esri', maxNativeZoom: 18, maxZoom: 22, noWrap: true, bounds: worldBounds }
  ),
  street: L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '&copy; OpenStreetMap contributors', maxNativeZoom: 19, maxZoom: 22, noWrap: true, bounds: worldBounds }
  ),
  dark: L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; CARTO', subdomains: 'abcd', maxNativeZoom: 19, maxZoom: 22, noWrap: true, bounds: worldBounds }
  )
};

// Default to satellite (colorful)
let currentLayer = tileLayers.satellite;
currentLayer.addTo(map);

function switchLayer(name) {
  map.removeLayer(currentLayer);
  currentLayer = tileLayers[name];
  currentLayer.addTo(map);
  // Update button states
  document.querySelectorAll('.map-btn').forEach(b => b.classList.remove('active'));
  const btnMap = { satellite: 'btnSat', street: 'btnStreet', dark: 'btnDark' };
  document.getElementById(btnMap[name])?.classList.add('active');
}
// Expose globally for onclick
window.switchLayer = switchLayer;

// Map click → set geofence
map.on('click', (e) => {
  if (!selectedDeviceId) return;
  const radius = parseInt(document.getElementById('geoRadius').value) || 500;
  emitGeofence(selectedDeviceId, e.latlng.lat, e.latlng.lng, radius);
});

// ── Custom marker icon ──────────────────────────────────────
function makeIcon(color, online) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:16px; height:16px;
      background:${color};
      border:3px solid white;
      border-radius:50%;
      box-shadow:0 0 14px ${color}99, 0 2px 6px rgba(0,0,0,0.5);
      opacity:${online ? 1 : 0.35};
      transition: opacity 0.3s;
    "></div>`,
    iconSize: [16, 16], iconAnchor: [8, 8]
  });
}

// ── Socket.IO ───────────────────────────────────────────────
const socket = io({
  auth: { token },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

socket.on('connect', () => {
  document.getElementById('connStatus').textContent = `Connected • ${socket.id.slice(0, 8)}`;
  const sessionEl = document.getElementById('sessionInfo');
  if (sessionEl) sessionEl.textContent = `ID: ${socket.id.slice(0, 6)}`;
});
socket.on('disconnect', (r) => {
  document.getElementById('connStatus').textContent = `Disconnected — ${r}`;
});
socket.on('reconnect_attempt', (n) => {
  document.getElementById('connStatus').textContent = `Reconnecting (${n})...`;
});
socket.on('connect_error', (err) => {
  if (err.message.includes('Authentication')) {
    localStorage.clear();
    // No redirect; keep dashboard accessible
  }
});

// ── Helper: fit map to all live devices ─────────────────────
function fitMapToDevices() {
  const liveDevs = Array.from(devices.values()).filter(d => d.data.isOnline && d.data.lastLocation);
  if (liveDevs.length === 0) return;
  if (liveDevs.length === 1) {
    const loc = liveDevs[0].data.lastLocation;
    map.flyTo([loc.lat, loc.lng], 15, { duration: 1.2 });
    return;
  }
  const bounds = L.latLngBounds(liveDevs.map(d => [d.data.lastLocation.lat, d.data.lastLocation.lng]));
  map.flyToBounds(bounds.pad(0.3), { duration: 1.2, maxZoom: 16 });
}

// ── Snapshot (initial state) ────────────────────────────────
socket.on('snapshot', (snap) => {
  snap.forEach((d) => {
    // Only show online devices in the dashboard
    if (!d.isOnline) return;
    registerDevice(d);
    const dev = devices.get(d.deviceId);
    if (dev && d.lastLocation) {
      dev.marker.setLatLng([d.lastLocation.lat, d.lastLocation.lng]);
      dev.marker.setOpacity(1);
    }
    if (dev && d.geofence) {
      drawFence(d.deviceId, d.geofence);
    }
  });
  refreshList();
  setTimeout(fitMapToDevices, 500);
});

// ── Device events ───────────────────────────────────────────
socket.on('device:online', (d) => {
  if (devices.has(d.deviceId)) {
    const existing = devices.get(d.deviceId);
    existing.data.isOnline = true;
    existing.hasFitted = false;
    existing.marker.setIcon(makeIcon(existing.color, true));
  } else {
    registerDevice({ ...d, isOnline: true, lastLocation: null, routeHistory: [], geofence: null });
  }
  refreshList();
  pushAlert('info', `${d.name} connected`, 'Session is now live');
});

socket.on('device:registered', (d) => {
  // Don't add to sidebar yet — device hasn't connected
  // Just log it silently
  console.log('[Dashboard] Link generated for', d.name);
});

socket.on('device:offline', (d) => {
  const dev = devices.get(d.deviceId);
  if (dev) {
    // Remove marker from map
    map.removeLayer(dev.marker);
    // Remove geofence circle if any
    if (dev.circle) map.removeLayer(dev.circle);
    // Remove from devices map
    devices.delete(d.deviceId);
    // If this was the selected device, close panels
    if (selectedDeviceId === d.deviceId) {
      selectedDeviceId = null;
      document.getElementById('infoSection').style.display = 'none';
      document.getElementById('geoSection').style.display = 'none';
    }
  }
  refreshList();
  pushAlert('info', `${d.name || d.deviceId.slice(0,8)} disconnected`, d.reason || 'Connection lost');
});

// ── Per-device address cache ──────────────────────────────────
const addressCache = new Map(); // deviceId → { place, fetchedAt }

async function updateDeviceAddress(deviceId, lat, lng) {
  const cached = addressCache.get(deviceId);
  // Throttle: only re-fetch every 15 seconds per device
  if (cached && Date.now() - cached.fetchedAt < 15000) return;

  try {
    const place = await fetchPlaceDetails(lat, lng);
    addressCache.set(deviceId, { place, fetchedAt: Date.now() });

    const dev = devices.get(deviceId);
    if (dev) {
      dev.data.address = place;
    }

    // Update sidebar card address
    const addrEl = document.getElementById(`addr-${deviceId}`);
    if (addrEl) {
      const area = place.city || place.town || place.village || '';
      addrEl.textContent = '📍 ' + (area ? `${area}, ${place.state || ''}` : `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    }

    // Update info panel if this device is selected
    if (selectedDeviceId === deviceId) {
      document.getElementById('iCity').textContent = place.city || place.town || place.village || '—';
      document.getElementById('iRegion').textContent = place.state || '—';
      document.getElementById('iCountry').textContent = place.country || '—';
    }
  } catch (e) {
    console.warn('Geocoding error:', e);
  }
}

// ── Location update ─────────────────────────────────────────
socket.on('location:update', (d) => {
  let dev = devices.get(d.deviceId);
  if (!dev) {
    registerDevice({ deviceId: d.deviceId, name: `User-${d.deviceId.slice(0,6)}`, isOnline: true, lastLocation: d, routeHistory: [], geofence: null });
    dev = devices.get(d.deviceId);
    refreshList();
  }

  const to = L.latLng(d.lat, d.lng);

  // Show marker (was hidden if no initial location)
  dev.marker.setOpacity(1);

  // Smooth animate marker from current position (not default 0,0)
  const from = dev.marker.getLatLng();
  const fromIsDefault = (from.lat === 0 && from.lng === 0);
  if (!fromIsDefault) {
    animateMarker(dev.marker, from, to, 800);
  } else {
    dev.marker.setLatLng(to);
  }

  dev.data.lastLocation = d;
  dev.data.routeHistory = [];

  // Auto-fit on first real location
  if (!dev.hasFitted) {
    dev.hasFitted = true;
    map.flyTo([d.lat, d.lng], 15, { duration: 1.2 });
  }

  // Update UI info panel if selected
  if (selectedDeviceId === d.deviceId) updateInfo(dev.data);
  updateCardMeta(d.deviceId, d);

  // Fetch real-time address for ALL devices
  updateDeviceAddress(d.deviceId, d.lat, d.lng);
});

// ── Geofence events ─────────────────────────────────────────
socket.on('geofence:breach', (d) => {
  pushAlert('breach', `🚨 BOUNDARY BREACH: ${d.name}`, `${d.distanceFromCenter}m outside the boundary zone!`);
  // Flash circle red
  const dev = devices.get(d.deviceId);
  if (dev?.circle) {
    dev.circle.setStyle({ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.18 });
  }
  // Show badge
  if (selectedDeviceId === d.deviceId) {
    document.getElementById('breachBadge').style.display = 'inline';
  }
});

socket.on('geofence:return', (d) => {
  pushAlert('return', `✅ ${d.name} returned`, 'Back inside the boundary zone');
  const dev = devices.get(d.deviceId);
  if (dev?.circle) {
    dev.circle.setStyle({ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.1 });
  }
  if (selectedDeviceId === d.deviceId) {
    document.getElementById('breachBadge').style.display = 'none';
  }
});

socket.on('geofence:updated', ({ deviceId, geofence }) => {
  if (geofence) drawFence(deviceId, geofence);
  else removeFence(deviceId);
});

// ── Register / update device ────────────────────────────────
function registerDevice(d) {
  if (devices.has(d.deviceId)) {
    const existing = devices.get(d.deviceId);
    existing.data = { ...existing.data, ...d };
    existing.marker.setIcon(makeIcon(existing.color, d.isOnline));
    return;
  }

  const color = nextColor();
  // Only place marker at real location — never default to map center
  const hasLocation = d.lastLocation && d.lastLocation.lat && d.lastLocation.lng;
  const pos = hasLocation ? [d.lastLocation.lat, d.lastLocation.lng] : [0, 0];
  const marker = L.marker(pos, { icon: makeIcon(color, d.isOnline), opacity: hasLocation ? 1 : 0 }).addTo(map);
  marker.bindPopup(`<b>${d.name || d.deviceId}</b><br>ID: ${d.deviceId}`);

  devices.set(d.deviceId, { marker, circle: null, color, data: d, hasFitted: false });
}

// ── Smooth marker animation ─────────────────────────────────
function animateMarker(marker, from, to, ms) {
  const t0 = performance.now();
  const dLat = to.lat - from.lat;
  const dLng = to.lng - from.lng;

  (function step(now) {
    const p = Math.min((now - t0) / ms, 1);
    const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
    marker.setLatLng([from.lat + dLat * e, from.lng + dLng * e]);
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

// ── Geofence helpers ────────────────────────────────────────
function drawFence(deviceId, g) {
  const dev = devices.get(deviceId);
  if (!dev) return;
  if (dev.circle) map.removeLayer(dev.circle);
  const c = g.breached ? '#ef4444' : '#10b981';
  dev.circle = L.circle([g.lat, g.lng], {
    radius: g.radius, color: c, fillColor: c, fillOpacity: 0.1,
    weight: 2.5, dashArray: '10, 8'
  }).addTo(map);
}

function removeFence(deviceId) {
  const dev = devices.get(deviceId);
  if (dev?.circle) { map.removeLayer(dev.circle); dev.circle = null; }
}

function emitGeofence(deviceId, lat, lng, radius) {
  socket.emit('geofence:set', { deviceId, lat, lng, radius });
  pushAlert('info', '📍 Boundary set', `${radius}m radius around (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
}

window.setGeoAtDevice = function () {
  if (!selectedDeviceId) return;
  const dev = devices.get(selectedDeviceId);
  if (!dev?.data.lastLocation) { pushAlert('info', '⚠️ No location', 'Wait for the user to share their location first'); return; }
  const r = parseInt(document.getElementById('geoRadius').value) || 500;
  emitGeofence(selectedDeviceId, dev.data.lastLocation.lat, dev.data.lastLocation.lng, r);
};

window.clearGeo = function () {
  if (!selectedDeviceId) return;
  socket.emit('geofence:clear', { deviceId: selectedDeviceId });
  removeFence(selectedDeviceId);
  document.getElementById('breachBadge').style.display = 'none';
  pushAlert('info', '🗑️ Boundary cleared', '');
};

// ── UI: Device list ─────────────────────────────────────────
function refreshList() {
  const arr = Array.from(devices.values());
  const countEl = document.getElementById('deviceCountBadge') || document.getElementById('deviceCount');
  if (countEl) countEl.textContent = arr.length;

  const deviceList = document.getElementById('deviceList');
  if (!deviceList) return;

  if (arr.length === 0) {
    deviceList.innerHTML = '<div class="no-devices" id="noDevices"><div class="icon">📡</div><p>Generate a link and share it with a user to start tracking.</p></div>';
    return;
  }

  let html = '';
  arr.forEach(({ data, color }) => {
    // Only show online devices
    if (!data.isOnline) return;
    const sel = selectedDeviceId === data.deviceId;
    const loc = data.lastLocation;
    const addr = data.address;
    const areaText = addr ? (addr.city || addr.town || addr.village || '') : '';
    const stateText = addr ? (addr.state || '') : '';
    const addrDisplay = areaText ? `${areaText}${stateText ? ', ' + stateText : ''}` : (loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : 'Locating...');
    html += `
      <div class="device-card ${sel ? 'selected' : ''}"
           onclick="selectDevice('${data.deviceId}')">
        <div class="dc-header">
          <span class="dc-name">
            <span class="status-dot on"></span>
            ${data.name || data.deviceId.slice(0,8)}
          </span>
          <span class="dc-badge online">LIVE</span>
        </div>
        <div class="dc-meta" id="meta-${data.deviceId}">
          <span id="addr-${data.deviceId}" style="grid-column:1/-1;font-weight:600;color:#a78bfa;">📍 ${addrDisplay}</span>
          <span>🏃 ${loc?.speed ? (loc.speed * 3.6).toFixed(1) + ' km/h' : '—'}</span>
          <span>🎯 ${loc?.accuracy ? '±' + loc.accuracy.toFixed(0) + 'm' : '—'}</span>
          <span style="color:${color}">● Live</span>
        </div>
      </div>`;
  });

  const scroll = document.getElementById('deviceList').scrollTop;
  document.getElementById('deviceList').innerHTML = html;
  document.getElementById('deviceList').scrollTop = scroll;
}

function updateCardMeta(deviceId, loc) {
  const el = document.getElementById(`meta-${deviceId}`);
  const dev = devices.get(deviceId);
  if (!el || !dev) return;
  const addr = dev.data.address;
  const areaText = addr ? (addr.city || addr.town || addr.village || '') : '';
  const stateText = addr ? (addr.state || '') : '';
  const addrDisplay = areaText ? `${areaText}${stateText ? ', ' + stateText : ''}` : `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
  el.innerHTML = `
    <span id="addr-${deviceId}" style="grid-column:1/-1;font-weight:600;color:#a78bfa;">📍 ${addrDisplay}</span>
    <span>🏃 ${loc.speed ? (loc.speed * 3.6).toFixed(1) + ' km/h' : '—'}</span>
    <span>🎯 ${loc.accuracy ? '±' + loc.accuracy.toFixed(0) + 'm' : '—'}</span>
    <span style="color:${dev.color}">● Live</span>`;
}

// ── Select device ───────────────────────────────────────────
window.selectDevice = function (deviceId) {
  if (selectedDeviceId === deviceId) {
    // Toggle off: deselect
    selectedDeviceId = null;
    document.getElementById('infoSection').style.display = 'none';
    document.getElementById('geoSection').style.display = 'none';
    refreshList();
    return;
  }
  selectedDeviceId = deviceId;
  const dev = devices.get(deviceId);
  if (!dev) return;

  document.getElementById('infoSection').style.display = 'block';
  document.getElementById('geoSection').style.display = 'block';
  document.getElementById('infoName').textContent = dev.data.name || deviceId.slice(0,8);

  refreshList();
  updateInfo(dev.data);

  if (dev.data.lastLocation) {
    map.flyTo([dev.data.lastLocation.lat, dev.data.lastLocation.lng], 16, { duration: 1 });
  }
};

// Close info/geo panels
window.closeInfoPanel = function () {
  selectedDeviceId = null;
  document.getElementById('infoSection').style.display = 'none';
  document.getElementById('geoSection').style.display = 'none';
  refreshList();
};

function fetchPlaceDetails(lat, lng) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
  return fetch(url)
    .then(res => res.json())
    .then(data => ({
      city: data.city || data.locality || '',
      town: data.localityInfo?.administrative?.[2]?.name || '',
      village: data.village || '',
      state: data.principalSubdivision || '',
      country: data.countryName || ''
    }));
}

function updateInfo(data) {
  const loc = data.lastLocation;
  document.getElementById('iSpeed').textContent = loc?.speed ? `${(loc.speed * 3.6).toFixed(1)} km/h` : '0 km/h';
  document.getElementById('iAcc').textContent = loc?.accuracy ? `±${loc.accuracy.toFixed(0)}m` : '—';
  document.getElementById('iHeading').textContent = loc?.heading ? `${loc.heading.toFixed(0)}°` : '—';
  // Clear location details until fetched
  document.getElementById('iCity').textContent = '—';
  document.getElementById('iRegion').textContent = '—';
  document.getElementById('iCountry').textContent = '—';
}

// ── Generate tracking link ──────────────────────────────────
async function generateLink() {
  console.log('[Dashboard] Generate link clicked');
  const nameInput = document.getElementById('newDeviceName');
  const name = nameInput.value.trim();
  const btn = document.querySelector('.btn-gen');
  
  const originalText = btn.textContent;
  btn.textContent = '⏳ ...';
  btn.disabled = true;

  try {
    console.log('[Dashboard] Fetching /api/generate-link with token:', token);
    const res = await fetch('/api/generate-link', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ deviceName: name || undefined })
    });
    
    const data = await res.json();
    console.log('[Dashboard] API Response:', data);
    
    if (!res.ok) throw new Error(data.error || 'Failed to generate link');

    generatedLink = data.trackingUrl;
    document.getElementById('linkUrl').textContent = generatedLink;
    document.getElementById('linkResult').style.display = 'block';
    nameInput.value = '';

    pushAlert('info', `🔗 Link generated for "${data.name}"`, 'Share this link with the user');
  } catch (e) {
    console.error('[Dashboard] Generate link error:', e);
    pushAlert('breach', '❌ Failed to generate link', e.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}
window.generateLink = generateLink;

window.copyLink = function () {
  navigator.clipboard.writeText(generatedLink).then(() => {
    pushAlert('info', '📋 Link copied!', 'Paste it in WhatsApp, SMS, or any messenger');
  });
};

// ── QR Code ─────────────────────────────────────────────────
let qrInstance = null;
window.showQR = function () {
  document.getElementById('qrModal').classList.add('show');
  const canvas = document.getElementById('qrCanvas');
  // Clear previous
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  if (qrInstance) {
    qrInstance.clear();
    qrInstance.makeCode(generatedLink);
  } else {
    qrInstance = new QRCode(canvas, {
      text: generatedLink,
      width: 220,
      height: 220,
      colorDark: '#0b0f1e',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }
};

window.closeQR = function () {
  document.getElementById('qrModal').classList.remove('show');
};

// ── Alert system ────────────────────────────────────────────
function pushAlert(type, title, body) {
  const panel = document.getElementById('alertsPanel');
  if (!panel) {
    console.warn('[Dashboard] Alerts panel not found:', { type, title, body });
    return;
  }
  const cls = type === 'breach' ? 'alert-breach' : type === 'return' ? 'alert-return' : 'alert-info';
  const el = document.createElement('div');
  el.className = `alert-card ${cls}`;
  el.innerHTML = `
    <div class="a-title">${title}</div>
    <div class="a-body">${body}</div>
    <div class="a-time">${new Date().toLocaleTimeString()}</div>`;
  panel.prepend(el);

  // Remove after 8s
  setTimeout(() => { if (el.parentNode) el.remove(); }, 8000);

  // Keep max 5 alerts visible
  while (panel.children.length > 5) panel.removeChild(panel.lastChild);
}

// ── Logout ──────────────────────────────────────────────────
window.logout = function () {
  socket.disconnect();
  localStorage.removeItem('lt_token');
  localStorage.removeItem('lt_user');
  // Reload dashboard directly without login page
  window.location.href = '/index.html';
};
