'use strict';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'hrp_myl_2026_jwt_secret';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireEditor(req, res, next) {
  if (!['admin', 'dph_officer', 'bdo'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Edit permission required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireEditor, JWT_SECRET };
