import nodemailer from 'nodemailer';
import { env } from '@config/env';
import { logger } from '@shared/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Zoho Mail SMTP Transporter (Singleton)
//
// Data center: India → smtppro.zoho.in:465 (SSL)
// Auth: Use Zoho App-Specific Password (NOT your account password)
// Generate at: Zoho Mail → Settings → Security → App Passwords
// ─────────────────────────────────────────────────────────────────────────────

let transporter: nodemailer.Transporter | null = null;

export function getMailer(): nodemailer.Transporter {
  if (transporter) return transporter;

  if (!env.ZOHO_SMTP_USER || !env.ZOHO_SMTP_PASS) {
    logger.warn('[Mailer] ZOHO_SMTP_USER or ZOHO_SMTP_PASS not set — email sending disabled');
    // Return a no-op transporter in development if creds not set
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: env.ZOHO_SMTP_HOST,   // smtppro.zoho.in
    port: env.ZOHO_SMTP_PORT,   // 465
    secure: true,               // SSL — required for port 465
    auth: {
      user: env.ZOHO_SMTP_USER, // full email e.g. admin@gomytruck.com
      pass: env.ZOHO_SMTP_PASS, // Zoho app-specific password
    },
    // Increase timeout for slow connections
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });

  // Verify connection on first creation (non-blocking)
  transporter.verify((err) => {
    if (err) {
      logger.error('[Mailer] Zoho SMTP connection failed:', err.message);
    } else {
      logger.info('[Mailer] Zoho SMTP connection verified ✓');
    }
  });

  return transporter;
}
