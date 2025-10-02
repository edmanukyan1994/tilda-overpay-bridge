function setCORS(res){
  res.setHeader('Access-Control-Allow-Origin', '*'); // при желании сузьте до домена
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Version');
}

function normalizePhoneE164(phone) {
  if (!phone) return undefined;
  let d = String(phone).replace(/\D/g,'');
  if (d.length === 10) d = '7' + d;                   // 10 цифр -> +7
  if (d[0] === '8' && d.length === 11) d = '7' + d.slice(1);
  return '+' + d;
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
      locale = 'ru',
      metadata = {}
    } = req.body || {};

    // 1) Валидация суммы
    const amt = Number(amountMinor);
    if (!Number.isFinite(amt) || amt <= 0){
      return res.status(400).json({ ok:false, reason:'amount_minor_required' });
    }

    // 2) Переменные окружения
    const shopId = process.env.OVERPAY_SHOP_ID;
    const secret = process.env.OVERPAY_SECRET;
    const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
    if (!shopId || !secret || !base){
      return res.status(500).json({
        ok:false,
        reason:'env_missing',
        details: { hasShopId: !!shopId, hasSecret: !!secret, hasBase: !!base }
      });
    }

    // 3) URL'ы возврата/вебхука
    const successUrl = "https://agressor-crew.ru/pay_success";
    const failUrl    = "https://agressor-crew.ru/pay_fail";
    const cancelUrl  = "https://agressor-crew.ru/pay_cancel";
    const notificationUrl = `${base}/api/payments/webhook`;

    // 4) Тело запроса в Overpay
    const first_name = (customer.first_name || '').trim() || undefined;
    const last_name  = (customer.last_name  || '').trim() || undefined;
    const email      = (customer.email      || '').trim() || undefined;
    const phone      = normalizePhoneE164(customer.phone);

    const body = {
      checkout: {
        transaction_type: 'payment',
        iframe: false,
        order: {
          amount: amt,                  // минорные единицы
          currency: 'RUB',
          description: `${description}${metadata.order_ref ? ` [${metadata.order_ref}]` : ''}`
        },
        customer: { first_name, last_name, email, phone },
        shipping: {
          city: (shipping.city || '').trim() || undefined,
          address: (shipping.address || '').trim() || undefined
        },
        metadata,                       // ← связь заказ↔платёж (order_ref и др.)
        success_url: successUrl,
        decline_url: failUrl,
        fail_url: failUrl,
        cancel_url: cancelUrl,
        notification_url: notificationUrl,
        settings: { locale }
      }
    };

    // 5) Запрос в Overpay
    const auth = 'Basic ' + Buffer.from(`${shopId}:${secret}`).toString('base64');
    const overpayUrl = 'https://checkout.overpay.io/ctp/api/checkouts';

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

    // читаем как текст (чтобы при ошибке видеть оригинал), затем пробуем JSON
    const text = await resp.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

    const redirectUrl = data?.checkout?.redirect_url || data?.redirect_url;
    const paymentToken = data?.checkout?.token || data?.token;

    if (!resp.ok || !redirectUrl){
      return res.status(502).json({
        ok:false,
        reason:'overpay_error',
        httpStatus: resp.status,
        data
      });
    }

    return res.status(200).json({
      ok: true,
      next: 'redirect',
      redirectUrl,
      token: paymentToken,
      orderRef: metadata.order_ref || null
    });

  }catch(e){
    return res.status(500).json({ ok:false, reason:'internal_error', error:String(e) });
  }
}
