export type Cue = { start: number; end: number; text: string };

const toSec = (s: string) => {
  const p = s.replace(',', '.').split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->').map((x) => toSec(x.trim().split(/\s+/)[0]));
    const body = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
    if (body && Number.isFinite(a) && Number.isFinite(b)) cues.push({ start: a, end: b, text: body });
  }
  return cues;
}

export const activeCue = (cues: Cue[], t: number) =>
  cues.filter((c) => t >= c.start && t <= c.end).map((c) => c.text).join('\n');
