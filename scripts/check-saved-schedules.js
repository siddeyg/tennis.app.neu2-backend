#!/usr/bin/env node
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import SavedSchedule from '../src/models/SavedSchedule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.development') });

async function checkSchedules() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const schedules = await SavedSchedule.find().sort({ createdAt: -1 });

    console.log(`\n💾 Saved Schedules: ${schedules.length} total\n`);

    schedules.forEach((s, index) => {
      console.log(`${index + 1}. ${s.name}`);
      console.log(`   Period ID: ${s.periodId || 'NONE - This is the issue!'}`);
      console.log(`   Created: ${new Date(s.createdAt).toLocaleString()}\n`);
    });

  } finally {
    await mongoose.disconnect();
  }
}

checkSchedules();
