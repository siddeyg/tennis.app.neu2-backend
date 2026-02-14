#!/usr/bin/env node
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import RegistrationPeriod from '../src/models/RegistrationPeriod.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.development') });

const MONGO_URI = process.env.MONGO_URI;

async function listPeriods() {
  try {
    await mongoose.connect(MONGO_URI);

    const periods = await RegistrationPeriod.find().sort({ createdAt: -1 });

    console.log(`\n📅 Registration Periods (Zeiträume): ${periods.length} total\n`);

    periods.forEach((p, index) => {
      console.log(`${index + 1}. ${p.name}`);
      console.log(`   Season: ${p.season} | Status: ${p.status}`);
      console.log(`   Current Plan ID: ${p.currentPlanId || 'none'}`);
      console.log(`   Created: ${new Date(p.createdAt).toLocaleDateString()}\n`);
    });

  } finally {
    await mongoose.disconnect();
  }
}

listPeriods();
