'use strict';
const router = require('express').Router();
const db = require('../db/database');
const { requireAuth, requireEditor } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/patients/stats/summary  (before /:id)
router.get('/stats/summary', async (_req, res) => {
  try {
    const [t, a, d] = await Promise.all([
      db.queryOne('SELECT COUNT(*) as c FROM patients'),
      db.queryOne("SELECT COUNT(*) as c FROM patients WHERE ds NOT IN ('Delivered','Abortion')"),
      db.queryOne("SELECT COUNT(*) as c FROM patients WHERE ds = 'Delivered'"),
    ]);
    const allPats = await db.query("SELECT r FROM patients WHERE r != '[]'");
    res.json({
      total:     parseInt(t.c) || 0,
      active:    parseInt(a.c) || 0,
      delivered: parseInt(d.c) || 0,
      highRisk:  allPats.length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/patients
router.get('/', async (req, res) => {
  try {
    const rows = req.user.role === 'bdo' && req.user.block
      ? await db.query('SELECT * FROM patients WHERE b = ? ORDER BY e ASC', [req.user.block])
      : await db.query('SELECT * FROM patients ORDER BY e ASC');
    res.json(rows.map(db.patientFromRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/patients/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await db.queryOne('SELECT * FROM patients WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Patient not found' });
    res.json(db.patientFromRow(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/patients/bulk  (before /:id to avoid conflict)
router.post('/bulk', requireEditor, async (req, res) => {
  try {
    const records = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: 'Expected array' });

    let written = 0, failed = 0;
    for (const rec of records) {
      try { await db.upsertPatient(db.patientToRow(rec)); written++; }
      catch { failed++; }
    }
    await db.flush();
    await _audit(req.user.username, 'bulk_import', 'patient', null, `${written} written, ${failed} failed`);
    res.json({ ok: true, written, failed, total: records.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/patients
router.post('/', requireEditor, async (req, res) => {
  try {
    const row      = db.patientToRow(req.body);
    const existing = await db.queryOne('SELECT id FROM patients WHERE id = ?', [row.id]);
    if (existing) {
      await db.run(
        `UPDATE patients SET b=?,p=?,h=?,n=?,hu=?,e=?,a=?,ph=?,g=?,pa=?,r=?,pp=?,pt=?,
         lv=?,nv=?,rm=?,as_status=?,ds=?,dd=?,fp=?,mo=?,mop=?,updated_at=datetime('now') WHERE id=?`,
        [row.b,row.p,row.h,row.n,row.hu,row.e,row.a,row.ph,row.g,row.pa,row.r,row.pp,row.pt,
         row.lv,row.nv,row.rm,row.as_status,row.ds,row.dd,row.fp,row.mo,row.mop,row.id]);
    } else {
      await db.run(
        `INSERT INTO patients (id,b,p,h,n,hu,e,a,ph,g,pa,r,pp,pt,lv,nv,rm,as_status,ds,dd,fp,mo,mop)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [row.id,row.b,row.p,row.h,row.n,row.hu,row.e,row.a,row.ph,row.g,row.pa,row.r,
         row.pp,row.pt,row.lv,row.nv,row.rm,row.as_status,row.ds,row.dd,row.fp,row.mo,row.mop]);
    }
    await _audit(req.user.username, existing ? 'update' : 'create', 'patient', row.id);
    res.json({ ok: true, id: row.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/patients/:id
router.put('/:id', requireEditor, async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT id FROM patients WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Patient not found' });
    const row = db.patientToRow({ ...req.body, id: req.params.id });
    await db.run(
      `UPDATE patients SET b=?,p=?,h=?,n=?,hu=?,e=?,a=?,ph=?,g=?,pa=?,r=?,pp=?,pt=?,
       lv=?,nv=?,rm=?,as_status=?,ds=?,dd=?,fp=?,mo=?,mop=?,updated_at=datetime('now') WHERE id=?`,
      [row.b,row.p,row.h,row.n,row.hu,row.e,row.a,row.ph,row.g,row.pa,row.r,row.pp,row.pt,
       row.lv,row.nv,row.rm,row.as_status,row.ds,row.dd,row.fp,row.mo,row.mop,row.id]);
    await _audit(req.user.username, 'update', 'patient', req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/patients/:id
router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    await db.run('DELETE FROM patients WHERE id = ?', [req.params.id]);
    await _audit(req.user.username, 'delete', 'patient', req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function _audit(username, action, entity, entityId, detail) {
  try {
    await db.run('INSERT INTO audit_log (username,action,entity,entity_id,detail) VALUES (?,?,?,?,?)',
      [username || 'system', action, entity, entityId || '', detail || '']);
  } catch {}
}

module.exports = router;
