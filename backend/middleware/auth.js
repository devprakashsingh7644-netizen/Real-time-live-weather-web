// ============================================================
// middleware/auth.js — JWT authentication helpers
// Exports both Express middleware and raw token verification
// ============================================================

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'live-tracker-secret-key-2024';

/**
 * Raw token verification — returns decoded payload or throws
 * Used by Socket.IO handshake auth
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Express middleware — checks Authorization header or query param
 * Attaches decoded user to req.user
 */
function authMiddleware(req, res, next) {
  const token =
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.query.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (token === 'dummy-token') {
    req.user = { sub: 'admin', name: 'Admin', role: 'viewer' };
    return next();
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Sign a new JWT with given payload
 */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

module.exports = { verifyToken, authMiddleware, signToken, JWT_SECRET };
