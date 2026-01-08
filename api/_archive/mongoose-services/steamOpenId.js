const express = require('express');
const { handleSteamOpenIdReturn } = require('../controllers/steamOpenIdController');

const router = express.Router();

router.get('/callback', handleSteamOpenIdReturn);

module.exports = router;
