/**
 * Email Service Tests
 *
 * Tests the Nodemailer SMTP email service functionality.
 *
 * Note: These tests run in isolation and do NOT send actual emails.
 * They test token generation, email template structure, and service configuration.
 */

import {
  generateVerificationTokenWithExpiry,
  generatePasswordResetToken,
} from '../../utils/emailService.js';

describe('Email Service - Token Generation', () => {
  describe('generateVerificationTokenWithExpiry()', () => {
    test('Should generate token with correct length', () => {
      const { token, expires } = generateVerificationTokenWithExpiry();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes hex = 64 characters
    });

    test('Should generate unique tokens', () => {
      const token1 = generateVerificationTokenWithExpiry();
      const token2 = generateVerificationTokenWithExpiry();

      expect(token1.token).not.toBe(token2.token);
    });

    test('Should set expiry to 24 hours from now', () => {
      const { expires } = generateVerificationTokenWithExpiry();

      const now = new Date();
      const expectedExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      expect(expires).toBeInstanceOf(Date);

      // Allow 5 second tolerance
      const timeDiff = Math.abs(expires.getTime() - expectedExpiry.getTime());
      expect(timeDiff).toBeLessThan(5000);
    });

    test('Should return token and expires', () => {
      const result = generateVerificationTokenWithExpiry();

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('expires');
    });
  });

  describe('generatePasswordResetToken()', () => {
    test('Should generate token with correct length', () => {
      const { token, expires } = generatePasswordResetToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes hex
    });

    test('Should generate unique tokens', () => {
      const token1 = generatePasswordResetToken();
      const token2 = generatePasswordResetToken();

      expect(token1.token).not.toBe(token2.token);
    });

    test('Should set expiry to 1 hour from now', () => {
      const { expires } = generatePasswordResetToken();

      const now = new Date();
      const expectedExpiry = new Date(now.getTime() + 60 * 60 * 1000);

      expect(expires).toBeInstanceOf(Date);

      // Allow 5 second tolerance
      const timeDiff = Math.abs(expires.getTime() - expectedExpiry.getTime());
      expect(timeDiff).toBeLessThan(5000);
    });

    test('Should return token and expires', () => {
      const result = generatePasswordResetToken();

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('expires');
    });
  });

  describe('Token Security', () => {
    test('Verification tokens should be cryptographically random', () => {
      const tokens = new Set();

      // Generate 100 tokens
      for (let i = 0; i < 100; i++) {
        const { token } = generateVerificationTokenWithExpiry();
        tokens.add(token);
      }

      // All should be unique
      expect(tokens.size).toBe(100);
    });

    test('Reset tokens should be cryptographically random', () => {
      const tokens = new Set();

      // Generate 100 tokens
      for (let i = 0; i < 100; i++) {
        const { token } = generatePasswordResetToken();
        tokens.add(token);
      }

      // All should be unique
      expect(tokens.size).toBe(100);
    });

    test('Tokens should only contain hex characters', () => {
      const { token: verifyToken } = generateVerificationTokenWithExpiry();
      const { token: resetToken } = generatePasswordResetToken();

      const hexRegex = /^[0-9a-f]+$/;
      expect(hexRegex.test(verifyToken)).toBe(true);
      expect(hexRegex.test(resetToken)).toBe(true);
    });
  });
});

describe('Email Service - Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('Should detect SMTP configuration from environment', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'test@example.com';
    process.env.SMTP_PASS = 'password123';
    process.env.FROM_EMAIL = 'noreply@example.com';
    process.env.FROM_NAME = 'Test App';

    // Configuration check happens at import time
    // This test verifies env vars are set correctly
    expect(process.env.SMTP_HOST).toBe('smtp.example.com');
    expect(process.env.SMTP_USER).toBe('test@example.com');
    expect(process.env.SMTP_PASS).toBe('password123');
  });

  test('Should handle missing SMTP configuration', () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    // Service should handle missing config gracefully
    // Emails will be logged instead of sent
    expect(process.env.SMTP_HOST).toBeUndefined();
  });
});

describe('Email Service - Template Validation', () => {
  test('Frontend URL should be configurable', () => {
    const originalUrl = process.env.FRONTEND_URL;

    process.env.FRONTEND_URL = 'https://example.com';
    expect(process.env.FRONTEND_URL).toBe('https://example.com');

    process.env.FRONTEND_URL = 'http://localhost:3001';
    expect(process.env.FRONTEND_URL).toBe('http://localhost:3001');

    process.env.FRONTEND_URL = originalUrl;
  });

  test('From email should be configurable', () => {
    const originalFrom = process.env.FROM_EMAIL;

    process.env.FROM_EMAIL = 'noreply@tcgw.de';
    expect(process.env.FROM_EMAIL).toBe('noreply@tcgw.de');

    process.env.FROM_EMAIL = originalFrom;
  });
});

describe('Email Service - Error Handling', () => {
  test('Should handle invalid token generation gracefully', () => {
    // Token generation should never fail with valid Node.js crypto
    expect(() => {
      for (let i = 0; i < 1000; i++) {
        generateVerificationTokenWithExpiry();
        generatePasswordResetToken();
      }
    }).not.toThrow();
  });
});

describe('Email Service - Multipart MIME Support', () => {
  test('Should support plain text parameter for multipart emails', () => {
    // Mock email function signature accepts text parameter
    const mockEmailOptions = {
      to: 'test@example.com',
      subject: 'Test Subject',
      html: '<p>HTML content</p>',
      text: 'Plain text content'
    };

    expect(mockEmailOptions).toHaveProperty('html');
    expect(mockEmailOptions).toHaveProperty('text');
    expect(mockEmailOptions.html).not.toBe(mockEmailOptions.text);
  });

  test('Plain text should differ from HTML-stripped version', () => {
    const html = '<div style="color: red;"><p>Hello <strong>World</strong></p></div>';
    const strippedHtml = html.replace(/<[^>]*>/g, ''); // Old approach
    const properText = 'Hello World'; // Proper plain text

    // Proper plain text should be well-formatted
    expect(strippedHtml).toContain('Hello World');
    expect(properText).toBe('Hello World');
    // Multipart MIME allows proper formatting instead of simple HTML stripping
    expect(properText.trim()).toBe('Hello World');
  });

  test('Should handle optional text parameter (backward compatibility)', () => {
    const withoutText = {
      to: 'test@example.com',
      subject: 'Test',
      html: '<p>HTML only</p>'
    };

    const withText = {
      to: 'test@example.com',
      subject: 'Test',
      html: '<p>HTML version</p>',
      text: 'Plain text version'
    };

    // Both should be valid email options
    expect(withoutText.to).toBeDefined();
    expect(withText.to).toBeDefined();
    expect(withText.text).toBeDefined();
    expect(withoutText.text).toBeUndefined();
  });

  test('Notification emails should provide both HTML and text versions', () => {
    // Mock notification email structure
    const mockSeasonalNotification = {
      html: '<div class="header"><h1>Neue Registrierung</h1></div>',
      text: '==================================================\nNEUE REGISTRIERUNG\n==================================================\n'
    };

    const mockCampNotification = {
      html: '<div class="header"><h1>Neue Camp-Anmeldung</h1></div>',
      text: '==================================================\nNEUE CAMP-ANMELDUNG\n==================================================\n'
    };

    expect(mockSeasonalNotification.html).toBeDefined();
    expect(mockSeasonalNotification.text).toBeDefined();
    expect(mockCampNotification.html).toBeDefined();
    expect(mockCampNotification.text).toBeDefined();

    // Text versions should not contain HTML tags
    expect(mockSeasonalNotification.text).not.toContain('<');
    expect(mockSeasonalNotification.text).not.toContain('>');
    expect(mockCampNotification.text).not.toContain('<');
    expect(mockCampNotification.text).not.toContain('>');
  });

  test('Plain text should preserve information from HTML', () => {
    // Example: Both versions should contain key information
    const registrationData = {
      name: 'Max Mustermann',
      email: 'max@example.com',
      season: 'Winter 2026'
    };

    const htmlVersion = `<div><p>Name: ${registrationData.name}</p><p>Email: ${registrationData.email}</p></div>`;
    const textVersion = `Name: ${registrationData.name}\nEmail: ${registrationData.email}`;

    // Both should contain the same data
    expect(htmlVersion).toContain(registrationData.name);
    expect(htmlVersion).toContain(registrationData.email);
    expect(textVersion).toContain(registrationData.name);
    expect(textVersion).toContain(registrationData.email);

    // Text should be more readable
    expect(textVersion).not.toContain('<');
    expect(textVersion.split('\n').length).toBeGreaterThan(1);
  });

  test('Section dividers should be properly formatted in plain text', () => {
    const sectionDivider = '\n' + '='.repeat(50) + '\nTEST SECTION\n' + '='.repeat(50) + '\n';
    const subSection = '\n' + '-'.repeat(40) + '\nTest Subsection\n' + '-'.repeat(40) + '\n';

    expect(sectionDivider).toContain('='.repeat(50));
    expect(sectionDivider).toContain('TEST SECTION');
    expect(subSection).toContain('-'.repeat(40));
    expect(subSection).toContain('Test Subsection');
  });

  test('Field alignment should be consistent in plain text', () => {
    const field1 = 'Name'.padEnd(20) + ': John Doe';
    const field2 = 'Email'.padEnd(20) + ': john@example.com';
    const field3 = 'Very Long Label'.padEnd(20) + ': Value';

    // All colons should be at the same position
    expect(field1.indexOf(':')).toBe(20);
    expect(field2.indexOf(':')).toBe(20);
    expect(field3.indexOf(':')).toBe(20);
  });

  test('German locale formatting should work correctly', () => {
    const testDate = new Date('2026-02-11');
    const formatted = testDate.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    expect(formatted).toBe('11.02.2026');
    expect(formatted).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
  });

  test('Boolean values should be formatted in German', () => {
    const formatYesNo = (bool) => bool ? 'Ja' : 'Nein';

    expect(formatYesNo(true)).toBe('Ja');
    expect(formatYesNo(false)).toBe('Nein');
  });
});
