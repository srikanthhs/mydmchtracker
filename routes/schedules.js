'use strict';
const router = require('express').Router();
const db = require('../db/database');
const { requireAuth, requireEditor } = require('../middleware/auth');

router.use(requireAuth);

function schedFromRow(r) {
  return {
    id: r.id, alertIdx: r.alert_idx, type: r.type,
    date: r.date, block: r.block, risk: r.risk,
    createdAt: r.created_at, fired: r.fired === 1 || r.fired === true,
    firedAt: r.fired_at,
  };
}

router.get('/', async (_req, res) => {
  try {
    const rows = await db.query('SELECT * FROM schedules ORDER BY date ASC');
    res.json(rows.map(schedFromRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', requireEditor, async (req, res) => {
  try {
    const { id, alertIdx, type, date, block, risk } = req.body || {};
    if (!date || type === undefined) return res.status(400).json({ error: 'date and type are required' });
    const schedId = id || Date.now().toString();
    await db.run(
      `INSERT INTO schedules (id,alert_idx,type,date,block,risk)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET alert_idx=excluded.alert_idx,type=excluded.type,
         date=excluded.date,block=excluded.block,risk=excluded.risk`,
      [schedId, alertIdx ?? 0, type, date, block || '', risk || '']
    );
    res.status(201).json({ ok: true, id: schedId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', requireEditor, async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT id FROM schedules WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Schedule not found' });
    const { fired, firedAt, date, block, risk } = req.body || {};
    if (fired !== undefined)
      await db.run('UPDATE schedules SET fired=?,fired_at=? WHERE id=?',
        [fired ? 1 : 0, firedAt || null, req.params.id]);
    if (date  !== undefined) await db.run('UPDATE schedules SET date=?  WHERE id=?', [date,  req.params.id]);
    if (block !== undefined) await db.run('UPDATE schedules SET block=? WHERE id=?', [block, req.params.id]);
    if (risk  !== undefined) await db.run('UPDATE schedules SET risk=?  WHERE id=?', [risk,  req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', requireEditor, async (req, res) => {
  try {
    await db.run('DELETE FROM schedules WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
