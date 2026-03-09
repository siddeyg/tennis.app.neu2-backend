/**
 * Alert Service — sends push notifications via ntfy.sh on critical errors.
 *
 * Alerts fire on:
 *   - HTTP 500 responses (unexpected server errors)
 *   - uncaughtException / unhandledRejection (in server.js)
 *
 * Alerts do NOT fire on:
 *   - 400 ValidationError (user input, properly handled)
 *   - 401 / 403 (normal auth flow)
 *
 * Rate limiting: max 1 alert per unique title per 60s — prevents alert storms
 * from repeated failures (e.g. DB down → every request fails).
 *
 * Only active in production (NODE_ENV=production).
 */

const NTFY_TOPIC = 'mondo-srv-k9x4';
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;
const RATE_LIMIT_MS = 60 * 1000; // 1 alert per title per minute

// In-memory rate limit map: title → last sent timestamp
const lastSent = new Map();

/**
 * Send an alert notification via ntfy.sh.
 *
 * @param {string} title  - Short headline (e.g. "500 — camps PUT /:id")
 * @param {string} message - Detail text (error message, stack first line, etc.)
 */
export async function sendAlert(title, message) {
  if (process.env.NODE_ENV !== 'production') return;

  // Rate limit: skip if same title was sent within the last minute
  const now = Date.now();
  const last = lastSent.get(title) || 0;
  if (now - last < RATE_LIMIT_MS) return;
  lastSent.set(title, now);

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const body = `${message}\n\n${timestamp}`;

  try {
    await fetch(NTFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Title': title,
        'Priority': 'high',
        'Tags': 'warning,mondo',
      },
      body,
    });
  } catch (err) {
    // Never throw from alertService — alerting must not break the app
    console.error('[alertService] Failed to send alert:', err.message);
  }
}
