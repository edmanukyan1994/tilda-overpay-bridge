// api/apiship/_authcheck.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const base = process.env.APISHIP_BASE?.replace(/\/+$/, '') || 'https://api.apiship.ru';
    const token = (process.env.APISHIP_TOKEN || '').trim();
    if (!token) return res.status(500).json({ ok:false, reason:'no_token' });

    const url = `${base}/tariffs?limit=1`;
    const r = await fetch(url, { headers: { 'Authorization': token, 'Accept': 'application/json' }});
    const text = await r.text();
    return res.status(200).json({ ok: r.ok, status: r.status, url, token_len: token.length, body: safeJSON(text) });

    function safeJSON(t){ try{ return JSON.parse(t); }catch{ return t; } }
  } catch (e) {
    return res.status(500).json({ ok:false, reason:'authcheck_fail', error: String(e) });
  }
}
