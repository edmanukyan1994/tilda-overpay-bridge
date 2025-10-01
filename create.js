function setCORS(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
export default async function handler(req, res){
  setCORS(res);
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({ ok:false, reason:'method_not_allowed' });
  try{
    const { paymentOption='now', amountMinor, description='Order', returnUrl } = req.body||{};
    if(!amountMinor || !Number.isFinite(Number(amountMinor))){
      return res.status(400).json({ ok:false, reason:'amount_minor_required' });
    }
    if(paymentOption==='meet'){ return res.status(200).json({ ok:true, next:'thankyou' }); }

    const shopId = process.env.OVERPAY_SHOP_ID;
    const secret = process.env.OVERPAY_SECRET;
    const base = (process.env.APP_BASE_URL||'').replace(/\/$/, '');
    if(!shopId || !secret || !base){
      return res.status(500).json({ ok:false, reason:'env_missing' });
    }

    const notificationUrl = `${base}/api/payments/webhook`;
    const finalReturnUrl  = returnUrl || `${base}/return.html`;
    const auth = 'Basic ' + Buffer.from(`${shopId}:${secret}`).toString('base64');

    const overpayUrl = 'https://gateway.overpay.io/transactions/payments';
    const body = {
      request: {
        amount: Number(amountMinor),
        currency: 'RUB',
        description,
        return_url: finalReturnUrl,
        notification_url: notificationUrl,
        test: false
      }
    };

    const resp = await fetch(overpayUrl, {
      method:'POST',
      headers:{ 'Authorization':auth, 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(()=> ({}));
    const redirectUrl = data?.response?.redirect_url;
    const externalId  = data?.response?.uid || data?.response?.token;

    if(!redirectUrl){ return res.status(502).json({ ok:false, reason:'overpay_no_redirect', data }); }
    return res.status(200).json({ ok:true, next:'redirect', redirectUrl, externalId });
  }catch(e){
    return res.status(500).json({ ok:false, reason:'internal_error', error:String(e) });
  }
}
