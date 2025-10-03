// /api/payments/webhook.js
import crypto from 'crypto';

function setCORS(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function mapStatus(raw){
  const s = String(raw || '').toLowerCase();
  if (['succeeded','success','paid','captured'].includes(s)) return 'succeeded';
  if (['failed','declined','error'].includes(s))             return 'failed';
  if (['canceled','cancelled'].includes(s))                  return 'canceled';
  return s || 'unknown';
}

function toAmountMajor(op){
  // Overpay присылает сумму чаще всего в МИНОРНЫХ (копейки)
  const minor = (op?.order && typeof op.order.amount === 'number') ? op.order.amount : null;
  if (typeof minor === 'number') return (minor/100).toFixed(2); // "1234.56"
  if (op?.order?.amount_major)   return String(op.order.amount_major);
  return '';
}

function signLovable(payload, secret){
  // HMAC-SHA256(JSON.stringify(payload)) → hex
  const json = JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(json).digest('hex');
}

export default async function handler(req, res){
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok:false, reason:'method_not_allowed' });

  try{
    const op = req.body || {};

    // order_ref прокидываем из query (мы добавляем его в create.js),
    // а также пытаемся найти в теле/metadata/description
    const order_ref =
      req.query?.order_ref ||
      req.body?.order_ref  ||
      op?.order_ref        ||
      op?.metadata?.order_ref ||
      (op?.order?.description?.match(/[A-Z]{2,}-[\w-]+/)?.[0]) ||
      '';

    const status      = mapStatus(op?.status || op?.checkout?.status || op?.transaction?.status);
    const amountMajor = toAmountMajor(op);
    const currency    = op?.order?.currency || 'RUB';
    const txid        = op?.id || op?.checkout?.token || op?.transaction?.uid || '';
    const description = op?.order?.description || '';
    const customer = {
      email: op?.customer?.email || '',
      phone: op?.customer?.phone || '',
      name:  [op?.customer?.first_name, op?.customer?.last_name].filter(Boolean).join(' ') || ''
    };
    const created_at  = op?.created_at || new Date().toISOString();

    // === Lovable webhook ===
    const LOVABLE_WEBHOOK_URL    = process.env.LOVABLE_WEBHOOK_URL;    // <- ЗАДАЙ В Vercel
    const LOVABLE_WEBHOOK_SECRET = process.env.LOVABLE_WEBHOOK_SECRET; // <- опционально

    if (!LOVABLE_WEBHOOK_URL){
      // нет куда слать — просто вернём, что получили, чтобы увидеть в логах
      return res.status(200).json({
        ok: true,
        note: 'LOVABLE_WEBHOOK_URL is not set; nothing forwarded',
        received: { order_ref, status, amountMajor, currency, txid, description, customer, created_at }
      });
    }

    const lovablePayload = {
      order_ref,              // ключ для связи заказа и платежа в Lovable
      status,                 // succeeded | failed | canceled | unknown
      amount: amountMajor,    // строка, рубли с копейками, напр. "2863.68"
      currency,               // "RUB"
      transaction_id: txid,
      description,
      customer,
      created_at,
      provider: 'overpay'
    };

    const headers = { 'Content-Type':'application/json' };
    if (LOVABLE_WEBHOOK_SECRET){
      headers['X-Signature'] = signLovable(lovablePayload, LOVABLE_WEBHOOK_SECRET);
    }

    const f = await fetch(LOVABLE_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(lovablePayload)
    });
    const text = await f.text().catch(()=>'');

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
