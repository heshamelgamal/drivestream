// The visible "Developed by Hesham Elgamal" credit is a condition of the DriveStream
// license (LICENSE §3, NOTICE). This checks it is still in place in the website and
// the Android app source, so removing it is a deliberate act and never an accident.
// It can't stop anyone editing the code; the license is what protects the credit.
//
// Used by server.js (a warning at startup) and tools/check-credit.mjs (exit code 1).

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const CREDIT_NAME = 'Hesham Elgamal';

const CHECKS = [
  // [file, text that must be there, what it is]
  ['public/ui.js', `h('strong', {}, '${CREDIT_NAME}')`, 'website credit()'],
  ['public/app.js', 'footer.append(credit())', 'website footer shows credit()'],
  ['public/i18n.js', "'Developed by '", 'website credit text'],
  ['app/src/components/ui.tsx', `>${CREDIT_NAME}</Text>`, 'app <Credit />'],
  ['app/src/app/index.tsx', '<Credit />', 'app home shows <Credit />'],
  ['app/src/app/login.tsx', '<Credit />', 'app sign-in shows <Credit />'],
  ['app/src/lib/i18n.tsx', "'credit.by'", 'app credit text'],
];

export function checkCredit(root) {
  const missing = [];
  for (const [file, needle, what] of CHECKS) {
    let src = null;
    try {
      src = readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue; // e.g. a server-only install without the app/ folder
    }
    if (!src.includes(needle)) missing.push(`${what} (${file})`);
  }
  return missing;
}
