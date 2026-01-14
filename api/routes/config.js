const express = require('express');
const onboardingScreen = require('../config/onboardingScreen.json');

const router = express.Router();

router.get('/onboarding', (_req, res) => {
  res.json(onboardingScreen);
});

module.exports = router;
