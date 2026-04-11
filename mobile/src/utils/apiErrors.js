export function isUserBlockedApiError(error) {
    return error?.data?.code === 'user_blocked';
}

export function getBlockedStateMessage(defaultMessage = 'This user is blocked.') {
    return defaultMessage;
}
