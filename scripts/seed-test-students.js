#!/usr/bin/env node
/**
 * Seed Test Students for Seasonal Training Load Testing
 *
 * Creates realistic StudentPortalUser + SeasonalRegistration records
 * to test the system with hundreds of students.
 *
 * Usage:
 *   node scripts/seed-test-students.js [options]
 *
 * Options:
 *   --count=N      Total students to create (default: 50)
 *   --kids=N       Number of kids (overrides auto-split)
 *   --adults=N     Number of adults (overrides auto-split)
 *   --period=ID    Registration period ID (default: active/open period)
 *   --process      Also process registrations → create Student records
 *   --cleanup      Delete all previously seeded test data
 *   --dry-run      Show what would be created, no DB writes
 *
 * Examples:
 *   node scripts/seed-test-students.js --count=200
 *   node scripts/seed-test-students.js --count=100 --process
 *   node scripts/seed-test-students.js --kids=60 --adults=40
 *   node scripts/seed-test-students.js --cleanup
 *
 * All test data uses emails ending in @mondo-tennis.test
 * Use --cleanup to remove all seeded data.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.development') });

// ─── Models ──────────────────────────────────────────────────────────────────

import StudentPortalUser from '../src/models/StudentPortalUser.js';
import SeasonalRegistration from '../src/models/SeasonalRegistration.js';
import RegistrationPeriod from '../src/models/RegistrationPeriod.js';
import Student from '../src/models/Student.js';

// ─── German Test Data ─────────────────────────────────────────────────────────

const FIRST_NAMES_M = [
  'Alexander', 'Benjamin', 'Christian', 'Daniel', 'Emil',
  'Felix', 'Georg', 'Hans', 'Ivan', 'Jonas',
  'Klaus', 'Leon', 'Markus', 'Nico', 'Oliver',
  'Patrick', 'Quentin', 'Ralf', 'Stefan', 'Thomas',
  'Ulrich', 'Viktor', 'Werner', 'Xavier', 'Yannik',
  'Tim', 'Jan', 'Lukas', 'Max', 'Paul',
  'Simon', 'Tobias', 'Fabian', 'Kai', 'Lars',
  'Moritz', 'Niklas', 'Philipp', 'Sebastian', 'Florian',
];

const FIRST_NAMES_F = [
  'Anna', 'Barbara', 'Christina', 'Daniela', 'Elisabeth',
  'Franziska', 'Gabriele', 'Hannah', 'Ingrid', 'Julia',
  'Katrin', 'Laura', 'Maria', 'Nina', 'Olivia',
  'Petra', 'Rebecca', 'Sandra', 'Tanja', 'Ursula',
  'Vanessa', 'Waltraud', 'Xenia', 'Yvonne', 'Zoe',
  'Lena', 'Lisa', 'Sophie', 'Emma', 'Lea',
  'Sarah', 'Katharina', 'Sabine', 'Stefanie', 'Monika',
  'Mia', 'Clara', 'Emilia', 'Marie', 'Leonie',
];

const FIRST_NAMES_KIDS_M = [
  'Luca', 'Ben', 'Paul', 'Jonas', 'Felix',
  'Leon', 'Finn', 'Elias', 'Noah', 'Lukas',
  'Tim', 'Jan', 'Tom', 'Max', 'Nico',
  'Nils', 'David', 'Julian', 'Moritz', 'Erik',
  'Hannes', 'Tobias', 'Kevin', 'Patrick', 'Sven',
];

const FIRST_NAMES_KIDS_F = [
  'Emma', 'Mia', 'Hannah', 'Lena', 'Anna',
  'Lea', 'Sophie', 'Laura', 'Sarah', 'Lisa',
  'Leonie', 'Clara', 'Emilia', 'Marie', 'Julia',
  'Katharina', 'Lara', 'Nina', 'Luisa', 'Amelie',
  'Charlotte', 'Viktoria', 'Johanna', 'Ida', 'Maja',
];

const LAST_NAMES = [
  'Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber',
  'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann',
  'Schäfer', 'Koch', 'Bauer', 'Richter', 'Klein',
  'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann',
  'Braun', 'Krüger', 'Hofmann', 'Hartmann', 'Lange',
  'Schmitt', 'Werner', 'Krause', 'Lehmann', 'Köhler',
  'Herrmann', 'Walter', 'Mayer', 'Huber', 'Kaiser',
  'Fuchs', 'Peters', 'Lang', 'Scholz', 'Möller',
  'Weiß', 'Jung', 'Hahn', 'Schubert', 'Vogel',
  'Friedrich', 'Frank', 'Berger', 'Winkler', 'Roth',
];

// ─── Training Data Options ────────────────────────────────────────────────────

const KIDS_DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const KIDS_HOURS = [14, 15, 16, 17, 18, 19];
const KIDS_VENUES = ['BTHV', 'Brüser Berg', 'Röttgen'];

const ADULTS_DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const ADULTS_HOURS = ['10:00', '11:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
const ADULTS_VENUES = ['BTHV (Teppich)', 'BTHV (Traglufthalle)', 'BB', 'Röttgen'];

const TRAININGSART_BY_AGE = {
  '4-6':  'Kindergarten (ca. 4-6 Jahre)',
  '6-8':  'KIDS-ROT (ca. 6-8 Jahre)',
  '8-10': 'KIDS-ORANGE (ca. 8-10 Jahre)',
  '10-12':'KIDS-GRÜN (ca. 10-12 Jahre)',
  '12+':  'Jugend HOBBY (Gelb)',
};

const SPIELSTAERKE_OPTIONS = [
  'Anfänger',
  'Anfänger mit Grundkenntnissen',
  'Fortgeschrittene',
  'Erfahrene Spieler:innen / Mannschaftsspieler:innen',
  'Leistungsspieler:innen / Turnierspieler:innen',
];

const TRAINING_GOALS_OPTIONS = ['Freizeit', 'Fitness', 'Turniere', 'Mannschaft'];
const GROUP_SIZE_OPTIONS = ['Einzeltraining', 'zu zweit', 'zu dritt', 'zu viert', 'Mannschaftstraining'];

const TEST_EMAIL_DOMAIN = 'mondo-tennis.test';
const TEST_PASSWORD = 'TestPasswort123!';
const TEST_SEED_TAG = '[TEST_SEED]';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function birthDateForAge(minAge, maxAge) {
  const now = new Date();
  const year = now.getFullYear() - randInt(minAge, maxAge);
  const month = randInt(1, 12);
  const day = randInt(1, 28);
  return new Date(year, month - 1, day);
}

function trainingsartForAge(ageYears) {
  if (ageYears <= 6) return TRAININGSART_BY_AGE['4-6'];
  if (ageYears <= 8) return TRAININGSART_BY_AGE['6-8'];
  if (ageYears <= 10) return TRAININGSART_BY_AGE['8-10'];
  if (ageYears <= 12) return TRAININGSART_BY_AGE['10-12'];
  return TRAININGSART_BY_AGE['12+'];
}

function generateAvailableTimesKids(count = 7) {
  const allSlots = [];
  for (const day of KIDS_DAYS) {
    for (const hour of KIDS_HOURS) {
      allSlots.push({ day, hour, venue: rand(KIDS_VENUES) });
    }
  }
  return pick(allSlots, Math.max(5, count));
}

function generateAvailableTimesAdults(count = 7) {
  const allSlots = [];
  for (const day of ADULTS_DAYS) {
    for (const hour of ADULTS_HOURS) {
      allSlots.push({ day, hour, venue: rand(ADULTS_VENUES) });
    }
  }
  return pick(allSlots, Math.max(5, count));
}

// Unique index: email + periodId → make email unique per batch
function makeEmail(firstName, lastName, index) {
  const slug = `${firstName}.${lastName}`.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9.]/g, '');
  return `${slug}.${index}@${TEST_EMAIL_DOMAIN}`;
}

// ─── Generator Functions ──────────────────────────────────────────────────────

function generateKid(index) {
  const sex = Math.random() > 0.5 ? 'männlich' : 'weiblich';
  const firstName = sex === 'männlich' ? rand(FIRST_NAMES_KIDS_M) : rand(FIRST_NAMES_KIDS_F);
  const lastName = rand(LAST_NAMES);
  const birthdate = birthDateForAge(6, 16);
  const ageYears = new Date().getFullYear() - birthdate.getFullYear();
  const email = makeEmail(firstName, lastName, index);
  const availableTimesCount = randInt(5, 10);

  return {
    portalUser: {
      email,
      password: TEST_PASSWORD, // will be hashed by pre-save hook
      emailVerified: true,
      firstName,
      lastName,
      birthdate,
      sex,
      member: Math.random() > 0.7,
      phone: `015${randInt(100000000, 999999999)}`,
      address: `Musterstraße ${randInt(1, 99)}, 53${randInt(100, 999)} Bonn`,
      profileCompleted: true,
    },
    registration: {
      formType: 'kids',
      firstName,
      lastName,
      birthdate,
      email,
      mitgliedsstatus: Math.random() > 0.5 ? 'Mitglied' : 'Nicht-Mitglied/Schnupperkind',
      trainingsart: trainingsartForAge(ageYears),
      trainingshäufigkeit: Math.random() > 0.4 ? '2x pro Woche' : '1x pro Woche',
      teamParticipation: Math.random() > 0.8 ? 'TC GW Am Kreuzberg U12' : '-',
      availableTimesKids: generateAvailableTimesKids(availableTimesCount),
      sepaMandate: Math.random() > 0.2,
      accountHolder: `${firstName} ${lastName}`,
      privacyConsent: true,
      remarks: `${TEST_SEED_TAG} Automatisch generierter Testdatensatz #${index}`,
    },
  };
}

function generateAdult(index) {
  const sex = Math.random() > 0.5 ? 'männlich' : 'weiblich';
  const firstName = sex === 'männlich' ? rand(FIRST_NAMES_M) : rand(FIRST_NAMES_F);
  const lastName = rand(LAST_NAMES);
  const birthdate = birthDateForAge(18, 65);
  const email = makeEmail(firstName, lastName, index);
  const goalCount = randInt(1, 3);
  const availableTimesCount = randInt(5, 10);

  return {
    portalUser: {
      email,
      password: TEST_PASSWORD,
      emailVerified: true,
      firstName,
      lastName,
      birthdate,
      sex,
      member: Math.random() > 0.6,
      phone: `017${randInt(100000000, 999999999)}`,
      address: `Testweg ${randInt(1, 50)}, 53${randInt(100, 999)} Bonn`,
      profileCompleted: true,
    },
    registration: {
      formType: 'adults',
      firstName,
      lastName,
      birthdate,
      email,
      spielstärke: rand(SPIELSTAERKE_OPTIONS),
      trainingGoals: pick(TRAINING_GOALS_OPTIONS, goalCount),
      groupSize: [rand(GROUP_SIZE_OPTIONS)],
      availableTimesAdults: generateAvailableTimesAdults(availableTimesCount),
      sepaMandate: Math.random() > 0.4,
      accountHolder: `${firstName} ${lastName}`,
      privacyConsent: true,
      remarks: `${TEST_SEED_TAG} Automatisch generierter Testdatensatz #${index}`,
    },
  };
}

// ─── Process Registration → Student ──────────────────────────────────────────

async function processRegistration(reg, portalUser) {
  const isKids = reg.formType === 'kids';
  const availableTimes = isKids
    ? (reg.availableTimesKids || []).map(t => ({ day: t.day, hour: t.hour, venue: t.venue }))
    : (reg.availableTimesAdults || []).map(t => ({ day: t.day, hour: t.hour, venue: t.venue }));

  let student = await Student.findOne({ email: reg.email });

  if (!student) {
    student = new Student({
      firstName: reg.firstName,
      lastName: reg.lastName,
      email: reg.email,
      birthDate: reg.birthdate ? reg.birthdate.toISOString().split('T')[0] : null,
      sex: reg.sex || portalUser.sex,
      member: portalUser.member || false,
      adult: !isKids,
      phone: reg.phone || portalUser.phone,
      adress: reg.address || portalUser.address,
      availableTimes,
      assignments: [],
      ...(isKids ? {
        trainigGroup: mapTrainigGroup(reg.trainingsart),
        frequence: reg.trainingshäufigkeit === '2x pro Woche' ? '2' : '1',
        team: (reg.teamParticipation || '-') !== '-',
      } : {
        skillLevel: mapSkillLevel(reg.spielstärke),
        comment2: (reg.trainingGoals || []).join(', '),
      }),
    });
  } else {
    student.availableTimes = availableTimes;
  }

  await student.save();

  // Link: SeasonalRegistration → Student
  reg.studentId = student._id;
  reg.status = 'processed';
  reg.processedAt = new Date();
  await reg.save();

  // Link: StudentPortalUser → Student
  if (!portalUser.studentId) {
    portalUser.studentId = student._id;
    await portalUser.save();
  }

  return student;
}

function mapTrainigGroup(trainingsart) {
  if (!trainingsart) return null;
  if (trainingsart.includes('Kindergarten')) return 'Kinderland';
  if (trainingsart.includes('ROT')) return 'Rot';
  if (trainingsart.includes('ORANGE')) return 'Orange';
  if (trainingsart.includes('GRÜN')) return 'Grün';
  if (trainingsart.includes('TEAM')) return 'Gelb Team';
  if (trainingsart.includes('HOBBY')) return 'Gelb Hobby';
  return null;
}

function mapSkillLevel(spielstärke) {
  if (!spielstärke) return null;
  if (spielstärke === 'Anfänger') return 'Anfänger';
  if (spielstärke.includes('Grundkenntnissen')) return 'wenig Fortgeschritten';
  if (spielstärke === 'Fortgeschrittene') return 'Fortgeschritten';
  if (spielstärke.includes('Erfahrene')) return 'gute:r Spieler:in';
  if (spielstärke.includes('Leistung')) return 'Leistungsspieler:in';
  return null;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log('\n🧹 Cleaning up all seeded test data...\n');

  const testUsers = await StudentPortalUser.find({
    email: { $regex: `@${TEST_EMAIL_DOMAIN}$` }
  }).lean();

  if (testUsers.length === 0) {
    console.log('  No test users found. Nothing to delete.');
    return;
  }

  const userIds = testUsers.map(u => u._id);
  const studentIds = testUsers.map(u => u.studentId).filter(Boolean);

  // Delete registrations
  const regResult = await SeasonalRegistration.deleteMany({
    studentPortalUserId: { $in: userIds }
  });

  // Delete linked Student records
  let studentResult = { deletedCount: 0 };
  if (studentIds.length > 0) {
    studentResult = await Student.deleteMany({ _id: { $in: studentIds } });
    // Also catch students matched by email (via --process)
    const emailResult = await Student.deleteMany({
      email: { $regex: `@${TEST_EMAIL_DOMAIN}$` }
    });
    studentResult.deletedCount += emailResult.deletedCount;
  }

  // Delete portal users
  const userResult = await StudentPortalUser.deleteMany({
    email: { $regex: `@${TEST_EMAIL_DOMAIN}$` }
  });

  console.log(`  ✅ Deleted ${userResult.deletedCount} portal users`);
  console.log(`  ✅ Deleted ${regResult.deletedCount} seasonal registrations`);
  console.log(`  ✅ Deleted ${studentResult.deletedCount} student records`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Parse CLI args
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter(a => a.startsWith('--'))
      .map(a => {
        const [k, v] = a.slice(2).split('=');
        return [k, v === undefined ? true : v];
      })
  );

  const isDryRun = !!args['dry-run'];
  const doCleanup = !!args.cleanup;
  const doProcess = !!args.process;
  const periodId = args.period || null;

  let totalCount = parseInt(args.count || '50', 10);
  let kidsCount = args.kids ? parseInt(args.kids, 10) : null;
  let adultsCount = args.adults ? parseInt(args.adults, 10) : null;

  if (kidsCount !== null && adultsCount !== null) {
    totalCount = kidsCount + adultsCount;
  } else if (kidsCount !== null) {
    adultsCount = totalCount - kidsCount;
  } else if (adultsCount !== null) {
    kidsCount = totalCount - adultsCount;
  } else {
    kidsCount = Math.round(totalCount * 0.6);
    adultsCount = totalCount - kidsCount;
  }

  // Connect
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');
  console.log('✅ Connected to MongoDB\n');

  if (doCleanup) {
    await cleanup();
    await mongoose.disconnect();
    return;
  }

  // Find registration period
  let period;
  if (periodId) {
    period = await RegistrationPeriod.findById(periodId);
    if (!period) {
      console.error(`❌ Period not found: ${periodId}`);
      process.exit(1);
    }
  } else {
    period = await RegistrationPeriod.findOne({ isActive: true });
    if (!period) {
      // Fall back to any open period
      period = await RegistrationPeriod.findOne({ status: 'open' });
    }
    if (!period) {
      // Fall back to most recent draft/closed period
      period = await RegistrationPeriod.findOne().sort({ createdAt: -1 });
    }
  }

  if (!period) {
    console.error('❌ No registration period found. Create one first in the admin portal.');
    process.exit(1);
  }

  console.log(`📅 Using period: "${period.name}" (${period.status}, ID: ${period._id})`);
  console.log(`\n📊 Plan:`);
  console.log(`   Total: ${totalCount} students`);
  console.log(`   Kids:  ${kidsCount}`);
  console.log(`   Adults:${adultsCount}`);
  console.log(`   Process to Student records: ${doProcess ? 'YES' : 'NO'}`);
  if (isDryRun) console.log('\n⚠️  DRY RUN — nothing will be written\n');
  console.log('');

  if (isDryRun) {
    console.log('Sample kid registration:');
    const kid = generateKid(1);
    console.log('  Portal user:', JSON.stringify({ ...kid.portalUser, password: '[hashed]' }, null, 2));
    console.log('  Registration:', JSON.stringify(kid.registration, null, 2));
    console.log('\nSample adult registration:');
    const adult = generateAdult(kidsCount + 1);
    console.log('  Portal user:', JSON.stringify({ ...adult.portalUser, password: '[hashed]' }, null, 2));
    console.log('  Registration:', JSON.stringify(adult.registration, null, 2));
    await mongoose.disconnect();
    return;
  }

  // Pre-hash password once (bcrypt is slow; reuse hash for all test users)
  console.log('🔐 Pre-hashing test password...');
  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
  console.log('   Done.\n');

  let created = 0;
  let skipped = 0;
  let studentRecords = 0;
  const errors = [];

  // Create kids
  for (let i = 0; i < kidsCount; i++) {
    const { portalUser: puData, registration: regData } = generateKid(i + 1);

    try {
      // Check for existing test user (idempotent re-run)
      const exists = await StudentPortalUser.exists({ email: puData.email });
      if (exists) { skipped++; continue; }

      // Create portal user (bypass bcrypt hook — inject pre-hashed password)
      const pu = await StudentPortalUser.create({
        ...puData,
        password: hashedPassword,
      });

      // Create registration
      const reg = await SeasonalRegistration.create({
        ...regData,
        periodId: period._id,
        studentPortalUserId: pu._id,
        sex: puData.sex,
      });

      if (doProcess) {
        await processRegistration(reg, pu);
        studentRecords++;
      }

      created++;
      if (created % 10 === 0) process.stdout.write(`   ${created}/${totalCount} created...\r`);

    } catch (err) {
      errors.push(`Kid #${i + 1}: ${err.message}`);
    }
  }

  // Create adults
  for (let i = 0; i < adultsCount; i++) {
    const { portalUser: puData, registration: regData } = generateAdult(kidsCount + i + 1);

    try {
      const exists = await StudentPortalUser.exists({ email: puData.email });
      if (exists) { skipped++; continue; }

      const pu = await StudentPortalUser.create({
        ...puData,
        password: hashedPassword,
      });

      const reg = await SeasonalRegistration.create({
        ...regData,
        periodId: period._id,
        studentPortalUserId: pu._id,
        sex: puData.sex,
      });

      if (doProcess) {
        await processRegistration(reg, pu);
        studentRecords++;
      }

      created++;
      if (created % 10 === 0) process.stdout.write(`   ${created}/${totalCount} created...\r`);

    } catch (err) {
      errors.push(`Adult #${i + 1}: ${err.message}`);
    }
  }

  console.log('\n');
  console.log('─'.repeat(50));
  console.log(`✅ Created:  ${created} students`);
  if (skipped > 0) console.log(`⏩ Skipped:  ${skipped} (already existed)`);
  if (doProcess) console.log(`📋 Student records processed: ${studentRecords}`);
  if (errors.length > 0) {
    console.log(`❌ Errors:   ${errors.length}`);
    errors.slice(0, 10).forEach(e => console.log(`   ${e}`));
    if (errors.length > 10) console.log(`   ... and ${errors.length - 10} more`);
  }
  console.log('─'.repeat(50));
  console.log(`\n💡 Test password for all accounts: ${TEST_PASSWORD}`);
  console.log(`💡 Run with --cleanup to remove all test data\n`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
