import mongoose from 'mongoose';

async function runSimulation() {
  await mongoose.connect('mongodb://admin:password123@localhost:27017/tennis-coach?authSource=admin');
  const db = mongoose.connection.db;

  const sommerPeriod = await db.collection('registrationperiods').findOne({ name: /Sommer 2026/i });
  const winterPeriod = await db.collection('registrationperiods').findOne({ name: /Winter/i });

  console.log('Sommer Period:', sommerPeriod._id, 'Winter Period:', winterPeriod._id);

  // 1. Clara Johanna Rump (Persona 1)
  const claraUser = await db.collection('studentportalusers').findOne({ email: 'stephanie.rump@gmx.de' });
  console.log('\n--- Simulation Persona 1: Clara Johanna Rump ---');
  console.log('User studentId:', claraUser.studentId, 'familyMembers:', claraUser.familyMembers);

  // 2. Sommer-only child (Persona 2)
  const sommerStudents = await db.collection('students').find({
    periodId: sommerPeriod._id,
    assignments: { $exists: true, $not: { $size: 0 } }
  }).toArray();

  const winterStudents = await db.collection('students').find({ periodId: winterPeriod._id }).toArray();
  const winterNames = new Set(winterStudents.map(s => `${s.firstName} ${s.lastName}`.trim().toLowerCase()));

  const sommerOnly = sommerStudents.filter(s => !winterNames.has(`${s.firstName} ${s.lastName}`.trim().toLowerCase()));
  console.log('\n--- Simulation Persona 2: Sommer-Only Students ---');
  console.log(`Found ${sommerOnly.length} students with Sommer training but NO Winter student record.`);

  // Find a Sommer-only student with a portal user
  let sampleSommerOnlyUser = null;
  let sampleStudent = null;
  for (const s of sommerOnly) {
    const u = await db.collection('studentportalusers').findOne({
      $or: [{ studentId: s._id }, { 'familyMembers.studentId': s._id }, { email: s.email }]
    });
    if (u) {
      sampleSommerOnlyUser = u;
      sampleStudent = s;
      break;
    }
  }

  if (sampleSommerOnlyUser) {
    console.log(`Sample Sommer-only Student: ${sampleStudent.firstName} ${sampleStudent.lastName} (ID: ${sampleStudent._id})`);
    console.log(`Portal User: ${sampleSommerOnlyUser.firstName} ${sampleSommerOnlyUser.lastName} (${sampleSommerOnlyUser.email})`);
    console.log('Portal User studentId:', sampleSommerOnlyUser.studentId);

    // Simulate portalSchedule.js resolution for this user when period is Winter
    let resolvedStudent = await db.collection('students').findOne({
      periodId: winterPeriod._id,
      $or: [
        { studentPortalUserId: sampleSommerOnlyUser._id, familyMemberId: null },
        ...(sampleSommerOnlyUser.studentId ? [{ _id: sampleSommerOnlyUser.studentId }] : []),
        ...(sampleSommerOnlyUser.email ? [{ email: sampleSommerOnlyUser.email.toLowerCase() }] : [])
      ]
    });
    console.log('Step 1 (scoped lookup in winter):', resolvedStudent ? resolvedStudent._id : 'null (correct)');

    if (!resolvedStudent && sampleSommerOnlyUser.studentId) {
      resolvedStudent = await db.collection('students').findOne({ _id: sampleSommerOnlyUser.studentId });
      console.log('Step 2 (UNSCOPED fallback to portalUser.studentId):', resolvedStudent ? {
        id: resolvedStudent._id,
        periodId: resolvedStudent.periodId,
        isSommer: resolvedStudent.periodId.equals(sommerPeriod._id),
        assignments: resolvedStudent.assignments?.length
      } : 'null');
    }
  }

  // 4. Familie mit mehreren Kindern (Persona 4: Plath, Hoesch)
  console.log('\n--- Simulation Persona 4: Familie Plath & Hoesch ---');
  for (const email of ['e.weffer@gmx.de', 'silke.hoesch@me.com']) {
    const user = await db.collection('studentportalusers').findOne({ email });
    console.log(`\nPortal User: ${user.firstName} ${user.lastName} (${email})`);
    console.log(`  User studentId: ${user.studentId}, Children count: ${user.familyMembers?.length}`);

    // Simulate for both Sommer and Winter
    for (const testPeriod of [sommerPeriod, winterPeriod]) {
      let ownStudent = await db.collection('students').findOne({
        periodId: testPeriod._id,
        $or: [
          { studentPortalUserId: user._id, familyMemberId: null },
          ...(user.studentId ? [{ _id: user.studentId }] : []),
          { email: user.email.toLowerCase() }
        ]
      });
      if (!ownStudent && user.studentId) {
        ownStudent = await db.collection('students').findOne({ _id: user.studentId });
      }

      const childResults = [];
      for (const fm of user.familyMembers || []) {
        let child = await db.collection('students').findOne({
          periodId: testPeriod._id,
          $or: [
            { studentPortalUserId: user._id, familyMemberId: fm._id },
            ...(fm.studentId ? [{ _id: fm.studentId }] : []),
            { firstName: { $regex: new RegExp(`^${fm.firstName?.trim()}$`, 'i') }, lastName: { $regex: new RegExp(`^${fm.lastName?.trim()}$`, 'i') } }
          ]
        });
        if (!child && fm.studentId) {
          child = await db.collection('students').findOne({ _id: fm.studentId });
        }
        childResults.push({
          name: `${fm.firstName} ${fm.lastName}`,
          childStudentFound: !!child,
          childPeriodMatch: child ? child.periodId.equals(testPeriod._id) : false,
          assignmentsCount: child?.assignments?.length || 0
        });
      }

      console.log(`  [Period: ${testPeriod.name}]`);
      console.log(`    Own student resolved:`, ownStudent ? { id: ownStudent._id, periodMatch: ownStudent.periodId.equals(testPeriod._id), assignments: ownStudent.assignments?.length } : 'null');
      console.log(`    Children resolved:`, childResults);
    }
  }

  // 4. Check whether Sommer students appear in Winter scheduler
  console.log('\n--- Checking if Sommer students appear in Winter scheduler query ---');
  const winterQueryStudents = await db.collection('students').find({ periodId: winterPeriod._id }).toArray();
  const contaminated = winterQueryStudents.filter(s => s.periodId.toString() !== winterPeriod._id.toString());
  console.log(`Query { periodId: ${winterPeriod._id} } returns ${winterQueryStudents.length} students. Contaminated count: ${contaminated.length}`);

  await mongoose.disconnect();
}

runSimulation().catch(console.error);
