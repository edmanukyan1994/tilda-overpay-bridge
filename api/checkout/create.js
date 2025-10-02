function setCORS(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Version');
}

function normalizePhoneE164(phone) {
  if (!phone) return undefined;
  let digits = String(phone).replace(/\D/g,'');
  if (digits.length === 10) digits = '7' + digits;
  if (digits[0] === '8' && digits.length === 11) digits = '7' + digits.slice(1);
  return '+' + digits;
}

export default async function handler(req, res){
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method_not_allowed' });

  try{
    const {
      amountMinor,
      description = 'Order',
      customer = {},
      shipping = {},
      locale = 'ru'
    } = req.body || {};

    if (!amountMinor || Number.isNaN(Number(amountMinor))){
      return res.status(400).json({ ok:false, reason:'amount_minor_required' });
    }

    const shopId = process.env.OVERPAY_SHOP_ID;
    const secret = process.env.OVERPAY_SECRET;
    const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
    if (!shopId || !secret || !base){
      return res.status(500).json({ ok:false, reason:'env_missing' });
    }

    // ✅ Твои страницы возврата
    const successUrl = "https://agressor-crew.ru/pay_success";
    const failUrl    = "https://agressor-crew.ru/pay_fail";
    const cancelUrl  = "https://agressor-crew.ru/pay_cancel";
    const notificationUrl = `${base}/api/payments/webhook`;

    const auth = 'Basic ' + Buffer.from(`${shopId}:${secret}`).toString('base64');

    const overpayUrl = 'https://checkout.overpay.io/ctp/api/checkouts';

    // ⚙️ Префилл покупателя
    const first_name = (customer.first_name || '').trim() || undefined;
    const last_name  = (customer.last_name  || '').trim() || undefined;
    const email      = (customer.email      || '').trim() || undefined;
    const phone      = normalizePhoneE164(customer.phone);

    const body = {
      checkout: {
        transaction_type: 'payment',
        iframe: false,
        order: {
          amount: Number(amountMinor),
          currency: 'RUB',
          description
        },
        customer: { first_name, last_name, email, phone },
        shipping: {
          city: (shipping.city || '').trim() || undefined,
          address: (shipping.address || '').trim() || undefined
        },
        // ⚡ Обязательно добавляем return_url для APM (SBP и др.)
        return_url: successUrl,
        success_url: successUrl,
        decline_url: failUrl,
        fail_url: failUrl,
        cancel_url: cancelUrl,
        notification_url: notificationUrl,
        settings: { locale }
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
