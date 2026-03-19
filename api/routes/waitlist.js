const express = require('express');
const rateLimit = require('express-rate-limit');
const { Resend } = require('resend');
const { requireFields } = require('../middleware/validate');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const waitlistLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'Too many waitlist requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isDuplicateContactError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  return (
    code === 'already_exists' ||
    code === 'conflict' ||
    message.includes('already') ||
    message.includes('exists') ||
    message.includes('duplicate')
  );
}

router.post('/', waitlistLimiter, requireFields(['email']), async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;

  if (!apiKey || !audienceId) {
    console.error('[Waitlist] Missing Resend configuration.');
    return res.status(500).json({ error: 'Waitlist is temporarily unavailable.' });
  }

  const resend = new Resend(apiKey);

  try {
    const result = await resend.contacts.create({
      audienceId,
      email,
      unsubscribed: false,
    });

    if (result?.error) {
      if (isDuplicateContactError(result.error)) {
        return res.status(200).json({ success: true, alreadySubscribed: true });
      }

      throw new Error(result.error.message || 'Failed to create contact.');
    }

    return res.status(201).json({ success: true });
  } catch (error) {
    if (isDuplicateContactError(error)) {
      return res.status(200).json({ success: true, alreadySubscribed: true });
    }

    console.error('[Waitlist] Failed to add email:', error.message || error);
    return res.status(502).json({ error: 'Unable to join waitlist right now. Please try again.' });
  }
});

module.exports = router;
