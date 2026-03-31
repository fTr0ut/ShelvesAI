const express = require('express');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const { CURRENT_TERMS_VERSION, TERMS_OF_SERVICE_URL } = require('../config/constants');

const router = express.Router();

const configPath = path.join(__dirname, '../config/onboardingScreen.json');

router.get('/onboarding', (_req, res) => {
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(data);
    const termsConfig = config.terms && typeof config.terms === 'object' ? config.terms : {};
    config.terms = {
      ...termsConfig,
      version: CURRENT_TERMS_VERSION,
      url: TERMS_OF_SERVICE_URL,
    };
    res.json(config);
  } catch (err) {
    logger.error('Failed to load onboarding config:', err.message);
    res.status(500).json({ error: 'Failed to load onboarding config' });
  }
});

module.exports = router;
