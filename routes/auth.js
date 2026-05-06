'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../db/database');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const EXPIRES_IN    = process.env.JWT_EXPIRES_IN || '8h';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10');

// GET /api/auth/config — returns public config (Google Client ID)
router.get('/config', (_req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

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

    const payload = { username: u.username, name: u.name, role: u.role, block: u.block || '', phc: u.phc || '' };
    const token   = jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
    return res.json({ token, user: payload });
  } catch (e) {
    console.error('[auth/login]', e.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/google — verify Google ID token and return app JWT
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'No credential provided' });

    // Verify with Google tokeninfo
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    if (!r.ok) return res.status(401).json({ error: 'Invalid Google token' });
    const info = await r.json();

    // Validate audience matches our client ID
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId && info.aud !== clientId) {
      return res.status(401).json({ error: 'Token audience mismatch' });
    }

    const email = (info.email || '').toLowerCase();
    if (!email || info.email_verified !== 'true') {
      return res.status(401).json({ error: 'Google email not verified' });
    }

    const u = await db.queryOne('SELECT * FROM users WHERE email = ?', [email]);
    if (!u) return res.status(401).json({ error: 'No account linked to ' + email + '. Contact admin.' });
    if (!u.active) return res.status(401).json({ error: 'Account deactivated. Contact admin.' });

    await db.run("UPDATE users SET last_login = datetime('now') WHERE username = ?", [u.username]);

    const payload = { username: u.username, name: u.name, role: u.role, block: u.block || '', phc: u.phc || '' };
    const token   = jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
    return res.json({ token, user: payload });
  } catch (e) {
    console.error('[auth/google]', e.message);
    res.status(500).json({ error: 'Google login failed' });
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
