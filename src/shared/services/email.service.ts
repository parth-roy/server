import { getMailer } from '@config/mailer';
import { env } from '@config/env';
import { logger } from '@shared/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Email Service — Zoho Mail via Nodemailer
// All admin-facing transactional emails go through here.
// ─────────────────────────────────────────────────────────────────────────────

const FROM_NAME = 'Parther Admin';
const FROM_EMAIL = env.ZOHO_FROM_EMAIL ?? 'admin@gomytruck.com';
const FROM = `"${FROM_NAME}" <${FROM_EMAIL}>`;

/**
 * Sends a password reset email to an admin user.
 * The reset link is valid for 1 hour.
 */
export async function sendPasswordResetEmail(
  to: string,
  adminName: string,
  resetToken: string
): Promise<void> {
  const resetLink = `${env.ADMIN_PANEL_URL}/reset-password?token=${resetToken}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reset your Parther Admin password</title>
  <style>
    body { font-family: 'Inter', -apple-system, sans-serif; background: #f4f5f7; margin: 0; padding: 20px; color: #1a1a2e; }
    .container { max-width: 520px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: #1e2235; padding: 32px; text-align: center; }
    .header h1 { color: #f4a31b; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { color: #8892a4; margin: 8px 0 0; font-size: 13px; }
    .body { padding: 32px; }
    .body p { font-size: 15px; line-height: 1.6; color: #374151; margin: 0 0 16px; }
    .button { display: block; width: fit-content; margin: 24px auto; background: #f4a31b; color: #1a1a2e; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; }
    .note { font-size: 12px; color: #9ca3af; text-align: center; margin-top: 20px; }
    .link { word-break: break-all; font-size: 12px; color: #6b7280; margin-top: 16px; padding: 12px; background: #f9fafb; border-radius: 6px; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Parther Admin</h1>
      <p>gomytruck.com — Operations Dashboard</p>
    </div>
    <div class="body">
      <p>Hi ${adminName},</p>
      <p>We received a request to reset the password for your <strong>Parther Admin</strong> account.</p>
      <p>Click the button below to reset your password. This link will expire in <strong>1 hour</strong>.</p>
      <a href="${resetLink}" class="button">Reset Password</a>
      <p class="note">If the button doesn't work, copy and paste this link into your browser:</p>
      <div class="link">${resetLink}</div>
      <p style="margin-top: 24px; font-size: 13px; color: #6b7280;">
        If you did not request a password reset, you can safely ignore this email. 
        Your password will not change.
      </p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Parther Technologies Pvt Ltd &nbsp;·&nbsp; CIN: U62099WR2026PTC293183
    </div>
  </div>
</body>
</html>`;

  const text = `Hi ${adminName},\n\nReset your Parther Admin password by visiting:\n${resetLink}\n\nThis link expires in 1 hour.\n\nIf you did not request this, ignore this email.\n\n— Parther Admin Team`;

  try {
    const mailer = getMailer();
    const info = await mailer.sendMail({
      from: FROM,
      to,
      subject: 'Reset your Parther Admin password',
      html,
      text,
    });
    logger.info(`[Email] Password reset email sent to ${to} — messageId: ${info.messageId}`);
  } catch (err: any) {
    // Log but don't crash — caller should surface a safe error message
    logger.error(`[Email] Failed to send password reset email to ${to}:`, err.message);
    throw new Error('Email delivery failed. Please try again later.');
  }
}
