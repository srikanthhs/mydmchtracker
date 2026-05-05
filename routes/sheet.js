'use strict';
const router = require('express').Router();
const SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbxPRkCFzEg0hwjq2GPnKR-cBgZKVK8Lk1KAbLE4Gat5c354RgrpKPI1I_kz89woMfHDOw/exec';

// POST /api/sheet — proxy update to Google Apps Script (avoids browser CORS)
router.post('/', async (req, res) => {
  try {
    const response = await fetch(SHEET_API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(req.body),
    });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { status: 'error', message: text.slice(0, 200) }; }
    res.json(json);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
