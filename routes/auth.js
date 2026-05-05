'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../db/database');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const EXPIRES_IN    = process.env.JWT_EXPIRES_IN || '8h';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password are required' });

    const u = await db.queryOne('SELECT * FROM users WHERE username = ?', [username.trim().toLowerCase()]);
    if (!u) return res.status(401).json({ error: 'Username not found. Contact admin.' });
    if (!u.active) return res.status(401).json({ error: 'Account deactivated. Contact admin.' });

    const match = await bcrypt.compare(password, u.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });

    await db.run("UPDATE users SET last_login = datetime('now') WHERE username = ?", [u.username]);

    const payload = { username: u.username, name: u.name, role: u.role, block: u.block || '' };
    const token   = jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
    return res.json({ token, user: payload });
  } catch (e) {
    console.error('[auth/login]', e.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (_req, res) => res.json({ ok: true }));

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// PUT /api/auth/change-password
router.put('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'Current and new password required' });
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const u = await db.queryOne('SELECT * FROM users WHERE username = ?', [req.user.username]);
    if (!u) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(currentPassword, u.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.run("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE username = ?",
      [newHash, u.username]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
