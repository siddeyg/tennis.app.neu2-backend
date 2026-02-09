import crypto from 'crypto';
import logger from './logger.js';

/**
 * IBAN Encryption Utilities
 *
 * Uses AES-256-CBC encryption to securely store IBAN numbers.
 * Encryption key must be stored in .env (IBAN_ENCRYPTION_KEY).
 *
 * Security:
 * - 256-bit encryption key
 * - Random IV (initialization vector) for each encryption
 * - IV stored with encrypted data (safe to store together)
 */

const ALGORITHM = 'aes-256-cbc';
let ENCRYPTION_KEY = null;
let KEY_BUFFER = null;

// Lazy initialization - validates and loads key on first use
function getEncryptionKey() {
  if (ENCRYPTION_KEY) return KEY_BUFFER;

  ENCRYPTION_KEY = process.env.IBAN_ENCRYPTION_KEY;

  if (!ENCRYPTION_KEY) {
    logger.error('❌ IBAN_ENCRYPTION_KEY not found in environment variables!');
    throw new Error('IBAN_ENCRYPTION_KEY must be set in .env file');
  }

  if (ENCRYPTION_KEY.length !== 64) {
    logger.error('❌ IBAN_ENCRYPTION_KEY must be 64 hex characters (256 bits)');
    throw new Error('IBAN_ENCRYPTION_KEY must be 64 hex characters');
  }

  // Convert hex string to Buffer
  KEY_BUFFER = Buffer.from(ENCRYPTION_KEY, 'hex');
  return KEY_BUFFER;
}

/**
 * Encrypt IBAN
 *
 * @param {string} iban - Plain IBAN number (e.g., "DE89370400440532013000")
 * @returns {string} - Encrypted IBAN in format "iv:encryptedData" (hex)
 *
 * Example:
 *   Input:  "DE89370400440532013000"
 *   Output: "a1b2c3d4e5f6....:f7e8d9c0b1a2...."
 */
export function encryptIBAN(iban) {
  if (!iban || typeof iban !== 'string') {
    throw new Error('IBAN must be a non-empty string');
  }

  try {
    const keyBuffer = getEncryptionKey(); // Lazy load key

    // Generate random IV (16 bytes for AES)
    const iv = crypto.randomBytes(16);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

    // Encrypt IBAN
    let encrypted = cipher.update(iban, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return IV + encrypted data (separated by colon)
    const result = `${iv.toString('hex')}:${encrypted}`;

    logger.debug(`IBAN encrypted successfully (length: ${result.length})`);

    return result;
  } catch (error) {
    logger.error(`IBAN encryption failed: ${error.message}`);
    throw new Error('Failed to encrypt IBAN');
  }
}

/**
 * Decrypt IBAN
 *
 * @param {string} encryptedIBAN - Encrypted IBAN in format "iv:encryptedData"
 * @returns {string} - Plain IBAN number
 *
 * Example:
 *   Input:  "a1b2c3d4e5f6....:f7e8d9c0b1a2...."
 *   Output: "DE89370400440532013000"
 */
export function decryptIBAN(encryptedIBAN) {
  if (!encryptedIBAN || typeof encryptedIBAN !== 'string') {
    throw new Error('Encrypted IBAN must be a non-empty string');
  }

  try {
    const keyBuffer = getEncryptionKey(); // Lazy load key

    // Split IV and encrypted data
    const parts = encryptedIBAN.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted IBAN format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);

    // Decrypt IBAN
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    logger.debug(`IBAN decrypted successfully`);

    return decrypted;
  } catch (error) {
    logger.error(`IBAN decryption failed: ${error.message}`);
    throw new Error('Failed to decrypt IBAN');
  }
}

/**
 * Mask IBAN for display
 *
 * Shows only last 4 characters, masks the rest.
 * Works with both encrypted and plain IBAN.
 *
 * @param {string} iban - IBAN (encrypted or plain)
 * @param {boolean} isEncrypted - Whether IBAN is encrypted (default: true)
 * @returns {string} - Masked IBAN (e.g., "DE****3000")
 *
 * Example:
 *   Input:  "DE89370400440532013000" (plain)
 *   Output: "DE****3000"
 */
export function maskIBAN(iban, isEncrypted = true) {
  if (!iban) return null;

  try {
    // Decrypt if encrypted
    const plainIBAN = isEncrypted ? decryptIBAN(iban) : iban;

    // Get country code (first 2 chars) and last 4 digits
    const countryCode = plainIBAN.substring(0, 2);
    const lastFour = plainIBAN.slice(-4);

    return `${countryCode}****${lastFour}`;
  } catch (error) {
    logger.error(`IBAN masking failed: ${error.message}`);
    return 'IBAN****';
  }
}

/**
 * Get last 3 digits of IBAN for display
 *
 * Returns only the last 3 characters of the IBAN.
 * Works with both encrypted and plain IBAN.
 *
 * @param {string} iban - IBAN (encrypted or plain)
 * @param {boolean} isEncrypted - Whether IBAN is encrypted (default: true)
 * @returns {string} - Last 3 characters (e.g., "890")
 *
 * Example:
 *   Input:  "DE89370400440532013000" (plain)
 *   Output: "000"
 */
export function getIBANLast3(iban, isEncrypted = true) {
  if (!iban) return null;

  try {
    // Decrypt if encrypted
    const plainIBAN = isEncrypted ? decryptIBAN(iban) : iban;

    // Return last 3 characters
    return plainIBAN.slice(-3);
  } catch (error) {
    logger.error(`Getting IBAN last 3 failed: ${error.message}`);
    return null;
  }
}

/**
 * Validate IBAN format (basic check)
 *
 * Checks:
 * - Starts with 2-letter country code
 * - Contains only alphanumeric characters
 * - Length between 15-34 characters (IBAN standard)
 *
 * @param {string} iban - IBAN to validate
 * @returns {boolean} - True if valid format
 */
export function validateIBANFormat(iban) {
  if (!iban || typeof iban !== 'string') return false;

  // Remove spaces
  const cleanIBAN = iban.replace(/\s/g, '');

  // Check format: 2 letters + 2 digits + alphanumeric
  const ibanRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/;

  // Check length (15-34 chars)
  if (cleanIBAN.length < 15 || cleanIBAN.length > 34) return false;

  return ibanRegex.test(cleanIBAN);
}

/**
 * Generate encryption key (for setup)
 *
 * Generates a random 256-bit (64 hex characters) encryption key.
 * Use this once during initial setup, then store in .env file.
 *
 * @returns {string} - 64-character hex string
 *
 * Usage:
 *   const key = generateEncryptionKey();
 *   // Returns key string - add to .env.development and .env.production
 */
export function generateEncryptionKey() {
  const key = crypto.randomBytes(32).toString('hex');
  logger.info('Generated new IBAN encryption key (256 bits)');
  return key;
}

export default {
  encryptIBAN,
  decryptIBAN,
  maskIBAN,
  getIBANLast3,
  validateIBANFormat,
  generateEncryptionKey,
};
