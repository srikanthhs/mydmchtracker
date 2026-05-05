/**
 * seed.js — Extracts the embedded patient array from the original index.html
 * and imports it into the SQLite database.
 *
 * Run: node scripts/seed.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SRC = process.env.SOURCE_HTML || path.join(__dirname, '..', '..', 'mch tracker', 'index.html');

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source HTML not found: ${SRC}`);
    console.error('Set SOURCE_HTML in .env to the correct path');
    process.exit(1);
  }

  console.log(`Reading source: ${SRC}`);
  const html = fs.readFileSync(SRC, 'utf8');

  // Extract JSON array from: let ALL = [...]
  const match = html.match(/^let ALL\s*=\s*(\[[\s\S]*?\]);/m);
  if (!match) {
    console.error('Could not find `let ALL = [...]` in the source HTML');
    process.exit(1);
  }

  let patients;
  try {
    patients = JSON.parse(match[1]);
  } catch (e) {
    console.error('Failed to parse patient data:', e.message);
    process.exit(1);
  }

  console.log(`Found ${patients.length} patient records — initialising database…`);

  const db = require('../db/database');
  await db.init();

  let written = 0, failed = 0;
  for (const rec of patients) {
    try {
      db.upsertPatient(db.patientToRow(rec));
      written++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.warn('  Skip:', e.message, JSON.stringify(rec).slice(0, 80));
    }
  }
  db.flush();

  console.log(`\n✅ Seed complete: ${written} inserted/updated, ${failed} skipped`);
  console.log(`   Database: db/hrp.db`);

  const count = db.queryOne('SELECT COUNT(*) as c FROM patients').c;
  console.log(`   Total patients in DB: ${count}\n`);
  process.exit(0);
}

main();
