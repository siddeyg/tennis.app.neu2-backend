#!/usr/bin/env node
/**
 * Deep analysis of the seasonal registration → schedule workflow
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import RegistrationPeriod from '../src/models/RegistrationPeriod.js';
import SeasonalRegistration from '../src/models/SeasonalRegistration.js';
import Student from '../src/models/Student.js';
import Coach from '../src/models/Coach.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.development') });

async function analyzeWorkflow() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  🔍 SCHEDULE WORKFLOW ANALYSIS');
    console.log('═══════════════════════════════════════════════════════════\n');

    // 1. Check active period and its configuration
    const activePeriod = await RegistrationPeriod.findOne({ isActive: true });
    console.log('1️⃣  ACTIVE REGISTRATION PERIOD:\n');
    if (activePeriod) {
      console.log(`   Name: ${activePeriod.name}`);
      console.log(`   Status: ${activePeriod.status}`);
      console.log(`   Training Slots: ${activePeriod.trainingSlots?.length || 0} configured`);

      if (activePeriod.trainingSlots?.length > 0) {
        console.log('   📅 Configured training times:');
        const grouped = {};
        activePeriod.trainingSlots.forEach(slot => {
          if (!grouped[slot.day]) grouped[slot.day] = [];
          grouped[slot.day].push(`${slot.hour}:00 (${slot.venue})`);
        });
        Object.keys(grouped).forEach(day => {
          console.log(`      ${day}: ${grouped[day].join(', ')}`);
        });
      } else {
        console.log('   ⚠️  NO training slots configured!');
      }
    } else {
      console.log('   ❌ No active period found!');
    }

    // 2. Check seasonal registrations
    console.log('\n2️⃣  SEASONAL REGISTRATIONS:\n');
    const registrations = await SeasonalRegistration.find().sort({ createdAt: -1 }).limit(10);
    console.log(`   Total: ${registrations.length} registrations (showing last 10)`);

    const byStatus = await SeasonalRegistration.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    console.log('   By status:');
    byStatus.forEach(s => console.log(`      ${s._id}: ${s.count}`));

    if (registrations.length > 0) {
      console.log('\n   📋 Recent registrations:');
      registrations.slice(0, 3).forEach(reg => {
        console.log(`      - ${reg.firstName} ${reg.lastName} (${reg.formType})`);
        console.log(`        Status: ${reg.status}`);
        console.log(`        Period: ${reg.periodId}`);
        console.log(`        Available times: ${reg.availableTimes?.length || 0}`);
        if (reg.availableTimes?.length > 0) {
          console.log(`        Times: ${reg.availableTimes.slice(0, 3).map(t => `${t.day} ${t.hour}`).join(', ')}...`);
        }
      });
    }

    // 3. Check Students
    console.log('\n3️⃣  STUDENTS IN SYSTEM:\n');
    const students = await Student.find();
    console.log(`   Total students: ${students.length}`);

    const withAssignments = students.filter(s => s.assignments?.length > 0);
    const withoutAssignments = students.filter(s => !s.assignments || s.assignments.length === 0);

    console.log(`   With assignments: ${withAssignments.length}`);
    console.log(`   Without assignments: ${withoutAssignments.length}`);

    if (students.length > 0) {
      console.log('\n   📋 Recent students:');
      students.slice(0, 3).forEach(s => {
        console.log(`      - ${s.firstName} ${s.lastName}`);
        console.log(`        Available times: ${s.availableTimes?.length || 0}`);
        console.log(`        Assignments: ${s.assignments?.length || 0}`);
        console.log(`        Adult: ${s.adult}, Frequence: ${s.frequence}`);
      });
    }

    // 4. Check Coaches
    console.log('\n4️⃣  COACHES:\n');
    const coaches = await Coach.find();
    console.log(`   Total coaches: ${coaches.length}`);

    if (coaches.length > 0) {
      console.log('\n   📋 Coaches and their availability:');
      coaches.forEach(c => {
        console.log(`      - ${c.firstName} ${c.lastName}`);
        console.log(`        Available times: ${c.availableTimes?.length || 0}`);
        if (c.availableTimes?.length > 0) {
          console.log(`        Times: ${c.availableTimes.slice(0, 5).join(', ')}...`);
        }
      });
    } else {
      console.log('   ❌ No coaches found!');
    }

    // 5. Workflow analysis
    console.log('\n5️⃣  WORKFLOW ISSUES DETECTED:\n');
    const issues = [];

    if (!activePeriod) {
      issues.push('❌ No active registration period');
    }

    if (activePeriod && (!activePeriod.trainingSlots || activePeriod.trainingSlots.length === 0)) {
      issues.push('❌ Active period has NO training slots configured');
      issues.push('   → Schedule grid will be empty (no hours to click)');
      issues.push('   → Fix: Edit period and add training slots in Step 2');
    }

    if (coaches.length === 0) {
      issues.push('❌ No coaches in system');
      issues.push('   → Algorithm cannot assign students');
      issues.push('   → Fix: Add coaches in "Trainer" menu');
    }

    const coachesWithoutTimes = coaches.filter(c => !c.availableTimes || c.availableTimes.length === 0);
    if (coachesWithoutTimes.length > 0) {
      issues.push(`⚠️  ${coachesWithoutTimes.length} coaches have NO available times`);
      issues.push('   → Algorithm cannot use these coaches');
    }

    const pendingRegs = await SeasonalRegistration.countDocuments({ status: 'pending' });
    if (pendingRegs > 0) {
      issues.push(`⚠️  ${pendingRegs} seasonal registrations are still PENDING`);
      issues.push('   → These are not yet converted to Student records');
      issues.push('   → Fix: Go to "Anmeldungen" and click "Alle verarbeiten"');
    }

    if (withoutAssignments.length > 0 && coaches.length > 0) {
      const studentsWithoutAvailableTimes = students.filter(s => !s.availableTimes || s.availableTimes.length === 0);
      if (studentsWithoutAvailableTimes.length > 0) {
        issues.push(`⚠️  ${studentsWithoutAvailableTimes.length} students have NO available times`);
        issues.push('   → Algorithm cannot assign these students');
        issues.push('   → Fix: Edit student and set available times');
      }
    }

    if (issues.length === 0) {
      console.log('   ✅ No critical issues detected!');
      console.log('   The workflow should work correctly.');
    } else {
      issues.forEach(issue => console.log(`   ${issue}`));
    }

    console.log('\n═══════════════════════════════════════════════════════════\n');

  } finally {
    await mongoose.disconnect();
  }
}

analyzeWorkflow();
