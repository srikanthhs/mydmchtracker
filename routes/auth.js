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

// POST /api/auth/request-access  (public — no auth needed)
router.post('/request-access', async (req, res) => {
  const { name, email, role, block, phc, message } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  if (!email.includes('@')) return res.status(400).json({ error: 'Invalid email address' });
  try {
    await db.storeAccessRequest({
      id: Date.now().toString(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: role || 'viewer',
      block: block || '',
      phc: phc || '',
      message: message || '',
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/auth/access-requests  (admin only)
router.get('/access-requests', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try { res.json(await db.getAccessRequests()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/auth/access-requests/:id/approve  (admin only)
router.post('/access-requests/:id/approve', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const requests = await db.getAccessRequests();
    const ar = requests.find(r => r.id === req.params.id);
    if (!ar) return res.status(404).json({ error: 'Request not found' });
    const password = (req.body && req.body.tempPassword) ? req.body.tempPassword : 'Welcome@2026';
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    // Derive username from email prefix, sanitised
    const base = ar.email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20);
    const username = base || 'user' + req.params.id.slice(-4);
    // Check for duplicate username
    const existing = await db.queryOne('SELECT username FROM users WHERE username = ?', [username]);
    const finalUsername = existing ? username + '_' + req.params.id.slice(-4) : username;
    await db.run(
      'INSERT INTO users (username,name,email,role,block,phc,password_hash,active) VALUES (?,?,?,?,?,?,?,1)',
      [finalUsername, ar.name, ar.email, ar.role, ar.block||'', ar.phc||'', hash]
    );
    await db.deleteAccessRequest(req.params.id);
    res.json({ ok: true, username: finalUsername, tempPassword: password });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/auth/access-requests/:id  (admin only)
router.delete('/access-requests/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try { await db.deleteAccessRequest(req.params.id); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
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
