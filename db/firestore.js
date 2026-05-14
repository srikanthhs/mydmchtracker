'use strict';
/**
 * Firebase Firestore backend — used on Vercel (production).
 * Activated when FIREBASE_SERVICE_ACCOUNT env var is set.
 *
 * Collections mirror the original app:
 *   hrp_patients   — patient records
 *   hrp_users      — user accounts
 *   hrp_alert_schedules — alert schedules
 *   hrp_audit      — audit log
 */
const bcrypt = require('bcryptjs');

let _admin = null;
let _db    = null;

async function init() {
  if (_db) return;

  const admin = require('firebase-admin');
  _admin = admin;

  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');

    let serviceAccount;
    try {
      // Accept base64-encoded or raw JSON
      serviceAccount = JSON.parse(
        raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
      );
    } catch (e) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON: ' + e.message);
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  _db = admin.firestore();
  await _ensureAdmin();
  console.log('[DB] Firebase Firestore connected');
}

// ── Firestore helpers ─────────────────────────────────────────
// Convert a Firestore doc snapshot to a plain object
function _snap(doc) {
  return doc.exists ? { ...doc.data(), _id: doc.id } : null;
}

// ── Patient helpers ───────────────────────────────────────────
function _patientToDoc(row) {
  // row already has as_status; Firestore stores it directly
  const { as_status, ...rest } = row;
  return { ...rest, as: as_status };
}

function _docToPatientRow(doc) {
  const { as, ...rest } = doc;
  return { ...rest, as_status: as };
}

// ── Admin bootstrap ───────────────────────────────────────────
async function _ensureAdmin() {
  const doc = await _db.collection('hrp_users').doc('admin').get();
  if (!doc.exists) {
    const hash = await bcrypt.hash('Admin@2026', 10);
    await _db.collection('hrp_users').doc('admin').set({
      username: 'admin', name: 'System Admin',
      role: 'admin', block: '',
      password_hash: hash, active: true,
      created_at: new Date().toISOString(),
    });
    console.log('[DB] Bootstrap admin created (admin / Admin@2026)');
  }
}

// ── Unified async query interface (matches sqlite.js / pg.js) ─

async function query(sql, params = []) {
  // Translate a small set of SQL patterns to Firestore calls.
  // Only patterns actually used by the routes are handled.

  // SELECT * FROM patients
  if (/SELECT \* FROM patients ORDER BY e/.test(sql)) {
    const snap = await _db.collection('hrp_patients').orderBy('e').get();
    return snap.docs.map(d => _docToPatientRow({ ...d.data(), id: d.id }));
  }
  if (/SELECT \* FROM patients WHERE b = \? AND p = \?/.test(sql)) {
    const snap = await _db.collection('hrp_patients').where('b', '==', params[0]).where('p', '==', params[1]).orderBy('e').get();
    return snap.docs.map(d => _docToPatientRow({ ...d.data(), id: d.id }));
  }
  if (/SELECT \* FROM patients WHERE b = \?/.test(sql)) {
    const snap = await _db.collection('hrp_patients').where('b', '==', params[0]).orderBy('e').get();
    return snap.docs.map(d => _docToPatientRow({ ...d.data(), id: d.id }));
  }
  if (/SELECT \* FROM patients WHERE 1=1/.test(sql)) {
    // Report query — filter in JS after fetching all
    let ref = _db.collection('hrp_patients');
    // Extract block/status from sql/params dynamically
    const blockMatch = /AND b = \?/.test(sql);
    const statusMatch = /AND ds NOT IN/.test(sql) || /AND ds = \?/.test(sql);
    let blockParam = null, statusParam = null;
    let pi = 0;
    if (blockMatch) blockParam = params[pi++];
    if (/AND ds = \?/.test(sql)) statusParam = params[pi++];
    if (blockParam) ref = ref.where('b', '==', blockParam);
    const snap = await ref.get();
    let rows = snap.docs.map(d => _docToPatientRow({ ...d.data(), id: d.id }));
    if (/ds NOT IN/.test(sql)) rows = rows.filter(r => r.ds !== 'Delivered' && r.ds !== 'Abortion');
    if (statusParam) rows = rows.filter(r => r.ds === statusParam);
    return rows;
  }
  // SELECT r FROM patients WHERE r != '[]'
  if (/SELECT r FROM patients/.test(sql)) {
    const snap = await _db.collection('hrp_patients').get();
    return snap.docs.map(d => d.data()).filter(d => {
      try { const r = JSON.parse(d.r || '[]'); return r.length > 0; } catch { return false; }
    }).map(d => ({ r: d.r }));
  }
  // COUNT queries
  if (/SELECT COUNT\(\*\) as c FROM patients WHERE ds NOT IN/.test(sql)) {
    const snap = await _db.collection('hrp_patients').get();
    const c = snap.docs.filter(d => { const ds=d.data().ds; return ds!=='Delivered'&&ds!=='Abortion'; }).length;
    return [{ c }];
  }
  if (/SELECT COUNT\(\*\) as c FROM patients WHERE ds = 'Delivered'/.test(sql)) {
    const snap = await _db.collection('hrp_patients').where('ds','==','Delivered').get();
    return [{ c: snap.size }];
  }
  if (/SELECT COUNT\(\*\) as c FROM patients/.test(sql)) {
    const snap = await _db.collection('hrp_patients').get();
    return [{ c: snap.size }];
  }
  // SELECT * FROM users
  if (/SELECT .+ FROM users ORDER BY created_at/.test(sql)) {
    const snap = await _db.collection('hrp_users').get();
    return snap.docs.map(d => ({ ...d.data(), username: d.id }));
  }
  if (/SELECT .+ FROM users WHERE username = \?/.test(sql)) {
    const doc = await _db.collection('hrp_users').doc(params[0]).get();
    return doc.exists ? [{ ...doc.data(), username: doc.id }] : [];
  }
  if (/SELECT \* FROM users WHERE email = \?/.test(sql)) {
    const snap = await _db.collection('hrp_users').where('email', '==', params[0]).limit(1).get();
    return snap.docs.map(d => ({ ...d.data(), username: d.id }));
  }
  // SELECT * FROM schedules
  if (/SELECT \* FROM schedules ORDER BY date/.test(sql)) {
    const snap = await _db.collection('hrp_alert_schedules').orderBy('date').get();
    return snap.docs.map(d => ({
      id: d.id, alert_idx: d.data().alertIdx ?? d.data().alert_idx ?? 0,
      type: d.data().type, date: d.data().date,
      block: d.data().block || '', risk: d.data().risk || '',
      created_at: d.data().createdAt || d.data().created_at || '',
      fired: d.data().fired ? 1 : 0, fired_at: d.data().firedAt || null,
    }));
  }
  if (/SELECT id FROM schedules WHERE id = \?/.test(sql)) {
    const doc = await _db.collection('hrp_alert_schedules').doc(params[0]).get();
    return doc.exists ? [{ id: doc.id }] : [];
  }
  // SELECT * FROM access_requests
  if (/SELECT \* FROM access_requests ORDER BY created_at/.test(sql)) {
    const snap = await _db.collection('hrp_access_requests').orderBy('created_at','desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // SELECT * FROM audit_log
  if (/SELECT \* FROM audit_log ORDER BY created_at DESC/.test(sql)) {
    const snap = await _db.collection('hrp_audit').orderBy('created_at','desc').limit(200).get();
    return snap.docs.map((d,i) => ({ id: i+1, ...d.data() }));
  }
  // DISTINCT blocks
  if (/SELECT DISTINCT b FROM patients/.test(sql)) {
    const snap = await _db.collection('hrp_patients').get();
    const blocks = [...new Set(snap.docs.map(d=>d.data().b).filter(Boolean))].sort();
    return blocks.map(b => ({ b }));
  }

  console.warn('[Firestore] Unhandled SQL pattern:', sql.slice(0, 80));
  return [];
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

async function run(sql, params = []) {
  // Handle individual write operations by parsing the SQL pattern
  const FieldValue = _admin.firestore.FieldValue;
  const now = new Date().toISOString();

  // ── Patients ───────────────────────────────────────────────
  if (/INSERT INTO patients/.test(sql) && !/ON CONFLICT/.test(sql)) {
    // params: [id,b,p,h,n,hu,e,a,ph,g,pa,r,pp,pt,pd,lv,nv,rm,as_status,ds,dd,fp,mo,mop]
    const [id,b,p,h,n,hu,e,a,ph,g,pa,r,pp,pt,pd,lv,nv,rm,as_status,ds,dd,fp,mo,mop] = params;
    await _db.collection('hrp_patients').doc(id).set({
      b,p,h,n,hu,e,a,ph,g,pa,r,pp,pt,pd,lv,nv,rm,as:as_status,ds,dd,fp,mo,mop,
      created_at:now, updated_at:now,
    }, { merge: true });
    return;
  }
  if (/UPDATE patients SET/.test(sql)) {
    // params: [b,p,h,n,hu,e,a,ph,g,pa,r,pp,pt,pd,lv,nv,rm,as_status,ds,dd,fp,mo,mop,id]
    const id = params[params.length - 1];
    const [b,p,h,n,hu,e,a,ph,g,pa,r,pp,pt,pd,lv,nv,rm,as_status,ds,dd,fp,mo,mop] = params;
    await _db.collection('hrp_patients').doc(id).update({
      b,p,h,n,hu,e,a,ph,g,pa,r,pp,pt,pd,lv,nv,rm,as:as_status,ds,dd,fp,mo,mop,
      updated_at: now,
    });
    return;
  }
  if (/DELETE FROM patients WHERE id/.test(sql)) {
    await _db.collection('hrp_patients').doc(params[0]).delete(); return;
  }

  // ── Users ──────────────────────────────────────────────────
  if (/INSERT INTO users/.test(sql)) {
    // params: [username, name, email, role, block, phc, password_hash]
    const [username,name,email,role,block,phc,password_hash] = params;
    await _db.collection('hrp_users').doc(username).set({
      username,name,email:email||'',role,block,phc:phc||'',password_hash,active:true,created_at:now,updated_at:now,
    }); return;
  }
  if (/UPDATE users SET name/.test(sql)) {
    // params: [name, email, role, block, phc, password_hash, active, username]
    const username = params[params.length - 1];
    const [name,email,role,block,phc,password_hash,active] = params;
    await _db.collection('hrp_users').doc(username).update({
      name,email:email||'',role,block,phc:phc||'',password_hash,active:!!active,updated_at:now,
    }); return;
  }
  if (/UPDATE users SET last_login/.test(sql)) {
    await _db.collection('hrp_users').doc(params[0]).update({ last_login: now }); return;
  }
  if (/UPDATE users SET password_hash/.test(sql)) {
    await _db.collection('hrp_users').doc(params[1]).update({ password_hash:params[0],updated_at:now }); return;
  }
  if (/DELETE FROM users WHERE username/.test(sql)) {
    await _db.collection('hrp_users').doc(params[0]).delete(); return;
  }

  // ── Schedules ─────────────────────────────────────────────
  if (/INSERT INTO schedules/.test(sql)) {
    const [id,alertIdx,type,date,block,risk] = params;
    await _db.collection('hrp_alert_schedules').doc(id).set({
      id,alertIdx:alertIdx??0,type,date,block:block||'',risk:risk||'',
      fired:false,firedAt:null,createdAt:now,
    }, { merge: true }); return;
  }
  if (/UPDATE schedules SET fired/.test(sql)) {
    const [fired,firedAt,id] = params;
    await _db.collection('hrp_alert_schedules').doc(id).update({
      fired:!!fired, firedAt:firedAt||null,
    }); return;
  }
  if (/UPDATE schedules SET date/.test(sql)) {
    await _db.collection('hrp_alert_schedules').doc(params[1]).update({ date:params[0] }); return;
  }
  if (/UPDATE schedules SET block/.test(sql)) {
    await _db.collection('hrp_alert_schedules').doc(params[1]).update({ block:params[0] }); return;
  }
  if (/UPDATE schedules SET risk/.test(sql)) {
    await _db.collection('hrp_alert_schedules').doc(params[1]).update({ risk:params[0] }); return;
  }
  if (/DELETE FROM schedules WHERE id/.test(sql)) {
    await _db.collection('hrp_alert_schedules').doc(params[0]).delete(); return;
  }

  // ── Access requests ───────────────────────────────────────
  if (/INSERT INTO access_requests/.test(sql)) {
    const [id,name,email,role,block,phc,message] = params;
    await _db.collection('hrp_access_requests').doc(id).set({
      name,email,role,block,phc,message, created_at: now,
    }); return;
  }
  if (/DELETE FROM access_requests WHERE id/.test(sql)) {
    await _db.collection('hrp_access_requests').doc(params[0]).delete(); return;
  }

  // ── Audit ─────────────────────────────────────────────────
  if (/INSERT INTO audit_log/.test(sql)) {
    await _db.collection('hrp_audit').add({
      username:params[0], action:params[1], entity:params[2],
      entity_id:params[3]||'', detail:params[4]||'', created_at:now,
    }); return;
  }

  console.warn('[Firestore] Unhandled SQL run pattern:', sql.slice(0, 80));
}

async function upsertPatient(row) {
  const { as_status, id, ...rest } = row;
  await _db.collection('hrp_patients').doc(id).set({
    ...rest, as: as_status,
    updated_at: new Date().toISOString(),
  }, { merge: true });
}

async function flush() { /* no-op — Firestore writes are immediate */ }

module.exports = { init, query, queryOne, run, upsertPatient, flush };
