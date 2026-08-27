import { Router } from 'express';
import express from 'express';
import { verifyWebhookSignature } from '../middleware/webhookVerify.js';
import { handleWebhook } from '../controllers/webhook.controller.js';

const router = Router();

/**
 * Webhook route with its own raw body parser — the HMAC must be computed over
 * the exact bytes GitHub sent, so this router is mounted before express.json().
 */
router.post(
  '/webhook',
  express.raw({ type: ['application/json', 'application/x-www-form-urlencoded'], limit: '5mb' }),
  verifyWebhookSignature,
  handleWebhook,
);

export default router;
