import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

import Gallery from '../../models/Gallery.js';
import Media from '../../models/Media.js';
import galleriesRoutes from '../galleries.js';
import portalGalleriesRoutes from '../portalGalleries.js';
import { clearTestDB } from '../../testHelpers.js';
import { configurePassport } from '../../config/passport.js';

process.env.JWT_SECRET = 'test_admin_secret';
process.env.PORTAL_JWT_SECRET = 'test_portal_secret';

const app = express();
app.use(express.json());
app.use(cookieParser());

// Initialize passport
import passport from 'passport';
configurePassport();
app.use(passport.initialize());

app.use('/api/galleries', galleriesRoutes);
app.use('/api/portal/galleries', portalGalleriesRoutes);

import User from '../../models/User.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';

let adminUser;
let studentUser;
let replSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);

  adminUser = await User.create({
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@test.com',
    password: 'password123',
    role: 'admin',
    isActive: true,
    isEmailVerified: true
  });

  studentUser = await StudentPortalUser.create({
    firstName: 'Student',
    lastName: 'User',
    email: 'student@test.com',
    password: 'password123',
    role: 'student',
    birthdate: new Date('2000-01-01'),
    isActive: true
  });
}, 30000);

afterEach(async () => {
  // Clear only data collections, keep users
  await Gallery.deleteMany({});
  await Media.deleteMany({});
});

afterAll(async () => {
  await clearTestDB();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
  }
});

// Helper to generate cookies
const getAdminCookie = () => {
  const token = jwt.sign(
    { userId: adminUser._id, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return `authToken=${token}`;
};

const getStudentCookie = () => {
  const token = jwt.sign(
    { id: studentUser._id, role: 'student' },
    process.env.PORTAL_JWT_SECRET,
    { expiresIn: '1h' }
  );
  return `portalAccessToken=${token}`;
};

describe('Gallery Routes', () => {
  describe('Admin Routes (/api/galleries)', () => {
    test('POST / creates a new gallery', async () => {
      const res = await request(app)
        .post('/api/galleries')
        .set('Cookie', getAdminCookie())
        .send({
          headline: 'Test Event',
          date: '2026-08-16',
          description: 'A test event',
          isPublished: true
        });

      expect(res.status).toBe(201);
      expect(res.body.headline).toBe('Test Event');
      expect(res.body.isPublished).toBe(true);

      const dbGallery = await Gallery.findById(res.body._id);
      expect(dbGallery).not.toBeNull();
      expect(dbGallery.headline).toBe('Test Event');
    });

    test('GET / returns all galleries for admin', async () => {
      await Gallery.create([
        { headline: 'Pub 1', date: new Date(), isPublished: true },
        { headline: 'Unpub 1', date: new Date(), isPublished: false }
      ]);

      const res = await request(app)
        .get('/api/galleries')
        .set('Cookie', getAdminCookie());

      expect(res.status).toBe(200);
      expect(res.body.galleries).toHaveLength(2);
    });
  });

  describe('Portal Routes (/api/portal/galleries)', () => {
    test('GET / only returns published galleries for student', async () => {
      await Gallery.create([
        { headline: 'Pub 1', date: new Date(), isPublished: true },
        { headline: 'Unpub 1', date: new Date(), isPublished: false }
      ]);

      const res = await request(app)
        .get('/api/portal/galleries')
        .set('Cookie', getStudentCookie());

      expect(res.status).toBe(200);
      expect(res.body.galleries).toHaveLength(1);
      expect(res.body.galleries[0].headline).toBe('Pub 1');
    });

    test('GET /:id returns media for a published gallery', async () => {
      const gallery = await Gallery.create({ headline: 'Pub 1', date: new Date(), isPublished: true });
      await Media.create([
        { gallery: gallery._id, originalFilename: 'test1.jpg', filePath: '/fake/path', thumbnailPath: '/fake/thumb', mimeType: 'image/jpeg', type: 'image', width: 800, height: 600, size: 1024, isPublished: true },
        { gallery: gallery._id, originalFilename: 'test2.jpg', filePath: '/fake/path2', thumbnailPath: '/fake/thumb2', mimeType: 'image/jpeg', type: 'image', width: 800, height: 600, size: 1024, isPublished: false }
      ]);

      const res = await request(app)
        .get(`/api/portal/galleries/${gallery._id}`)
        .set('Cookie', getStudentCookie());

      expect(res.status).toBe(200);
      expect(res.body.gallery.headline).toBe('Pub 1');
      // Should only return published media
      expect(res.body.media).toHaveLength(1);
      expect(res.body.media[0].originalFilename).toBe('test1.jpg');
    });

    test('GET /:id returns 404 for an unpublished gallery for student', async () => {
      const gallery = await Gallery.create({ headline: 'Unpub 1', date: new Date(), isPublished: false });

      const res = await request(app)
        .get(`/api/portal/galleries/${gallery._id}`)
        .set('Cookie', getStudentCookie());

      // Student portal explicitly filters by isPublished: true, returning 404 if not found
      expect(res.status).toBe(404);
    });
  });
});
