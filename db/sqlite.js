'use strict';
/**
 * SQLite backend — used for local development.
 * Uses sql.js (WebAssembly) so no native compilation is needed.
 * All exported functions return Promises to match the PostgreSQL interface.
 */
const fs   = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'hrp.db');

let _SQL = null;
let _db  = null;
let _flushTimer = null;

async function init() {
  if (_db) return;
  const initSqlJs = require('sql.js');
  _SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
  });
  _db  = fs.existsSync(DB_PATH)
    ? new _SQL.Database(fs.readFileSync(DB_PATH))
    : new _SQL.Database();
  _db.run('PRAGMA journal_mode = WAL');
  _db.run('PRAGMA foreign_keys = ON');
  _createSchema();
  // Migration: add phc column if missing
  try { _db.run("ALTER TABLE users ADD COLUMN phc TEXT DEFAULT ''"); } catch {}
  await _ensureAdmin();
  _flush();
}

function _flush() {
  try { fs.writeFileSync(DB_PATH, Buffer.from(_db.export())); } catch {}
}

function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => { _flushTimer = null; _flush(); }, 500);
}

function _createSchema() {
  _db.run(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY, b TEXT, p TEXT, h TEXT, n TEXT, hu TEXT,
      e TEXT, a INTEGER, ph TEXT, g TEXT, pa TEXT, r TEXT DEFAULT '[]',
      pp TEXT, pt TEXT, lv TEXT, nv TEXT, rm TEXT, as_status TEXT,
      ds TEXT, dd TEXT, fp TEXT, mo TEXT, mop TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY, name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer', block TEXT DEFAULT '',
      phc TEXT DEFAULT '',
      password_hash TEXT NOT NULL, active INTEGER DEFAULT 1,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY, alert_idx INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL, date TEXT NOT NULL, block TEXT DEFAULT '',
      risk TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')),
      fired INTEGER DEFAULT 0, fired_at TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT,
      action TEXT, entity TEXT, entity_id TEXT, detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_p_block ON patients(b);
    CREATE INDEX IF NOT EXISTS idx_p_ds    ON patients(ds);
    CREATE INDEX IF NOT EXISTS idx_p_edd   ON patients(e);
    CREATE INDEX IF NOT EXISTS idx_s_date  ON schedules(date);
  `);
}

async function _ensureAdmin() {
  const rows = await query('SELECT username FROM users WHERE username = ?', ['admin']);
  if (!rows.length) {
    const hash = bcrypt.hashSync('Admin@2026', 10);
    await run(
      'INSERT INTO users (username,name,role,block,password_hash,active) VALUES (?,?,?,?,?,1)',
      ['admin', 'System Admin', 'admin', '', hash]
    );
    console.log('[DB] Bootstrap admin created (admin / Admin@2026)');
  }
}

async function query(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

async function run(sql, params = []) {
  _db.run(sql, params);
  _scheduleFlush();
}

async function upsertPatient(row) {
  _db.run(`
    INSERT INTO patients (id,b,p,h,n,hu,e,a,ph,g,pa,r,pp,pt,lv,nv,rm,as_status,ds,dd,fp,mo,mop)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      b=excluded.b,p=excluded.p,h=excluded.h,n=excluded.n,hu=excluded.hu,
      e=excluded.e,a=excluded.a,ph=excluded.ph,g=excluded.g,pa=excluded.pa,
      r=excluded.r,pp=excluded.pp,pt=excluded.pt,lv=excluded.lv,nv=excluded.nv,
      rm=excluded.rm,as_status=excluded.as_status,ds=excluded.ds,dd=excluded.dd,
      fp=excluded.fp,mo=excluded.mo,mop=excluded.mop,updated_at=datetime('now')
  `, [row.id,row.b,row.p,row.h,row.n,row.hu,row.e,row.a,row.ph,row.g,row.pa,row.r,
      row.pp,row.pt,row.lv,row.nv,row.rm,row.as_status,row.ds,row.dd,row.fp,row.mo,row.mop]);
  _scheduleFlush();
}

async function flush() { _flush(); }

module.exports = { init, query, queryOne, run, upsertPatient, flush };
