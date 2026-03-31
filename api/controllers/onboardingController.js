const usersQueries = require('../database/queries/users');
const { formatUserForResponse } = require('../database/queries/utils');
const { CURRENT_TERMS_VERSION } = require('../config/constants');
const logger = require('../logger');

async function completeOnboarding(req, res) {
    try {
        const user = await usersQueries.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const missingFields = [];
        if (!user.email) missingFields.push('email');
        if (!user.first_name) missingFields.push('firstName');
        if (!user.city) missingFields.push('city');
        if (!user.state) missingFields.push('state');

        if (missingFields.length > 0) {
            return res.status(400).json({
                error: 'Missing required fields',
                missingFields,
            });
        }
        const termsAccepted = req.body?.termsAccepted === true;
        const providedTermsVersion = typeof req.body?.termsVersion === 'string'
            ? req.body.termsVersion.trim()
            : '';
        const userAcceptedCurrentTerms = user.terms_accepted === true
            && String(user.terms_accepted_version || '').trim() === CURRENT_TERMS_VERSION;

        if (!userAcceptedCurrentTerms && !termsAccepted) {
            return res.status(400).json({
                error: 'Terms of Service must be accepted',
                requiredTermsVersion: CURRENT_TERMS_VERSION,
            });
        }

        if (termsAccepted && providedTermsVersion && providedTermsVersion !== CURRENT_TERMS_VERSION) {
            return res.status(400).json({
                error: 'Terms version mismatch',
                requiredTermsVersion: CURRENT_TERMS_VERSION,
            });
        }

        if (user.onboarding_completed && userAcceptedCurrentTerms) {
            return res.json({ onboardingCompleted: true, user: formatUserForResponse(user) });
        }

        const acceptedVersion = providedTermsVersion || CURRENT_TERMS_VERSION;
        const updated = await usersQueries.completeOnboardingWithTerms(req.user.id, acceptedVersion);
        return res.json({ onboardingCompleted: true, user: formatUserForResponse(updated) });
    } catch (err) {
        logger.error('completeOnboarding error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
}

module.exports = { completeOnboarding };
