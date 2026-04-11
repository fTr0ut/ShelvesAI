const userBlocksQueries = require('../database/queries/userBlocks');

const USER_BLOCKED_CODE = 'user_blocked';

function buildUserBlockedPayload(error = 'You cannot access this user') {
    return { error, code: USER_BLOCKED_CODE };
}

function sendUserBlocked(res, error = 'You cannot access this user') {
    return res.status(403).json(buildUserBlockedPayload(error));
}

async function ensureUsersNotBlocked({
    res,
    viewerId,
    targetUserId,
    error = 'You cannot access this user',
}) {
    if (!viewerId || !targetUserId) return true;
    if (String(viewerId) === String(targetUserId)) return true;

    const blocked = await userBlocksQueries.isBlockedEitherDirection(viewerId, targetUserId);
    if (!blocked) return true;

    sendUserBlocked(res, error);
    return false;
}

module.exports = {
    USER_BLOCKED_CODE,
    buildUserBlockedPayload,
    sendUserBlocked,
    ensureUsersNotBlocked,
};
