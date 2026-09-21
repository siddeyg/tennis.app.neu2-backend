#!/usr/bin/env node
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import RegistrationPeriod from '../src/models/RegistrationPeriod.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.development') });

const MONGO_URI = process.env.MONGO_URI;

async function configureExclusions() {
  try {
    await mongoose.connect(MONGO_URI);

    const period = await RegistrationPeriod.findOne({ name: 'Wintertraining 2026/2027' });
    if (!period) {
      console.error('Period "Wintertraining 2026/2027" not found!');
      return;
    }

    console.log(`Found period: ${period.name} (${period._id})`);
    console.log('Current trainingExclusions count:', period.trainingExclusions.length);
    period.trainingExclusions.forEach((ex, i) => {
      console.log(`  ${i + 1}. ${new Date(ex.date).toISOString().slice(0, 10)} - ${ex.reason}`);
    });

    const carnivalDays = [
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

    let addedCount = 0;
    for (const cDay of carnivalDays) {
      const cDateStr = cDay.date.toISOString().slice(0, 10);
      const exists = period.trainingExclusions.some(ex => {
        const dStr = new Date(ex.date).toISOString().slice(0, 10);
        return dStr === cDateStr;
      });

      if (!exists) {
        period.trainingExclusions.push(cDay);
        addedCount++;
        console.log(`Added: ${cDateStr} - ${cDay.reason}`);
      } else {
        console.log(`Already exists: ${cDateStr}`);
      }
    }

    if (addedCount > 0) {
      await period.save();
      console.log(`Successfully saved ${addedCount} new exclusions to period.`);
    } else {
      console.log('No new exclusions needed.');
    }

  } catch (err) {
    console.error('Error configuring exclusions:', err);
  } finally {
    await mongoose.disconnect();
  }
}

configureExclusions();
