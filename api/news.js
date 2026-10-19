import { rejectUnknownParams } from '../lib/http.js';
import { getNews } from '../lib/news.js';

// Ranked feed as JSON. Data only changes once a day, so the CDN caches it.
export default async function handler(req, res) {
  if (rejectUnknownParams(req, res)) return;
  try {
    const data = await getNews();
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (err) {
    console.error('news api failed', err);
    res.status(500).json({ error: 'could not load news' });
  }
}
