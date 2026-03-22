/**
 * Email service using Resend for transactional emails.
 *
 * Required env variables:
 *   RESEND_API_KEY - Resend API key
 *   RESEND_FROM_EMAIL - Verified sender email (e.g., noreply@yourapp.com)
 *   RESET_PASSWORD_URL - Optional absolute URL for reset page (e.g., https://yourapp.com/reset-password)
 *   APP_NAME - Application name for email templates
 *   APP_URL - Base URL for reset links (e.g., https://yourapp.com)
 */

const { Resend } = require('resend');
const logger = require('../logger');

const API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@shelvesai.com';
const APP_NAME = process.env.APP_NAME || 'ShelvesAI';
const APP_URL = process.env.APP_URL || 'https://shelvesai.com';
const RESET_PASSWORD_URL =
    process.env.RESET_PASSWORD_URL || `${APP_URL.replace(/\/+$/, '')}/reset-password`;

const resend = API_KEY ? new Resend(API_KEY) : null;

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

module.exports = {
    sendPasswordResetEmail,
};
