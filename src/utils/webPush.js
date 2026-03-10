/**
 * Web Push utility — sends push notifications to subscribed browsers.
 *
 * VAPID keys are read from env at startup. If missing, push is disabled
 * (logs warning, never throws).
 */
import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';
import logger from './logger.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@mondo-tennis.de';

let pushEnabled = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  pushEnabled = true;
  logger.info('Web Push: VAPID configured ✓');
} else {
  logger.warn('Web Push: VAPID keys missing — push notifications disabled');
}

/**
 * Send a push notification to all stored subscriptions.
 * Removes expired/invalid subscriptions automatically (410 Gone).
 */
export async function sendPushToAdmins(title, body, data = {}) {
  if (!pushEnabled) return;

  const payload = JSON.stringify({ title, body, data });
  const subscriptions = await PushSubscription.find({});

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired — remove it
          await PushSubscription.deleteOne({ _id: sub._id });
          logger.info('Web Push: removed expired subscription', { id: sub._id });
        } else {
          throw err;
        }
      }
    })
  );

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    logger.error('Web Push: some notifications failed', { count: failed.length });
  }
}

export { VAPID_PUBLIC_KEY, pushEnabled };
