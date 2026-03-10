import mongoose from 'mongoose';

const pushSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  subscription: {
    endpoint: { type: String, required: true },
    keys: {
      p256dh: String,
      auth: String
    }
  },
  userAgent: String,
  createdAt: { type: Date, default: Date.now }
});

// One subscription per endpoint (browser tab/device)
pushSubscriptionSchema.index({ 'subscription.endpoint': 1 }, { unique: true });
pushSubscriptionSchema.index({ userId: 1 });

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);
export default PushSubscription;
