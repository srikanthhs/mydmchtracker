'use strict';
/**
 * Vercel Serverless Function entry point.
 * Exports the Express app after the database is initialised.
 * Vercel calls this as a Node.js serverless function for every request.
 */
require('dotenv').config();
const path = require('path');
const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');

const app = express();

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

app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
}));
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 300,
  message: { error: 'Too many requests' } }));

app.use('/api/auth',      require('../routes/auth'));
app.use('/api/patients',  require('../routes/patients'));
app.use('/api/users',     require('../routes/users'));
app.use('/api/schedules', require('../routes/schedules'));
app.use('/api/reports',   require('../routes/reports'));
app.use('/api/sheet',     require('../routes/sheet'));
app.get('/api/health',    (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Static frontend files (Vercel serves public/ via vercel.json rewrites)
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialise DB once (Vercel may reuse the function instance)
let _dbReady = false;
module.exports = async (req, res) => {
  if (!_dbReady) {
    await require('../db/database').init();
    _dbReady = true;
  }
  return app(req, res);
};
