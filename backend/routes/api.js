// ============================================================
// routes/api.js — REST API endpoints
// Login, link generation, device listing, geofence management
// ============================================================

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { signToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

// ── Hard-coded admin credentials ─────────────────────────────
// In production, replace with a real database + bcrypt hashing
const ADMINS = [
  { username: 'admin', password: 'admin123', name: 'Admin' }
];

// ── POST /api/login ──────────────────────────────────────────
// Admin-only login — returns JWT for dashboard viewer
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const admin = ADMINS.find(
    (u) => u.username === username && u.password === password
  );

  if (!admin) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const payload = {
    username: admin.username,
    name: admin.name,
    role: 'viewer'
  };

  const token = signToken(payload);
  res.json({ token, user: payload });
});

// ── POST /api/generate-link ─────────────────────────────────
// Admin generates a shareable tracking link for a user
// The link contains a JWT that auto-authenticates the tracker
router.post('/generate-link', authMiddleware, (req, res) => {
  const { deviceName } = req.body;
  const deviceId = uuidv4().slice(0, 8);
  const name = deviceName || `User-${deviceId}`;

  // Create a tracker token (valid for 24 hours)
  const trackerToken = signToken({
    role: 'tracker',
    deviceId,
    name
  });

  // Build the full tracking URL
  const host = req.headers.host || 'localhost:3000';
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const trackingUrl = `${protocol}://${host}/local-weather.html?token=${trackerToken}`;

  // Pre-register the device in sessions
  const deviceSessions = req.app.get('deviceSessions');
  if (!deviceSessions.has(deviceId)) {
    deviceSessions.set(deviceId, {
      deviceId,
      name,
      socketId: null,
      lastLocation: null,
      geofence: null,
      isOnline: false
    });
  }

  // Notify viewers about the new device
  const io = req.app.get('io');
  io.to('viewers').emit('device:registered', { deviceId, name });

  res.json({
    deviceId,
    name,
    token: trackerToken,
    trackingUrl
  });
});

// ── GET /api/devices ─────────────────────────────────────────
router.get('/devices', authMiddleware, (req, res) => {
  const deviceSessions = req.app.get('deviceSessions');
  const devices = [];

  deviceSessions.forEach((session) => {
    devices.push({
      deviceId: session.deviceId,
      name: session.name,
      isOnline: session.isOnline,
      lastLocation: session.lastLocation,
      hasGeofence: !!session.geofence
    });
  });

  res.json({ devices });
});

// ── POST /api/geofence ───────────────────────────────────────
router.post('/geofence', authMiddleware, (req, res) => {
  const { deviceId, lat, lng, radius } = req.body;

  if (!deviceId || typeof lat !== 'number' || typeof lng !== 'number' || typeof radius !== 'number') {
    return res.status(400).json({ error: 'deviceId, lat, lng, and radius are required' });
  }

  const deviceSessions = req.app.get('deviceSessions');
  const session = deviceSessions.get(deviceId);

  if (!session) {
    return res.status(404).json({ error: 'Device not found' });
  }

  session.geofence = { lat, lng, radius, breached: false };

  const io = req.app.get('io');
  io.to('viewers').emit('geofence:updated', { deviceId, geofence: session.geofence });
  io.to(`device:${deviceId}`).emit('geofence:set', session.geofence);

  res.json({ message: 'Geofence set', geofence: session.geofence });
});

// ── GET /api/health ──────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

module.exports = router;
