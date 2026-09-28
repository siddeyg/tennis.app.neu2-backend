import mongoose from 'mongoose';

async function checkPersonas() {
  await mongoose.connect('mongodb://admin:password123@localhost:27017/tennis-coach?authSource=admin');
  const db = mongoose.connection.db;

  const periods = await db.collection('registrationperiods').find({}).toArray();
  console.log('=== PERIODS ===');
  for (const p of periods) {
    console.log(`ID: ${p._id} | Name: ${p.name} | isActive: ${p.isActive} | status: ${p.status} | schedulePublished: ${p.schedulePublished} | trainingStart: ${p.trainingStartDate?.toISOString?.()?.slice(0,10)} | trainingEnd: ${p.trainingEndDate?.toISOString?.()?.slice(0,10)}`);
  }

  console.log('\n=== PERSONA 1: Clara Johanna Rump ===');
  const claraStudents = await db.collection('students').find({ firstName: /Clara/i }).toArray();
  for (const s of claraStudents) {
    console.log(`Student ID: ${s._id} | periodId: ${s.periodId} | Name: ${s.firstName} ${s.lastName} | email: ${s.email} | portalUserId: ${s.studentPortalUserId} | familyMemberId: ${s.familyMemberId} | assignments: ${s.assignments?.length}`);
  }
  const claraPortal = await db.collection('studentportalusers').find({
    $or: [{ email: /rump/i }, { 'familyMembers.firstName': /Clara/i }, { firstName: /Clara/i }]
  }).toArray();
  for (const u of claraPortal) {
    console.log(`PortalUser ID: ${u._id} | Name: ${u.firstName} ${u.lastName} | email: ${u.email} | studentId: ${u.studentId} | familyMembers:`, JSON.stringify(u.familyMembers));
  }
  const claraRegs = await db.collection('seasonalregistrations').find({ firstName: /Clara/i }).toArray();
  for (const r of claraRegs) {
    console.log(`Registration ID: ${r._id} | periodId: ${r.periodId} | status: ${r.status} | studentId: ${r.studentId} | email: ${r.email}`);
  }

  console.log('\n=== PERSONA 4: Familie Plath & Hoesch ===');
  for (const name of ['Plath', 'Hoesch']) {
    console.log(`-- ${name} --`);
    const famStudents = await db.collection('students').find({ lastName: new RegExp(name, 'i') }).toArray();
    for (const s of famStudents) {
      console.log(`Student ID: ${s._id} | periodId: ${s.periodId} | Name: ${s.firstName} ${s.lastName} | email: ${s.email} | portalUserId: ${s.studentPortalUserId} | famMemberId: ${s.familyMemberId} | assignments: ${s.assignments?.length}`);
    }
    const famUsers = await db.collection('studentportalusers').find({
      $or: [{ lastName: new RegExp(name, 'i') }, { email: new RegExp(name, 'i') }]
    }).toArray();
    for (const u of famUsers) {
      console.log(`PortalUser ID: ${u._id} | Name: ${u.firstName} ${u.lastName} | email: ${u.email} | studentId: ${u.studentId} | familyMembers:`, JSON.stringify(u.familyMembers));
    }
  }

  console.log('\n=== PERSONA 5: Erwachsene ===');
  const adultRegs = await db.collection('seasonalregistrations').find({ formType: 'adults' }).limit(3).toArray();
  for (const r of adultRegs) {
    console.log(`Adult Reg ID: ${r._id} | Name: ${r.firstName} ${r.lastName} | email: ${r.email} | periodId: ${r.periodId} | studentId: ${r.studentId} | paymentMethod: ${r.paymentMethod}`);
  }

  await mongoose.disconnect();
}

checkPersonas().catch(console.error);
