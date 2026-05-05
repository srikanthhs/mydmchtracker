'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security & Middleware ──────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'fonts.googleapis.com',
                   'fonts.gstatic.com', 'www.gstatic.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc:    ["'self'", 'fonts.gstatic.com', 'fonts.googleapis.com'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'sheets.googleapis.com', 'script.google.com',
                   '*.googleapis.com', '*.google.com'],
    },
  },
}));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// ── Rate Limiting ─────────────────────────────────────────────
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' } }));
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 300,
  message: { error: 'Too many requests' } }));

// ── API Routes (Tier 2 — Application Layer) ───────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/patients',  require('./routes/patients'));
app.use('/api/users',     require('./routes/users'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/reports',   require('./routes/reports'));
app.use('/api/sheet',     require('./routes/sheet'));
app.get('/api/health',    (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Frontend (Tier 1 — Presentation Layer) ────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Global error handler ──────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup: init Tier 3 (database) first, then listen ───────
async function start() {
  try {
    await require('./db/database').init();
    console.log('[DB] SQLite ready');
  } catch (e) {
    console.error('[DB] Init failed:', e.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n┌──────────────────────────────────────────────────┐`);
    console.log(`│   HRP Tracker — Three-Tier Architecture           │`);
    console.log(`│                                                    │`);
    console.log(`│   Tier 1 (Presentation) → http://localhost:${PORT}  │`);
    console.log(`│   Tier 2 (Application)  → /api/*                  │`);
    console.log(`│   Tier 3 (Data)         → db/hrp.db  (SQLite)     │`);
    console.log(`│                                                    │`);
    console.log(`│   Login: admin / Admin@2026                        │`);
    console.log(`└──────────────────────────────────────────────────┘\n`);
  });
}

start();
