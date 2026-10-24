import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Student from '../../models/Student.js';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import Settings from '../../models/Settings.js';
import scheduleNotificationsRoutes from '../../routes/scheduleNotifications.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB
} from '../../testHelpers.js';

const app = express();
app.use(express.json());

const adminId = new mongoose.Types.ObjectId();
app.use((req, res, next) => {
  req.user = {
    _id: adminId,
    id: adminId,
    role: 'admin',
    firstName: 'Admin',
    lastName: 'User',
    username: 'admin',
    email: 'admin@test.com'
  };
  next();
});

app.use('/api/schedule-notifications', scheduleNotificationsRoutes);

describe('Schedule Notifications Period Scoping & Enforcement', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('rejects POST /notify-all without periodId with 400', async () => {
    const res = await request(app)
      .post('/api/schedule-notifications/notify-all')
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/periodId ist zwingend erforderlich/i);
  });

  it('rejects POST /notify-all with invalid periodId with 400', async () => {
    const res = await request(app)
      .post('/api/schedule-notifications/notify-all')
      .send({ periodId: 'not-a-valid-id' })
      .expect(400);

    expect(res.body.error).toMatch(/periodId ist zwingend erforderlich/i);
  });

  it('rejects POST /notify-all with non-existent periodId with 404', async () => {
    const nonExistentId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/schedule-notifications/notify-all')
      .send({ periodId: nonExistentId.toString() })
      .expect(404);

    expect(res.body.error).toMatch(/Trainingsperiode nicht gefunden/i);
  });

  it('notifies only students of target period and updates both period and settings metadata', async () => {
    const period1 = await RegistrationPeriod.create({
      name: 'Sommer 2026',
      season: 'summer',
      trainingStartDate: new Date('2026-05-01'),
      trainingEndDate: new Date('2026-09-30'),
      registrationDeadline: new Date('2026-04-15'),
      status: 'open',
      currentPlanId: new mongoose.Types.ObjectId(),
      createdBy: adminId
    });

    const period2 = await RegistrationPeriod.create({
      name: 'Winter 2026/27',
      season: 'winter',
      trainingStartDate: new Date('2026-10-01'),
      trainingEndDate: new Date('2027-04-30'),
      registrationDeadline: new Date('2026-09-15'),
      status: 'open',
      currentPlanId: new mongoose.Types.ObjectId(),
      createdBy: adminId
    });

    // Create a portal user
    const portalUser = await StudentPortalUser.create({
      email: 'user@example.com',
      password: 'password123',
      firstName: 'Test',
      lastName: 'User',
      birthdate: new Date('1980-01-01')
    });

    // Student in period 1
    const student1 = await Student.create({
      firstName: 'Max',
      lastName: 'Sommer',
      birthDate: '2010-01-01',
      email: 'max@sommer.de',
      phone: '123',
      adress: 'Strasse 1',
      adult: false,
      member: true,
      periodId: period1._id,
      studentPortalUserId: portalUser._id,
      assignments: [{ day: 'Montag', hour: 15 }]
    });

    // Student in period 2
    const student2 = await Student.create({
      firstName: 'Lara',
      lastName: 'Winter',
      birthDate: '2012-05-05',
      email: 'lara@winter.de',
      phone: '456',
      adress: 'Strasse 2',
      adult: false,
      member: true,
      periodId: period2._id,
      studentPortalUserId: portalUser._id,
      assignments: [{ day: 'Dienstag', hour: 16 }]
    });

    // Notify for period 2 only
    const notifyRes = await request(app)
      .post('/api/schedule-notifications/notify-all')
      .send({ periodId: period2._id.toString() })
      .expect(200);

    expect(notifyRes.body.success).toBe(true);
    expect(notifyRes.body.sentCount).toBe(1);

    // Student 2 scheduleVisible should be true, student 1 untouched
    const updatedS1 = await Student.findById(student1._id);
    const updatedS2 = await Student.findById(student2._id);
    expect(updatedS2.scheduleVisible).toBe(true);
    expect(updatedS1.scheduleVisible).toBeFalsy();

    // Check GET /status with periodId
    const statusP2 = await request(app)
      .get(`/api/schedule-notifications/status?periodId=${period2._id}`)
      .expect(200);

    expect(statusP2.body.alreadySentToday).toBe(true);
    expect(statusP2.body.lastBulkNotificationSent.sentCount).toBe(1);

    // Period 1 status should still be false
    const statusP1 = await request(app)
      .get(`/api/schedule-notifications/status?periodId=${period1._id}`)
      .expect(200);

    expect(statusP1.body.alreadySentToday).toBe(false);

    // Calling again without force should warn
    const warnRes = await request(app)
      .post('/api/schedule-notifications/notify-all')
      .send({ periodId: period2._id.toString() })
      .expect(200);

    expect(warnRes.body.warned).toBe(true);
    expect(warnRes.body.alreadySentToday).toBe(true);

    // Calling with force: true should proceed
    const forceRes = await request(app)
      .post('/api/schedule-notifications/notify-all')
      .send({ periodId: period2._id.toString(), force: true })
      .expect(200);

    expect(forceRes.body.success).toBe(true);
  });
});
