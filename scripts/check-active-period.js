#!/usr/bin/env node
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import RegistrationPeriod from '../src/models/RegistrationPeriod.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.development') });

async function checkActivePeriod() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    // Check active period
    const activePeriod = await RegistrationPeriod.findOne({ isActive: true });

    console.log('\n🔍 Checking Active Period:\n');
    if (activePeriod) {
      console.log('✅ Active period found:');
      console.log(`   Name: ${activePeriod.name}`);
      console.log(`   Season: ${activePeriod.season}`);
      console.log(`   Status: ${activePeriod.status}`);
      console.log(`   isActive: ${activePeriod.isActive}`);
      console.log(`   ID: ${activePeriod._id}`);
      console.log(`   Current Plan ID: ${activePeriod.currentPlanId || 'none'}`);
    } else {
      console.log('❌ No active period found!');

      // List all periods
      const allPeriods = await RegistrationPeriod.find();
      console.log(`\n📋 All periods (${allPeriods.length} total):`);
      allPeriods.forEach(p => {
        console.log(`   - ${p.name}: isActive=${p.isActive}, status=${p.status}`);
      });
    }

  } finally {
    await mongoose.disconnect();
  }
}

checkActivePeriod();
