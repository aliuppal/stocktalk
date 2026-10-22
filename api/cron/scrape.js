import { timingSafeEqual } from 'node:crypto';
import { runDailyScrape } from '../../lib/scrape.js';
import { sql } from '../../lib/db.js';

// Scrapes twice a day (vercel.json):
//   12:00 UTC = 8 AM New York in summer (EDT), 7 AM in winter (EST): fresh news before the 9 AM note
//   20:00 UTC = 4 PM / 3 PM New York: the afternoon's stories
// On the Hobby plan Vercel can start a cron up to about an hour after its scheduled time,
// so there is deliberately no exact-hour check (that check made every run skip). Even a
// late 12:00 run lands before 9 AM New York. A scheduled call only skips when a scrape
// already ran in the last few hours (retries / duplicate fires).
// Vercel sends `Authorization: Bearer $CRON_SECRET` when that env var is set.
const MIN_GAP_HOURS = 4;

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

  // Scheduled calls carry ?slot=…; a manual call without it always runs.
  const scheduled = new URL(req.url, 'http://localhost').searchParams.has('slot');
  if (scheduled) {
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
