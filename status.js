function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const { externalId } = req.query || {};
    if (!externalId) return res.status(400).json({ ok:false, reason:'externalId_required' });
    const shopId = process.env.OVERPAY_SHOP_ID;
    const secret = process.env.OVERPAY_SECRET;
    const auth = 'Basic ' + Buffer.from(`${shopId}:${secret}`).toString('base64');
    const url = `https://checkout.overpay.io/transactions/${encodeURIComponent(String(externalId))}`;
    const resp = await fetch(url, { headers: { 'Authorization': auth } });
    const data = await resp.json().catch(() => ({}));
    const status = data?.response?.status || 'unknown';
    return res.status(200).json({ ok:true, status, raw: data });
  } catch (e) {
    return res.status(500).json({ ok:false, reason:'internal_error', error:String(e) });
  }

}