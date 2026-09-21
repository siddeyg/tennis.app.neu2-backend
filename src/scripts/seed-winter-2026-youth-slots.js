/**
 * Seed Winter 2026/2027 Youth (U18) Training Slots
 *
 * Populates the official U18 youth hall times:
 * - Montag: 14:00 – 18:00 Uhr (BTHV)
 * - Dienstag bis Donnerstag: 15:00 – 18:00 Uhr (Di: BTHV, Mi: Brüser Berg, Do: Brüser Berg)
 * - Freitag: 14:00 – 19:00 Uhr (Brüser Berg)
 * - Samstag: 12:00 – 15:00 Uhr (BTHV)
 *
 * Usage:
 * node backend/src/scripts/seed-winter-2026-youth-slots.js
 */

import '../loadEnv.js';
import mongoose from 'mongoose';
import RegistrationPeriod from '../models/RegistrationPeriod.js';
import logger from '../utils/logger.js';

export const generateSlots = (day, fromHour, toHour, venues) => {
  const slots = [];
  for (let h = fromHour; h < toHour; h += 1) {
    slots.push({
      day,
      hour: h,
      venues: [...venues]
    });
  }
  return slots;
};

export const WINTER_2026_YOUTH_SLOTS = [
  // Montag: 14:00 – 18:00 Uhr (BTHV)
  ...generateSlots('Montag', 14, 18, ['BTHV']),

  // Dienstag: 15:00 – 18:00 Uhr (BTHV)
  ...generateSlots('Dienstag', 15, 18, ['BTHV']),

  // Mittwoch: 15:00 – 18:00 Uhr (Brüser Berg)
  ...generateSlots('Mittwoch', 15, 18, ['Brüser Berg']),

  // Donnerstag: 15:00 – 18:00 Uhr (Brüser Berg)
  ...generateSlots('Donnerstag', 15, 18, ['Brüser Berg']),

  // Freitag: 14:00 – 19:00 Uhr (Brüser Berg)
  ...generateSlots('Freitag', 14, 19, ['Brüser Berg']),

  // Samstag: 12:00 – 15:00 Uhr (BTHV)
  ...generateSlots('Samstag', 12, 15, ['BTHV']),
];

async function seedWinterYouthSlots() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('Connected to MongoDB');

    const period = await RegistrationPeriod.findOne({
      $or: [
        { name: /Wintertraining 2026/i },
        { season: 'winter', isActive: true }
      ]
    });

    if (!period) {
      logger.error('No active Wintertraining 2026 period found in database');
      process.exit(1);
    }

    logger.info(`Found period: "${period.name}" (ID: ${period._id})`);

    // Update U18 / youth training slots
    period.trainingSlots = WINTER_2026_YOUTH_SLOTS;

    await period.save();

    logger.info(`Successfully updated U18 trainingSlots for period "${period.name}":`);
    logger.info(`- Total youth slots: ${period.trainingSlots.length}`);
    
    // Group and log by day
    const byDay = {};
    period.trainingSlots.forEach(s => {
      if (!byDay[s.day]) byDay[s.day] = [];
      byDay[s.day].push(s.hour);
    });

    for (const [day, hours] of Object.entries(byDay)) {
      const min = Math.min(...hours);
      const max = Math.max(...hours) + 1;
      logger.info(`  • ${day}: ${min}:00 – ${max}:00 Uhr (${hours.length} Stunden-Slots)`);
    }

    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
    process.exit(0);
  } catch (err) {
    logger.error(`Error seeding youth slots: ${err.message}`);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

// Execute if run directly
if (process.argv[1] && process.argv[1].endsWith('seed-winter-2026-youth-slots.js')) {
  seedWinterYouthSlots();
}
