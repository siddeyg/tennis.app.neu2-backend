/**
 * Setup / Migrate Winter 2026/2027 Registration Period
 *
 * Idempotent migration script that:
 * 1. Creates or updates the "Wintertraining 2026/2027" period in MongoDB.
 * 2. Populates official dates (05.10.2026 – 24.04.2027, deadline 27.09.2026).
 * 3. Populates official venues (BTHV TLH, BTHV Teppich, Brüser Berg, Duisdorf, Robinson Club).
 * 4. Populates all 42 youth trainingSlots (U18) with exact hall times.
 * 5. Populates all 36 adult trainingSlotsAdults with exact hall times.
 * 6. Populates trainingExclusions for Karneval (Rosenmontag & Veilchendienstag 2027).
 * 7. Sets period to active and open, deactivating any older periods.
 * 8. Syncs MongoDB collection indexes for SeasonalRegistration.
 *
 * Usage:
 * node backend/src/scripts/setup-winter-2026-period.js
 */

import '../loadEnv.js';
import mongoose from 'mongoose';
import RegistrationPeriod from '../models/RegistrationPeriod.js';
import SeasonalRegistration from '../models/SeasonalRegistration.js';
import logger from '../utils/logger.js';
import { WINTER_2026_YOUTH_SLOTS } from './seed-winter-2026-youth-slots.js';
import { WINTER_2026_ADULT_SLOTS, WINTER_2026_VENUES } from './seed-winter-2026-adult-slots.js';

export const WINTER_2026_EXCLUSIONS = [
  {
    date: new Date('2027-02-08T00:00:00.000Z'),
    reason: 'Karnevalspause (Rosenmontag)',
    affectedSlots: []
  },
  {
    date: new Date('2027-02-09T00:00:00.000Z'),
    reason: 'Karnevalspause (Veilchendienstag)',
    affectedSlots: []
  }
];

export async function setupWinterPeriod() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/tennis-coach';
    await mongoose.connect(mongoUri);
    logger.info('Connected to MongoDB');

    let period = await RegistrationPeriod.findOne({
      $or: [
        { name: /Wintertraining 2026/i },
        { season: 'winter' }
      ]
    });

    const isNew = !period;
    if (isNew) {
      logger.info('Period "Wintertraining 2026/2027" not found — creating new period...');
      period = new RegistrationPeriod({
        name: 'Wintertraining 2026/2027',
        season: 'winter',
      });
    } else {
      logger.info(`Found existing period "${period.name}" (ID: ${period._id}) — updating...`);
    }

    // Official dates
    period.name = 'Wintertraining 2026/2027';
    period.season = 'winter';
    period.trainingStartDate = new Date('2026-10-05T00:00:00.000Z');
    period.trainingEndDate = new Date('2027-04-24T23:59:59.000Z');
    period.registrationDeadline = new Date('2026-09-27T23:59:59.000Z');
    period.status = 'open';
    period.isActive = true;

    // Venues & slots
    period.availableVenues = WINTER_2026_VENUES;
    period.trainingSlots = WINTER_2026_YOUTH_SLOTS;
    period.trainingSlotsAdults = WINTER_2026_ADULT_SLOTS;
    period.trainingExclusions = WINTER_2026_EXCLUSIONS;

    // Deactivate all older periods
    await RegistrationPeriod.updateMany(
      { _id: { $ne: period._id }, isActive: true },
      { $set: { isActive: false } }
    );

    await period.save();
    logger.info(`✅ Period "Wintertraining 2026/2027" saved successfully (ID: ${period._id}):`);
    logger.info(`   - Status: ${period.status}, isActive: ${period.isActive}`);
    logger.info(`   - Dates: ${period.trainingStartDate.toISOString().slice(0, 10)} to ${period.trainingEndDate.toISOString().slice(0, 10)}`);
    logger.info(`   - Deadline: ${period.registrationDeadline.toISOString().slice(0, 10)}`);
    logger.info(`   - Available Venues (${period.availableVenues.length}): ${period.availableVenues.join(', ')}`);
    logger.info(`   - Youth Slots (U18): ${period.trainingSlots.length} slots`);
    logger.info(`   - Adult Slots: ${period.trainingSlotsAdults.length} slots`);
    logger.info(`   - Exclusions: ${period.trainingExclusions.map(e => e.reason).join(', ')}`);

    // Sync database indexes
    logger.info('Syncing SeasonalRegistration database indexes...');
    await SeasonalRegistration.syncIndexes();
    logger.info('✅ SeasonalRegistration indexes synced successfully');

    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
    return period;
  } catch (err) {
    logger.error(`Error in setupWinterPeriod: ${err.message}`);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    throw err;
  }
}

// Direct CLI execution
if (process.argv[1] && process.argv[1].endsWith('setup-winter-2026-period.js')) {
  setupWinterPeriod()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
