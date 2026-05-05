'use strict';
const router = require('express').Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/summary', async (req, res) => {
  try {
    const { block, status } = req.query;
    let sql = 'SELECT * FROM patients WHERE 1=1';
    const params = [];
    if (block) { sql += ' AND b = ?'; params.push(block); }
    if (status === 'active') sql += " AND ds NOT IN ('Delivered','Abortion')";
    else if (status) { sql += ' AND ds = ?'; params.push(status); }

    const patients = (await db.query(sql, params)).map(db.patientFromRow);
    const total     = patients.length;
    const active    = patients.filter(p => p.ds !== 'Delivered' && p.ds !== 'Abortion').length;
    const delivered = patients.filter(p => p.ds === 'Delivered').length;
    const highRisk  = patients.filter(p => p.r && p.r.length > 0).length;

    const byBlock = {};
    patients.forEach(p => {
      if (!byBlock[p.b]) byBlock[p.b] = { block: p.b, total:0, active:0, delivered:0, highRisk:0 };
      byBlock[p.b].total++;
      if (p.ds !== 'Delivered' && p.ds !== 'Abortion') byBlock[p.b].active++;
      if (p.ds === 'Delivered') byBlock[p.b].delivered++;
      if (p.r && p.r.length > 0) byBlock[p.b].highRisk++;
    });

    res.json({
      summary: { total, active, delivered, highRisk },
      byBlock: Object.values(byBlock).sort((a, b) => a.block.localeCompare(b.block)),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/blocks', async (_req, res) => {
  try {
    const rows = await db.query("SELECT DISTINCT b FROM patients WHERE b != '' ORDER BY b");
    res.json(rows.map(r => r.b));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/audit', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const rows = await db.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
