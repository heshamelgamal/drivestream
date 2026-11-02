// Sign in a TV (or any device) with a short code, like Netflix / YouTube on TV.
//
// 1. The device asks for a code: it gets a short code to show (and as a QR) plus a
//    secret only it knows.
// 2. Someone already signed in enters the code on the website or phone app (or scans
//    the QR, which opens the website's link page) and approves it.
// 3. The device keeps polling with its secret; once approved it gets its own session
//    for the approving profile. Codes last 10 minutes and work once.

import { randomBytes, randomInt } from 'node:crypto';

const TTL_MS = 10 * 60_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I look-alikes

export function createDeviceLogin() {
  const byCode = new Map(); // code -> request
  const bySecret = new Map(); // secret -> request

  const sweep = () => {
    const now = Date.now();
    for (const [code, r] of byCode) if (r.expires < now) { byCode.delete(code); bySecret.delete(r.secret); }
  };
  setInterval(sweep, 60_000).unref();

  const normalise = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  return {
    start(device = '') {
      sweep();
      let code;
      do code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
      while (byCode.has(code));
      const r = { code, secret: randomBytes(24).toString('base64url'), device: String(device).slice(0, 60), expires: Date.now() + TTL_MS, userId: null };
      byCode.set(code, r);
      bySecret.set(r.secret, r);
      return { code, secret: r.secret, expiresIn: TTL_MS / 1000 };
    },
    // What the approver sees before confirming.
    lookup(code) {
      const r = byCode.get(normalise(code));
      return r && r.expires > Date.now() && !r.userId ? { device: r.device || 'a TV' } : null;
    },
    approve(code, userId) {
      const r = byCode.get(normalise(code));
      if (!r || r.expires < Date.now() || r.userId) return false;
      r.userId = userId;
      return true;
    },
    // The device's poll: 'pending', 'expired', or the approving profile's id (once).
    poll(secret) {
      const r = bySecret.get(String(secret || ''));
      if (!r || r.expires < Date.now()) return { status: 'expired' };
      if (!r.userId) return { status: 'pending' };
      byCode.delete(r.code);
      bySecret.delete(r.secret);
      return { status: 'approved', userId: r.userId };
    },
  };
}

// "K7P2QX" → "K7P-2QX" for display.
export const prettyCode = (code) => `${code.slice(0, 3)}-${code.slice(3)}`;
