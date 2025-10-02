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
      // metadata и shipping Overpay HPP не требуют — не шлём их, чтобы не ловить валидацию
    } = req.body || {};

    const amt = Number(amountMinor);
    if (!Number.isFinite(amt) || amt <= 0){
      return res.status(400).json({ ok:false, reason:'amount_minor_required' });
    }

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

    // Ваши страницы возврата
    const successUrl = "https://agressor-crew.ru/pay_success";
    const failUrl    = "https://agressor-crew.ru/pay_fail";
    const cancelUrl  = "https://agressor-crew.ru/pay_cancel";

    // Webhook — остаётся верхним полем checkout
    const notificationUrl = `${base}/api/payments/webhook`;

    // Формируем тело в нужной схеме: редиректы — ВНУТРИ settings
    const first_name = (customer.first_name || '').trim() || undefined;
    const last_name  = (customer.last_name  || '').trim() || undefined;
    const email      = (customer.email      || '').trim() || undefined;
    const phone      = normalizePhoneE164(customer.phone);

    const body = {
      checkout: {
        transaction_type: 'payment',
        iframe: false,
        order: {
          amount: amt,
          currency: 'RUB',
          description
        },
        customer: { first_name, last_name, email, phone },
        notification_url: notificationUrl,
        settings: {
          locale,
          success_url: successUrl,
          fail_url: failUrl,
          cancel_url: cancelUrl
          // при необходимости Overpay может требовать return_url — тогда добавим сюда:
          // return_url: successUrl
        }
      }
    };

    const apiBase = process.env.OVERPAY_API_BASE || 'https://checkout.overpay.io';
    const overpayUrl = `${apiBase}/ctp/api/checkouts`;
    const auth = 'Basic ' + Buffer.from(`${shopId}:${secret}`).toString('base64');

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
      token: paymentToken
    });

  }catch(e){
    return res.status(500).json({ ok:false, reason:'internal_error', error:String(e) });
  }
}
