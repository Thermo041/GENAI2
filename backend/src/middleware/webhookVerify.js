import { verify } from '@octokit/webhooks-methods';
import { config } from '../config/env.js';
import { errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Verifies the GitHub webhook HMAC before the payload is parsed or trusted.
 * Requires the raw body (mounted with express.raw on the webhook route only).
 * An unsigned or mis-signed delivery never reaches the handler.
 */
export async function verifyWebhookSignature(req, _res, next) {
  try {
    if (!config.github.webhookSecret) {
      return next(errors.config('GITHUB_WEBHOOK_SECRET is not set, so webhooks cannot be verified.'));
    }
    const signature = req.get('x-hub-signature-256');
    if (!signature) return next(errors.forbidden('Missing webhook signature.'));

    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : '';
    if (!raw) return next(errors.badRequest('Empty webhook payload.'));

    const valid = await verify(config.github.webhookSecret, raw, signature);
    if (!valid) {
      logger.warn({ delivery: req.get('x-github-delivery'), event: req.get('x-github-event') }, 'Rejected webhook with bad signature');
      return next(errors.forbidden('Invalid webhook signature.'));
    }

    req.webhook = {
      id: req.get('x-github-delivery') || '',
      event: req.get('x-github-event') || '',
      payload: JSON.parse(raw),
    };
    return next();
  } catch (err) {
    return next(errors.badRequest(`Webhook could not be processed: ${err.message}`));
  }
}
