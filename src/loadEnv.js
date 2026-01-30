/**
 * Load Environment Variables BEFORE Any Other Imports
 *
 * This file must be imported FIRST in server.js to ensure
 * environment variables are available when other modules load.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine environment file
const activeEnvFile =
  process.env.NODE_ENV === 'production'
    ? '.env.production'
    : '.env.development';

// Load .env from project root (one level up from src/)
const envPath = path.resolve(__dirname, '..', activeEnvFile);
dotenv.config({ path: envPath });

// Export environment info for logging
export const envInfo = {
  activeEnvFile,
  envPath,
  isProduction: process.env.NODE_ENV === 'production',
};
