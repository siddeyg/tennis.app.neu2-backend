/**
 * Production Configuration Verification Script
 *
 * Checks that all required environment variables are set correctly
 * before deploying to production. Helps prevent deployment issues.
 *
 * Usage:
 *   node verify-production-config.mjs
 *
 * Run this BEFORE deploying to production.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load production environment
const envPath = path.join(process.cwd(), '.env.production');
const envExists = fs.existsSync(envPath);

if (!envExists) {
  console.log('❌ .env.production file not found!');
  console.log('');
  console.log('To create production configuration:');
  console.log('  1. Copy .env.production.example to .env.production');
  console.log('  2. Fill in all required values');
  console.log('  3. Run this verification script again');
  console.log('');
  process.exit(1);
}

dotenv.config({ path: envPath });

console.log('🔍 Production Configuration Verification\n');
console.log('='.repeat(60));
console.log('');

let errors = 0;
let warnings = 0;

// Helper functions
function checkRequired(name, value, description) {
  if (!value || value.includes('GENERATE') || value.includes('xxxxx') || value.includes('username:password')) {
    console.log(`❌ ${name}`);
    console.log(`   Missing or placeholder value`);
    console.log(`   ${description}`);
    console.log('');
    errors++;
    return false;
  }
  console.log(`✅ ${name}`);
  return true;
}

function checkSecret(name, value, minLength = 64) {
  if (!value) {
    console.log(`❌ ${name}`);
    console.log(`   Missing secret`);
    console.log(`   Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
    console.log('');
    errors++;
    return false;
  }

  if (value.length < minLength) {
    console.log(`⚠️  ${name}`);
    console.log(`   Secret too short (${value.length} chars, should be ${minLength}+)`);
    console.log(`   Weak secrets are security risk`);
    console.log('');
    warnings++;
    return false;
  }

  if (value.includes('GENERATE')) {
    console.log(`❌ ${name}`);
    console.log(`   Placeholder value detected`);
    console.log('');
    errors++;
    return false;
  }

  console.log(`✅ ${name} (${value.length} characters)`);
  return true;
}

function checkURL(name, value, shouldBeHTTPS = true) {
  if (!value) {
    console.log(`❌ ${name}`);
    console.log(`   Missing URL`);
    console.log('');
    errors++;
    return false;
  }

  if (shouldBeHTTPS && !value.startsWith('https://')) {
    console.log(`⚠️  ${name}`);
    console.log(`   Not HTTPS: ${value}`);
    console.log(`   Production should use HTTPS`);
    console.log('');
    warnings++;
    return false;
  }

  if (value.includes('localhost') || value.includes('127.0.0.1')) {
    console.log(`❌ ${name}`);
    console.log(`   Contains localhost: ${value}`);
    console.log(`   Should be production domain`);
    console.log('');
    errors++;
    return false;
  }

  console.log(`✅ ${name}`);
  return true;
}

// Check environment
console.log('1. ENVIRONMENT CONFIGURATION');
console.log('-'.repeat(60));
checkRequired('NODE_ENV', process.env.NODE_ENV, 'Must be set to "production"');
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'production') {
  console.log(`⚠️  NODE_ENV is "${process.env.NODE_ENV}", should be "production"`);
  warnings++;
}
checkRequired('PORT', process.env.PORT, 'Server port (typically 5000)');
console.log('');

// Check database
console.log('2. DATABASE CONFIGURATION');
console.log('-'.repeat(60));
checkRequired('MONGO_URI', process.env.MONGO_URI, 'MongoDB connection string');
if (process.env.MONGO_URI && process.env.MONGO_URI.includes('localhost')) {
  console.log(`⚠️  MONGO_URI contains localhost - should be production database`);
  warnings++;
}
console.log('');

// Check JWT secrets
console.log('3. JWT AUTHENTICATION SECRETS');
console.log('-'.repeat(60));
checkSecret('JWT_SECRET', process.env.JWT_SECRET, 64);
checkSecret('REFRESH_TOKEN_SECRET', process.env.REFRESH_TOKEN_SECRET, 64);
checkRequired('JWT_EXPIRES_IN', process.env.JWT_EXPIRES_IN, 'Token expiry (e.g., "15m")');
checkRequired('REFRESH_EXPIRES_IN', process.env.REFRESH_EXPIRES_IN, 'Refresh token expiry (e.g., "7d")');
console.log('');

// Check IBAN encryption
console.log('4. IBAN ENCRYPTION');
console.log('-'.repeat(60));
checkSecret('IBAN_ENCRYPTION_KEY', process.env.IBAN_ENCRYPTION_KEY, 64);
console.log('');

// Check CORS
console.log('5. CORS CONFIGURATION');
console.log('-'.repeat(60));
checkURL('CORS_ORIGIN', process.env.CORS_ORIGIN, true);
checkURL('CORS_ORIGIN_STUDENT', process.env.CORS_ORIGIN_STUDENT, true);
checkURL('CORS_ORIGIN_COACH', process.env.CORS_ORIGIN_COACH, true);
console.log('');

// Check email service
console.log('6. EMAIL SERVICE (SendGrid)');
console.log('-'.repeat(60));
const hasEmailService = checkRequired('SENDGRID_API_KEY', process.env.SENDGRID_API_KEY, 'SendGrid API key from app.sendgrid.com');
checkRequired('FROM_EMAIL', process.env.FROM_EMAIL, 'Verified sender email address');
checkRequired('FROM_NAME', process.env.FROM_NAME, 'Sender name displayed in emails');

if (!hasEmailService) {
  console.log('⚠️  Email service not configured');
  console.log('   Password reset and email verification will NOT work');
  console.log('   Setup guide: PRODUCTION_ENVIRONMENT_SETUP.md Section 4');
  console.log('');
  warnings++;
}
console.log('');

// Check frontend URLs
console.log('7. FRONTEND URLS');
console.log('-'.repeat(60));
checkURL('FRONTEND_URL', process.env.FRONTEND_URL, true);
checkURL('STUDENT_PORTAL_URL', process.env.STUDENT_PORTAL_URL, true);
checkURL('COACH_PORTAL_URL', process.env.COACH_PORTAL_URL, true);
console.log('');

// Summary
console.log('='.repeat(60));
console.log('');
console.log('📊 VERIFICATION SUMMARY');
console.log('');

if (errors === 0 && warnings === 0) {
  console.log('✅ All checks passed!');
  console.log('');
  console.log('Production configuration is ready for deployment.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run database migration: node migrate-user-auth-fields.mjs');
  console.log('  2. Install email service: npm install @sendgrid/mail');
  console.log('  3. Uncomment email service code in:');
  console.log('     - backend/src/utils/emailService.js');
  console.log('     - backend/src/routes/auth.js (lines 302-304, 261-262, 475-476)');
  console.log('  4. Build frontend: npm run build (in each frontend folder)');
  console.log('  5. Deploy to production server');
  console.log('');
  process.exit(0);
} else {
  console.log(`❌ ${errors} error(s) found`);
  console.log(`⚠️  ${warnings} warning(s) found`);
  console.log('');

  if (errors > 0) {
    console.log('Fix all errors before deploying to production.');
    console.log('');
    console.log('See PRODUCTION_ENVIRONMENT_SETUP.md for detailed setup guide.');
    console.log('');
    process.exit(1);
  } else {
    console.log('Warnings should be reviewed but do not block deployment.');
    console.log('');
    console.log('Production configuration has issues but may be deployable.');
    console.log('Review warnings above before proceeding.');
    console.log('');
    process.exit(0);
  }
}
