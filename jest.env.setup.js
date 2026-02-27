/**
 * Jest Environment Setup
 * Loads .env.development before running tests so route handlers
 * have access to JWT secrets, DB URIs, etc.
 * Referenced in jest.config.js setupFiles array.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env.development') });
