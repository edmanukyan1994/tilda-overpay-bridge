// /api/apiship/_authcheck.js
function setCORS(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
export default async function handler(req, res){
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const BASE  = (process.env.APISHIP_BASE || 'https://api.apiship.ru/v1').replace(/\/+$/,'');
  const TOKEN = process.env.APISHIP_TOKEN || '';

  const url = `${BASE}/lists/tariffs?limit=1`;
  try{
    const r = await fetch(url, { headers: { 'Authorization': TOKEN }});
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }

    return res.status(200).json({
      ok: r.ok,
      status: r.status,
      url,
      token_len: TOKEN.length,
      body
    });
  }catch(e){
    return res.status(500).json({ ok:false, error:String(e), url, token_len:TOKEN.length });
  }
}
