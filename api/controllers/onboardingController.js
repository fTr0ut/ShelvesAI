const usersQueries = require('../database/queries/users');
const { formatUserForResponse } = require('../database/queries/utils');

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

        if (user.onboarding_completed) {
            return res.json({ onboardingCompleted: true, user: formatUserForResponse(user) });
        }

        const updated = await usersQueries.setOnboardingCompleted(req.user.id, true);
        return res.json({ onboardingCompleted: true, user: formatUserForResponse(updated) });
    } catch (err) {
        console.error('completeOnboarding error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
}

module.exports = { completeOnboarding };
