/**
 * Test Runner with Logging
 * Runs Jest tests and captures output to log files
 *
 * Usage: node run-tests-with-logging.js [testFile]
 * Example: node run-tests-with-logging.js students.test.js
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get test file argument (optional)
const testFile = process.argv[2] || '';
const testNameForFile = testFile ? testFile.replace(/\.test\.js$/, '').replace(/[\/\\]/g, '-') : 'all-tests';

// Generate timestamp
const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');

// Create test-results directory if it doesn't exist
const resultsDir = path.join(__dirname, 'test-results');
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

// Define output file paths
const txtLogFile = path.join(resultsDir, `${testNameForFile}-${timestamp}.txt`);
const jsonLogFile = path.join(resultsDir, `${testNameForFile}-${timestamp}.json`);

console.log('\n📋 Running tests with logging...');
console.log(`📝 Text log: ${path.basename(txtLogFile)}`);
console.log(`📊 JSON log: ${path.basename(jsonLogFile)}`);
console.log('');

// Build Jest command
const jestArgs = [
  '--experimental-vm-modules',
  'node_modules/jest/bin/jest.js',
  '--coverage',
  '--verbose',
  '--json',
  `--outputFile=${jsonLogFile}`
];

// Add test file if specified
if (testFile) {
  jestArgs.push(testFile);
}

// Spawn Jest process
const jest = spawn('node', jestArgs, {
  cwd: __dirname,
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true
});

// Capture output
let textOutput = '';
let errorOutput = '';

jest.stdout.on('data', (data) => {
  const text = data.toString();
  process.stdout.write(text); // Display in console
  textOutput += text;
});

jest.stderr.on('data', (data) => {
  const text = data.toString();
  process.stderr.write(text); // Display in console
  errorOutput += text;
});

jest.on('close', (code) => {
  // Combine output
  const fullOutput = `
=================================================================
TEST RUN SUMMARY
=================================================================
Date/Time: ${new Date().toLocaleString()}
Test File: ${testFile || 'All tests'}
Exit Code: ${code}
Status: ${code === 0 ? '✅ PASSED' : '❌ FAILED'}
=================================================================

STDOUT OUTPUT:
${textOutput}

${errorOutput ? `STDERR OUTPUT:\n${errorOutput}\n` : ''}
=================================================================
Log files saved:
- Text: ${txtLogFile}
- JSON: ${jsonLogFile}
=================================================================
`;

  // Write text log file
  fs.writeFileSync(txtLogFile, fullOutput, 'utf8');

  console.log('');
  console.log('✅ Test logs saved successfully!');
  console.log(`📝 ${path.basename(txtLogFile)}`);
  console.log(`📊 ${path.basename(jsonLogFile)}`);

  process.exit(code);
});

jest.on('error', (error) => {
  console.error('❌ Error running tests:', error);
  process.exit(1);
});
