import mongoose from 'mongoose';

/**
 * Deduplication + audit log for GitHub webhook deliveries. The unique index on
 * deliveryId is what makes redelivery safe: a duplicate insert throws E11000
 * and the handler exits early.
 */
const webhookDeliverySchema = new mongoose.Schema(
  {
    deliveryId: { type: String, required: true, unique: true },
    event: { type: String, required: true, index: true },
    action: { type: String, default: '' },
    installationId: { type: Number, default: null },
    repositoryFullName: { type: String, default: '', index: true },
    status: { type: String, enum: ['received', 'processed', 'ignored', 'failed'], default: 'received' },
    detail: { type: String, default: '' },
    processedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 14 },
  },
  { timestamps: false },
);

export const WebhookDelivery =
  mongoose.models.WebhookDelivery || mongoose.model('WebhookDelivery', webhookDeliverySchema);
