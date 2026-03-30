/**
 * Migrate Coach documents with string _id to proper ObjectId _id.
 *
 * Problem: 6 original coaches (Helge, Ben, Joris, Christopher, Falko, Nicole) have
 * string _id values instead of ObjectId. Mongoose's findById() auto-casts to ObjectId,
 * silently failing to match string _ids — breaking coach edit/delete in admin portal.
 *
 * This script:
 *   1. Backs up affected collections to JSON
 *   2. Creates new coach documents with proper ObjectId _ids
 *   3. Updates all references across collections
 *   4. Deletes old string-_id documents
 *   5. Verifies everything
 *
 * Usage:
 *   node scripts/migrate-coach-string-ids.js              # dry-run (default)
 *   node scripts/migrate-coach-string-ids.js --live       # execute for real
 *
 * Collections updated:
 *   - coaches        (new docs with ObjectId _id)
 *   - students       (assignments[].coach)
 *   - schedules      (coach)
 *   - users          (coachId)
 *   - camps          (trainerId — stored as String)
 *   - attendances    (coach)
 *   - savedschedules (coaches[]._id, students[].assignments[].coach, schedule[].coach)
 *
 * Skipped (string fields, no lookups):
 *   - absences       (coach field is informational string)
 *   - schedulechangerequests (string preference fields)
 *   - auditlogs      (historical, resourceId is already String)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ObjectId } = mongoose.Types;

// Load env
const envFile = process.env.NODE_ENV === 'production'
  ? '/app/.env.production'
  : path.join(__dirname, '../../.env.development');

dotenv.config({ path: envFile });

const DRY_RUN = !process.argv.includes('--live');

async function migrate() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Coach String _id → ObjectId Migration`);
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '⚡ LIVE'}`);
  console.log(`${'='.repeat(60)}\n`);

  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const db = mongoose.connection.db;

  // ── Phase 0: Find string-_id coaches ──────────────────────────────
  console.log('── Phase 0: Identify string-_id coaches ──');

  const allCoaches = await db.collection('coaches').find().toArray();
  const stringIdCoaches = allCoaches.filter(c => typeof c._id === 'string');

  if (stringIdCoaches.length === 0) {
    console.log('✅ No coaches with string _id found. Nothing to migrate.\n');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${stringIdCoaches.length} coaches with string _id:\n`);
  for (const c of stringIdCoaches) {
    console.log(`  _id: "${c._id}" (${typeof c._id}) — ${c.firstName} ${c.lastName}`);
  }
  console.log();

  // ── Phase 0b: Backup ──────────────────────────────────────────────
  console.log('── Phase 0b: Backup affected collections ──');

  const backupDir = path.join(__dirname, '../../../scripts/migration-backup');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `coach-string-ids-backup-${timestamp}.json`);

  const oldIds = stringIdCoaches.map(c => c._id);
  // Old string IDs are valid hex — other collections may store as ObjectId too
  const oldObjIds = oldIds.map(id => new ObjectId(id));
  const bothForms = [...oldIds, ...oldObjIds];

  // Gather all affected data for backup
  const backup = {
    timestamp: new Date().toISOString(),
    coaches: stringIdCoaches,
    students: await db.collection('students').find({ 'assignments.coach': { $in: bothForms } }).toArray(),
    schedules: await db.collection('schedules').find({ coach: { $in: bothForms } }).toArray(),
    users: await db.collection('users').find({ coachId: { $in: bothForms } }).toArray(),
    camps: await db.collection('camps').find({ trainerId: { $in: bothForms } }).toArray(),
    attendances: await db.collection('attendances').find({ coach: { $in: bothForms } }).toArray(),
    savedschedules: await db.collection('savedschedules').find().toArray(), // full snapshot needed
  };

  if (!DRY_RUN) {
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
    console.log(`  Backup saved to: ${backupFile}`);
  } else {
    console.log(`  [dry-run] Would save backup to: ${backupFile}`);
  }

  console.log(`  Affected documents:`);
  console.log(`    students:       ${backup.students.length}`);
  console.log(`    schedules:      ${backup.schedules.length}`);
  console.log(`    users:          ${backup.users.length}`);
  console.log(`    camps:          ${backup.camps.length}`);
  console.log(`    attendances:    ${backup.attendances.length}`);
  console.log(`    savedschedules: ${backup.savedschedules.length} (full collection)\n`);

  // ── Phase 1: Build ID mapping ─────────────────────────────────────
  console.log('── Phase 1: Build ID mapping ──');

  const idMap = {};  // oldStringId → newObjectId
  for (const c of stringIdCoaches) {
    idMap[c._id] = new ObjectId();
    console.log(`  "${c._id}" → ${idMap[c._id]}  (${c.firstName} ${c.lastName})`);
  }
  console.log();

  // ── Phase 2: Create new coach documents ───────────────────────────
  console.log('── Phase 2: Create new coach documents ──');

  for (const c of stringIdCoaches) {
    const newDoc = { ...c, _id: idMap[c._id] };
    if (!DRY_RUN) {
      await db.collection('coaches').insertOne(newDoc);
      console.log(`  ✅ Inserted: ${c.firstName} ${c.lastName} (${idMap[c._id]})`);
    } else {
      console.log(`  [dry-run] Would insert: ${c.firstName} ${c.lastName} (${idMap[c._id]})`);
    }
  }
  console.log();

  // ── Phase 3: Update references ────────────────────────────────────
  console.log('── Phase 3: Update references ──');

  // NOTE: Old string _ids are valid hex, so other collections may store references
  // as either string "68eb..." OR ObjectId("68eb..."). Must search for BOTH forms.

  // 3a. students — assignments[].coach
  let studentUpdates = 0;
  for (const [oldId, newId] of Object.entries(idMap)) {
    const oldObjId = new ObjectId(oldId);
    const filter = { 'assignments.coach': { $in: [oldId, oldObjId] } };
    const students = await db.collection('students').find(filter).toArray();
    for (const student of students) {
      const updatedAssignments = student.assignments.map(a => {
        const coachStr = a.coach?.toString?.() || a.coach;
        return coachStr === oldId ? { ...a, coach: newId } : a;
      });
      if (!DRY_RUN) {
        await db.collection('students').updateOne(
          { _id: student._id },
          { $set: { assignments: updatedAssignments } }
        );
      }
      studentUpdates++;
    }
  }
  console.log(`  students.assignments[].coach: ${studentUpdates} docs ${DRY_RUN ? 'would be ' : ''}updated`);

  // 3b. schedules — coach field
  let scheduleUpdates = 0;
  for (const [oldId, newId] of Object.entries(idMap)) {
    const oldObjId = new ObjectId(oldId);
    const filter = { coach: { $in: [oldId, oldObjId] } };
    const result = DRY_RUN
      ? { modifiedCount: (await db.collection('schedules').countDocuments(filter)) }
      : await db.collection('schedules').updateMany(filter, { $set: { coach: newId } });
    scheduleUpdates += result.modifiedCount || 0;
  }
  console.log(`  schedules.coach: ${scheduleUpdates} docs ${DRY_RUN ? 'would be ' : ''}updated`);

  // 3c. users — coachId field
  let userUpdates = 0;
  for (const [oldId, newId] of Object.entries(idMap)) {
    const oldObjId = new ObjectId(oldId);
    const filter = { coachId: { $in: [oldId, oldObjId] } };
    const result = DRY_RUN
      ? { modifiedCount: (await db.collection('users').countDocuments(filter)) }
      : await db.collection('users').updateMany(filter, { $set: { coachId: newId } });
    userUpdates += result.modifiedCount || 0;
  }
  console.log(`  users.coachId: ${userUpdates} docs ${DRY_RUN ? 'would be ' : ''}updated`);

  // 3d. camps — trainerId (String type, but check both forms)
  let campUpdates = 0;
  for (const [oldId, newId] of Object.entries(idMap)) {
    const oldObjId = new ObjectId(oldId);
    const filter = { trainerId: { $in: [oldId, oldObjId] } };
    const result = DRY_RUN
      ? { modifiedCount: (await db.collection('camps').countDocuments(filter)) }
      : await db.collection('camps').updateMany(filter, { $set: { trainerId: newId.toString() } });
    campUpdates += result.modifiedCount || 0;
  }
  console.log(`  camps.trainerId: ${campUpdates} docs ${DRY_RUN ? 'would be ' : ''}updated`);

  // 3e. attendances — coach field
  let attendanceUpdates = 0;
  for (const [oldId, newId] of Object.entries(idMap)) {
    const oldObjId = new ObjectId(oldId);
    const filter = { coach: { $in: [oldId, oldObjId] } };
    const result = DRY_RUN
      ? { modifiedCount: (await db.collection('attendances').countDocuments(filter)) }
      : await db.collection('attendances').updateMany(filter, { $set: { coach: newId } });
    attendanceUpdates += result.modifiedCount || 0;
  }
  console.log(`  attendances.coach: ${attendanceUpdates} docs ${DRY_RUN ? 'would be ' : ''}updated`);

  // 3f. savedschedules — deep patch of snapshot arrays
  let savedScheduleUpdates = 0;
  const savedSchedules = await db.collection('savedschedules').find().toArray();
  for (const ss of savedSchedules) {
    let changed = false;

    // Patch coaches[]._id
    if (Array.isArray(ss.coaches)) {
      for (const coach of ss.coaches) {
        if (coach._id && idMap[coach._id]) {
          coach._id = idMap[coach._id];
          changed = true;
        }
        // Also handle string _id stored as coach._id
        if (typeof coach._id === 'string' && idMap[coach._id]) {
          coach._id = idMap[coach._id];
          changed = true;
        }
      }
    }

    // Patch students[].assignments[].coach
    if (Array.isArray(ss.students)) {
      for (const student of ss.students) {
        if (Array.isArray(student.assignments)) {
          for (const a of student.assignments) {
            if (a.coach && idMap[a.coach]) {
              a.coach = idMap[a.coach];
              changed = true;
            }
            // Also check string form
            const coachStr = a.coach?.toString?.() || a.coach;
            if (typeof coachStr === 'string' && idMap[coachStr]) {
              a.coach = idMap[coachStr];
              changed = true;
            }
          }
        }
        // Also patch legacy student.coach field in snapshot
        if (student.coach && idMap[student.coach]) {
          student.coach = idMap[student.coach];
          changed = true;
        }
        const studentCoachStr = student.coach?.toString?.() || student.coach;
        if (typeof studentCoachStr === 'string' && idMap[studentCoachStr]) {
          student.coach = idMap[studentCoachStr];
          changed = true;
        }
      }
    }

    // Patch schedule[].coach
    if (Array.isArray(ss.schedule)) {
      for (const entry of ss.schedule) {
        if (entry.coach && idMap[entry.coach]) {
          entry.coach = idMap[entry.coach];
          changed = true;
        }
        const entryCoachStr = entry.coach?.toString?.() || entry.coach;
        if (typeof entryCoachStr === 'string' && idMap[entryCoachStr]) {
          entry.coach = idMap[entryCoachStr];
          changed = true;
        }
      }
    }

    if (changed) {
      if (!DRY_RUN) {
        await db.collection('savedschedules').updateOne(
          { _id: ss._id },
          { $set: { coaches: ss.coaches, students: ss.students, schedule: ss.schedule } }
        );
      }
      savedScheduleUpdates++;
    }
  }
  console.log(`  savedschedules: ${savedScheduleUpdates} docs ${DRY_RUN ? 'would be ' : ''}updated`);
  console.log();

  // ── Phase 4: Delete old string-_id documents ──────────────────────
  console.log('── Phase 4: Delete old string-_id coach documents ──');

  for (const c of stringIdCoaches) {
    if (!DRY_RUN) {
      await db.collection('coaches').deleteOne({ _id: c._id });
      console.log(`  ✅ Deleted: "${c._id}" (${c.firstName} ${c.lastName})`);
    } else {
      console.log(`  [dry-run] Would delete: "${c._id}" (${c.firstName} ${c.lastName})`);
    }
  }
  console.log();

  // ── Phase 5: Verify ───────────────────────────────────────────────
  console.log('── Phase 5: Verification ──');

  const totalCoachesAfter = await db.collection('coaches').countDocuments();
  const stringIdsRemaining = (await db.collection('coaches').find().toArray())
    .filter(c => typeof c._id === 'string').length;

  console.log(`  Total coaches: ${allCoaches.length} before → ${totalCoachesAfter} after`);
  console.log(`  String _ids remaining: ${stringIdsRemaining}`);

  if (!DRY_RUN) {
    // Verify Mongoose findById works for all migrated coaches
    const Coach = mongoose.model('Coach', new mongoose.Schema({
      firstName: String, lastName: String
    }));

    let findByIdOk = 0;
    for (const [oldId, newId] of Object.entries(idMap)) {
      const found = await Coach.findById(newId);
      if (found) {
        findByIdOk++;
        console.log(`  ✅ findById(${newId}): ${found.firstName} ${found.lastName}`);
      } else {
        console.log(`  ❌ findById(${newId}): NOT FOUND!`);
      }
    }

    // Verify student assignments resolve
    const studentsWithMigratedCoaches = await db.collection('students').find({
      'assignments.coach': { $in: Object.values(idMap) }
    }).toArray();
    console.log(`  Students referencing new coach IDs: ${studentsWithMigratedCoaches.length}`);

    if (totalCoachesAfter !== allCoaches.length) {
      console.log('\n  ⚠️  WARNING: Coach count changed! Check manually.');
    }
    if (stringIdsRemaining > 0) {
      console.log('\n  ⚠️  WARNING: String _ids still remain! Check manually.');
    }
    if (findByIdOk === Object.keys(idMap).length && totalCoachesAfter === allCoaches.length && stringIdsRemaining === 0) {
      console.log('\n  ✅ Migration completed successfully!');
    }
  } else {
    console.log('\n  🔍 Dry run complete. Run with --live to execute.');
  }

  console.log();
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
