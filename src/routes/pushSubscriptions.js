import express from 'express';
import PushSubscription from '../models/PushSubscription.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdminOrSupermod } from '../middleware/requireRole.js';
import { VAPID_PUBLIC_KEY } from '../utils/webPush.js';
import logger from '../utils/logger.js';

const router = express.Router();

// All routes require admin auth
router.use(requireAuth, requireAdminOrSupermod);

// GET /api/push/vapid-public-key
// Returns public VAPID key so frontend can subscribe
router.get('/vapid-public-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: 'Push notifications not configured' });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe
// Save a push subscription for this admin user
router.post('/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    await PushSubscription.findOneAndUpdate(
      { 'subscription.endpoint': subscription.endpoint },
      {
        userId: req.user._id,
        subscription,
        userAgent: req.headers['user-agent']
      },
      { upsert: true, new: true }
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Error saving push subscription', { error: error.message });
    res.status(500).json({ error: 'Fehler beim Speichern der Benachrichtigungseinstellungen' });
  }
});

// DELETE /api/push/unsubscribe
// Remove a push subscription
router.delete('/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint required' });
    }
    await PushSubscription.deleteOne({ 'subscription.endpoint': endpoint });
    res.json({ success: true });
  } catch (error) {
    logger.error('Error removing push subscription', { error: error.message });
    res.status(500).json({ error: 'Fehler beim Entfernen der Benachrichtigungseinstellungen' });
  }
});

export default router;
