// Checks the "Developed by Hesham Elgamal" credit is still shown by the website and
// the Android app (a condition of the license: see LICENSE §3 and NOTICE).
//
//   node tools/check-credit.mjs      (exits 1 and lists what's missing)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCredit } from '../lib/credit.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const missing = checkCredit(root);
if (missing.length) {
  console.error('The DriveStream credit is missing from:\n  - ' + missing.join('\n  - '));
  console.error('\nKeeping it visible is a condition of the license (LICENSE §3, NOTICE).');
  process.exit(1);
}
console.log('Credit check passed.');
