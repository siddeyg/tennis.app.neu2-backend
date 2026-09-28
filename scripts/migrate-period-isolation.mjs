import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env.development') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://admin:password123@localhost:27017/tennis-coach?authSource=admin';

async function migrate() {
  console.log('Connecting to MongoDB:', MONGO_URI);
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  const summerPeriod = await db.collection('registrationperiods').findOne({ name: /Sommer 2026/i });
  const winterPeriod = await db.collection('registrationperiods').findOne({ name: /Wintertraining 2026\/2027/i });

  if (!summerPeriod) {
    throw new Error('Sommer 2026 period not found!');
  }
  if (!winterPeriod) {
    throw new Error('Wintertraining 2026/2027 period not found!');
  }

  console.log(`Summer Period ID: ${summerPeriod._id} (${summerPeriod.name})`);
  console.log(`Winter Period ID: ${winterPeriod._id} (${winterPeriod.name})`);

  // 1. Migrate students without periodId to summerPeriod._id
  const studentRes = await db.collection('students').updateMany(
    { $or: [{ periodId: null }, { periodId: { $exists: false } }] },
    { $set: { periodId: summerPeriod._id } }
  );
  console.log(`Updated ${studentRes.modifiedCount} students with summer periodId: ${summerPeriod._id}`);

  // 2. Migrate schedules (collection name is plural: schedules)
  const scheduleRes = await db.collection('schedules').updateMany(
    { $or: [{ periodId: null }, { periodId: { $exists: false } }] },
    { $set: { periodId: summerPeriod._id } }
  );
  console.log(`Updated ${scheduleRes.modifiedCount} schedule courses with summer periodId: ${summerPeriod._id}`);

  // 3. Heal portal user references and backfill studentPortalUserId / familyMemberId
  const portalUsers = await db.collection('studentportalusers').find({}).toArray();
  let healedDirectLinks = 0;
  let healedFmLinks = 0;

  for (const user of portalUsers) {
    let userModified = false;
    const userUpdates = {};

    // Check direct studentId or match by email / name
    let directStudent = null;
    if (user.studentId) {
      directStudent = await db.collection('students').findOne({ _id: user.studentId });
    }
    if (!directStudent && user.email) {
      directStudent = await db.collection('students').findOne({
        email: user.email.toLowerCase(),
        periodId: summerPeriod._id
      });
    }
    if (!directStudent && user.firstName && user.lastName) {
      directStudent = await db.collection('students').findOne({
        firstName: { $regex: new RegExp(`^${user.firstName.trim()}$`, 'i') },
        lastName: { $regex: new RegExp(`^${user.lastName.trim()}$`, 'i') },
        periodId: summerPeriod._id
      });
    }

    if (directStudent) {
      await db.collection('students').updateOne(
        { _id: directStudent._id },
        { $set: { studentPortalUserId: user._id, familyMemberId: null } }
      );
      if (!user.studentId || String(user.studentId) !== String(directStudent._id)) {
        userUpdates.studentId = directStudent._id;
        userModified = true;
      }
      healedDirectLinks++;
    }

    // Check family members
    if (Array.isArray(user.familyMembers)) {
      const updatedFm = [];
      let fmModified = false;

      for (const fm of user.familyMembers) {
        let fmStudent = null;
        if (fm.studentId) {
          fmStudent = await db.collection('students').findOne({ _id: fm.studentId });
        }
        if (!fmStudent && fm.firstName && fm.lastName) {
          fmStudent = await db.collection('students').findOne({
            firstName: { $regex: new RegExp(`^${fm.firstName.trim()}$`, 'i') },
            lastName: { $regex: new RegExp(`^${fm.lastName.trim()}$`, 'i') },
            periodId: summerPeriod._id
          });
        }

        if (fmStudent) {
          await db.collection('students').updateOne(
            { _id: fmStudent._id },
            { $set: { studentPortalUserId: user._id, familyMemberId: fm._id } }
          );
          if (!fm.studentId || String(fm.studentId) !== String(fmStudent._id)) {
            updatedFm.push({ ...fm, studentId: fmStudent._id });
            fmModified = true;
          } else {
            updatedFm.push(fm);
          }
          healedFmLinks++;
        } else {
          updatedFm.push(fm);
        }
      }

      if (fmModified) {
        userUpdates.familyMembers = updatedFm;
        userModified = true;
      }
    }

    if (userModified) {
      await db.collection('studentportalusers').updateOne(
        { _id: user._id },
        { $set: userUpdates }
      );
    }
  }

  console.log(`Healed & linked ${healedDirectLinks} direct student links`);
  console.log(`Healed & linked ${healedFmLinks} family member student links`);

  // 4. Restore Clara Johanna Rump's summer availableTimes
  const clara = await db.collection('students').findOne({
    firstName: 'Clara Johanna',
    lastName: 'Rump',
    periodId: summerPeriod._id
  });
  if (clara) {
    await db.collection('students').updateOne(
      { _id: clara._id },
      {
        $set: {
          availableTimes: [
            { day: 'Montag', hour: 15, venue: '' },
            { day: 'Dienstag', hour: 15, venue: '' }
          ]
        }
      }
    );
    console.log(`Restored summer availableTimes for Clara Johanna Rump (${clara._id})`);
  }

  // 5. Backfill periodId on SavedSchedules if missing
  const savedRes = await db.collection('savedschedules').updateMany(
    { $or: [{ periodId: null }, { periodId: { $exists: false } }] },
    { $set: { periodId: summerPeriod._id } }
  );
  console.log(`Updated ${savedRes.modifiedCount} saved schedule snapshots with summer periodId`);

  console.log('Migration completed successfully!');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
