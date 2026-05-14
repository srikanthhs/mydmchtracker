'use strict';
/**
 * Database selector — picks the right backend automatically:
 *
 *   FIREBASE_SERVICE_ACCOUNT set → Firebase Firestore   (Vercel / production)
 *   DATABASE_URL set             → Neon PostgreSQL       (alternative cloud)
 *   neither                      → sql.js SQLite         (local development)
 *
 * All three backends export the same async interface:
 *   init(), query(), queryOne(), run(), upsertPatient(), flush()
 */
require('dotenv').config();

function selectBackend() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return require('./firestore');
  if (process.env.DATABASE_URL)             return require('./pg');
  return require('./sqlite');
}

const backend = selectBackend();

// ── Shared domain helpers (identical for all backends) ────────
function patientFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,  b: row.b,  p: row.p,  h: row.h,
    n:  row.n,  hu: row.hu, e: row.e,  a: row.a,  ph: row.ph,
    g:  row.g,  pa: row.pa,
    r: (() => { try { return JSON.parse(row.r || '[]'); } catch { return []; } })(),
    pp: row.pp, pt: row.pt, pd: row.pd,
    lv: row.lv, nv: row.nv, rm: row.rm,
    as: row.as_status ?? row.as,
    ds: row.ds, dd: row.dd, fp: row.fp, mo: row.mo, mop: row.mop,
  };
}

function patientToRow(p) {
  const rawKey = p.id
    ? String(p.id).trim()
    : ((p.n || '') + '_' + (p.e || '')).replace(/[^a-zA-Z0-9_-]/g, '_');
  const id = (rawKey || 'rec_' + Date.now()).slice(0, 80);
  return {
    id, b: p.b||'', p: p.p||'', h: p.h||'',
    n: p.n||'', hu: p.hu||'',
    e: p.e||'', a: p.a ?? null, ph: p.ph||'',
    g: p.g||'', pa: p.pa||'',
    r: JSON.stringify(Array.isArray(p.r) ? p.r : []),
    pp: p.pp||'', pt: p.pt||'', pd: p.pd||'',
    lv: p.lv||'', nv: p.nv||'', rm: p.rm||'',
    as_status: p.as||'',
    ds: p.ds||'', dd: p.dd||'', fp: p.fp||'',
    mo: p.mo||'', mop: p.mop||'',
  };
}

// ── Access request helpers ────────────────────────────────────
async function storeAccessRequest(req) {
  await backend.run(
    `INSERT INTO access_requests (id,name,email,role,block,phc,message) VALUES (?,?,?,?,?,?,?)`,
    [req.id, req.name, req.email, req.role||'viewer', req.block||'', req.phc||'', req.message||'']
  );
}

async function getAccessRequests() {
  return backend.query('SELECT * FROM access_requests ORDER BY created_at DESC');
}

async function deleteAccessRequest(id) {
  await backend.run('DELETE FROM access_requests WHERE id = ?', [id]);
}

module.exports = { ...backend, patientFromRow, patientToRow, storeAccessRequest, getAccessRequests, deleteAccessRequest };
