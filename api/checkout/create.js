function setCORS(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Version');
}

export default async function handler(req, res){
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method_not_allowed' });

  try{
    const { paymentOption='now', amountMinor, description='Order', returnUrl } = req.body || {};
    if (!amountMinor || !Number.isFinite(Number(amountMinor))){
      return res.status(400).json({ ok:false, reason:'amount_minor_required' });
    }
    if (paymentOption === 'meet'){
      return res.status(200).json({ ok:true, next:'thankyou' });
    }

    const shopId = process.env.OVERPAY_SHOP_ID;
    const secret = process.env.OVERPAY_SECRET;
    const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
    if (!shopId || !secret || !base){
      return res.status(500).json({ ok:false, reason:'env_missing' });
    }

    const notificationUrl = `${base}/api/payments/webhook`;
    const finalReturnUrl  = returnUrl || `${base}/return`;

    const auth = 'Basic ' + Buffer.from(`${shopId}:${secret}`).toString('base64');

    // ✅ Hosted payment page: создаём payment token
    const overpayUrl = 'https://checkout.overpay.io/ctp/api/checkouts';
    const body = {
      checkout: {
        transaction_type: 'payment',
        // можно включить виджет в iframe, но для редиректа не обязательно
        iframe: false,
        order: {
          amount: Number(amountMinor),     // сумма в минорных единицах
          currency: 'RUB',                 // ISO-4217 alpha-3 для рубля
          description: description
        },
        // URLы возврата/нотификаций
        success_url: finalReturnUrl,
        decline_url: finalReturnUrl,
        fail_url: finalReturnUrl,
        cancel_url: finalReturnUrl,
        notification_url: notificationUrl,
        // локаль платежной страницы можно передать (ru/en/hy и т.д.)
        settings: { }
      }
    };

    const resp = await fetch(overpayUrl, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-API-Version': '2'
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json().catch(()=> ({}));
    const redirectUrl = data?.checkout?.redirect_url || data?.redirect_url;
    const paymentToken = data?.checkout?.token || data?.token;

    if (!resp.ok || !redirectUrl){
      return res.status(502).json({ ok:false, reason:'overpay_no_redirect', data });
    }
    return res.status(200).json({ ok:true, next:'redirect', redirectUrl, token: paymentToken });
  }catch(e){
    return res.status(500).json({ ok:false, reason:'internal_error', error:String(e) });
  }
}
