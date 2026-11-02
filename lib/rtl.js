// Repairs right-to-left (Arabic, Persian, Hebrew) subtitle lines that were
// "pre-flipped" for players without bidi support.
//
// Many downloaded .srt files move each line's closing punctuation to the front
// and mirror brackets, e.g. "،الحيوان الذي يقع في الفخ" or ".(ـ (دانكن", so that
// it lands on the left in players that lay text out left-to-right. Players that
// lay Arabic out correctly then show it on the wrong side. We undo that: leading
// punctuation goes back to the end, its order reversed and brackets un-mirrored.
// Lines that already end with punctuation are left alone, so correctly written
// files pass through unchanged.

const RTL_CHAR = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g;
const PUNCT = '.,،؛;:!?؟…"\'«»()[]{}';
const isPunct = (c) => PUNCT.includes(c);
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '«': '»', '»': '«' };

export function fixRtlLine(line) {
  if (!RTL_CHAR.test(line)) return line;
  const plain = line.replace(BIDI_MARKS, '');
  // Keep formatting tags (<i>, {\an8} …) where they are; only look at the text between them.
  const lead = plain.match(/^(?:\s|<[^>]*>|\{[^}]*\})*/)[0];
  const trail = plain.slice(lead.length).match(/(?:\s|<[^>]*>|\{[^}]*\})*$/)[0];
  const body = plain.slice(lead.length, plain.length - trail.length);

  let n = 0;
  while (n < body.length && (isPunct(body[n]) || body[n] === ' ')) n++;
  const moved = body.slice(0, n).trim();
  const rest = body.slice(n);
  const endsWithPunct = rest.length > 0 && isPunct(rest[rest.length - 1]);
  if (!moved || !rest || endsWithPunct) return `‫${plain}‬`;

  const restored = [...moved].reverse().map((c) => MIRROR[c] || c).join('');
  return `‫${lead}${rest}${restored}${trail}‬`;
}

// Applies fixRtlLine to the text lines of a WebVTT document (cue timings, numbers and headers are untouched).
export function fixRtlVtt(vtt) {
  return vtt
    .split('\n')
    .map((l) => (l.includes('-->') ? l : fixRtlLine(l)))
    .join('\n');
}
