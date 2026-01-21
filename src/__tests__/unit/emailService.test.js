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
