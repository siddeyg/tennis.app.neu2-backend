/**
 * fix-orphaned-portal-users.js
 *
 * Finds and fixes StudentPortalUser records whose studentId or
 * familyMembers[].studentId reference a Student that no longer exists.
 *
 * Run this once after any bulk student deletion, or periodically as a health check.
 * Safe to run multiple times (idempotent).
 *
 * Usage:
 *   cd backend
 *   node scripts/fix-orphaned-portal-users.js
 *
 * Add --dry-run to preview without writing changes:
 *   node scripts/fix-orphaned-portal-users.js --dry-run
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.development') });

const dryRun = process.argv.includes('--dry-run');

// Minimal schemas (avoid full model imports to prevent side-effects)
const StudentPortalUser = mongoose.model('StudentPortalUser', new mongoose.Schema({
  email: String,
  studentId: mongoose.Schema.Types.ObjectId,
  familyMembers: [{
    firstName: String,
    lastName: String,
    studentId: mongoose.Schema.Types.ObjectId
  }]
}, { strict: false }));

const Student = mongoose.model('Student', new mongoose.Schema({
  firstName: String,
  lastName: String
}, { strict: false }));

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`\n🔍 Scanning for orphaned portal user links${dryRun ? ' (DRY RUN)' : ''}...\n`);

  let fixedStudentId = 0;
  let fixedFamilyMembers = 0;

  // ── 1. Fix StudentPortalUser.studentId ───────────────────────────────────
  const usersWithStudentId = await StudentPortalUser.find({
    studentId: { $ne: null, $exists: true }
  });

  for (const user of usersWithStudentId) {
    const exists = await Student.exists({ _id: user.studentId });
    if (!exists) {
      console.log(`  Portal user ${user.email} → studentId ${user.studentId} is ORPHANED`);
      if (!dryRun) {
        await StudentPortalUser.updateOne(
          { _id: user._id },
          { $unset: { studentId: '' } }
        );
      }
      fixedStudentId++;
    }
  }

  // ── 2. Fix familyMembers[].studentId ─────────────────────────────────────
  const usersWithFamily = await StudentPortalUser.find({
    'familyMembers.studentId': { $ne: null, $exists: true }
  });

  for (const user of usersWithFamily) {
    let modified = false;

    for (const member of user.familyMembers) {
      if (!member.studentId) continue;
      const exists = await Student.exists({ _id: member.studentId });
      if (!exists) {
        console.log(`  Portal user ${user.email} → familyMember "${member.firstName}" studentId ${member.studentId} is ORPHANED`);
        if (!dryRun) {
          member.studentId = null;
        }
        modified = true;
        fixedFamilyMembers++;
      }
    }

    if (modified && !dryRun) {
      await user.save();
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────');
  if (fixedStudentId === 0 && fixedFamilyMembers === 0) {
    console.log('✅ No orphaned links found — database is clean');
  } else if (dryRun) {
    console.log(`⚠️  DRY RUN — would fix:`);
    console.log(`   ${fixedStudentId} orphaned StudentPortalUser.studentId`);
    console.log(`   ${fixedFamilyMembers} orphaned familyMember.studentId`);
    console.log(`\nRe-run without --dry-run to apply fixes.`);
  } else {
    console.log(`✅ Fixed:`);
    console.log(`   ${fixedStudentId} orphaned StudentPortalUser.studentId → nullified`);
    console.log(`   ${fixedFamilyMembers} orphaned familyMember.studentId → nullified`);
  }
  console.log('─────────────────────────────────────\n');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
