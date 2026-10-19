import { timingSafeEqual } from 'node:crypto';
import { runDailyScrape } from '../../lib/scrape.js';

// Runs once a day at 8:45 AM New York time, so fresh news is in place before the
// 9 AM blog routine writes its market summary. Vercel Cron only speaks UTC and
// New York shifts between UTC-4 (EDT) and UTC-5 (EST), so vercel.json fires
// at both 12:45 and 13:45 UTC and the slot that isn't in the 8 AM hour there is
// skipped. (On the Hobby plan Vercel may start a cron anywhere in its hour.)
// Vercel sends `Authorization: Bearer $CRON_SECRET` when that env var is set.
const RUN_HOUR_NY = 8;
const nyHour = (d = new Date()) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(d));

export default async function handler(req, res) {
  // Fail closed: without CRON_SECRET nothing can trigger a scrape (user-agents are spoofable).
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(String(req.headers.authorization ?? ''));
  const want = Buffer.from(`Bearer ${secret ?? ''}`);
  const authorized = Boolean(secret) && got.length === want.length && timingSafeEqual(got, want);
  if (!authorized) return res.status(401).json({ error: 'unauthorized' });

  // Scheduled calls carry ?slot=…; a manual call without it always runs.
  const scheduled = new URL(req.url, 'http://localhost').searchParams.has('slot');
  const hour = nyHour();
  if (scheduled && hour !== RUN_HOUR_NY) {
    return res.status(200).json({ ok: true, skipped: true, reason: `New York hour is ${hour}, runs at ${RUN_HOUR_NY}` });
  }

  try {
    const result = await runDailyScrape();
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('daily scrape failed', err);
    res.status(500).json({ ok: false, error: 'scrape failed' });
  }
}
