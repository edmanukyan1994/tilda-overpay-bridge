// /api/payments/webhook.js
// Принимает вебхук от Overpay и пересылает статус оплаты в Lovable (Supabase function)
// Требуемые ENV на Vercel:
//   LOVABLE_WEBHOOK_URL     = https://pchnryesscotcwwpozgw.supabase.co/functions/v1/payment-webhook
//   LOVABLE_WEBHOOK_SECRET  = lovable_secret_key

import crypto from 'crypto';

function setCORS(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function mapStatus(raw){
  const s = String(raw || '').toLowerCase();
  if (['succeeded','success','paid','captured','authorized','authorized_and_captured'].includes(s)) return 'succeeded';
  if (['failed','declined','error'].includes(s))                                                    return 'failed';
  if (['canceled','cancelled'].includes(s))                                                         return 'canceled';
  return s || 'unknown';
}

function toAmountMajor(overpayBody){
  // Overpay обычно шлёт order.amount в МИНОРНЫХ (копейки)
  const minor = (overpayBody?.order && typeof overpayBody.order.amount === 'number') ? overpayBody.order.amount : null;
  if (typeof minor === 'number') return (minor / 100).toFixed(2); // "1234.56"
  if (overpayBody?.order?.amount_major != null) return String(overpayBody.order.amount_major);
  // иногда присылают amount/amount_minor на верхнем уровне:
  if (typeof overpayBody?.amount === 'number')       return (overpayBody.amount / 100).toFixed(2);
  if (typeof overpayBody?.amount_minor === 'number') return (overpayBody.amount_minor / 100).toFixed(2);
  return '';
}

function pickOrderRef(op, req){
  return (
    req?.query?.order_ref ||
    req?.body?.order_ref  ||
    op?.order_ref         ||
    op?.metadata?.order_ref ||
    // попробуем вытащить из description что-то вроде AGC-... или любой UPPER-XXX шаблон
    (op?.order?.description?.match(/[A-Z]{2,}[A-Z0-9_-]*/)?.[0]) ||
    ''
  );
}

function hmacSignatureHex(payload, secret){
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

export default async function handler(req, res){
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok:false, reason:'method_not_allowed' });

  try{
    const op = req.body || {};

    // 1) Извлекаем ключевые данные из вебхука Overpay
    const order_ref   = pickOrderRef(op, req);
    const status      = mapStatus(op?.status || op?.checkout?.status || op?.transaction?.status);
    const amountMajor = toAmountMajor(op);
    const currency    = op?.order?.currency || op?.currency || 'RUB';
    const txid        = op?.id || op?.checkout?.token || op?.transaction?.uid || op?.payment_id || '';
    const description = op?.order?.description || op?.description || '';
    const customer = {
      email: op?.customer?.email || op?.email || '',
      phone: op?.customer?.phone || op?.phone || '',
      name:  [op?.customer?.first_name, op?.customer?.last_name].filter(Boolean).join(' ') ||
             op?.customer?.name || op?.name || ''
    };
    const created_at  = op?.created_at || new Date().toISOString();
    const provider    = 'overpay';

    // 2) Куда пересылать: Lovable webhook (Supabase Edge Function)
    const LOVABLE_WEBHOOK_URL    = process.env.LOVABLE_WEBHOOK_URL;
    const LOVABLE_WEBHOOK_SECRET = process.env.LOVABLE_WEBHOOK_SECRET;

    if (!LOVABLE_WEBHOOK_URL){
      // Нет URL — просто вернём входные данные для отладки
      return res.status(200).json({
        ok: true,
        note: 'LOVABLE_WEBHOOK_URL is not set; nothing forwarded',
        received: { order_ref, status, amountMajor, currency, txid, description, customer, created_at, provider }
      });
    }

    // 3) Готовим payload для Lovable
    const lovablePayload = {
      order_ref,              // по нему Lovable свяжет платёж с заказом
      status,                 // succeeded | failed | canceled | unknown
      amount: amountMajor,    // строка, рубли с копейками, напр. "2863.68"
      currency,               // "RUB"
      transaction_id: txid,
      description,
      customer,
      created_at,
      provider
    };

    // 4) Формируем подпись (если секрет задан)
    const headers = { 'Content-Type': 'application/json' };
    if (LOVABLE_WEBHOOK_SECRET){
      headers['X-Signature'] = hmacSignatureHex(lovablePayload, LOVABLE_WEBHOOK_SECRET);
    }

    // 5) Отправляем в Lovable
    const f = await fetch(LOVABLE_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(lovablePayload)
    });
    const text = await f.text().catch(()=>'');

    // 6) Отдаём сводку
    return res.status(200).json({
      ok: f.ok,
      forwarded: { status: f.status, body: text.slice(0,400) },
      sent: lovablePayload
    });
  }catch(e){
    console.error('[WEBHOOK_ERROR]', e);
    return res.status(500).json({ ok:false, reason:'internal_error', error:String(e) });
  }
}
