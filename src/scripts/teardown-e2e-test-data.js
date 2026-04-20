/**
 * teardown-e2e-test-data.js
 *
 * Removes all E2E test data seeded by seed-e2e-test-data.js.
 * Matches all records whose email ends with @mondo.local.
 *
 * Run from backend/: node src/scripts/teardown-e2e-test-data.js
 * Or from project root via wrapper: node scripts/teardown-test-data.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../../.env.development');
dotenv.config({ path: envPath });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI not found. Expected backend/.env.development to be loaded.');
  process.exit(1);
}

// Minimal schemas — enough to call deleteMany against the right collections
const User    = mongoose.models.User    || mongoose.model('User',    new mongoose.Schema({ email: String }));
const Coach   = mongoose.models.Coach   || mongoose.model('Coach',   new mongoose.Schema({ email: String }));
const Student = mongoose.models.Student || mongoose.model('Student', new mongoose.Schema({ email: String }));

async function teardown() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');

  const TEST_EMAIL_REGEX = /@mondo\.local$/;

  const users    = await User.deleteMany({ email: TEST_EMAIL_REGEX });
  const coaches  = await Coach.deleteMany({ email: TEST_EMAIL_REGEX });
  const students = await Student.deleteMany({ email: TEST_EMAIL_REGEX });

  console.log('\nTeardown complete:');
  console.log(`  Users    removed: ${users.deletedCount}`);
  console.log(`  Coaches  removed: ${coaches.deletedCount}`);
  console.log(`  Students removed: ${students.deletedCount}`);

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

teardown().catch((err) => {
  console.error('Teardown failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
