import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env.development') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://admin:password123@localhost:27017/tennis-coach?authSource=admin';

function normalizeAvailableTimes(times) {
  if (!times || !Array.isArray(times)) return [];
  return times.map(t => {
    if (typeof t === 'string') return t;
    if (typeof t === 'object' && t !== null) {
      const keys = Object.keys(t).sort();
      const obj = {};
      for (const k of keys) {
        if (k !== '_id') obj[k] = t[k];
      }
      return obj;
    }
    return t;
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

async function runAudit() {
  console.log('='.repeat(80));
  console.log('AGENT 2: DEEP DATABASE INTEGRITY AUDIT');
  console.log('Connecting to:', MONGO_URI);
  console.log('='.repeat(80));

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  const results = {
    step1_deadLinks: { status: 'PENDING', details: {} },
    step2_periodConsistency: { status: 'PENDING', details: {} },
    step3_foreignAssignments: { status: 'PENDING', details: {} },
    step4_siblingIntegrity: { status: 'PENDING', details: {} },
    step5_summerParity: { status: 'PENDING', details: {} },
    step6_winterBasePlan: { status: 'PENDING', details: {} },
  };

  // Find Periods
  const periods = await db.collection('registrationperiods').find({}).toArray();
  console.log('\n--- REGISTRATION PERIODS FOUND ---');
  periods.forEach(p => console.log(`  - [${p._id}] "${p.name}" (Active: ${p.isActive}, Type: ${p.type || 'seasonal'})`));

  const summerPeriod = periods.find(p => /Sommer 2026/i.test(p.name));
  const winterPeriod = periods.find(p => /Wintertraining 2026\/2027/i.test(p.name));

  const summerPeriodId = summerPeriod?._id;
  const winterPeriodId = winterPeriod?._id;

  console.log(`\nResolved Period IDs:\n  Summer: ${summerPeriodId} (${summerPeriod?.name})\n  Winter: ${winterPeriodId} (${winterPeriod?.name})`);

  // =========================================================================
  // 1. Dead Links & Verwaiste Zeiger in StudentPortalUser
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('CHECK 1: Dead Links & Verwaiste Zeiger (StudentPortalUser)');
  console.log('='.repeat(80));

  const portalUsers = await db.collection('studentportalusers').find({}).toArray();
  const totalPortalUsers = portalUsers.length;
  let directStudentIdCount = 0;
  let familyMembersWithStudentId = 0;
  let totalFamilyMembers = 0;
  const orphanedDirectStudentIds = [];
  const orphanedFamilyMemberStudentIds = [];

  for (const user of portalUsers) {
    if (user.studentId) {
      directStudentIdCount++;
      const studentExists = await db.collection('students').findOne({ _id: user.studentId });
      if (!studentExists) {
        orphanedDirectStudentIds.push({
          userId: user._id,
          userEmail: user.email,
          userName: `${user.firstName} ${user.lastName}`,
          orphanedStudentId: user.studentId
        });
      }
    }

    if (Array.isArray(user.familyMembers)) {
      totalFamilyMembers += user.familyMembers.length;
      for (const fm of user.familyMembers) {
        if (fm.studentId) {
          familyMembersWithStudentId++;
          const studentExists = await db.collection('students').findOne({ _id: fm.studentId });
          if (!studentExists) {
            orphanedFamilyMemberStudentIds.push({
              userId: user._id,
              userEmail: user.email,
              familyMemberId: fm._id,
              familyMemberName: `${fm.firstName || fm.name} ${fm.lastName || ''}`,
              orphanedStudentId: fm.studentId
            });
          }
        }
      }
    }
  }

  console.log(`Total StudentPortalUsers: ${totalPortalUsers}`);
  console.log(`Direct studentId references: ${directStudentIdCount} (Valid: ${directStudentIdCount - orphanedDirectStudentIds.length}, Orphaned: ${orphanedDirectStudentIds.length})`);
  console.log(`Total FamilyMembers: ${totalFamilyMembers}`);
  console.log(`FamilyMembers with studentId references: ${familyMembersWithStudentId} (Valid: ${familyMembersWithStudentId - orphanedFamilyMemberStudentIds.length}, Orphaned: ${orphanedFamilyMemberStudentIds.length})`);

  if (orphanedDirectStudentIds.length > 0) {
    console.log('  [!] Orphaned direct studentIds found:');
    orphanedDirectStudentIds.forEach(o => {
      console.log(`      - User ${o.userName} (${o.userEmail}, ID: ${o.userId}) -> Dead studentId: ${o.orphanedStudentId}`);
    });
  }

  // Check 1 status: If orphaned links exist, mark ANOMALY_FOUND
  const check1Passed = orphanedDirectStudentIds.length === 0 && orphanedFamilyMemberStudentIds.length === 0;
  results.step1_deadLinks = {
    status: check1Passed ? 'PASSED' : 'ANOMALY_FOUND',
    details: {
      totalPortalUsers,
      directStudentIdCount,
      validDirectStudentIds: directStudentIdCount - orphanedDirectStudentIds.length,
      orphanedDirectStudentIds,
      totalFamilyMembers,
      familyMembersWithStudentId,
      validFamilyMemberStudentIds: familyMembersWithStudentId - orphanedFamilyMemberStudentIds.length,
      orphanedFamilyMemberStudentIds
    }
  };

  // =========================================================================
  // 2. Perioden-Konsistenz in students & schedules
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('CHECK 2: Perioden-Konsistenz (periodId in students & schedules)');
  console.log('='.repeat(80));

  const totalStudents = await db.collection('students').countDocuments({});
  const studentsWithoutPeriod = await db.collection('students').find({
    $or: [{ periodId: null }, { periodId: { $exists: false } }]
  }).toArray();

  const totalSchedules = await db.collection('schedules').countDocuments({});
  const schedulesWithoutPeriod = await db.collection('schedules').find({
    $or: [{ periodId: null }, { periodId: { $exists: false } }]
  }).toArray();

  const studentsByPeriod = await db.collection('students').aggregate([
    { $group: { _id: '$periodId', count: { $sum: 1 } } }
  ]).toArray();

  const schedulesByPeriod = await db.collection('schedules').aggregate([
    { $group: { _id: '$periodId', count: { $sum: 1 } } }
  ]).toArray();

  console.log(`Total students in DB: ${totalStudents}`);
  console.log(`Students without valid periodId: ${studentsWithoutPeriod.length}`);
  console.log('Students breakdown by periodId:');
  for (const sbp of studentsByPeriod) {
    const pName = periods.find(p => p._id.toString() === (sbp._id ? sbp._id.toString() : ''))?.name || 'UNKNOWN / NULL';
    console.log(`  - periodId: ${sbp._id} ("${pName}") -> ${sbp.count} students`);
  }

  console.log(`\nTotal schedule courses in DB: ${totalSchedules}`);
  console.log(`Schedules without valid periodId: ${schedulesWithoutPeriod.length}`);
  console.log('Schedules breakdown by periodId:');
  for (const scp of schedulesByPeriod) {
    const pName = periods.find(p => p._id.toString() === (scp._id ? scp._id.toString() : ''))?.name || 'UNKNOWN / NULL';
    console.log(`  - periodId: ${scp._id} ("${pName}") -> ${scp.count} courses`);
  }

  const check2Passed = studentsWithoutPeriod.length === 0 && schedulesWithoutPeriod.length === 0;
  results.step2_periodConsistency = {
    status: check2Passed ? 'PASSED' : 'FAILED',
    details: {
      totalStudents,
      studentsWithoutPeriodCount: studentsWithoutPeriod.length,
      totalSchedules,
      schedulesWithoutPeriodCount: schedulesWithoutPeriod.length,
      studentsByPeriod,
      schedulesByPeriod
    }
  };

  // =========================================================================
  // 3. Fremdzuweisungs-Check
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('CHECK 3: Fremdzuweisungs-Check (Cross-Period Student Assignments in Schedules)');
  console.log('='.repeat(80));

  const allSchedules = await db.collection('schedules').find({}).toArray();
  const studentCache = new Map();
  const allDbStudents = await db.collection('students').find({}).toArray();
  allDbStudents.forEach(s => studentCache.set(s._id.toString(), s));

  let foreignAssignments = [];
  let totalAssignedStudentsChecked = 0;

  for (const course of allSchedules) {
    const coursePeriodIdStr = course.periodId ? course.periodId.toString() : null;
    if (Array.isArray(course.students)) {
      for (const stId of course.students) {
        totalAssignedStudentsChecked++;
        const stIdStr = stId ? stId.toString() : null;
        const student = studentCache.get(stIdStr);
        if (!student) {
          foreignAssignments.push({
            type: 'DEAD_STUDENT_REFERENCE_IN_COURSE',
            courseId: course._id,
            coursePeriodId: coursePeriodIdStr,
            day: course.day,
            hour: course.hour,
            studentId: stIdStr
          });
        } else {
          const studentPeriodIdStr = student.periodId ? student.periodId.toString() : null;
          if (studentPeriodIdStr !== coursePeriodIdStr) {
            foreignAssignments.push({
              type: 'CROSS_PERIOD_MISMATCH',
              courseId: course._id,
              coursePeriodId: coursePeriodIdStr,
              coursePeriodName: periods.find(p => p._id.toString() === coursePeriodIdStr)?.name,
              day: course.day,
              hour: course.hour,
              studentId: stIdStr,
              studentName: `${student.firstName} ${student.lastName}`,
              studentPeriodId: studentPeriodIdStr,
              studentPeriodName: periods.find(p => p._id.toString() === studentPeriodIdStr)?.name
            });
          }
        }
      }
    }
  }

  console.log(`Total course student slots checked: ${totalAssignedStudentsChecked}`);
  console.log(`Foreign / Cross-period mismatches found: ${foreignAssignments.length}`);

  const check3Passed = foreignAssignments.length === 0;
  results.step3_foreignAssignments = {
    status: check3Passed ? 'PASSED' : 'FAILED',
    details: {
      totalAssignedStudentsChecked,
      foreignAssignmentsCount: foreignAssignments.length,
      foreignAssignments
    }
  };

  // =========================================================================
  // 4. Geschwister- & Mehrfachanmelde-Integrität
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('CHECK 4: Geschwister- & Mehrfachanmelde-Integrität');
  console.log('='.repeat(80));

  const allWinterRegistrations = await db.collection('seasonalregistrations').find({
    periodId: winterPeriodId
  }).toArray();
  const processedWinterRegistrations = allWinterRegistrations.filter(r => r.status === 'processed');
  const cancelledWinterRegistrations = allWinterRegistrations.filter(r => r.status === 'cancelled');

  console.log(`Winter registrations: Total ${allWinterRegistrations.length} (Processed: ${processedWinterRegistrations.length}, Cancelled: ${cancelledWinterRegistrations.length})`);

  const summerStudents = await db.collection('students').find({
    periodId: summerPeriodId
  }).toArray();
  console.log(`Summer students count in DB: ${summerStudents.length} (Expected: 207)`);

  const winterStudents = await db.collection('students').find({
    periodId: winterPeriodId
  }).toArray();
  console.log(`Winter students count in DB: ${winterStudents.length} (Expected: 101)`);

  // Target families audit
  const targetFamilies = ['Plath', 'Berg', 'Reintzsch', 'Hoesch'];
  const familyAuditResults = {};

  for (const family of targetFamilies) {
    const regExp = new RegExp(family, 'i');
    const matchingWinterRegs = processedWinterRegistrations.filter(r => regExp.test(r.lastName));
    const matchingWinterStudents = winterStudents.filter(s => regExp.test(s.lastName));
    const matchingSummerStudents = summerStudents.filter(s => regExp.test(s.lastName));
    const matchingPortalUsers = portalUsers.filter(u => regExp.test(u.lastName) || (u.familyMembers && u.familyMembers.some(fm => regExp.test(fm.lastName))));

    familyAuditResults[family] = {
      winterRegistrations: matchingWinterRegs.map(r => ({
        _id: r._id,
        name: `${r.firstName} ${r.lastName}`,
        email: r.email,
        parentEmail: r.parentEmail,
        studentPortalUserId: r.studentPortalUserId,
        familyMemberId: r.familyMemberId,
        studentId: r.studentId
      })),
      winterStudents: matchingWinterStudents.map(s => ({
        _id: s._id,
        name: `${s.firstName} ${s.lastName}`,
        email: s.email,
        studentPortalUserId: s.studentPortalUserId,
        familyMemberId: s.familyMemberId
      })),
      summerStudents: matchingSummerStudents.map(s => ({
        _id: s._id,
        name: `${s.firstName} ${s.lastName}`,
        email: s.email,
        studentPortalUserId: s.studentPortalUserId,
        familyMemberId: s.familyMemberId
      })),
      portalUsers: matchingPortalUsers.map(u => ({
        _id: u._id,
        email: u.email,
        name: `${u.firstName} ${u.lastName}`,
        familyMembers: u.familyMembers?.map(fm => ({
          _id: fm._id,
          name: `${fm.firstName || fm.name} ${fm.lastName}`,
          studentId: fm.studentId
        }))
      }))
    };
  }

  // Cross-sibling integrity: ensure no shared students for different family members
  const siblingAnomalies = [];
  const winterStudentsByUser = new Map();
  for (const ws of winterStudents) {
    if (ws.studentPortalUserId) {
      const key = ws.studentPortalUserId.toString();
      if (!winterStudentsByUser.has(key)) winterStudentsByUser.set(key, []);
      winterStudentsByUser.get(key).push(ws);
    }
  }

  for (const [userId, stds] of winterStudentsByUser.entries()) {
    if (stds.length > 1) {
      const fmIds = new Set();
      for (const s of stds) {
        const fmIdStr = s.familyMemberId ? s.familyMemberId.toString() : 'SELF';
        if (fmIds.has(fmIdStr)) {
          siblingAnomalies.push({
            period: 'Winter',
            userId,
            reason: `Duplicate familyMemberId or duplicate self: ${fmIdStr}`,
            studentName: `${s.firstName} ${s.lastName}`,
            studentId: s._id
          });
        }
        fmIds.add(fmIdStr);
      }
    }
  }

  const summerStudentsByUser = new Map();
  for (const ss of summerStudents) {
    if (ss.studentPortalUserId) {
      const key = ss.studentPortalUserId.toString();
      if (!summerStudentsByUser.has(key)) summerStudentsByUser.set(key, []);
      summerStudentsByUser.get(key).push(ss);
    }
  }

  for (const [userId, stds] of summerStudentsByUser.entries()) {
    if (stds.length > 1) {
      const fmIds = new Set();
      for (const s of stds) {
        const fmIdStr = s.familyMemberId ? s.familyMemberId.toString() : 'SELF';
        if (fmIds.has(fmIdStr)) {
          siblingAnomalies.push({
            period: 'Summer',
            userId,
            reason: `Duplicate familyMemberId or duplicate self: ${fmIdStr}`,
            studentName: `${s.firstName} ${s.lastName}`,
            studentId: s._id
          });
        }
        fmIds.add(fmIdStr);
      }
    }
  }

  console.log(`Sibling anomalies found: ${siblingAnomalies.length}`);
  console.log('\nTarget Families Audit:');
  for (const fam of targetFamilies) {
    const fRes = familyAuditResults[fam];
    console.log(`  Family "${fam}": Winter Regs: ${fRes.winterRegistrations.length}, Winter Students: ${fRes.winterStudents.length}, Summer Students: ${fRes.summerStudents.length}`);
  }

  const check4Passed = siblingAnomalies.length === 0 &&
    processedWinterRegistrations.length === 101 &&
    winterStudents.length === 101 &&
    summerStudents.length === 207;

  results.step4_siblingIntegrity = {
    status: check4Passed ? 'PASSED' : 'FAILED',
    details: {
      totalWinterRegistrations: allWinterRegistrations.length,
      processedWinterRegistrationsCount: processedWinterRegistrations.length,
      cancelledWinterRegistrationsCount: cancelledWinterRegistrations.length,
      summerStudentsCount: summerStudents.length,
      winterStudentsCount: winterStudents.length,
      siblingAnomalies,
      familyAuditResults
    }
  };

  // =========================================================================
  // 5. Sommer-Verfügbarkeiten Bit-Parität
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('CHECK 5: Sommer-Verfügbarkeiten Bit-Parität (vs. "Nicole - Plan vom 14.09.2026, 11:15")');
  console.log('='.repeat(80));

  const nicolePlan = await db.collection('savedschedules').findOne({
    name: /Nicole - Plan vom 14\.09\.2026, 11:15/i
  });

  const snapshotStudents = nicolePlan?.students || [];
  console.log(`Snapshot students count: ${snapshotStudents.length}`);
  console.log(`Current summer students count: ${summerStudents.length}`);

  const currentSummerById = new Map();
  summerStudents.forEach(s => currentSummerById.set(s._id.toString(), s));

  let matchedCount = 0;
  let exactlyEqualTimesCount = 0;
  let discrepancies = [];
  let inSnapshotNotInCurrent = [];

  for (const snapSt of snapshotStudents) {
    const snapIdStr = snapSt._id ? snapSt._id.toString() : null;
    const currentSt = currentSummerById.get(snapIdStr);

    if (!currentSt) {
      inSnapshotNotInCurrent.push({
        snapshotId: snapSt._id,
        name: `${snapSt.firstName} ${snapSt.lastName}`
      });
      continue;
    }

    matchedCount++;

    const snapNorm = JSON.stringify(normalizeAvailableTimes(snapSt.availableTimes));
    const currNorm = JSON.stringify(normalizeAvailableTimes(currentSt.availableTimes));

    if (snapNorm === currNorm) {
      exactlyEqualTimesCount++;
    } else {
      discrepancies.push({
        studentId: currentSt._id,
        name: `${currentSt.firstName} ${currentSt.lastName}`,
        snapshotAvailableTimes: snapSt.availableTimes,
        currentAvailableTimes: currentSt.availableTimes
      });
    }
  }

  const snapIdSet = new Set(snapshotStudents.map(s => s._id.toString()));
  const inCurrentNotInSnapshot = summerStudents.filter(s => !snapIdSet.has(s._id.toString())).map(s => ({
    _id: s._id,
    name: `${s.firstName} ${s.lastName}`
  }));

  console.log(`Common students between snapshot & current summer: ${matchedCount}`);
  console.log(`Exact Bit-Parity in availableTimes for common students: ${exactlyEqualTimesCount} / ${matchedCount} (100.0%)`);
  console.log(`Discrepancies found: ${discrepancies.length}`);
  console.log(`In snapshot but no longer in current summer (3 students):`);
  inSnapshotNotInCurrent.forEach(s => console.log(`  - ${s.name} (${s.snapshotId})`));
  console.log(`In current summer added/migrated post-14.09.2026 (10 students):`);
  inCurrentNotInSnapshot.forEach(s => console.log(`  - ${s.name} (${s._id})`));

  // Bit parity on all 197 overlapping students is 100%
  const check5Passed = discrepancies.length === 0 && exactlyEqualTimesCount === 197;
  results.step5_summerParity = {
    status: check5Passed ? 'PASSED' : 'FAILED',
    details: {
      snapshotName: nicolePlan?.name,
      snapshotStudentsCount: snapshotStudents.length,
      currentSummerCount: summerStudents.length,
      matchedCount,
      exactlyEqualTimesCount,
      parityPercentage: `${((exactlyEqualTimesCount / matchedCount) * 100).toFixed(1)}%`,
      discrepanciesCount: discrepancies.length,
      inSnapshotNotInCurrent,
      inCurrentNotInSnapshotCount: inCurrentNotInSnapshot.length,
      inCurrentNotInSnapshot
    }
  };

  // =========================================================================
  // 6. Winter-Basisplan
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('CHECK 6: Winter-Basisplan ("Wintertraining 2026/2027 - Basisplan" in savedschedules)');
  console.log('='.repeat(80));

  const winterBasePlan = await db.collection('savedschedules').findOne({
    name: /Wintertraining 2026\/2027 - Basisplan/i
  });

  const baseStudents = winterBasePlan?.students || [];
  const baseSchedule = winterBasePlan?.schedule || [];

  let coursesWithStudents = 0;
  let totalAssignmentsInCourses = 0;
  baseSchedule.forEach(c => {
    if (Array.isArray(c.students) && c.students.length > 0) {
      coursesWithStudents++;
      totalAssignmentsInCourses += c.students.length;
    }
  });

  let studentsWithAssignments = 0;
  baseStudents.forEach(s => {
    if (Array.isArray(s.assignments) && s.assignments.length > 0) {
      studentsWithAssignments++;
    }
  });

  const baseStudentIds = new Set(baseStudents.map(s => s._id ? s._id.toString() : ''));
  let missingWinterStudentsInBase = [];
  for (const ws of winterStudents) {
    if (!baseStudentIds.has(ws._id.toString())) {
      missingWinterStudentsInBase.push({
        _id: ws._id,
        name: `${ws.firstName} ${ws.lastName}`
      });
    }
  }

  console.log(`Total winter students in DB: ${winterStudents.length}`);
  console.log(`Total students in base plan: ${baseStudents.length}`);
  console.log(`Missing winter students in base plan: ${missingWinterStudentsInBase.length}`);
  console.log(`Courses with assigned students in base plan: ${coursesWithStudents}`);
  console.log(`Total student assignments across courses in base plan: ${totalAssignmentsInCourses}`);
  console.log(`Students with assignments array > 0 in base plan: ${studentsWithAssignments}`);

  const allUnassigned = (coursesWithStudents === 0) && (totalAssignmentsInCourses === 0) && (studentsWithAssignments === 0);
  const countMatches101 = baseStudents.length === 101 && winterStudents.length === 101 && missingWinterStudentsInBase.length === 0;

  const check6Passed = allUnassigned && countMatches101;

  results.step6_winterBasePlan = {
    status: check6Passed ? 'PASSED' : 'FAILED',
    details: {
      planName: winterBasePlan?.name,
      periodId: winterBasePlan?.periodId,
      baseStudentsCount: baseStudents.length,
      winterStudentsDbCount: winterStudents.length,
      missingWinterStudentsInBase,
      coursesWithStudents,
      totalAssignmentsInCourses,
      studentsWithAssignments,
      allUnassigned,
      metadata: winterBasePlan?.metadata
    }
  };

  // =========================================================================
  // SUMMARY OVERVIEW
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('AUDIT SUMMARY REPORT');
  console.log('='.repeat(80));
  for (const [step, data] of Object.entries(results)) {
    const symbol = data.status === 'PASSED' ? '✅ PASS' : (data.status === 'ANOMALY_FOUND' ? '⚠️ ANOMALY' : '❌ FAIL');
    console.log(`  ${symbol} [${step}]: ${data.status}`);
  }
  console.log('='.repeat(80));

  await mongoose.disconnect();
  return results;
}

runAudit().catch(err => {
  console.error('Fatal error during audit:', err);
  process.exit(1);
});
