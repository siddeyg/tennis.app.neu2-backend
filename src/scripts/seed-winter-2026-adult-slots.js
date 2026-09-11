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
  'BTHV (Belag noch offen)',
  'Brüser Berg (Sand)',
  'TC Duisdorf (Teppich)',
  'Robinson Club (Teppich)',
  'Röttgen'
];

export const WINTER_2026_ADULT_SLOTS = [
  // Montag: BTHV (Belag noch offen) 12-14h, Duisdorf 13-16:30h, BTHV TLH 15-20h
  { day: 'Montag', hour: '12', venues: ['BTHV (Belag noch offen)'] },
  { day: 'Montag', hour: '13', venues: ['BTHV (Belag noch offen)', 'TC Duisdorf (Teppich)'] },
  { day: 'Montag', hour: '14', venues: ['TC Duisdorf (Teppich)'] },
  { day: 'Montag', hour: '15', venues: ['BTHV Sand (Traglufthalle)', 'TC Duisdorf (Teppich)'] },
  { day: 'Montag', hour: '16', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Montag', hour: '17', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Montag', hour: '18', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Montag', hour: '19', venues: ['BTHV Sand (Traglufthalle)'] },

  // Dienstag: BTHV (Belag noch offen) 10-13h, BTHV TLH 15-18h
  { day: 'Dienstag', hour: '10', venues: ['BTHV (Belag noch offen)'] },
  { day: 'Dienstag', hour: '11', venues: ['BTHV (Belag noch offen)'] },
  { day: 'Dienstag', hour: '12', venues: ['BTHV (Belag noch offen)'] },
  { day: 'Dienstag', hour: '15', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Dienstag', hour: '16', venues: ['BTHV Sand (Traglufthalle)'] },
  { day: 'Dienstag', hour: '17', venues: ['BTHV Sand (Traglufthalle)'] },

  // Mittwoch: BTHV Teppich 10-12h, Brüser Berg 15-18h, Robinson Club 21-22h
  { day: 'Mittwoch', hour: '10', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Mittwoch', hour: '11', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Mittwoch', hour: '15', venues: ['Brüser Berg (Sand)'] },
  { day: 'Mittwoch', hour: '16', venues: ['Brüser Berg (Sand)'] },
  { day: 'Mittwoch', hour: '17', venues: ['Brüser Berg (Sand)'] },
  { day: 'Mittwoch', hour: '21', venues: ['Robinson Club (Teppich)'] },

  // Donnerstag: BTHV Teppich 10-14h, BTHV TLH + Brüser Berg 15-18h
  { day: 'Donnerstag', hour: '10', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Donnerstag', hour: '11', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Donnerstag', hour: '12', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Donnerstag', hour: '13', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Donnerstag', hour: '15', venues: ['BTHV Sand (Traglufthalle)', 'Brüser Berg (Sand)'] },
  { day: 'Donnerstag', hour: '16', venues: ['BTHV Sand (Traglufthalle)', 'Brüser Berg (Sand)'] },
  { day: 'Donnerstag', hour: '17', venues: ['BTHV Sand (Traglufthalle)', 'Brüser Berg (Sand)'] },

  // Freitag: BTHV Teppich 10-13h (Neu!), Brüser Berg Sand 14-20h
  { day: 'Freitag', hour: '10', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Freitag', hour: '11', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Freitag', hour: '12', venues: ['BTHV Halle (Teppich)'] },
  { day: 'Freitag', hour: '14', venues: ['Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '15', venues: ['Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '16', venues: ['Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '17', venues: ['Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '18', venues: ['Brüser Berg (Sand)'] },
  { day: 'Freitag', hour: '19', venues: ['Brüser Berg (Sand)'] },

  // Samstag: BTHV TLH 10-15h, TC Duisdorf Teppich 10-14h (vorläufig beibehalten bis Rückmeldung)
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
