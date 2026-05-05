'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db     = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10');

router.use(requireAuth);

router.get('/', requireAdmin, async (_req, res) => {
  try {
    const rows = await db.query(
      'SELECT username,name,role,block,active,last_login,created_at FROM users ORDER BY created_at ASC'
    );
    res.json(rows.map(u => ({ ...u, active: u.active === 1 || u.active === true })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:username', requireAdmin, async (req, res) => {
  try {
    const u = await db.queryOne(
      'SELECT username,name,role,block,active,last_login FROM users WHERE username = ?',
      [req.params.username]
    );
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ ...u, active: u.active === 1 || u.active === true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { username, name, role, block, password } = req.body || {};
    if (!username || !name || !role || !password)
      return res.status(400).json({ error: 'username, name, role and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be ≥ 6 characters' });
    if (username === 'admin') return res.status(400).json({ error: '"admin" is reserved' });

    const uname = username.toLowerCase();
    const existing = await db.queryOne('SELECT username FROM users WHERE username = ?', [uname]);
    if (existing) return res.status(409).json({ error: 'Username already exists' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.run(
      'INSERT INTO users (username,name,role,block,password_hash,active) VALUES (?,?,?,?,?,1)',
      [uname, name, role, block || '', hash]
    );
    res.status(201).json({ ok: true, username: uname });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:username', requireAdmin, async (req, res) => {
  try {
    const u = await db.queryOne('SELECT * FROM users WHERE username = ?', [req.params.username]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const { name, role, block, password, active } = req.body || {};
    let hash = u.password_hash;
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Password must be ≥ 6 characters' });
      hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    }
    await db.run(
      `UPDATE users SET name=?,role=?,block=?,password_hash=?,active=?,updated_at=datetime('now') WHERE username=?`,
      [name ?? u.name, role ?? u.role,
       block !== undefined ? block : u.block,
       hash,
       active !== undefined ? (active ? 1 : 0) : u.active,
       u.username]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:username', requireAdmin, async (req, res) => {
  try {
    if (req.params.username === 'admin')
      return res.status(400).json({ error: 'Cannot delete bootstrap admin' });
    if (req.params.username === req.user.username)
      return res.status(400).json({ error: 'Cannot delete your own account' });
    await db.run('DELETE FROM users WHERE username = ?', [req.params.username]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
