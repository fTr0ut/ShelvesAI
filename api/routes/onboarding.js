const express = require('express');
const { auth } = require('../middleware/auth');
const onboardingController = require('../controllers/onboardingController');

const router = express.Router();

router.post('/complete', auth, onboardingController.completeOnboarding);

module.exports = router;
