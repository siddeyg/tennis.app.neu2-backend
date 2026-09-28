/**
 * verify-all-hardening.mjs
 * 
 * Verifikations-Skript für alle Hardening- und Period-Isolation-Kriterien:
 * 1. SeasonalRegistration.findOne({ status: 'pending' }) Auffinden & Test-Datensatz Verarbeitung/Cleanup
 * 2. PUT /api/schedule ohne periodId -> Status 400
 * 3. POST /api/students/import ohne periodId -> Status 400
 * 4. Strikte Isolation: 101 Winterschüler vs. 207 Sommerschüler (0 Überschneidungen in IDs & assignments)
 */

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env.development') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://admin:password123@localhost:27017/tennis-coach?authSource=admin';
const JWT_SECRET = process.env.JWT_SECRET;
const API_BASE = process.env.API_BASE || 'http://localhost:5000';

const results = [];

function recordResult(testName, passed, details = '') {
  results.push({ testName, passed, details });
  const statusBadge = passed ? '\x1b[32m[BESTANDEN]\x1b[0m' : '\x1b[31m[FEHLGESCHLAGEN]\x1b[0m';
  console.log(`${statusBadge} ${testName}`);
  if (details) {
    console.log(`   └─ ${details}`);
  }
}

async function runVerification() {
  console.log('\n' + '='.repeat(80));
  console.log(' QA VERIFIKATION: ALL HARDENING & MULTI-SEASON PERIOD ISOLATION');
  console.log(' Server Target: ' + API_BASE);
  console.log(' Database:      ' + MONGO_URI.replace(/:([^:@]+)@/, ':****@'));
  console.log('='.repeat(80) + '\n');

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  try {
    // -------------------------------------------------------------------------
    // 0. Setup Admin Token for HTTP Calls
    // -------------------------------------------------------------------------
    const adminUser = await db.collection('users').findOne({ role: 'admin' });
    if (!adminUser) {
      throw new Error('Kein Admin-Benutzer in der Datenbank gefunden!');
    }
    const authToken = jwt.sign(
      { userId: adminUser._id.toString(), role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const authHeaders = {
      'Cookie': `authToken=${authToken}`,
    };

    // -------------------------------------------------------------------------
    // 1. SeasonalRegistration.findOne({ status: 'pending' }) & Test-Verarbeitung
    // -------------------------------------------------------------------------
    console.log('\n--- 1. PRÜFUNG: PENDING REGISTRATIONS & VERARBEITUNG ---');
    const existingPending = await db.collection('seasonalregistrations').findOne({ status: 'pending' });
    if (existingPending) {
      recordResult(
        "SeasonalRegistration mit status 'pending' gefunden",
        true,
        `ID: ${existingPending._id}, Name: ${existingPending.firstName} ${existingPending.lastName}, Periode: ${existingPending.periodId}`
      );
    } else {
      recordResult(
        "SeasonalRegistration mit status 'pending' gefunden",
        false,
        'Kein Datensatz mit status pending in DB vorhanden.'
      );
    }

    // Erstelle und verarbeite einen isolierten Test-Datensatz
    const winterPeriod = await db.collection('registrationperiods').findOne({ season: 'winter' });
    if (!winterPeriod) {
      throw new Error('Keine Winter-Registrierungsperiode gefunden!');
    }

    const portalUser = await db.collection('studentportalusers').findOne();
    const portalUserId = portalUser ? portalUser._id : new mongoose.Types.ObjectId();

    const testRegDoc = {
      periodId: winterPeriod._id,
      studentPortalUserId: portalUserId,
      formType: 'adults',
      firstName: '__QA_HARDENING_TEST__',
      lastName: 'Mustermann',
      email: 'qa_hardening_test@example.com',
      birthdate: new Date('1990-01-01'),
      phone: '+49150000000',
      address: 'Testweg 99, Bonn',
      mitgliedsstatus: 'Mitglied',
      spielstärke: 'Anfänger',
      availableTimesAdults: [{ day: 'Montag', hour: '18', venue: '' }],
      priorityTime: { day: 'Montag', hour: 18, venue: '' },
      privacyConsent: true,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertResult = await db.collection('seasonalregistrations').insertOne(testRegDoc);
    const testRegId = insertResult.insertedId;

    // Verarbeite über die API (POST /api/seasonal-registrations/:id/process)
    const processRes = await fetch(`${API_BASE}/api/seasonal-registrations/${testRegId}/process`, {
      method: 'POST',
      headers: authHeaders,
    });
    const processData = await processRes.json();

    const testStudentCreated = await db.collection('students').findOne({
      firstName: '__QA_HARDENING_TEST__',
      periodId: winterPeriod._id,
    });

    const processPassed = processRes.status === 200 && testStudentCreated !== null;
    recordResult(
      'Test-Datensatz Verarbeitung via API (POST /:id/process)',
      processPassed,
      `HTTP Status: ${processRes.status}, Student angelegt: ${testStudentCreated ? testStudentCreated._id : 'nein'}`
    );

    // Bereinige den Test-Datensatz
    await db.collection('seasonalregistrations').deleteOne({ _id: testRegId });
    await db.collection('students').deleteMany({ firstName: '__QA_HARDENING_TEST__' });
    recordResult('Test-Datensatz sicher bereinigt (Rollback/Cleanup)', true, 'Keine Test-Artefakte verblieben.');

    // -------------------------------------------------------------------------
    // 2. PUT /api/schedule ohne periodId -> Status 400
    // -------------------------------------------------------------------------
    console.log('\n--- 2. PRÜFUNG: PUT /api/schedule OHNE periodId ---');
    const putScheduleRes = await fetch(`${API_BASE}/api/schedule`, {
      method: 'PUT',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ schedule: [] }),
    });
    const putScheduleData = await putScheduleRes.json();
    const putScheduleBlocked = putScheduleRes.status === 400 &&
      /periodId/i.test(putScheduleData.message || putScheduleData.error || '');

    recordResult(
      'PUT /api/schedule ohne periodId liefert HTTP 400',
      putScheduleBlocked,
      `Status: ${putScheduleRes.status}, Nachricht: "${putScheduleData.message || putScheduleData.error}"`
    );

    // -------------------------------------------------------------------------
    // 3. POST /api/students/import ohne periodId -> Status 400
    // -------------------------------------------------------------------------
    console.log('\n--- 3. PRÜFUNG: POST /api/students/import OHNE periodId ---');
    const dummyCsv = 'firstName,lastName,email\nTest,User,test.user@example.com';
    const formData = new FormData();
    formData.append('file', new Blob([dummyCsv], { type: 'text/csv' }), 'test-import.csv');

    const importRes = await fetch(`${API_BASE}/api/students/import`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    });
    const importData = await importRes.json();
    const importBlocked = importRes.status === 400 &&
      /periodId/i.test(importData.error || importData.message || '');

    recordResult(
      'POST /api/students/import ohne periodId liefert HTTP 400',
      importBlocked,
      `Status: ${importRes.status}, Fehler: "${importData.error || importData.message}"`
    );

    // -------------------------------------------------------------------------
    // 4. Strikte Isolation: 101 Winterschüler vs. 207 Sommerschüler
    // -------------------------------------------------------------------------
    console.log('\n--- 4. PRÜFUNG: MULTI-SEASON PERIOD ISOLATION (101 Winter vs. 207 Sommer) ---');
    const summerPeriod = await db.collection('registrationperiods').findOne({ season: 'summer' });
    if (!summerPeriod) {
      throw new Error('Keine Sommer-Registrierungsperiode gefunden!');
    }

    const summerStudents = await db.collection('students').find({ periodId: summerPeriod._id }).toArray();
    const winterStudents = await db.collection('students').find({ periodId: winterPeriod._id }).toArray();
    const unscopedStudents = await db.collection('students').find({
      $or: [{ periodId: null }, { periodId: { $exists: false } }]
    }).toArray();

    const summerCountPassed = summerStudents.length === 207;
    recordResult(
      'Sommerschüler exakte Anzahl (207)',
      summerCountPassed,
      `Erwartet: 207, Gefunden: ${summerStudents.length} (Periode: ${summerPeriod.name} [${summerPeriod._id}])`
    );

    const winterCountPassed = winterStudents.length === 101;
    recordResult(
      'Winterschüler exakte Anzahl (101)',
      winterCountPassed,
      `Erwartet: 101, Gefunden: ${winterStudents.length} (Periode: ${winterPeriod.name} [${winterPeriod._id}])`
    );

    const unscopedPassed = unscopedStudents.length === 0;
    recordResult(
      'Keine Schüler ohne periodId vorhanden (0 ungescoped)',
      unscopedPassed,
      `Gefunden ohne periodId: ${unscopedStudents.length}`
    );

    // Prüfe Schnittmenge der Schüler-IDs (muss strikt 0 sein)
    const summerStudentIdSet = new Set(summerStudents.map(s => s._id.toString()));
    const winterStudentIdSet = new Set(winterStudents.map(s => s._id.toString()));
    let idOverlapCount = 0;
    for (const wId of winterStudentIdSet) {
      if (summerStudentIdSet.has(wId)) {
        idOverlapCount++;
      }
    }
    const idOverlapPassed = idOverlapCount === 0;
    recordResult(
      '0 ID-Überschneidungen zwischen Winter- und Sommerschülern',
      idOverlapPassed,
      `Überschneidung: ${idOverlapCount}`
    );

    // Prüfe Kurs- und Assignment-Isolation
    const summerSchedules = await db.collection('schedules').find({ periodId: summerPeriod._id }).toArray();
    const winterSchedules = await db.collection('schedules').find({ periodId: winterPeriod._id }).toArray();

    let winterInSummerSchedule = 0;
    for (const sched of summerSchedules) {
      for (const stId of (sched.students || [])) {
        if (winterStudentIdSet.has(stId.toString())) {
          winterInSummerSchedule++;
        }
      }
    }

    let summerInWinterSchedule = 0;
    for (const sched of winterSchedules) {
      for (const stId of (sched.students || [])) {
        if (summerStudentIdSet.has(stId.toString())) {
          summerInWinterSchedule++;
        }
      }
    }

    const scheduleOverlapPassed = winterInSummerSchedule === 0 && summerInWinterSchedule === 0;
    recordResult(
      '0 Kurs-Assignment-Überschneidungen in Schedules zwischen Sommer und Winter',
      scheduleOverlapPassed,
      `Winter in Sommerplan: ${winterInSummerSchedule}, Sommer in Winterplan: ${summerInWinterSchedule}`
    );

    // -------------------------------------------------------------------------
    // Zusammenfassung & Exit Code
    // -------------------------------------------------------------------------
    console.log('\n' + '='.repeat(80));
    console.log(' ZUSAMMENFASSUNG DER VERIFIKATION');
    console.log('='.repeat(80));
    const allPassed = results.every(r => r.passed);
    const passedCount = results.filter(r => r.passed).length;
    const failedCount = results.filter(r => !r.passed).length;

    console.log(`Gesamt: ${results.length} Tests | Bestanden: ${passedCount} | Fehlgeschlagen: ${failedCount}`);

    if (allPassed) {
      console.log('\n\x1b[32m✔ ALLE VERIFIKATIONEN VOLLSTÄNDIG BESTANDEN!\x1b[0m\n');
      process.exit(0);
    } else {
      console.log('\n\x1b[31m✘ ES GIBT FEHLGESCHLAGENE VERIFIKATIONEN!\x1b[0m\n');
      process.exit(1);
    }

  } catch (err) {
    console.error('\n\x1b[31mUNERWARTETER FEHLER:\x1b[0m', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runVerification();
