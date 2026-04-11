/**
 * Email service using Resend for transactional emails.
 *
 * Required env variables:
 *   RESEND_API_KEY - Resend API key
 *   RESEND_FROM_EMAIL - Verified sender email (e.g., noreply@yourapp.com)
 *   SUPPORT_EMAIL - Optional support inbox for user feedback (defaults to support@shelvesai.com)
 *   RESET_PASSWORD_URL - Optional absolute URL for reset page (e.g., https://yourapp.com/reset-password)
 *   APP_NAME - Application name for email templates
 *   APP_URL - Base URL for reset links (e.g., https://yourapp.com)
 */

const { Resend } = require('resend');
const logger = require('../logger');

const API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@shelvesai.com';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@shelvesai.com';
const APP_NAME = process.env.APP_NAME || 'ShelvesAI';
const APP_URL = process.env.APP_URL || 'https://shelvesai.com';
const RESET_PASSWORD_URL =
    process.env.RESET_PASSWORD_URL || `${APP_URL.replace(/\/+$/, '')}/reset-password`;

const resend = API_KEY ? new Resend(API_KEY) : null;

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Send a password reset email with a reset link.
 * @param {string} to - Recipient email address
 * @param {string} token - Password reset token
 * @param {string} firstName - User's first name (optional)
 */
async function sendPasswordResetEmail(to, token, firstName = null) {
    if (!API_KEY) {
        const env = String(process.env.NODE_ENV || '').toLowerCase();
        const isDevLike = env === 'development' || env === 'test';

        if (!isDevLike) {
            logger.error(`[EmailService] RESEND_API_KEY not configured - cannot send password reset email to ${to}`);
            throw new Error('Email transport unavailable');
        }

        logger.warn(`[EmailService] RESEND_API_KEY not configured - simulating password reset email to ${to}`);
        return { success: true, simulated: true };
    }

    const separator = RESET_PASSWORD_URL.includes('?') ? '&' : '?';
    const resetLink = `${RESET_PASSWORD_URL}${separator}token=${encodeURIComponent(token)}`;
    const greeting = firstName ? `Hi ${firstName},` : 'Hi,';

    const msg = {
        from: `${APP_NAME} <${FROM_EMAIL}>`,
        to,
        subject: `Reset your ${APP_NAME} password`,
        text: `${greeting}

We received a request to reset your password for your ${APP_NAME} account.

Click the link below to reset your password:
${resetLink}

This link will expire in 1 hour.

If you didn't request this, you can safely ignore this email.

- The ${APP_NAME} Team`,
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">${APP_NAME}</h1>
    </div>
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="font-size: 16px;">${greeting}</p>
        <p style="font-size: 16px;">We received a request to reset your password for your ${APP_NAME} account.</p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Reset Password</a>
        </div>
        <p style="font-size: 14px; color: #6b7280;">This link will expire in 1 hour.</p>
        <p style="font-size: 14px; color: #6b7280;">If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #9ca3af; text-align: center;">© ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
    </div>
</body>
</html>
`,
    };

    try {
        const response = await resend.emails.send(msg);
        if (response?.error) {
            throw new Error(response.error.message || 'Resend API error');
        }
        logger.info(`[EmailService] Password reset email sent to ${to}`);
        return { success: true };
    } catch (error) {
        logger.error('[EmailService] Failed to send email:', error.message);
        throw new Error('Failed to send email');
    }
}

/**
 * Send user-submitted in-app feedback to support.
 * @param {object} payload
 * @param {string} payload.message
 * @param {string} payload.userId
 * @param {string} payload.username
 * @param {string|null} payload.email
 * @param {string|null} payload.firstName
 * @param {string|null} payload.lastName
 */
async function sendFeedbackEmail({
    message,
    userId,
    username,
    email = null,
    firstName = null,
    lastName = null,
}) {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
        throw new Error('Feedback message is required');
    }

    if (!API_KEY) {
        const env = String(process.env.NODE_ENV || '').toLowerCase();
        const isDevLike = env === 'development' || env === 'test';

        if (!isDevLike) {
            logger.error('[EmailService] RESEND_API_KEY not configured - cannot send feedback email');
            throw new Error('Email transport unavailable');
        }

        logger.warn('[EmailService] RESEND_API_KEY not configured - simulating feedback email');
        return { success: true, simulated: true };
    }

    const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'N/A';
    const submittedAt = new Date().toISOString();
    const safeMessage = escapeHtml(normalizedMessage);
    const safeDisplayName = escapeHtml(displayName);
    const safeUsername = escapeHtml(username || 'unknown');
    const safeEmail = escapeHtml(email || 'N/A');
    const safeUserId = escapeHtml(userId || 'N/A');
    const subjectUsername = username ? `@${username}` : 'unknown-user';

    const msg = {
        from: `${APP_NAME} <${FROM_EMAIL}>`,
        to: SUPPORT_EMAIL,
        subject: `[${APP_NAME}] Feedback from ${subjectUsername}`,
        ...(email ? { replyTo: email } : {}),
        text: `New in-app feedback submission

Submitted at: ${submittedAt}
User ID: ${userId || 'N/A'}
Username: ${username || 'N/A'}
Name: ${displayName}
Email: ${email || 'N/A'}

Message:
${normalizedMessage}
`,
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #111827; margin: 0; padding: 24px; background-color: #f3f4f6;">
    <div style="max-width: 700px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
        <div style="padding: 18px 22px; background: #111827; color: #ffffff;">
            <h1 style="margin: 0; font-size: 18px;">${APP_NAME} User Feedback</h1>
        </div>
        <div style="padding: 20px 22px;">
            <p style="margin: 0 0 16px 0; color: #374151;">A user submitted feedback from the in-app Account Settings screen.</p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
                <tr><td style="padding: 6px 0; color: #6b7280; width: 130px;">Submitted</td><td style="padding: 6px 0; color: #111827;">${submittedAt}</td></tr>
                <tr><td style="padding: 6px 0; color: #6b7280;">User ID</td><td style="padding: 6px 0; color: #111827; word-break: break-all;">${safeUserId}</td></tr>
                <tr><td style="padding: 6px 0; color: #6b7280;">Username</td><td style="padding: 6px 0; color: #111827;">${safeUsername}</td></tr>
                <tr><td style="padding: 6px 0; color: #6b7280;">Name</td><td style="padding: 6px 0; color: #111827;">${safeDisplayName}</td></tr>
                <tr><td style="padding: 6px 0; color: #6b7280;">Email</td><td style="padding: 6px 0; color: #111827;">${safeEmail}</td></tr>
            </table>
            <h2 style="margin: 0 0 10px 0; font-size: 15px; color: #111827;">Message</h2>
            <pre style="white-space: pre-wrap; word-break: break-word; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin: 0; font-family: inherit; font-size: 14px; color: #111827;">${safeMessage}</pre>
        </div>
    </div>
</body>
</html>
`,
    };

    try {
        const response = await resend.emails.send(msg);
        if (response?.error) {
            throw new Error(response.error.message || 'Resend API error');
        }
        logger.info(`[EmailService] Feedback email sent for user ${userId || username || 'unknown'}`);
        return { success: true };
    } catch (error) {
        logger.error('[EmailService] Failed to send feedback email:', error.message);
        throw new Error('Failed to send feedback email');
    }
}

/**
 * Notify a user that their account deletion request has been approved
 * and their account has been permanently deleted.
 * @param {object} payload
 * @param {string} payload.email
 * @param {string} payload.username
 */
async function sendDeletionApprovedEmail({ email, username }) {
    if (!API_KEY) {
        const env = String(process.env.NODE_ENV || '').toLowerCase();
        const isDevLike = env === 'development' || env === 'test';

        if (!isDevLike) {
            logger.error(`[EmailService] RESEND_API_KEY not configured - cannot send deletion approved email to ${email}`);
            throw new Error('Email transport unavailable');
        }

        logger.warn(`[EmailService] RESEND_API_KEY not configured - simulating deletion approved email to ${email}`);
        return { success: true, simulated: true };
    }

    const safeUsername = escapeHtml(username || 'there');
    const year = new Date().getFullYear();

    const msg = {
        from: `${APP_NAME} <${FROM_EMAIL}>`,
        to: email,
        subject: `Your ${APP_NAME} account has been deleted`,
        text: `Hi ${username || 'there'},

Your account deletion request has been approved and your ${APP_NAME} account has been permanently deleted.

All associated data — including your shelves, collections, profile, and activity — has been removed from our systems.

If you ever decide to return, you're welcome to create a new account at any time.

If you have any questions, please contact us at ${SUPPORT_EMAIL}.

- The ${APP_NAME} Team`,
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #111827; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">${APP_NAME}</h1>
    </div>
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="font-size: 16px;">Hi ${safeUsername},</p>
        <p style="font-size: 16px;">Your account deletion request has been approved. Your <strong>${APP_NAME}</strong> account has been permanently deleted.</p>
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 24px 0;">
            <p style="margin: 0; font-size: 14px; color: #374151;">All associated data — including your shelves, collections, profile, and activity — has been removed from our systems.</p>
        </div>
        <p style="font-size: 15px; color: #374151;">If you ever decide to return, you're welcome to create a new account at any time.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 14px; color: #6b7280;">Questions? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color: #6366f1;">${SUPPORT_EMAIL}</a>.</p>
        <p style="font-size: 12px; color: #9ca3af; text-align: center;">© ${year} ${APP_NAME}. All rights reserved.</p>
    </div>
</body>
</html>
`,
    };

    try {
        const response = await resend.emails.send(msg);
        if (response?.error) {
            throw new Error(response.error.message || 'Resend API error');
        }
        logger.info(`[EmailService] Deletion approved email sent to ${email}`);
        return { success: true };
    } catch (error) {
        logger.error('[EmailService] Failed to send deletion approved email:', error.message);
        throw new Error('Failed to send deletion approved email');
    }
}

/**
 * Notify a user that their account deletion request has been rejected.
 * @param {object} payload
 * @param {string} payload.email
 * @param {string} payload.username
 * @param {string|null} payload.reviewerNote
 */
async function sendDeletionRejectedEmail({ email, username, reviewerNote = null }) {
    if (!API_KEY) {
        const env = String(process.env.NODE_ENV || '').toLowerCase();
        const isDevLike = env === 'development' || env === 'test';

        if (!isDevLike) {
            logger.error(`[EmailService] RESEND_API_KEY not configured - cannot send deletion rejected email to ${email}`);
            throw new Error('Email transport unavailable');
        }

        logger.warn(`[EmailService] RESEND_API_KEY not configured - simulating deletion rejected email to ${email}`);
        return { success: true, simulated: true };
    }

    const safeUsername = escapeHtml(username || 'there');
    const safeNote = reviewerNote ? escapeHtml(reviewerNote) : null;
    const year = new Date().getFullYear();

    const noteTextBlock = reviewerNote
        ? `\nReason provided:\n${reviewerNote}\n`
        : '';

    const noteHtmlBlock = safeNote
        ? `<div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px;">Reason</p>
            <p style="margin: 0; font-size: 14px; color: #374151;">${safeNote}</p>
           </div>`
        : '';

    const msg = {
        from: `${APP_NAME} <${FROM_EMAIL}>`,
        to: email,
        subject: `Your ${APP_NAME} account deletion request has been reviewed`,
        text: `Hi ${username || 'there'},

We've reviewed your account deletion request, but we're unable to process it at this time.
${noteTextBlock}
Your account remains active and you can continue to use ${APP_NAME} as normal.

If you have questions or believe this was a mistake, please contact us at ${SUPPORT_EMAIL}.

- The ${APP_NAME} Team`,
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #111827; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">${APP_NAME}</h1>
    </div>
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="font-size: 16px;">Hi ${safeUsername},</p>
        <p style="font-size: 16px;">We've reviewed your account deletion request, but we're unable to process it at this time.</p>
        ${noteHtmlBlock}
        <p style="font-size: 15px; color: #374151;">Your account remains active and you can continue to use <strong>${APP_NAME}</strong> as normal.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 14px; color: #6b7280;">Questions or concerns? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color: #6366f1;">${SUPPORT_EMAIL}</a>.</p>
        <p style="font-size: 12px; color: #9ca3af; text-align: center;">© ${year} ${APP_NAME}. All rights reserved.</p>
    </div>
</body>
</html>
`,
    };

    try {
        const response = await resend.emails.send(msg);
        if (response?.error) {
            throw new Error(response.error.message || 'Resend API error');
        }
        logger.info(`[EmailService] Deletion rejected email sent to ${email}`);
        return { success: true };
    } catch (error) {
        logger.error('[EmailService] Failed to send deletion rejected email:', error.message);
        throw new Error('Failed to send deletion rejected email');
    }
}

/**
 * Send a bulk email campaign to multiple recipients via Resend batch API.
 * Chunks recipients into groups of 100 (Resend batch limit per request).
 * @param {Array<{email: string, name?: string}>} recipients
 * @param {{ subject: string, html: string, text?: string }} opts
 * @returns {{ sent: number, failed: number, simulated?: boolean }}
 */
async function sendBulkEmail(recipients, { subject, html, text }) {
    if (!API_KEY) {
        const env = String(process.env.NODE_ENV || '').toLowerCase();
        const isDevLike = env === 'development' || env === 'test';

        if (!isDevLike) {
            throw new Error('Email transport unavailable');
        }

        logger.warn(`[EmailService] Simulating bulk email to ${recipients.length} recipients`);
        return { sent: recipients.length, failed: 0, simulated: true };
    }

    const CHUNK = 100;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i += CHUNK) {
        const chunk = recipients.slice(i, i + CHUNK);
        const messages = chunk.map(({ email, name }) => ({
            from: `${APP_NAME} <${FROM_EMAIL}>`,
            to: name ? `${name} <${email}>` : email,
            subject,
            html,
            ...(text ? { text } : {}),
        }));
        try {
            const response = await resend.batch.send(messages);
            if (response?.error) throw new Error(response.error.message || 'Resend batch API error');
            sent += chunk.length;
        } catch (err) {
            logger.error(`[EmailService] Bulk batch (offset ${i}) failed:`, err.message);
            failed += chunk.length;
        }
    }

    logger.info(`[EmailService] Bulk campaign complete: ${sent} sent, ${failed} failed`);
    return { sent, failed };
}

/**
 * List all Resend Audiences available in the account.
 * @returns {Array<{id: string, name: string}>}
 */
async function getResendAudiences() {
    if (!resend) throw new Error('Email transport unavailable');
    const response = await resend.audiences.list();
    if (response?.error) throw new Error(response.error.message || 'Resend API error');
    return (response.data?.data || []).map(({ id, name }) => ({ id, name }));
}

/**
 * Fetch all non-unsubscribed contacts from a Resend Audience, paginating automatically.
 * @param {string} audienceId
 * @returns {Array<{email: string, name?: string}>}
 */
async function getResendAudienceContacts(audienceId) {
    if (!resend) throw new Error('Email transport unavailable');
    const contacts = [];
    let after;
    do {
        const response = await resend.contacts.list({
            audienceId,
            limit: 100,
            ...(after ? { after } : {}),
        });
        if (response?.error) throw new Error(response.error.message || 'Resend API error');
        const page = response.data?.data || [];
        for (const c of page) {
            if (!c.unsubscribed) {
                const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || undefined;
                contacts.push({ email: c.email, ...(name ? { name } : {}) });
            }
        }
        after = response.data?.has_more ? page[page.length - 1]?.id : undefined;
    } while (after);
    return contacts;
}

module.exports = {
    sendPasswordResetEmail,
    sendFeedbackEmail,
    sendDeletionApprovedEmail,
    sendDeletionRejectedEmail,
    sendBulkEmail,
    getResendAudiences,
    getResendAudienceContacts,
};
