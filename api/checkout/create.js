// /api/checkout/create.js

function setCORS(res){
  res.setHeader('Access-Control-Allow-Origin', '*'); // при желании сузьте до своего домена
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Version');
}

function normalizeBase(urlLike){
  const raw = (urlLike || '').trim();
  if (!raw) return 'https://checkout.overpay.io';
  let base = raw.replace(/\/+$/,'');               // убираем хвостовые /
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base; // если вдруг без схемы — добавим
  return base;                                     // напр. https://checkout.overpay.io
}

function normalizePhoneE164(phone) {
  if (!phone) return undefined;
  let d = String(phone).replace(/\D/g,'');
  if (d.length === 10) d = '7' + d;             // 10 цифр -> +7XXXXXXXXXX
  if (d[0] === '8' && d.length === 11) d = '7' + d.slice(1);
  return '+' + d;
}

export default async function handler(req, res){
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method_not_allowed' });

  try{
    const {
      order_ref = '',
      amountMinor,
      amountMajor,
      description = 'Order',
      customer = {},                 // { first_name, last_name, email, phone }
      locale = 'ru'
    } = req.body || {};

    // Сумма: приоритет у amountMinor (копейки). Если нет — берём amountMajor (рубли) и умножаем на 100
    const amt = Number.isFinite(Number(amountMinor))
      ? Number(amountMinor)
      : Math.round(Number(amountMajor) * 100);

    if (!Number.isFinite(amt) || amt <= 0){
      return res.status(400).json({ ok:false, reason:'amount_required' });
    }

    const shopId  = (process.env.OVERPAY_SHOP_ID   || '').trim();
    const secret  = (process.env.OVERPAY_SECRET    || '').trim();
    const appBase = (process.env.APP_BASE_URL      || '').trim().replace(/\/$/, '');
    const apiBase = normalizeBase(process.env.OVERPAY_API_BASE || 'https://checkout.overpay.io');

    if (!shopId || !secret || !appBase){
      return res.status(500).json({
        ok:false, reason:'env_missing',
        details:{ hasShopId:!!shopId, hasSecret:!!secret, hasAppBase:!!appBase }
      });
    }

    // Конечная точка Overpay
    const overpayUrl = `${apiBase}/ctp/api/checkouts`;

    // Страницы возврата на вашем сайте (Lovable)
    const successUrl = "https://agressor-crew.com/pay_success";
    const failUrl    = "https://agressor-crew.com/pay_fail";
    const cancelUrl  = "https://agressor-crew.com/pay_cancel";
    const declineUrl = failUrl;

    // Webhook: приклеим order_ref, чтобы связать платёж с заказом без БД
    const notificationUrl = `${appBase}/api/payments/webhook${order_ref ? `?order_ref=${encodeURIComponent(order_ref)}` : ''}`;

    // Данные покупателя (префилл на стороне Overpay)
    const first_name = (customer.first_name || '').trim() || undefined;
    const last_name  = (customer.last_name  || '').trim() || undefined;
    const email      = (customer.email      || '').trim() || undefined;
    const phone      = normalizePhoneE164(customer.phone);

    // Тело запроса: redirect-URL строго внутри settings (требование Overpay)
    const body = {
      checkout: {
        transaction_type: 'payment',
        iframe: false,
        order: {
          amount: amt,               // МИНОРНЫЕ единицы (копейки)
          currency: 'RUB',
          description
        },
        customer: { first_name, last_name, email, phone },
        settings: {
          success_url:     successUrl,
          fail_url:        failUrl,
          cancel_url:      cancelUrl,
          decline_url:     declineUrl,
          notification_url: notificationUrl,
          locale: (locale || 'ru').toLowerCase()
        }
      }
    };

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
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw:text }; }

    const redirectUrl  = data?.checkout?.redirect_url || data?.redirect_url;
    const paymentToken = data?.checkout?.token        || data?.token;

    if (!resp.ok || !redirectUrl){
      return res.status(502).json({
        ok:false, reason:'overpay_no_redirect',
        httpStatus: resp.status, data
      });
    }

    return res.status(200).json({ ok:true, next:'redirect', redirectUrl, token: paymentToken, order_ref });
  }catch(e){
    console.error('[CREATE_ERROR]', e);
    return res.status(500).json({ ok:false, reason:'internal_error', error:String(e) });
  }
}
