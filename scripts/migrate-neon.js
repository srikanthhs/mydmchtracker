/**
 * migrate-neon.js
 * Runs once to create the schema on Neon PostgreSQL AND seeds all patients
 * from the local SQLite database into Neon.
 *
 * Run AFTER setting DATABASE_URL in your environment:
 *   $env:DATABASE_URL="postgres://..."   # PowerShell
 *   node scripts/migrate-neon.js
 */
'use strict';
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  console.error('Set it to your Neon connection string and re-run.');
  process.exit(1);
}

const { neon } = require('@neondatabase/serverless');
const fs   = require('fs');
const path = require('path');

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  console.log('Connected to Neon PostgreSQL');

  // ── 1. Create schema ─────────────────────────────────────────
  console.log('Creating schema…');
  await sql`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY, b TEXT, p TEXT, h TEXT, n TEXT, hu TEXT,
      e TEXT, a INTEGER, ph TEXT, g TEXT, pa TEXT, r TEXT DEFAULT '[]',
      pp TEXT, pt TEXT, lv TEXT, nv TEXT, rm TEXT, as_status TEXT,
      ds TEXT, dd TEXT, fp TEXT, mo TEXT, mop TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY, name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer', block TEXT DEFAULT '',
      password_hash TEXT NOT NULL, active INTEGER DEFAULT 1,
      last_login TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY, alert_idx INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL, date TEXT NOT NULL, block TEXT DEFAULT '',
      risk TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(),
      fired INTEGER DEFAULT 0, fired_at TIMESTAMPTZ
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY, username TEXT,
      action TEXT, entity TEXT, entity_id TEXT, detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_p_block ON patients(b)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_p_ds    ON patients(ds)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_p_edd   ON patients(e)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_s_date  ON schedules(date)`;
  console.log('✓ Schema created');

  // ── 2. Seed bootstrap admin ───────────────────────────────────
  const bcrypt = require('bcryptjs');
  const admins = await sql`SELECT username FROM users WHERE username = 'admin'`;
  if (!admins.length) {
    const hash = await bcrypt.hash('Admin@2026', 10);
    await sql`INSERT INTO users (username,name,role,block,password_hash,active)
              VALUES ('admin','System Admin','admin','',${hash},1)`;
    console.log('✓ Bootstrap admin created (admin / Admin@2026)');
  } else {
    console.log('✓ Bootstrap admin already exists');
  }

  // ── 3. Seed patients from local SQLite ────────────────────────
  const DB_PATH = path.join(__dirname, '..', 'db', 'hrp.db');
  if (!fs.existsSync(DB_PATH)) {
    console.log('⚠ Local db/hrp.db not found — skipping patient seed');
    console.log('  Run  node scripts/seed.js  first to populate it, then re-run this script.');
    process.exit(0);
  }

  console.log('Reading patients from local SQLite…');
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const localDb = new SQL.Database(fs.readFileSync(DB_PATH));
  const stmt = localDb.prepare('SELECT * FROM patients');
  const patients = [];
  while (stmt.step()) patients.push(stmt.getAsObject());
  stmt.free();
  console.log(`Found ${patients.length} patients — uploading to Neon in batches…`);

  const BATCH = 50;
  let written = 0, failed = 0;
  for (let i = 0; i < patients.length; i += BATCH) {
    const chunk = patients.slice(i, i + BATCH);
    for (const p of chunk) {
      try {
        await sql`
          INSERT INTO patients (id,b,p,h,n,hu,e,a,ph,g,pa,r,pp,pt,lv,nv,rm,as_status,ds,dd,fp,mo,mop)
          VALUES (${p.id},${p.b},${p.p},${p.h},${p.n},${p.hu},
                  ${p.e},${p.a},${p.ph},${p.g},${p.pa},${p.r},
                  ${p.pp},${p.pt},${p.lv},${p.nv},${p.rm},
                  ${p.as_status},${p.ds},${p.dd},${p.fp},${p.mo},${p.mop})
          ON CONFLICT (id) DO UPDATE SET
            b=EXCLUDED.b,p=EXCLUDED.p,h=EXCLUDED.h,n=EXCLUDED.n,hu=EXCLUDED.hu,
            e=EXCLUDED.e,a=EXCLUDED.a,ph=EXCLUDED.ph,g=EXCLUDED.g,pa=EXCLUDED.pa,
            r=EXCLUDED.r,pp=EXCLUDED.pp,pt=EXCLUDED.pt,lv=EXCLUDED.lv,nv=EXCLUDED.nv,
            rm=EXCLUDED.rm,as_status=EXCLUDED.as_status,ds=EXCLUDED.ds,dd=EXCLUDED.dd,
            fp=EXCLUDED.fp,mo=EXCLUDED.mo,mop=EXCLUDED.mop,updated_at=NOW()`;
        written++;
      } catch (e) { failed++; }
    }
    process.stdout.write(`\r  ${written + failed}/${patients.length} processed…`);
  }
  console.log(`\n✅ Migration complete: ${written} uploaded, ${failed} failed`);

  // ── 4. Verify ─────────────────────────────────────────────────
  const count = await sql`SELECT COUNT(*) as c FROM patients`;
  console.log(`   Neon now has ${count[0].c} patients\n`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
