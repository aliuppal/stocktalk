// Public JSON endpoints are cached at the CDN by full URL, so a junk query string
// (/api/news?x=1, ?x=2, ...) would skip the cache and hit Neon or third-party APIs
// on every request. Reject any parameter an endpoint doesn't use before doing work.
// Returns true when the request was rejected (the response has been sent).
export function rejectUnknownParams(req, res, allowed = []) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  for (const key of params.keys()) {
    if (!allowed.includes(key)) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      res.status(400).json({ error: `unknown parameter: ${key.slice(0, 40)}` });
      return true;
    }
  }
  return false;
}
