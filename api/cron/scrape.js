import { timingSafeEqual } from 'node:crypto';
import { runDailyScrape } from '../../lib/scrape.js';
import { sql } from '../../lib/db.js';

// Two scrapes a day, on New York time:
//   morning  ~8:45 AM  (before the 9 AM note)
//   evening  ~5:00 PM  (after the close)
// Vercel Cron only speaks UTC and New York moves between UTC-4 (EDT) and UTC-5 (EST),
// so vercel.json fires each slot twice, one hour apart:
//   morning: 12:45 and 13:45 UTC     evening: 21:15 and 22:15 UTC
// A scheduled call runs only inside its New York window (below) and only if no scrape
// ran in the last few hours, so exactly one of each pair runs. The windows are wide
// because on the Hobby plan Vercel can start a cron up to about an hour late.
// Vercel sends `Authorization: Bearer $CRON_SECRET` when that env var is set.
const SLOTS = {
  morning: { from: 8 * 60 + 30, to: 12 * 60 },   // 8:30 AM – noon New York
  evening: { from: 17 * 60, to: 23 * 60 },       // 5:00 PM – 11 PM New York
};
const MIN_GAP_HOURS = 4;

function nyMinutes(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}
const hhmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

async function hoursSinceLastRun() {
  try {
    const [row] = await sql()`select ran_at from scrape_runs order by ran_at desc limit 1`;
    return row ? (Date.now() - new Date(row.ran_at).getTime()) / 3600e3 : Infinity;
  } catch {
    return Infinity;   // table missing on a fresh database: runDailyScrape creates it
  }
}

export default async function handler(req, res) {
  // Fail closed: without CRON_SECRET nothing can trigger a scrape (user-agents are spoofable).
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(String(req.headers.authorization ?? ''));
  const want = Buffer.from(`Bearer ${secret ?? ''}`);
  const authorized = Boolean(secret) && got.length === want.length && timingSafeEqual(got, want);
  if (!authorized) return res.status(401).json({ error: 'unauthorized' });

  // Scheduled calls carry ?slot=morning|evening; a manual call without it always runs.
  const slot = new URL(req.url, 'http://localhost').searchParams.get('slot');
  if (slot) {
    const win = SLOTS[slot];
    if (!win) return res.status(400).json({ error: `unknown slot: ${slot.slice(0, 20)}` });
    const now = nyMinutes();
    if (now < win.from || now >= win.to) {
      return res.status(200).json({ ok: true, skipped: true, reason: `New York time ${hhmm(now)} is outside the ${slot} window (${hhmm(win.from)}–${hhmm(win.to)})` });
    }
    const gap = await hoursSinceLastRun();
    if (gap < MIN_GAP_HOURS) {
      return res.status(200).json({ ok: true, skipped: true, reason: `last scrape ${gap.toFixed(1)}h ago (< ${MIN_GAP_HOURS}h)` });
    }
  }

  try {
    const result = await runDailyScrape();
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('daily scrape failed', err);
    res.status(500).json({ ok: false, error: 'scrape failed' });
  }
}
