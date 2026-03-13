/**
 * seed-e2e-test-data.js
 *
 * Seeds MongoDB with deterministic E2E test data.
 * Run from backend/: node src/scripts/seed-e2e-test-data.js
 * Or from project root via wrapper: node scripts/seed-test-data.js
 *
 * Idempotent — drops and recreates all @mondo.local records on each run.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env relative to backend/
const envPath = path.resolve(__dirname, '../../.env.development');
dotenv.config({ path: envPath });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI not found. Expected backend/.env.development to be loaded.');
  process.exit(1);
}

// ─── Inline model definitions ─────────────────────────────────────────────────
// Defined here (not imported from models/) so this script is self-contained
// and does not pull in all model files and their cross-dependencies.

const userSchema = new mongoose.Schema({
  email:                  { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:               { type: String, required: true, minlength: 8 },
  firstName:              { type: String, required: true, trim: true },
  lastName:               { type: String, required: true, trim: true },
  role:                   { type: String, enum: ['admin', 'supermod', 'coach', 'trainer', 'student'], default: 'student' },
  studentId:              { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
  coachId:                { type: mongoose.Schema.Types.ObjectId, ref: 'Coach', default: null },
  isActive:               { type: Boolean, default: true },
  lastLogin:              { type: Date },
  lastActivity:           { type: Date, default: Date.now },
  createdAt:              { type: Date, default: Date.now },
  resetPasswordToken:     { type: String, default: null },
  resetPasswordExpires:   { type: Date, default: null },
  emailVerificationToken: { type: String, default: null },
  isEmailVerified:        { type: Boolean, default: false },
});

// Hash password on save (mirrors real User model behaviour)
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

const coachSchema = new mongoose.Schema({
  firstName:              { type: String, required: true, trim: true },
  lastName:               { type: String, required: true, trim: true },
  email:                  { type: String, lowercase: true, trim: true, sparse: true },
  availableTimes:         [{ day: String, hour: Number }],
  isCoachingAdult:        Boolean,
  isCoachingChildren:     Boolean,
  CoachingAdultLevels:    [],
  CoachingChildrenLevels: [],
});

const studentSchema = new mongoose.Schema({
  firstName:    { type: String, required: true, trim: true },
  lastName:     { type: String, required: true, trim: true },
  email:        { type: String, lowercase: true, trim: true, sparse: true },
  comment:      { type: String, default: null },
  adult:        { type: Boolean, default: false },
  frequence:    { type: String, enum: ['1', '2', '3', null], default: null },
  sex:          { type: String, enum: ['männlich', 'weiblich', null], default: null },
  skillLevel: {
    type: String,
    enum: [
      'Anfänger', 'wenig Fortgeschritten', 'Fortgeschritten',
      'gute:r Spieler:in', 'Leistungsspieler:in',
      'Anfänger mit Grundkenntnissen', 'Fortgeschrittene',
      'Erfahrene Spieler:innen / Mannschaftsspieler:innen',
      'Leistungsspieler:innen / Turnierspieler:innen', null,
    ],
    default: null,
  },
  trainigGroup: {
    type: String,
    enum: ['Kinderland', 'Rot', 'Grün', 'Orange', 'Gelb Team', 'Gelb Hobby', null],
    default: null,
  },
  team:            { type: Boolean, default: false },
  availableTimes:  [{
    day:   { type: String },
    hour:  { type: mongoose.Schema.Types.Mixed },
    venue: { type: String, default: '' },
  }],
  priorityTime: {
    day:   { type: String },
    hour:  { type: mongoose.Schema.Types.Mixed },
    venue: { type: String, default: '' },
  },
  assignments: [{
    day:   { type: String, required: true },
    hour:  { type: Number, required: true, min: 10, max: 21 },
    coach: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  }],
  // Legacy single-assignment fields (kept for backward compat, set on pre-assigned students)
  day:   { type: String },
  hour:  { type: Number },
  coach: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
});

const scheduleSchema = new mongoose.Schema({}, { strict: false });

// Register — guard against re-registration
const User     = mongoose.models.User     || mongoose.model('User',     userSchema);
const Coach    = mongoose.models.Coach    || mongoose.model('Coach',    coachSchema);
const Student  = mongoose.models.Student  || mongoose.model('Student',  studentSchema);
const Schedule = mongoose.models.Schedule || mongoose.model('Schedule', scheduleSchema);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build availableTimes object array for Student */
function studentTimes(slots) {
  return slots.map(([day, hour]) => ({ day, hour, venue: 'Platz 1' }));
}

/** Build availableTimes object array for Coach (no venue) */
function coachTimes(slots) {
  return slots.map(([day, hour]) => ({ day, hour }));
}

const DAY = {
  Mo: 'Montag',
  Di: 'Dienstag',
  Mi: 'Mittwoch',
  Do: 'Donnerstag',
  Fr: 'Freitag',
};

// skillLevel mapping (spec shorthand → Mongoose enum)
const SKILL = {
  advanced:     'Leistungsspieler:in',
  intermediate: 'Fortgeschritten',
  beginner:     'Anfänger',
};

// sex mapping (spec shorthand → Mongoose enum)
const SEX = {
  m: 'männlich',
  w: 'weiblich',
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');

  // ── Teardown ALL test data for clean E2E state ─────────────────────────────
  console.log('\nRemoving ALL existing test data for clean E2E state…');
  const removedUsers    = await User.deleteMany({ email: /@mondo\.local$/ });
  const removedCoaches  = await Coach.deleteMany({});   // clear ALL coaches
  const removedStudents = await Student.deleteMany({});  // clear ALL students
  const removedSchedule = await Schedule.deleteMany({}); // clear schedule state
  console.log(`  Removed ${removedUsers.deletedCount} User(s), ${removedCoaches.deletedCount} Coach(es), ${removedStudents.deletedCount} Student(s), ${removedSchedule.deletedCount} Schedule entries`);

  // ── Admin user ────────────────────────────────────────────────────────────
  console.log('\nCreating admin user…');
  const adminUser = await User.create({
    email:           'test-admin@mondo.local',
    password:        'TestAdmin2027',   // hashed by pre-save hook (10 rounds, bcryptjs)
    firstName:       'Test',
    lastName:        'Admin',
    role:            'admin',
    isActive:        true,
    isEmailVerified: true,
  });
  console.log(`  Created admin: ${adminUser.email} (id: ${adminUser._id})`);

  // ── Coach 1 — Klaus Trainer ───────────────────────────────────────────────
  console.log('\nCreating Coach 1 (Klaus Trainer)…');

  // Coach record in Coach collection (used by schedule algorithm)
  const coach1Record = await Coach.create({
    firstName:          'Klaus',
    lastName:           'Trainer',
    email:              'trainer1@mondo.local',
    availableTimes:     coachTimes([
      [DAY.Mo, 14], [DAY.Mo, 15], [DAY.Mo, 16], [DAY.Mo, 17],
      [DAY.Di, 14], [DAY.Di, 15], [DAY.Di, 16], [DAY.Di, 17],
      [DAY.Mi, 14], [DAY.Mi, 15], [DAY.Mi, 16], [DAY.Mi, 17],
      [DAY.Do, 14], [DAY.Do, 15], [DAY.Do, 16], [DAY.Do, 17],
    ]),
    isCoachingAdult:    true,
    isCoachingChildren: true,
  });

  // User record (for portal auth — coaches use role: 'trainer' per CLAUDE.md gotcha #12)
  const coach1User = await User.create({
    email:           'trainer1@mondo.local',
    password:        'Trainer2027!',
    firstName:       'Klaus',
    lastName:        'Trainer',
    role:            'trainer',
    coachId:         coach1Record._id,
    isActive:        true,
    isEmailVerified: true,
  });
  console.log(`  Created Coach 1: ${coach1User.email} (userId: ${coach1User._id}, coachId: ${coach1Record._id})`);

  // ── Coach 2 — Eva Coach ───────────────────────────────────────────────────
  console.log('\nCreating Coach 2 (Eva Coach)…');

  const coach2Record = await Coach.create({
    firstName:          'Eva',
    lastName:           'Coach',
    email:              'trainer2@mondo.local',
    availableTimes:     coachTimes([
      [DAY.Do, 14], [DAY.Do, 15], [DAY.Do, 16], [DAY.Do, 17],
      [DAY.Fr, 14], [DAY.Fr, 15], [DAY.Fr, 16], [DAY.Fr, 17],
    ]),
    isCoachingAdult:    true,
    isCoachingChildren: false,
  });

  const coach2User = await User.create({
    email:           'trainer2@mondo.local',
    password:        'Trainer2027!',
    firstName:       'Eva',
    lastName:        'Coach',
    role:            'trainer',
    coachId:         coach2Record._id,
    isActive:        true,
    isEmailVerified: true,
  });
  console.log(`  Created Coach 2: ${coach2User.email} (userId: ${coach2User._id}, coachId: ${coach2Record._id})`);

  // Schedule algorithm stores Coach collection _id (not User _id) in assignments
  const coach1Id = coach1Record._id;

  // ── Students ──────────────────────────────────────────────────────────────
  console.log('\nCreating students…');

  // All test students carry comment: '__e2e_seed__' so teardown can find them
  // even though Student has no email field.
  const SEED_TAG = { comment: '__e2e_seed__' };

  const studentsSpec = [
    // ── Adults ──
    {
      ...SEED_TAG,
      firstName: 'Max',   lastName: 'Mustermann', adult: true,
      skillLevel: SKILL.advanced,     sex: SEX.m, frequence: '1',
      availableTimes: studentTimes([[DAY.Mo, 15], [DAY.Di, 15], [DAY.Mi, 16]]),
      // Pre-assigned to coach1, Montag 15
      assignments: [{ day: DAY.Mo, hour: 15, coach: coach1Id }],
      day: DAY.Mo, hour: 15, coach: coach1Id,   // legacy fields
    },
    {
      ...SEED_TAG,
      firstName: 'Anna',  lastName: 'Beispiel', adult: true,
      skillLevel: SKILL.intermediate, sex: SEX.w, frequence: '1',
      availableTimes: studentTimes([[DAY.Mo, 15], [DAY.Mo, 16], [DAY.Di, 15], [DAY.Do, 15]]),
      // Pre-assigned to coach1, Montag 15
      assignments: [{ day: DAY.Mo, hour: 15, coach: coach1Id }],
      day: DAY.Mo, hour: 15, coach: coach1Id,   // legacy fields
    },
    {
      ...SEED_TAG,
      firstName: 'Peter', lastName: 'Schmidt', adult: true,
      skillLevel: SKILL.beginner,     sex: SEX.m, frequence: '1',
      availableTimes: studentTimes([[DAY.Di, 16], [DAY.Mi, 16], [DAY.Do, 16]]),
      assignments: [],
    },
    {
      ...SEED_TAG,
      firstName: 'Maria', lastName: 'Weber', adult: true,
      skillLevel: SKILL.intermediate, sex: SEX.w, frequence: '2',
      availableTimes: studentTimes([[DAY.Mo, 15], [DAY.Di, 15], [DAY.Mi, 15], [DAY.Do, 15]]),
      assignments: [],
    },
    {
      ...SEED_TAG,
      firstName: 'Hans',  lastName: 'Koch', adult: true,
      skillLevel: SKILL.advanced,     sex: SEX.m, frequence: '1',
      availableTimes: studentTimes([[DAY.Mo, 16], [DAY.Di, 16]]),
      assignments: [],
    },
    {
      ...SEED_TAG,
      firstName: 'Lisa',  lastName: 'Braun', adult: true,
      skillLevel: SKILL.beginner,     sex: SEX.w, frequence: '1',
      availableTimes: studentTimes([[DAY.Mi, 14], [DAY.Do, 14], [DAY.Fr, 14]]),
      assignments: [],
    },
    // ── Kids ──
    {
      ...SEED_TAG,
      firstName: 'Tim',  lastName: 'Kind',   adult: false,
      trainigGroup: 'Rot',    sex: SEX.m, frequence: '1',
      availableTimes: studentTimes([[DAY.Mo, 14], [DAY.Di, 14], [DAY.Mi, 14]]),
      assignments: [],
    },
    {
      ...SEED_TAG,
      firstName: 'Sara', lastName: 'Grün',   adult: false,
      trainigGroup: 'Grün',   sex: SEX.w, frequence: '1',
      availableTimes: studentTimes([[DAY.Mo, 14], [DAY.Di, 14], [DAY.Do, 14]]),
      assignments: [],
    },
    {
      ...SEED_TAG,
      firstName: 'Lena', lastName: 'Orange', adult: false,
      trainigGroup: 'Orange', sex: SEX.w, frequence: '2',
      availableTimes: studentTimes([[DAY.Mo, 14], [DAY.Mo, 15], [DAY.Di, 14], [DAY.Mi, 14]]),
      assignments: [],
    },
    {
      ...SEED_TAG,
      firstName: 'Ben',  lastName: 'Rot',    adult: false,
      trainigGroup: 'Rot',    sex: SEX.m, frequence: '1',
      availableTimes: studentTimes([[DAY.Di, 14], [DAY.Mi, 14], [DAY.Fr, 14]]),
      assignments: [],
    },
  ];

  const createdStudents = [];
  for (const spec of studentsSpec) {
    const student = await Student.create(spec);
    createdStudents.push(student);
    const tag = student.adult
      ? `adult / ${student.skillLevel}`
      : `kid   / ${student.trainigGroup}`;
    console.log(`  [${tag.padEnd(30)}] ${student.firstName} ${student.lastName} (id: ${student._id})`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n── Seed complete ───────────────────────────────────────────────────');
  console.log(`  Admin:    test-admin@mondo.local  / TestAdmin2027`);
  console.log(`  Coach 1:  trainer1@mondo.local    / Trainer2027!  (userId: ${coach1User._id})`);
  console.log(`  Coach 2:  trainer2@mondo.local    / Trainer2027!  (userId: ${coach2User._id})`);
  console.log(`  Students: ${createdStudents.length} created (2 pre-assigned, 8 unassigned)`);
  console.log(`  Pre-assigned:`);
  console.log(`    Max Mustermann  → Coach 1, Montag 15:00`);
  console.log(`    Anna Beispiel   → Coach 1, Montag 15:00`);
  console.log('─────────────────────────────────────────────────────────────────────\n');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
