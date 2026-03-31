const express = require('express');
const { auth } = require('../middleware/auth');
const { validateStringLengths } = require('../middleware/validate');
const onboardingController = require('../controllers/onboardingController');

const router = express.Router();

router.post('/complete', auth, validateStringLengths({ termsVersion: 64 }), onboardingController.completeOnboarding);

module.exports = router;
