#!/usr/bin/env node
/**
 * One-time migration: remove stale day/hour/coach fields from all student documents.
 *
 * These were "legacy fields" kept in sync with the assignments[] array.
 * After the 2026-02-14 migration, assignments[] is the single source of truth.
 *
 * Run once:
 *   node backend/scripts/migrate-remove-legacy-student-fields.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MongoClient } from 'mongodb';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../backend/.env.development') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach';

async function migrate() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log(`Connected to MongoDB: ${MONGO_URI}`);

    const db = client.db();
    const collection = db.collection('students');

    // Count documents that still have legacy fields
    const withLegacy = await collection.countDocuments({
      $or: [
        { day: { $exists: true } },
        { hour: { $exists: true } },
        { coach: { $exists: true } },
      ]
    });

    console.log(`Found ${withLegacy} students with legacy day/hour/coach fields`);

    if (withLegacy === 0) {
      console.log('Nothing to migrate. Exiting.');
      return;
    }

    // Remove the legacy fields from all documents
    const result = await collection.updateMany(
      {},
      { $unset: { day: '', hour: '', coach: '' } }
    );

    console.log(`✅ Migration complete: ${result.modifiedCount} documents updated`);

    // Verify
    const remaining = await collection.countDocuments({
      $or: [
        { day: { $exists: true } },
        { hour: { $exists: true } },
        { coach: { $exists: true } },
      ]
    });
    console.log(`Remaining documents with legacy fields: ${remaining}`);

  } finally {
    await client.close();
    console.log('Disconnected.');
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
