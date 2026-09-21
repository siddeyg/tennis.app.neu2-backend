/**
 * Seed Winter 2026/2027 Adult Training Slots & Available Venues
 *
 * Populates the exact adult hall times transcribed from Mondo Tennisschule
 * official notice sheets (winter/2026/WINTER_2026_2027_TRAININGSANGEBOT_HALLEN_UND_TERMINE.md).
 *
 * Usage:
 * node backend/src/scripts/seed-winter-2026-adult-slots.js
 */

import '../loadEnv.js';
import mongoose from 'mongoose';
import RegistrationPeriod from '../models/RegistrationPeriod.js';
import logger from '../utils/logger.js';

export const WINTER_2026_VENUES = [
  'TC Brüser Berg (Sand)',
  'BonnerTHV – Teppichhalle',
  'BonnerTHV – Traglufthalle',
  'TC Duisdorf (Teppich)'
];

export const WINTER_2026_ADULT_SLOTS = [
  // Montag: BTHV TLH 12h, Duisdorf 13-16:30h, BTHV TLH 15-20h
  { day: 'Montag', hour: '12', venues: ['BonnerTHV – Traglufthalle'] },
  { day: 'Montag', hour: '13', venues: ['TC Duisdorf (Teppich)'] },
  { day: 'Montag', hour: '14', venues: ['TC Duisdorf (Teppich)'] },
  { day: 'Montag', hour: '15', venues: ['BonnerTHV – Traglufthalle', 'TC Duisdorf (Teppich)'] },
  { day: 'Montag', hour: '16', venues: ['BonnerTHV – Traglufthalle'] },
  { day: 'Montag', hour: '17', venues: ['BonnerTHV – Traglufthalle'] },
  { day: 'Montag', hour: '18', venues: ['BonnerTHV – Traglufthalle'] },
  { day: 'Montag', hour: '19', venues: ['BonnerTHV – Traglufthalle'] },

  // Dienstag: BTHV Teppich 10-13h, BTHV TLH 15-18h
  { day: 'Dienstag', hour: '10', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Dienstag', hour: '11', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Dienstag', hour: '12', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Dienstag', hour: '15', venues: ['BonnerTHV – Traglufthalle'] },
  { day: 'Dienstag', hour: '16', venues: ['BonnerTHV – Traglufthalle'] },
  { day: 'Dienstag', hour: '17', venues: ['BonnerTHV – Traglufthalle'] },

  // Mittwoch: BTHV Teppich 10-12h, Brüser Berg 15-18h
  { day: 'Mittwoch', hour: '10', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Mittwoch', hour: '11', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Mittwoch', hour: '15', venues: ['TC Brüser Berg (Sand)'] },
  { day: 'Mittwoch', hour: '16', venues: ['TC Brüser Berg (Sand)'] },
  { day: 'Mittwoch', hour: '17', venues: ['TC Brüser Berg (Sand)'] },

  // Donnerstag: BTHV Teppich 10-14h, BTHV TLH + Brüser Berg 15-18h
  { day: 'Donnerstag', hour: '10', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Donnerstag', hour: '11', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Donnerstag', hour: '12', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Donnerstag', hour: '13', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Donnerstag', hour: '15', venues: ['BonnerTHV – Traglufthalle', 'TC Brüser Berg (Sand)'] },
  { day: 'Donnerstag', hour: '16', venues: ['BonnerTHV – Traglufthalle', 'TC Brüser Berg (Sand)'] },
  { day: 'Donnerstag', hour: '17', venues: ['BonnerTHV – Traglufthalle', 'TC Brüser Berg (Sand)'] },

  // Freitag: BTHV Teppich 10-13h, Brüser Berg Sand 14-20h
  { day: 'Freitag', hour: '10', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Freitag', hour: '11', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Freitag', hour: '12', venues: ['BonnerTHV – Teppichhalle'] },
  { day: 'Freitag', hour: '14', venues: ['TC Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '15', venues: ['TC Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '16', venues: ['TC Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '17', venues: ['TC Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '18', venues: ['TC Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '19', venues: ['TC Brüser Berg (Sand)'] },

  // Samstag: BTHV TLH 10-15h, TC Duisdorf Teppich 10-14h
  { day: 'Samstag', hour: '10', venues: ['BonnerTHV – Traglufthalle', 'TC Duisdorf (Teppich)'] },
  { day: 'Samstag', hour: '11', venues: ['BonnerTHV – Traglufthalle', 'TC Duisdorf (Teppich)'] },
  { day: 'Samstag', hour: '12', venues: ['BonnerTHV – Traglufthalle', 'TC Duisdorf (Teppich)'] },
  { day: 'Samstag', hour: '13', venues: ['BonnerTHV – Traglufthalle', 'TC Duisdorf (Teppich)'] },
  { day: 'Samstag', hour: '14', venues: ['BonnerTHV – Traglufthalle'] }
];

async function seedWinterAdultSlots() {
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

    // Update venues and adult slots
    period.availableVenues = WINTER_2026_VENUES;
    period.trainingSlotsAdults = WINTER_2026_ADULT_SLOTS;

    // Update dates per official chefcoach documents
    period.trainingStartDate = new Date('2026-10-05T00:00:00.000Z');
    period.trainingEndDate = new Date('2027-04-24T23:59:59.000Z');
    period.registrationDeadline = new Date('2026-09-27T23:59:59.000Z');
    period.status = 'open';
    period.isActive = true;

    await period.save();

    logger.info(`Successfully updated period "${period.name}":`);
    logger.info(`- availableVenues: ${period.availableVenues.length} entries (${period.availableVenues.join(', ')})`);
    logger.info(`- trainingSlotsAdults: ${period.trainingSlotsAdults.length} slots`);
    logger.info(`- trainingStartDate: ${period.trainingStartDate.toISOString()}`);
    logger.info(`- trainingEndDate: ${period.trainingEndDate.toISOString()}`);
    logger.info(`- registrationDeadline: ${period.registrationDeadline.toISOString()}`);

    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
    process.exit(0);
  } catch (err) {
    logger.error(`Error seeding adult slots: ${err.message}`);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

// Run directly if invoked from CLI
if (process.argv[1]?.endsWith('seed-winter-2026-adult-slots.js')) {
  seedWinterAdultSlots();
}
