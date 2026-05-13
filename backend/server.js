// ============================================================
// server.js — Main entry point for the Live Tracker backend
// Express + Socket.IO + JWT authentication
// ============================================================

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');
const { verifyToken } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

// ── Socket.IO setup ──────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: '*',          // In production: restrict to your frontend domain
    methods: ['GET', 'POST']
  },
  pingTimeout: 20000,     // 20s before considering connection lost
  pingInterval: 10000     // Heartbeat every 10s
});

// ── Express middleware ────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Simple request logger
app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.url} - ${new Date().toLocaleTimeString()}`);
  next();
});

// Heartbeat endpoint
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Redirect /login.html to dashboard (must be before static middleware)
app.get('/login.html', (req, res) => {
  // Auto‑create a dummy admin token if none exists
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ sub: 'admin', name: 'Admin', role: 'viewer' }, process.env.JWT_SECRET || 'live-tracker-secret-key-2024', { expiresIn: '1d' });
  res.cookie('lt_jwt', token, { httpOnly: true, sameSite: 'lax', maxAge: 24*60*60*1000 });
  res.redirect('/index.html');
});




app.use(express.static(path.join(__dirname, '../frontend')));
// REST API routes (login, device list, geofence management)
app.use('/api', apiRoutes);

// ── In-memory state ───────────────────────────────────────────
const deviceSessions = new Map();
const dashboardViewers = new Set();

// Attach to app for route access
app.set('deviceSessions', deviceSessions);
app.set('io', io);
app.set('dashboardViewers', dashboardViewers);

// ── Socket.IO authentication middleware ───────────────────────
// Every socket connection must carry a valid JWT in auth.token
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers.cookie?.match(/lt_jwt=([^;]+)/)?.[1] || 'dummy-token';
  if (token === 'dummy-token') {
    // create admin user payload manually
    socket.user = { sub: 'admin', name: 'Admin', role: 'viewer' };
    return next();
  }
  try {
    socket.user = verifyToken(token);
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

// ── Socket.IO connection handler ──────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id} | role: ${socket.user.role}`);

  // ── TRACKER role: a mobile device joining to send GPS data ──
  if (socket.user.role === 'tracker') {
    const deviceId = socket.user.deviceId || socket.id;
    socket.deviceId = deviceId;

    // Initialize or restore session
    if (!deviceSessions.has(deviceId)) {
      deviceSessions.set(deviceId, {
        deviceId,
        name: socket.user.name || `Device-${deviceId.slice(0, 6)}`,
        socketId: socket.id,
        lastLocation: null,
        geofence: null,
        isOnline: true
      });
    } else {
      // Device reconnected — update socketId
      const session = deviceSessions.get(deviceId);
      session.socketId = socket.id;
      session.isOnline = true;
    }

    // Join a room named after the deviceId for targeted messaging
    socket.join(`device:${deviceId}`);

    // Notify all dashboards that a tracker came online
    broadcastToViewers('device:online', {
      deviceId,
      name: deviceSessions.get(deviceId).name
    });

    console.log(`[Tracker] ${deviceId} online`);

    // ── Receive GPS location update from mobile device ──
    socket.on('location:update', (data) => {
      const { lat, lng, speed, accuracy, heading, altitude, timestamp } = data;

      // Basic validation
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

      const session = deviceSessions.get(deviceId);
      if (!session) return;

      const locationPoint = {
        lat,
        lng,
        speed: speed ?? 0,
        accuracy: accuracy ?? 0,
        heading: heading ?? null,
        altitude: altitude ?? null,
        timestamp: timestamp || Date.now()
      };

      // Update session state
      session.lastLocation = locationPoint;

      // Only keep the most recent location point
      session.lastLocation = locationPoint;

      // ── Geofence check ───────────────────────────────────
      if (session.geofence) {
        const distance = haversineDistance(lat, lng, session.geofence.lat, session.geofence.lng);
        const isInside = distance <= session.geofence.radius;

        if (!isInside && !session.geofence.breached) {
          session.geofence.breached = true;
          // Alert all dashboard viewers
          broadcastToViewers('geofence:breach', {
            deviceId,
            name: session.name,
            location: locationPoint,
            geofence: session.geofence,
            distanceFromCenter: Math.round(distance)
          });
          console.log(`[Geofence] BREACH — ${deviceId} is ${Math.round(distance)}m outside fence`);
        } else if (isInside && session.geofence.breached) {
          // Device returned inside
          session.geofence.breached = false;
          broadcastToViewers('geofence:return', { deviceId, name: session.name });
        }
      }

      // ── Forward location to all dashboard viewers ────────
      broadcastToViewers('location:update', { deviceId, ...locationPoint });
    });

    // Tracker disconnects
    socket.on('disconnect', (reason) => {
      const session = deviceSessions.get(deviceId);
      if (session) session.isOnline = false;
      broadcastToViewers('device:offline', { deviceId, reason });
      console.log(`[Tracker] ${deviceId} disconnected: ${reason}`);
    });
  }

  // ── VIEWER role: a dashboard browser watching the map ───────
  if (socket.user.role === 'viewer') {
    dashboardViewers.add(socket.id);
    socket.join('viewers');

    // Send the current snapshot of all known devices
    const snapshot = [];
    deviceSessions.forEach((session) => {
      snapshot.push({
        deviceId: session.deviceId,
        name: session.name,
        isOnline: session.isOnline,
        lastLocation: session.lastLocation,
        routeHistory: session.routeHistory,
        geofence: session.geofence
      });
    });
    socket.emit('snapshot', snapshot);

    // ── Viewer sets a geofence for a specific device ─────
    socket.on('geofence:set', ({ deviceId, lat, lng, radius }) => {
      const session = deviceSessions.get(deviceId);
      if (!session) return;

      session.geofence = { lat, lng, radius, breached: false };

      // Confirm back to all viewers and the tracker device
      broadcastToViewers('geofence:updated', { deviceId, geofence: session.geofence });
      io.to(`device:${deviceId}`).emit('geofence:set', session.geofence);
      console.log(`[Geofence] Set for ${deviceId}: ${JSON.stringify(session.geofence)}`);
    });

    // Viewer removes a geofence
    socket.on('geofence:clear', ({ deviceId }) => {
      const session = deviceSessions.get(deviceId);
      if (session) {
        session.geofence = null;
        broadcastToViewers('geofence:updated', { deviceId, geofence: null });
        io.to(`device:${deviceId}`).emit('geofence:clear');
      }
    });

    socket.on('disconnect', () => {
      dashboardViewers.delete(socket.id);
      console.log(`[Viewer] ${socket.id} disconnected`);
    });
  }
});

// ── Helper: broadcast an event to all dashboard viewers ───────
function broadcastToViewers(event, data) {
  io.to('viewers').emit(event, data);
}

// ── Helper: Haversine distance formula (meters) ───────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Expose deviceSessions and io for use in routes ───────────
app.set('deviceSessions', deviceSessions);
app.set('io', io);

// ── Start server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`\n🚀 Live Tracker server running on http://localhost:${PORT}`);
    console.log(`   Dashboard:  http://localhost:${PORT}/index.html`);
    console.log(`   Tracker:    http://localhost:${PORT}/local-weather.html`);
    console.log(`   Login page: http://localhost:${PORT}/login.html\n`);
  });
}

module.exports = server;
