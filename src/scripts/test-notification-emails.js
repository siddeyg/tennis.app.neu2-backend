/**
 * Manual Testing Script for Notification Emails (Multipart MIME)
 *
 * This script sends test notification emails to verify:
 * 1. HTML version displays correctly in HTML email clients
 * 2. Plain text version displays correctly in text-only clients
 * 3. Both versions contain identical information
 *
 * Usage:
 *   node backend/src/scripts/test-notification-emails.js
 *
 * Prerequisites:
 *   - SMTP configured in .env.development
 *   - Valid recipient email address
 *
 * Testing Process:
 *   1. Run this script to send test emails
 *   2. Check Gmail/Outlook (HTML mode) - should see styled version
 *   3. Check "Show original" in Gmail - should see both MIME parts
 *   4. Check Thunderbird - switch between HTML and Plain Text views
 *   5. Check text-only client (Pine, Mutt, Lynx) - should see clean text
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  sendSeasonalRegistrationNotification,
  sendCampRegistrationNotification,
} from '../utils/emailService.js';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env.development') });

// Configuration
const TEST_EMAIL = process.env.TEST_EMAIL || 'tennisapp-admin@diemachtderworte.de';

console.log('🧪 Notification Email Multipart MIME Test\n');
console.log('Test recipient:', TEST_EMAIL);
console.log('SMTP configured:', !!process.env.SMTP_HOST);
console.log('');

// Mock seasonal registration data
const mockSeasonalRegistration = {
  firstName: 'Max',
  lastName: 'Mustermann',
  email: 'max.mustermann@example.com',
  phone: '+49 123 456789',
  birthdate: new Date('2010-05-15'),
  sex: 'männlich',
  address: 'Teststraße 123, 12345 Teststadt',
  member: true,
  periodId: { name: 'Winter 2026 Test' },
  adult: false,
  trainigGroup: 'Kinder 8-10',
  skillLevel: null,
  frequence: '2',
  availableTimes: [
    { day: 'Mo', hour: '15:00' },
    { day: 'Mi', hour: '15:00' }
  ],
  iban: 'DE89370400440532013000',
  parentEmail: 'parent@example.com',
  parentPhone: '+49 987 654321',
  notes: 'Dies ist eine Testnotiz für die E-Mail-Vorschau.',
  createdAt: new Date()
};

// Mock camp registration data
const mockCamp = {
  title: 'Sommer Tennis Camp 2026 (TEST)',
  startDate: new Date('2026-07-15'),
  endDate: new Date('2026-07-19'),
  location: 'TC GW Am Kreuzberg',
  price: 250,
  description: 'Test camp for email verification'
};

const mockCampRegistration = {
  firstName: 'Anna',
  lastName: 'Schmidt',
  email: 'anna.schmidt@example.com',
  phone: '+49 111 222333',
  birthdate: new Date('2012-08-20'),
  skillLevel: 'Fortgeschritten',
  team: false,
  emergencyContact: {
    name: 'Peter Schmidt',
    relationship: 'Vater',
    phone: '+49 444 555666'
  },
  additionalEmergencyContact: {
    name: 'Maria Schmidt',
    relationship: 'Mutter',
    phone: '+49 777 888999'
  },
  status: 'confirmed',
  notes: 'Keine besonderen Anforderungen. Dies ist ein Test.',
  createdAt: new Date()
};

// Test function
async function runTests() {
  try {
    console.log('📧 Test 1: Seasonal Registration Notification\n');
    console.log('   Sending to:', TEST_EMAIL);
    console.log('   Registration:', `${mockSeasonalRegistration.firstName} ${mockSeasonalRegistration.lastName}`);
    console.log('   Format: HTML + Plain Text (multipart MIME)\n');

    await sendSeasonalRegistrationNotification(
      mockSeasonalRegistration,
      [TEST_EMAIL]
    );

    console.log('   ✅ Seasonal registration email sent!\n');

    console.log('📧 Test 2: Camp Registration Notification\n');
    console.log('   Sending to:', TEST_EMAIL);
    console.log('   Camp:', mockCamp.title);
    console.log('   Participant:', `${mockCampRegistration.firstName} ${mockCampRegistration.lastName}`);
    console.log('   Format: HTML + Plain Text (multipart MIME)\n');

    await sendCampRegistrationNotification(
      mockCampRegistration,
      mockCamp,
      [TEST_EMAIL]
    );

    console.log('   ✅ Camp registration email sent!\n');

    console.log('✅ All test emails sent successfully!\n');
    console.log('📋 Verification Checklist:\n');
    console.log('   1. Gmail/Outlook (HTML mode):');
    console.log('      - Check styled HTML version displays correctly');
    console.log('      - Headers, sections, colors should render properly\n');
    console.log('   2. Gmail "Show original":');
    console.log('      - Should see "Content-Type: multipart/alternative"');
    console.log('      - Should see both text/plain and text/html parts\n');
    console.log('   3. Thunderbird:');
    console.log('      - View → Message Body As → Simple HTML (styled version)');
    console.log('      - View → Message Body As → Plain Text (text version)');
    console.log('      - Both should contain identical information\n');
    console.log('   4. Text-only client (Pine, Mutt, Lynx):');
    console.log('      - Should display clean plain text');
    console.log('      - NO HTML tags visible');
    console.log('      - NO emoji characters (replaced with text)');
    console.log('      - Section dividers (=== and ---) should be clear');
    console.log('      - Field labels should be aligned\n');
    console.log('   5. Information Completeness:');
    console.log('      - Compare HTML and text versions side-by-side');
    console.log('      - Verify NO data is lost in plain text version');
    console.log('      - All sections present in both versions\n');

  } catch (error) {
    console.error('❌ Error sending test emails:', error);
    console.error('\nTroubleshooting:');
    console.error('  - Check SMTP configuration in .env.development');
    console.error('  - Verify SMTP_HOST, SMTP_USER, SMTP_PASS are set');
    console.error('  - Check firewall/network allows SMTP connections');
    console.error('  - Review backend/src/utils/emailService.js logs');
    process.exit(1);
  }
}

// Run tests
runTests();
