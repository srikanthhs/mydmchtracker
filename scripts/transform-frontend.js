/**
 * transform-frontend.js
 * Reads the original single-file HRP Tracker HTML, strips the embedded patient
 * data array and all Firebase/Firestore calls, and writes a new index.html that
 * talks to the Express REST API instead.
 *
 * Run: node scripts/transform-frontend.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SRC = process.env.SOURCE_HTML || path.join(__dirname, '..', '..', 'mch tracker', 'index.html');
const OUT = path.join(__dirname, '..', 'public', 'index.html');

if (!fs.existsSync(SRC)) {
  console.error(`Source HTML not found: ${SRC}`);
  console.error('Set SOURCE_HTML in .env to the full path of the original index.html');
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
const originalSize = html.length;

// ── 1. Strip the massive embedded patient data array ──────────
// The line starts with: let ALL = [{"b":  (one giant line)
html = html.replace(/^let ALL\s*=\s*\[.*?\];?\s*$/m, 'let ALL = [];');
console.log('✓ Stripped embedded patient data');

// ── 2. Replace Firebase block (config, init, saveToFirestore, syncAllToFirestore)
const FIREBASE_BLOCK_START = '// ============================================================\n// FIREBASE';
const FIREBASE_BLOCK_END   = '// ============================================================\n// ALERT SCHEDULER';

const fbStart = html.indexOf(FIREBASE_BLOCK_START);
const fbEnd   = html.indexOf(FIREBASE_BLOCK_END);

if (fbStart === -1 || fbEnd === -1) {
  console.warn('⚠ Could not find Firebase block boundaries — applying fallback replacements');
} else {
  const API_REPLACEMENT = `
// ============================================================
// API CLIENT — replaces Firebase/Firestore (Three-Tier Arch.)
// ============================================================
let db = null;          // kept for compatibility
let fbReady = false;    // kept for compatibility
let pendingWrites = []; // kept for compatibility

function _getToken() {
  return sessionStorage.getItem('hrp_jwt') || '';
}

async function _api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _getToken() },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (res.status === 401) { signOut(); return null; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// No-op stubs that previously handled Firebase lifecycle
function setFbBadge(state, msg) {
  const badge = document.getElementById('fbBadge');
  if (!badge) return;
  badge.className = 'fb-sync-badge ok';
  badge.innerHTML = '<span class="material-icons-round" style="font-size:14px">storage</span>' + msg;
}
async function loadFirebaseSDK() { return true; }
async function initFirebase() {
  fbReady = true;
  setFbBadge('ok', 'API Connected');
  await loadSchedulesFromAPI();
}
async function ensureFirestoreReady() { return; }
async function flushPendingWrites() { return; }

// Save a single patient record to the API (called after add/edit)
async function saveToFirestore(rec) {
  try {
    await _api('POST', '/patients', rec);
    setFbBadge('ok', 'Saved · ' + new Date().toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'}));
  } catch(e) {
    showSnack('⚠ Save failed: ' + e.message.slice(0,60));
  }
}

// Push entire ALL array to the API (replaces syncAllToFirestore)
async function syncAllToFirestore() {
  const total = ALL.length;
  if (!total) { showSnack('No records to sync'); return; }
  showSnack('Syncing ' + total + ' records to database…');
  try {
    const result = await _api('POST', '/patients/bulk', ALL);
    if (result) {
      showSnack('✓ ' + result.written + ' records saved to database');
      setFbBadge('ok', result.written + ' records in DB');
    }
  } catch(e) {
    showSnack('⚠ Bulk sync failed: ' + e.message);
  }
}

`;
  html = html.slice(0, fbStart) + API_REPLACEMENT + '\n' + html.slice(fbEnd);
  console.log('✓ Replaced Firebase block with API client');
}

// ── 3. Replace loadSchedulesFromFirebase with API version ─────
html = html.replace(
  /async function loadSchedulesFromFirebase\(\)[^}]+\{[\s\S]*?^}/m,
  `async function loadSchedulesFromAPI() {
  try {
    const data = await _api('GET', '/schedules');
    if (Array.isArray(data)) {
      schedules = data;
      saveSchedulesLocal();
      renderSchedules();
      updateSchedBadge();
    }
    setFbBadge('ok', 'API · ' + schedules.length + ' schedules');
  } catch(e) {
    setFbBadge('err', 'Load failed');
  }
}
async function loadSchedulesFromFirebase() { return loadSchedulesFromAPI(); }`
);
console.log('✓ Replaced loadSchedulesFromFirebase');

// ── 4. Replace Firebase save in addSchedule ───────────────────
html = html.replace(
  /schedules\.push\(sched\);\s*saveSchedulesLocal\(\);\s*if \(fbReady && db\) \{[\s\S]*?renderSchedules\(\);/,
  `schedules.push(sched);
  saveSchedulesLocal();
  try { await _api('POST', '/schedules', sched); } catch(e) {}
  renderSchedules();`
);
console.log('✓ Replaced Firebase save in addSchedule');

// ── 5. Replace Firebase delete in deleteSchedule ──────────────
html = html.replace(
  /schedules = schedules\.filter\(s => s\.id !== id\);\s*saveSchedulesLocal\(\);\s*if \(fbReady && db\) \{[\s\S]*?\}\s*renderSchedules/,
  `schedules = schedules.filter(s => s.id !== id);
  saveSchedulesLocal();
  try { await _api('DELETE', '/schedules/' + id); } catch(e) {}
  renderSchedules`
);
console.log('✓ Replaced Firebase delete in deleteSchedule');

// ── 6. Replace Firebase update in fireScheduledAlert ─────────
html = html.replace(
  /sched\.fired = true;\s*sched\.firedAt = new Date\(\)\.toISOString\(\);\s*saveSchedulesLocal\(\);\s*if \(fbReady && db\) \{[\s\S]*?\.catch\(\(\)=>\{\}\);\s*\}/,
  `sched.fired = true;
  sched.firedAt = new Date().toISOString();
  saveSchedulesLocal();
  try { await _api('PUT', '/schedules/' + sched.id, { fired: true, firedAt: sched.firedAt }); } catch(e) {}`
);
console.log('✓ Replaced Firebase update in fireScheduledAlert');

// ── 7. Replace doLogin ────────────────────────────────────────
const OLD_LOGIN_START = '// ── Login ────────────────────────────────────────────────────';
const OLD_LOGIN_END   = '// ── Grant access ─────────────────────────────────────────────';

const loginStart = html.indexOf(OLD_LOGIN_START);
const loginEnd   = html.indexOf(OLD_LOGIN_END);

if (loginStart !== -1 && loginEnd !== -1) {
  const NEW_LOGIN = `// ── Login ────────────────────────────────────────────────────
async function doLogin() {
  const uEl = document.getElementById('loginUser');
  const pEl = document.getElementById('loginPass');
  const btn = document.getElementById('loginBtn');
  const username = (uEl.value || '').trim().toLowerCase();
  const password = (pEl.value || '').trim();
  hideAccessErr();

  if (!username) { showAccessErr('Enter your username.'); uEl.focus(); return; }
  if (!password) { showAccessErr('Enter your password.'); pEl.focus(); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons-round sync-spinning" style="font-size:18px">refresh</span>&nbsp; Signing in\\u2026';

  try {
    const data = await _api('POST', '/auth/login', { username, password });
    if (!data) { resetLoginBtn(btn); return; }
    sessionStorage.setItem('hrp_jwt', data.token);
    const u = { ...data.user, ts: Date.now() };
    sessionStorage.setItem('hrp_session', JSON.stringify(u));
    grantAccess(u);
  } catch(err) {
    showAccessErr(err.message || 'Login failed');
    resetLoginBtn(btn);
  }
}

`;
  html = html.slice(0, loginStart) + NEW_LOGIN + html.slice(loginEnd);
  console.log('✓ Replaced doLogin with API version');
}

// ── 8. Replace signOut to also clear JWT ─────────────────────
html = html.replace(
  /function signOut\(\) \{\s*if\(!confirm\('Sign out of HRP Tracker\?'\)\) return;\s*sessionStorage\.removeItem\('hrp_session'\);/,
  `function signOut() {
  if (!confirm('Sign out of HRP Tracker?')) return;
  sessionStorage.removeItem('hrp_session');
  sessionStorage.removeItem('hrp_jwt');`
);
console.log('✓ Patched signOut to clear JWT');

// ── 9. Replace initAccessControl to also load JWT from session ─
html = html.replace(
  /function initAccessControl\(\) \{\s*try \{\s*const raw = sessionStorage\.getItem\('hrp_session'\);/,
  `function initAccessControl() {
  try {
    const raw = sessionStorage.getItem('hrp_session');`
);

// ── 10. Replace renderUserList (Firestore → API) ──────────────
html = html.replace(
  /async function renderUserList\(\) \{[\s\S]*?^}/m,
  `async function renderUserList() {
  const body = document.getElementById('umBody');
  body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--txt3)"><span class="material-icons-round sync-spinning" style="font-size:32px;display:block;margin-bottom:8px">refresh</span>Loading users…</div>';
  try {
    const users = await _api('GET', '/users');
    if (!users) return;

    const bootstrapRow = \`<div class="user-row">
      <div><b>admin</b><div style="font-size:10px;color:var(--txt3)">System Admin (bootstrap)</div></div>
      <div>admin</div>
      <div><span class="role-pill role-admin">Admin</span></div>
      <div><span class="status-pill" style="background:var(--c-mod-bg);color:var(--c-mod)">Active</span></div>
      <div style="font-size:11px;color:var(--txt3)">hardcoded</div>
    </div>\`;

    const rows = users.length ? users.filter(u=>u.username!=='admin').map(u => {
      const rd = ROLE_OPTIONS.find(r => r.value === u.role) || { label: u.role, cls: 'role-viewer' };
      const active = u.active !== false;
      return \`<div class="user-row">
        <div><b>\${u.name || '—'}</b><div style="font-size:10px;color:var(--txt3)">\${u.username}</div></div>
        <div style="font-size:12px">\${u.username}</div>
        <div><span class="role-pill \${rd.cls}">\${rd.label}</span>\${u.block?'<div style="font-size:10px;color:var(--txt3);margin-top:2px">Block: '+u.block+'</div>':''}</div>
        <div><span class="status-pill" style="background:\${active?'var(--c-mod-bg)':'var(--c-none-bg)'};color:\${active?'var(--c-mod)':'var(--c-none)'}">
          \${active?'Active':'Inactive'}</span></div>
        <div style="display:flex;gap:4px">
          <button class="act-btn" style="padding:4px 8px" onclick="editUser('\${u.username}')">
            <span class="material-icons-round" style="font-size:14px">edit</span></button>
          <button class="act-btn" style="padding:4px 8px;color:\${active?'var(--c-crit)':'var(--c-mod)'}"
            onclick="toggleUserActive('\${u.username}',\${!active})">
            <span class="material-icons-round" style="font-size:14px">\${active?'person_off':'person'}</span>
          </button>
        </div>
      </div>\`;
    }).join('') : '<div style="padding:24px;text-align:center;color:var(--txt3);font-size:13px">No users yet. Use the Add User tab.</div>';

    body.innerHTML = \`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:13px;color:var(--txt2)">\${users.length} user(s) in database</div>
      <button class="act-btn" onclick="renderUserList()">
        <span class="material-icons-round" style="font-size:14px">refresh</span> Refresh</button>
    </div>
    <div style="border:1px solid var(--bdr);border-radius:var(--r-md);overflow:hidden">
      <div class="user-row user-row-hdr"><div>Name</div><div>Username</div><div>Role</div><div>Status</div><div>Actions</div></div>
      \${bootstrapRow}\${rows}
    </div>\`;
  } catch(err) {
    body.innerHTML = '<div style="padding:20px;color:var(--c-crit);background:var(--c-crit-bg);border-radius:var(--r-md)">Failed to load users: ' + err.message + '</div>';
  }
}`
);
console.log('✓ Replaced renderUserList with API version');

// ── 11. Replace editUser (Firestore → API) ────────────────────
html = html.replace(
  /async function editUser\(uid\) \{[\s\S]*?^}/m,
  `async function editUser(uid) {
  try {
    const u = await _api('GET', '/users/' + uid);
    if (!u) return;
    renderAddUser({ id: u.username, name: u.name, role: u.role, block: u.block || '' });
    switchUmTab(1);
  } catch(e) {
    showSnack('Failed to load user: ' + e.message);
  }
}`
);
console.log('✓ Replaced editUser with API version');

// ── 12. Replace saveUser (Firestore → API) ────────────────────
html = html.replace(
  /async function saveUser\(editing\) \{[\s\S]*?^}/m,
  `async function saveUser(editing) {
  const name     = (document.getElementById('um_name')?.value || '').trim();
  const username = (document.getElementById('um_user')?.value || '').trim().toLowerCase().replace(/\\s+/g,'');
  const role     = document.getElementById('um_role')?.value;
  const block    = document.getElementById('um_block')?.value || '';
  const pass     = document.getElementById('um_pass')?.value || '';
  const pass2    = document.getElementById('um_pass2')?.value || '';
  const errEl    = document.getElementById('um_form_err');
  const showErr  = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
  errEl.style.display = 'none';

  if (!name)     return showErr('Full name is required.');
  if (!username) return showErr('Username is required.');
  if (!editing && username === 'admin') return showErr('"admin" is reserved for the bootstrap account.');
  if (!role)     return showErr('Select a role.');
  if (role === 'bdo' && !block) return showErr('Select the block for this BDO.');
  if (!editing && !pass) return showErr('Password is required for new users.');
  if (pass && pass.length < 6) return showErr('Password must be at least 6 characters.');
  if (pass && pass !== pass2) return showErr('Passwords do not match.');

  try {
    if (editing) {
      const body = { name, role, block };
      if (pass) body.password = pass;
      await _api('PUT', '/users/' + umEditingUser, body);
      showSnack('✓ User updated');
    } else {
      await _api('POST', '/users', { username, name, role, block, password: pass });
      showSnack('✓ User created: ' + username);
    }
    switchUmTab(0);
  } catch(err) {
    showErr(err.message || 'Save failed');
  }
}`
);
console.log('✓ Replaced saveUser with API version');

// ── 13. Replace toggleUserActive (Firestore → API) ────────────
html = html.replace(
  /async function toggleUserActive\(uid, setActive\) \{[\s\S]*?^}/m,
  `async function toggleUserActive(uid, setActive) {
  try {
    await _api('PUT', '/users/' + uid, { active: setActive });
    showSnack(setActive ? '✓ User activated' : '✓ User deactivated');
    renderUserList();
  } catch(e) {
    showSnack('Failed: ' + e.message);
  }
}`
);
console.log('✓ Replaced toggleUserActive with API version');

// ── 14. Replace renderChangePassword (Firestore → API) ────────
html = html.replace(
  /function renderChangePassword\(\) \{[\s\S]*?^}/m,
  `function renderChangePassword() {
  document.getElementById('umBody').innerHTML = \`
    <div style="font-family:'Google Sans',sans-serif;font-size:14px;font-weight:500;margin-bottom:16px">Change Password</div>
    <div style="font-size:12px;color:var(--txt2);margin-bottom:16px">Logged in as: <b>\${currentUser&&currentUser.username}</b></div>
    <div class="um-form-grid" style="max-width:480px">
      <div class="fg" style="grid-column:1/-1">
        <label>Current Password</label>
        <input type="password" id="cp_current" placeholder="Your current password"
          style="padding:9px 12px;border:1px solid var(--bdr);border-radius:var(--r-sm);font-size:13px;outline:none;width:100%">
      </div>
      <div class="fg">
        <label>New Password</label>
        <input type="password" id="cp_new" placeholder="Min 6 characters"
          style="padding:9px 12px;border:1px solid var(--bdr);border-radius:var(--r-sm);font-size:13px;outline:none;width:100%">
      </div>
      <div class="fg">
        <label>Confirm New Password</label>
        <input type="password" id="cp_new2" placeholder="Re-enter new password"
          style="padding:9px 12px;border:1px solid var(--bdr);border-radius:var(--r-sm);font-size:13px;outline:none;width:100%">
      </div>
    </div>
    <div id="cp_err" style="display:none;margin-top:10px;padding:8px 12px;background:var(--c-crit-bg);border-radius:var(--r-sm);font-size:12px;color:var(--c-crit)"></div>
    <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end">
      <button class="btn-filled" onclick="savePassword()">
        <span class="material-icons-round" style="font-size:15px;vertical-align:middle">lock</span> Change Password
      </button>
    </div>\`;
}`
);
console.log('✓ Replaced renderChangePassword');

// ── 15. Replace savePassword (Firestore → API) ───────────────
html = html.replace(
  /async function savePassword\(\) \{[\s\S]*?^}/m,
  `async function savePassword() {
  const current = document.getElementById('cp_current')?.value || '';
  const np      = document.getElementById('cp_new')?.value     || '';
  const np2     = document.getElementById('cp_new2')?.value    || '';
  const errEl   = document.getElementById('cp_err');
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
  errEl.style.display = 'none';

  if (!current) return showErr('Enter your current password.');
  if (!np)      return showErr('Enter a new password.');
  if (np.length < 6) return showErr('New password must be at least 6 characters.');
  if (np !== np2) return showErr('Passwords do not match.');

  try {
    await _api('PUT', '/auth/change-password', { currentPassword: current, newPassword: np });
    showSnack('✓ Password changed successfully');
    switchUmTab(0);
  } catch(e) {
    showErr(e.message || 'Password change failed');
  }
}`
);
console.log('✓ Replaced savePassword with API version');

// ── 16. Replace startup block ─────────────────────────────────
const OLD_STARTUP = `buildTableHeader();
buildRiskChips();
loadSchedulesLocal();
updateSchedBadge();
// Start access control — show login overlay until authenticated
initAccessControl();
// Sync from sheet on load; fall back to demo data if sheet unavailable
syncFromSheet(false).then(()=>{ startSyncTimer(); });
// If sheet hasn't responded in 4 seconds, init with whatever is in ALL (demo data)
setTimeout(()=>{ if(ALL.length===0){ buildSidebar();buildDropdowns();applyFilters(); } }, 4000);
// Check due alerts on load (after data is ready)
setTimeout(()=>{ if(schedules.length) checkDueAlerts(); }, 5500);
// Init Firebase (non-blocking, 2s delay so page loads fast)
setTimeout(initFirebase, 2000);`;

const NEW_STARTUP = `buildTableHeader();
buildRiskChips();
loadSchedulesLocal();
updateSchedBadge();
// Start access control — show login overlay until authenticated
initAccessControl();
// Load patients from the REST API, then start Google Sheet sync timer
(async () => {
  try {
    const data = await _api('GET', '/patients');
    if (Array.isArray(data) && data.length) {
      ALL = data;
      buildSidebar(); buildDropdowns(); applyFilters();
    }
  } catch(e) {
    console.warn('[API] Could not load patients:', e.message);
  }
  // Also sync from Google Sheet (pushes fresh data into our API)
  syncFromSheet(false).then(() => { startSyncTimer(); });
  setTimeout(() => { if (ALL.length === 0) { buildSidebar(); buildDropdowns(); applyFilters(); } }, 4000);
})();
setTimeout(() => { if (schedules.length) checkDueAlerts(); }, 5500);
// Connect to API (loads schedules, shows badge)
setTimeout(initFirebase, 500);`;

html = html.replace(OLD_STARTUP, NEW_STARTUP);
console.log('✓ Replaced startup block');

// ── 17. Ensure public dir exists and write output ─────────────
const outDir = path.dirname(OUT);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');

const newSize = html.length;
const saved = ((originalSize - newSize) / 1024).toFixed(1);
console.log(`\n✅ Frontend generated → ${OUT}`);
console.log(`   Original: ${(originalSize / 1024).toFixed(1)} KB  →  New: ${(newSize / 1024).toFixed(1)} KB  (−${saved} KB from stripped data)\n`);
