// Run the daily scrape locally: `npm run scrape` (reads DATABASE_URL from .env).
import { runDailyScrape } from '../lib/scrape.js';

const result = await runDailyScrape();
console.log(`fetched ${result.fetched}, new ${result.inserted}, ranked ${result.ranked}`);
console.table(result.sources);
console.log('trending:', result.trending.map((t) => `${t.topic} (${t.outlets})`).join(', '));
