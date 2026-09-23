/**
 * Production Audit-Log Monitor & ntfy Alerting Script
 *
 * Modes:
 *   --mode=watch  : 30-min emergency watch (alerts on blocked users, spikes, tickets, crashes)
 *   --mode=digest : 4x daily quality report (08:00, 12:00, 16:00, 20:00 Uhr summary)
 *
 * Usage:
 *   node backend/src/scripts/monitorAuditLogs.mjs --mode=watch
 *   node backend/src/scripts/monitorAuditLogs.mjs --mode=digest
 */

import mongoose from 'mongoose';

// Configuration & Credentials
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/tennis-coach';
const NTFY_URL = process.env.NTFY_URL || 'http://5.252.227.183/mondo-srv-k9x4';
const NTFY_USER = process.env.NTFY_USER || 'admin';
const NTFY_PASS = process.env.NTFY_PASS || 'goonline4M';

/**
 * Send push notification to self-hosted ntfy server
 */
async function sendNtfy({ title, message, priority = 'default', tags = 'tennis' }) {
  const auth = Buffer.from(`${NTFY_USER}:${NTFY_PASS}`).toString('base64');
  try {
    // Strip emojis or non-ASCII from HTTP header to comply with HTTP spec (emojis belong in Tags header)
    const cleanTitle = title.replace(/[^\x20-\x7E]/g, '').trim();

    const res = await fetch(NTFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Title': cleanTitle,
        'Priority': String(priority),
        'Tags': tags,
        'Authorization': `Basic ${auth}`
      },
      body: Buffer.from(message, 'utf-8')
    });

    if (!res.ok) {
      console.error(`[monitor] ntfy returned HTTP ${res.status}: ${await res.text()}`);
      return false;
    }
    console.log(`[monitor] ntfy push sent successfully (Title: "${title}")`);
    return true;
  } catch (err) {
    console.error('[monitor] Error sending ntfy notification:', err.message);
    return false;
  }
}

/**
 * Watch Mode: Check for urgent anomalies in the last 30-35 minutes
 */
async function runWatch(db) {
  const now = new Date();
  const defaultLookback = new Date(now.getTime() - 35 * 60 * 1000); // 35 min default

  const stateCol = db.collection('monitorstates');
  const stateDoc = await stateCol.findOne({ _id: 'watch_state' });
  const since = stateDoc?.lastRun ? new Date(stateDoc.lastRun) : defaultLookback;

  console.log(`[monitor:watch] Checking window from ${since.toISOString()} to ${now.toISOString()}`);

  const alerts = [];
  let maxPriority = 'default';

  // 1. Check for blocked users on registration routes (>= 3 errors)
  const regErrors = await db.collection('auditlogs').find({
    endpoint: { $regex: /\/(seasonal-registrations|camps\/.*\/register)/ },
    status: 'ERROR',
    timestamp: { $gte: since }
  }).toArray();

  if (regErrors.length > 0) {
    // Group by user / child
    const bySubject = {};
    for (const err of regErrors) {
      const childName = err.requestBody?.firstName
        ? `${err.requestBody.firstName} ${err.requestBody.lastName || ''}`.trim()
        : null;
      const key = childName || err.userEmail || err.userId?.toString() || err.ipAddress || 'Unbekannt';

      if (!bySubject[key]) {
        bySubject[key] = {
          identifier: key,
          childName,
          email: err.userEmail,
          userId: err.userId,
          count: 0,
          errorMessages: new Set(),
          lastAttempt: err.timestamp
        };
      }
      bySubject[key].count++;
      if (err.errorMessage) bySubject[key].errorMessages.add(err.errorMessage);
      bySubject[key].lastAttempt = err.timestamp;
    }

    // Check if any subject reached >= 3 failures and is still not registered
    const activePeriod = await db.collection('registrationperiods').findOne({ status: 'open' });
    const periodId = activePeriod ? activePeriod._id : null;

    const successfulRegs = periodId ? await db.collection('seasonalregistrations').find({
      periodId,
      status: { $ne: 'cancelled' }
    }).toArray() : [];
    const successSet = new Set(successfulRegs.map(r => `${r.firstName.trim().toLowerCase()} ${r.lastName.trim().toLowerCase()}`));

    const blockedSubjects = [];
    for (const key of Object.keys(bySubject)) {
      const item = bySubject[key];
      if (item.count >= 3) {
        const isSucceeded = item.childName && successSet.has(item.childName.trim().toLowerCase());
        if (!isSucceeded) {
          blockedSubjects.push(item);
        }
      }
    }

    if (blockedSubjects.length > 0) {
      maxPriority = 'urgent';
      const details = blockedSubjects.map(b => 
        `• ${b.identifier} (${b.count}x Fehlversuche, z. B. "${[...b.errorMessages][0] || 'Validierungsfehler'}")`
      ).join('\n');

      alerts.push(`🚨 ANMELDE-BLOCKADE ERKANNT:\n${details}\nKunde(n) kommen aktuell nicht durch die Anmeldung!`);
    } else if (regErrors.length >= 8) {
      // General spike across multiple users
      maxPriority = 'urgent';
      alerts.push(`⚠️ FEHLER-SPIKE AUF REGISTRIERUNGSROUTEN:\n${regErrors.length} Fehler in den letzten 35 Min. registriert. Bitte Validierung prüfen!`);
    }
  }

  // 2. Check for unexpected HTTP 500 crashes
  const server500s = await db.collection('auditlogs').find({
    status: 'ERROR',
    errorMessage: { $regex: /500|Internal|Crash|MongoError|CastError/i },
    timestamp: { $gte: since }
  }).toArray();

  if (server500s.length >= 2) {
    maxPriority = 'urgent';
    alerts.push(`💥 SERVER-CRASH / 500 FEHLER:\n${server500s.length} schwere Serverfehler aufgetreten (z. B. auf ${server500s[0].endpoint}).`);
  }

  // 3. Check for new Support Tickets or customer replies
  const newTickets = await db.collection('supporttickets').find({
    createdAt: { $gte: since }
  }).toArray();

  const ticketReplies = await db.collection('supporttickets').find({
    createdAt: { $lt: since },
    'messages': {
      $elemMatch: {
        senderType: 'student',
        createdAt: { $gte: since }
      }
    }
  }).toArray();

  if (newTickets.length > 0) {
    if (maxPriority !== 'urgent') maxPriority = 'high';
    const list = newTickets.map(t => `• Ticket #${t.ticketNumber}: "${t.subject}" (${t.customerName || t.customerEmail})`).join('\n');
    alerts.push(`📩 NEUES SUPPORT-TICKET:\n${list}`);
  }

  if (ticketReplies.length > 0) {
    if (maxPriority !== 'urgent') maxPriority = 'high';
    const list = ticketReplies.map(t => `• Ticket #${t.ticketNumber}: Neue Kundenantwort von ${t.customerName || t.customerEmail}`).join('\n');
    alerts.push(`💬 KUNDEN-ANTWORT AUF TICKET:\n${list}`);
  }

  // 4. Check for failed Broadcast Emails
  const failedBroadcasts = await db.collection('broadcastemails').find({
    status: { $in: ['failed', 'partially_failed'] },
    updatedAt: { $gte: since }
  }).toArray();

  if (failedBroadcasts.length > 0) {
    if (maxPriority !== 'urgent') maxPriority = 'high';
    alerts.push(`📧 E-MAIL-RUNDMAIL FEHLGESCHLAGEN:\n${failedBroadcasts.length} Rundmail-Job(s) fehlgeschlagen oder unvollständig.`);
  }

  // Send aggregated alert if any anomalies detected
  if (alerts.length > 0) {
    const title = maxPriority === 'urgent'
      ? '🚨 [Mondo App] Akute Störung / Blocker erkannt!'
      : '⚠️ [Mondo App] Wichtige Ereignisse / Tickets';

    const message = alerts.join('\n\n') + `\n\nZeitstempel: ${now.toLocaleTimeString('de-DE')} Uhr`;
    await sendNtfy({
      title,
      message,
      priority: maxPriority,
      tags: maxPriority === 'urgent' ? 'rotating_light,warning,tennis' : 'warning,tennis'
    });
  } else {
    console.log('[monitor:watch] All clear — no anomalies detected in this interval.');
  }

  // Persist state
  await stateCol.updateOne(
    { _id: 'watch_state' },
    { $set: { lastRun: now, lastAlertSent: alerts.length > 0 ? now : (stateDoc?.lastAlertSent || null) } },
    { upsert: true }
  );
}

/**
 * Digest Mode: 4x daily quality report (08:00, 12:00, 16:00, 20:00 Uhr)
 */
async function runDigest(db) {
  const now = new Date();
  const stateCol = db.collection('monitorstates');
  const stateDoc = await stateCol.findOne({ _id: 'digest_state' });

  // Default lookback: last 4 hours (e.g. 08->12, 12->16, 16->20, 20->08)
  const since = stateDoc?.lastDigestAt ? new Date(stateDoc.lastDigestAt) : new Date(now.getTime() - 4.5 * 60 * 60 * 1000);

  console.log(`[monitor:digest] Compiling quality report from ${since.toISOString()} to ${now.toISOString()}`);

  // 1. Registrations in this window
  const newSeasonalRegs = await db.collection('seasonalregistrations').find({
    createdAt: { $gte: since },
    status: { $ne: 'cancelled' }
  }).toArray();

  const totalActiveSeasonal = await db.collection('seasonalregistrations').countDocuments({
    status: { $ne: 'cancelled' }
  });

  const kidsNew = newSeasonalRegs.filter(r => r.formType === 'kids').length;
  const adultsNew = newSeasonalRegs.filter(r => r.formType === 'adults').length;

  // 2. Cleaned error analysis (who failed vs who succeeded afterwards)
  const regErrors = await db.collection('auditlogs').find({
    endpoint: { $regex: /\/(seasonal-registrations|camps\/.*\/register)/ },
    status: 'ERROR',
    timestamp: { $gte: since }
  }).toArray();

  const activePeriod = await db.collection('registrationperiods').findOne({ status: 'open' });
  const periodId = activePeriod ? activePeriod._id : null;

  const successfulRegs = periodId ? await db.collection('seasonalregistrations').find({
    periodId,
    status: { $ne: 'cancelled' }
  }).toArray() : [];
  const successSet = new Set(successfulRegs.map(r => `${r.firstName.trim().toLowerCase()} ${r.lastName.trim().toLowerCase()}`));

  const byChild = {};
  for (const err of regErrors) {
    const fn = err.requestBody?.firstName || 'Unbekannt';
    const ln = err.requestBody?.lastName || '';
    const childKey = `${fn} ${ln}`.trim();
    if (!byChild[childKey]) {
      byChild[childKey] = {
        name: childKey,
        attempts: 0,
        lastError: err.errorMessage || 'Validierungsfehler'
      };
    }
    byChild[childKey].attempts++;
  }

  const resolved = [];
  const unresolved = [];
  for (const key of Object.keys(byChild)) {
    const item = byChild[key];
    if (successSet.has(item.name.toLowerCase())) {
      resolved.push(item);
    } else {
      unresolved.push(item);
    }
  }

  // 3. Support Tickets status
  const openTicketsCount = await db.collection('supporttickets').countDocuments({
    status: { $in: ['open', 'in_progress', 'waiting_for_admin'] }
  });
  const newTicketsInWindow = await db.collection('supporttickets').countDocuments({
    createdAt: { $gte: since }
  });

  // Format Digest Message
  const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const title = `📊 [Mondo App] Qualitäts-Report (${timeStr} Uhr)`;

  let msg = `📅 ZEITRAUM: ${since.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} – ${timeStr} Uhr\n\n`;

  msg += `🎾 NEUE ANMELDUNGEN:\n`;
  msg += `• Kinder/Jugend: +${kidsNew}\n`;
  msg += `• Erwachsene: +${adultsNew}\n`;
  msg += `• Gesamtbestand aktiv: ${totalActiveSeasonal} Anmeldungen\n\n`;

  msg += `🔍 ANMELDE-INTEGRITÄT:\n`;
  if (unresolved.length === 0 && resolved.length === 0) {
    msg += `• Keine Fehlversuche im Berichtszeitraum ✅\n`;
  } else {
    if (resolved.length > 0) {
      msg += `• ${resolved.length} Familie(n) mit Fehlversuchen, danach erfolgreich registriert ✅\n`;
      resolved.forEach(r => {
        msg += `   ↳ ${r.name} (${r.attempts}x Fehlversuch, erledigt)\n`;
      });
    }
    if (unresolved.length > 0) {
      msg += `• 🚨 ${unresolved.length} Familie(n) AKTUELL NOCH BLOCKIERT:\n`;
      unresolved.forEach(u => {
        msg += `   ↳ ${u.name} (${u.attempts}x Fehlversuche, z. B. "${u.lastError}")\n`;
      });
    }
  }

  msg += `\n📩 SUPPORT & TICKETS:\n`;
  msg += `• Aktuell offene Tickets: ${openTicketsCount}\n`;
  msg += `• Neue Tickets in diesem Fenster: ${newTicketsInWindow}\n`;

  const priority = unresolved.length > 0 ? 'high' : 'default';
  const tags = unresolved.length > 0 ? 'warning,bar_chart,tennis' : 'white_check_mark,bar_chart,tennis';

  await sendNtfy({
    title,
    message: msg,
    priority,
    tags
  });

  // Persist state
  await stateCol.updateOne(
    { _id: 'digest_state' },
    { $set: { lastDigestAt: now } },
    { upsert: true }
  );
}

async function main() {
  const mode = process.argv.find(arg => arg.startsWith('--mode='))?.split('=')[1] || 'watch';

  console.log(`[monitor] Connecting to MongoDB: ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI);

  const db = mongoose.connection.db;

  try {
    if (mode === 'digest') {
      await runDigest(db);
    } else {
      await runWatch(db);
    }
  } catch (err) {
    console.error('[monitor] Execution error:', err);
    await sendNtfy({
      title: '🚨 [Mondo App] Monitor-Skript Fehler',
      message: `Das Monitoring-Skript ist mit einem Fehler abgestürzt:\n${err.message}`,
      priority: 'urgent',
      tags: 'skull,warning'
    });
  } finally {
    await mongoose.disconnect();
    console.log('[monitor] Finished.');
    process.exit(0);
  }
}

main();
