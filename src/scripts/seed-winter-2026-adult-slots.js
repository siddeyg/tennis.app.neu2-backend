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
  'BTHV Sand (Traglufthalle)',
  'BTHV Halle (Teppich)',
  'Brüser Berg (Sand)',
  'TC Duisdorf (Teppich)',
  'Robinson Club (Teppich)',
  'Röttgen'
];

export const WINTER_2026_ADULT_SLOTS = [
  // Montag
  { day: 'Montag', hour: '12', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Montag', hour: '13', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Montag', hour: '17', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Montag', hour: '18', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Montag', hour: '19', venues: ['BTHV Sand (Traglufthalle)'] },

  // Dienstag
  { day: 'Dienstag', hour: '10', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Dienstag', hour: '11', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Dienstag', hour: '12', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Dienstag', hour: '15', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Dienstag', hour: '16', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Dienstag', hour: '17', venues: ['BTHV Sand (Traglufthalle)'] },

  // Mittwoch
  { day: 'Mittwoch', hour: '10', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Mittwoch', hour: '11', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Mittwoch', hour: '14', venues: ['Brüser Berg (Sand)'] },
  { day: 'Mittwoch', hour: '15', venues: ['Brüser Berg (Sand)'] },
  { day: 'Mittwoch', hour: '16', venues: ['Brüser Berg (Sand)'] },
  { day: 'Mittwoch', hour: '17', venues: ['Brüser Berg (Sand)'] },
  { day: 'Mittwoch', hour: '21', venues: ['Robinson Club (Teppich)'] },

  // Donnerstag
  { day: 'Donnerstag', hour: '10', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Donnerstag', hour: '11', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Donnerstag', hour: '12', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Donnerstag', hour: '15', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Donnerstag', hour: '16', venues: ['BTHV Sand (Traglufthalle)', 'Brüser Berg (Sand)'] },
  { day: 'Donnerstag', hour: '17', venues: ['BTHV Sand (Traglufthalle)', 'Brüser Berg (Sand)'] },

  // Freitag
  { day: 'Freitag', hour: '14', venues: ['Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '15', venues: ['Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '16', venues: ['Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '17', venues: ['Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '18', venues: ['Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '19', venues: ['Brüser Berg (Sand)'] },

  // Samstag
  { day: 'Samstag', hour: '9', venues: ['BTHV Sand (Traglufthalle)', 'TC Duisdorf (Teppich)'] },
  { day: 'Samstag', hour: '10', venues: ['BTHV Sand (Traglufthalle)', 'TC Duisdorf (Teppich)'] },
  { day: 'Samstag', hour: '11', venues: ['BTHV Sand (Traglufthalle)', 'TC Duisdorf (Teppich)'] },
  { day: 'Samstag', hour: '12', venues: ['BTHV Sand (Traglufthalle)', 'TC Duisdorf (Teppich)'] },
  { day: 'Samstag', hour: '13', venues: ['BTHV Sand (Traglufthalle)', 'TC Duisdorf (Teppich)'] },
  { day: 'Samstag', hour: '14', venues: ['BTHV Sand (Traglufthalle)'] }
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

    await period.save();

    logger.info(`Successfully updated period "${period.name}":`);
    logger.info(`- availableVenues: ${period.availableVenues.length} entries`);
    logger.info(`- trainingSlotsAdults: ${period.trainingSlotsAdults.length} slots`);

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
