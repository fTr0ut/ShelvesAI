const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const configPath = path.join(__dirname, '../config/onboardingScreen.json');

router.get('/onboarding', (_req, res) => {
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    console.error('Failed to load onboarding config:', err.message);
    res.status(500).json({ error: 'Failed to load onboarding config' });
  }
});

module.exports = router;
