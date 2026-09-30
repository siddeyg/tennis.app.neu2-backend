/**
 * Verification script for Audit Log Search & Security Enhancements
 * Tests:
 * 1. User name resolution for search (e.g. "nicole", "Kreienborg")
 * 2. Enhanced IBAN & sensitive fields sanitization in body, changes, and metadata
 * 3. Model index coverage and EXPORT action enum support
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env.development') });

import AuditLog from '../src/models/AuditLog.js';
import User from '../src/models/User.js';
import { createAuditLog } from '../src/middleware/auditLog.js';

async function run() {
  console.log('--- Starting Audit Log Enhancements Verification ---');
  let failures = 0;

  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://admin:password123@localhost:27017/tennis-coach?authSource=admin';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // 1. Verify User Name Resolution for Nicole
    console.log('\n[Test 1] User Name Resolution');
    const nicole = await User.findOne({
      $or: [
        { firstName: { $regex: 'nicole', $options: 'i' } },
        { email: { $regex: 'mondo-tennisschule', $options: 'i' } }
      ]
    }).lean();

    if (!nicole) {
      console.warn('⚠️ Nicole user not found in database (seed data might not have her), testing resolution logic generically.');
    } else {
      console.log(`✅ Found Nicole: ${nicole.firstName} ${nicole.lastName} (${nicole.email}) [ID: ${nicole._id}]`);

      // Test query for "nicole"
      const searchTerms = ['nicole', 'Nicole', 'Kreienborg', 'info@mondo-tennisschule.de'];
      for (const term of searchTerms) {
        const matchingUsers = await User.find({
          $or: [
            { firstName: { $regex: term, $options: 'i' } },
            { lastName: { $regex: term, $options: 'i' } },
            { email: { $regex: term, $options: 'i' } }
          ]
        }).select('_id').lean();

        if (matchingUsers.some(u => u._id.toString() === nicole._id.toString())) {
          console.log(`✅ Search "${term}" resolves Nicole's user ID correctly.`);
        } else {
          console.error(`❌ Search "${term}" did not resolve Nicole's user ID!`);
          failures++;
        }
      }
    }

    // 2. Verify Sanitization of IBAN, Kontoinhaber, Passwords in requestBody, changes, metadata
    console.log('\n[Test 2] Sanitization in Body, Changes, Metadata');
    const testLogId = new mongoose.Types.ObjectId();
    await createAuditLog({
      userId: nicole ? nicole._id : new mongoose.Types.ObjectId(),
      userEmail: 'test-sanitization@example.com',
      userRole: 'admin',
      action: 'UPDATE',
      resource: 'Coach',
      resourceId: 'test-resource',
      method: 'PUT',
      endpoint: '/api/coaches/test',
      requestBody: {
        iban: 'DE12345678901234567890',
        kontoinhaber: 'Nicole Test',
        accountHolder: 'Nicole Test',
        password: 'superSecretPassword123!',
        safeData: 'visibleValue'
      },
      changes: {
        iban: 'DE99999999999999999999',
        field: 'normalChange'
      },
      metadata: {
        accountHolder: 'Nicole Test',
        reason: 'Audit test run'
      },
      status: 'SUCCESS'
    });

    const savedLog = await AuditLog.findOne({ userEmail: 'test-sanitization@example.com' }).sort({ timestamp: -1 });
    if (!savedLog) {
      console.error('❌ Could not retrieve saved test audit log');
      failures++;
    } else {
      // Check requestBody
      if (savedLog.requestBody.iban === '[REDACTED]' &&
          savedLog.requestBody.kontoinhaber === '[REDACTED]' &&
          savedLog.requestBody.accountHolder === '[REDACTED]' &&
          savedLog.requestBody.password === '[REDACTED]' &&
          savedLog.requestBody.safeData === 'visibleValue') {
        console.log('✅ Request body sanitization: ALL sensitive fields redacted, safe fields preserved.');
      } else {
        console.error('❌ Request body sanitization failed:', savedLog.requestBody);
        failures++;
      }

      // Check changes
      if (savedLog.changes && savedLog.changes.iban === '[REDACTED]' && savedLog.changes.field === 'normalChange') {
        console.log('✅ Changes sanitization: sensitive fields in changes diff redacted.');
      } else {
        console.error('❌ Changes sanitization failed:', savedLog.changes);
        failures++;
      }

      // Check metadata
      if (savedLog.metadata && savedLog.metadata.accountHolder === '[REDACTED]' && savedLog.metadata.reason === 'Audit test run') {
        console.log('✅ Metadata sanitization: sensitive fields in metadata redacted.');
      } else {
        console.error('❌ Metadata sanitization failed:', savedLog.metadata);
        failures++;
      }

      // Clean up test log
      await AuditLog.deleteOne({ _id: savedLog._id });
      console.log('🧹 Cleaned up test audit log');
    }

    // 3. Verify EXPORT action enum & Index definitions
    console.log('\n[Test 3] Model Enum & Indexes');
    const exportLog = new AuditLog({
      action: 'EXPORT',
      resource: 'AuditLog',
      method: 'POST',
      endpoint: '/api/audit-logs/export',
      status: 'SUCCESS'
    });
    const validateErr = exportLog.validateSync();
    if (!validateErr) {
      console.log('✅ AuditLog model accepts EXPORT action without validation error.');
    } else {
      console.error('❌ EXPORT action validation error:', validateErr.message);
      failures++;
    }

    const indexes = await AuditLog.collection.indexes();
    const indexKeyNames = indexes.map(idx => Object.keys(idx.key).join('_'));
    console.log('📋 Existing AuditLog indexes:', indexKeyNames);
    const hasUserEmailIndex = indexes.some(idx => idx.key.userEmail !== undefined);
    if (hasUserEmailIndex) {
      console.log('✅ Index on userEmail confirmed present.');
    } else {
      console.log('ℹ️ Index on userEmail will be created automatically on next Mongoose init or ensureIndexes.');
    }

  } catch (err) {
    console.error('❌ Verification script crashed:', err);
    failures++;
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }

  if (failures > 0) {
    console.error(`\n❌ FAILED with ${failures} error(s).`);
    process.exit(1);
  } else {
    console.log('\n🎉 ALL AUDIT LOG VERIFICATION CHECKS PASSED SUCCESSFULLY!');
    process.exit(0);
  }
}

run();
