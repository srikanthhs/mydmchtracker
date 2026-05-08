'use strict';
/**
 * PostgreSQL backend — used on Vercel (Neon serverless).
 * Activated when DATABASE_URL env var is set.
 * Uses @neondatabase/serverless for HTTP-based connections (no TCP, works on edge).
 */
const bcrypt = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');

let sql;

function getSql() {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

// Convert SQLite-style ? placeholders to PostgreSQL $1, $2, ...
function pg(queryStr, params = []) {
  let i = 0;
  const converted = queryStr
    .replace(/datetime\('now'\)/gi, 'NOW()')
    .replace(/\?/g, () => `$${++i}`);
  return getSql()(converted, params);
}

// ── Schema (PostgreSQL-flavoured) ─────────────────────────────
async function init() {
  const s = getSql();
  await s`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY, b TEXT, p TEXT, h TEXT, n TEXT, hu TEXT,
      e TEXT, a INTEGER, ph TEXT, g TEXT, pa TEXT, r TEXT DEFAULT '[]',
      pp TEXT, pt TEXT, pd TEXT DEFAULT '', lv TEXT, nv TEXT, rm TEXT, as_status TEXT,
      ds TEXT, dd TEXT, fp TEXT, mo TEXT, mop TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await s`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY, name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer', block TEXT DEFAULT '',
      password_hash TEXT NOT NULL, active INTEGER DEFAULT 1,
      last_login TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await s`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY, alert_idx INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL, date TEXT NOT NULL, block TEXT DEFAULT '',
      risk TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(),
      fired INTEGER DEFAULT 0, fired_at TIMESTAMPTZ
    )`;
  await s`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY, username TEXT,
      action TEXT, entity TEXT, entity_id TEXT, detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await s`CREATE INDEX IF NOT EXISTS idx_p_block ON patients(b)`;
  await s`CREATE INDEX IF NOT EXISTS idx_p_ds    ON patients(ds)`;
  await s`CREATE INDEX IF NOT EXISTS idx_p_edd   ON patients(e)`;
  await s`CREATE INDEX IF NOT EXISTS idx_s_date  ON schedules(date)`;

  await _ensureAdmin(s);
}

async function _ensureAdmin(s) {
  const rows = await s`SELECT username FROM users WHERE username = 'admin'`;
  if (!rows.length) {
    const hash = await bcrypt.hash('Admin@2026', 10);
    await s`INSERT INTO users (username,name,role,block,password_hash,active)
            VALUES ('admin','System Admin','admin','',${hash},1)`;
    console.log('[DB] Bootstrap admin created (admin / Admin@2026)');
  }
}

// ── Query helpers (same interface as sqlite.js) ───────────────
async function query(queryStr, params = []) {
  return pg(queryStr, params);
}

async function queryOne(queryStr, params = []) {
  const rows = await pg(queryStr, params);
  return rows.length ? rows[0] : null;
}

async function run(queryStr, params = []) {
  await pg(queryStr, params);
}

async function upsertPatient(row) {
  const s = getSql();
  await s`
    INSERT INTO patients (id,b,p,h,n,hu,e,a,ph,g,pa,r,pp,pt,pd,lv,nv,rm,as_status,ds,dd,fp,mo,mop)
    VALUES (${row.id},${row.b},${row.p},${row.h},${row.n},${row.hu},
            ${row.e},${row.a},${row.ph},${row.g},${row.pa},${row.r},
            ${row.pp},${row.pt},${row.pd},${row.lv},${row.nv},${row.rm},
            ${row.as_status},${row.ds},${row.dd},${row.fp},${row.mo},${row.mop})
    ON CONFLICT (id) DO UPDATE SET
      b=EXCLUDED.b,p=EXCLUDED.p,h=EXCLUDED.h,n=EXCLUDED.n,hu=EXCLUDED.hu,
      e=EXCLUDED.e,a=EXCLUDED.a,ph=EXCLUDED.ph,g=EXCLUDED.g,pa=EXCLUDED.pa,
      r=EXCLUDED.r,pp=EXCLUDED.pp,pt=EXCLUDED.pt,pd=EXCLUDED.pd,
      lv=EXCLUDED.lv,nv=EXCLUDED.nv,
      rm=EXCLUDED.rm,as_status=EXCLUDED.as_status,ds=EXCLUDED.ds,dd=EXCLUDED.dd,
      fp=EXCLUDED.fp,mo=EXCLUDED.mo,mop=EXCLUDED.mop,updated_at=NOW()
  `;
}

async function flush() { /* no-op for PostgreSQL */ }

module.exports = { init, query, queryOne, run, upsertPatient, flush };
