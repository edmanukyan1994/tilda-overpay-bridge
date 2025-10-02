// /api/payments/webhook.js
import crypto from 'crypto';

function setCORS(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function signTilda(payload, secret){
  // исключаем signature и пустые значения
  const entries = Object.entries(payload)
    .filter(([k,v]) => k !== 'signature' && v !== undefined && v !== null && String(v) !== '');
  // сортировка по алфавиту ключей
  entries.sort(([a],[b]) => a.localeCompare(b));
  // склейка значений без разделителя
  const data = entries.map(([,v]) => String(v)).join('');
  // HMAC-SHA256 (секрет как ключ) → HEX UPPER
  return crypto.createHmac('sha256', secret).update(data).digest('hex').toUpperCase();
}

export default async function handler(req, res){
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method_not_allowed' });

  const TILDA_LOGIN      = process.env.TILDA_LOGIN;      // из «универсальной платёжки»
  const TILDA_SECRET     = process.env.TILDA_SECRET;     // «Секрет для подписи заказа»
  const TILDA_NOTIFY_URL = process.env.TILDA_NOTIFY_URL; // https://forms.tildacdn.com/payment/custom/psXXXX
  if (!TILDA_LOGIN || !TILDA_SECRET || !TILDA_NOTIFY_URL){
    return res.status(500).json({ ok:false, reason:'tilda_env_missing' });
  }

  try{
    // 1) что прислал Overpay
    const op = req.body || {};

    // 2) достаём order_ref из query (?order_ref=...), мы приклеили его в create.js
    const order_ref = (req.query && req.query.order_ref) ? String(req.query.order_ref) : '';

    // 3) маппинг статуса Overpay → статус для Тильды
    const raw = (op?.status || op?.checkout?.status || op?.transaction?.status || '').toString().toLowerCase();
    let status = raw;
    if (raw === 'succeeded' || raw === 'success' || raw === 'paid') status = 'succeeded';
    if (raw === 'failed' || raw === 'declined') status = 'failed';
    if (raw === 'canceled' || raw === 'cancelled') status = 'canceled';

    // 4) сумма в МАЖОРНЫХ (RUB): если получили в минорных — делим на 100
    let amountMajor = '';
    if (typeof op?.order?.amount === 'number') {
      amountMajor = (op.order.amount / 100).toFixed(2);
    } else if (op?.order?.amount_major) {
      amountMajor = String(op.order.amount_major);
    }

    // 5) собираем payload для Тильды (минимально достаточно)
    const payload = {
      login: TILDA_LOGIN,
      orderid: order_ref,                                       // в «универсалке»: Номер заказа → order_ref
      amount: amountMajor || '',
      currency: op?.order?.currency || 'RUB',
      status,                                                   // «Признак успешного платежа» = status=succeeded
      transaction_id: op?.id || op?.checkout?.token || op?.transaction?.uid || '',
      description: op?.order?.description || '',
      email: op?.customer?.email || '',
      phone: op?.customer?.phone || '',
      name: [op?.customer?.first_name, op?.customer?.last_name].filter(Boolean).join(' ') || '',
      created_at: op?.created_at || new Date().toISOString()
    };

    // 6) подпись по правилам Тильды
    payload.signature = signTilda(payload, TILDA_SECRET);

    // 7) отправляем уведомление в Тильду
    const formBody = new URLSearchParams(payload).toString();
    const r = await fetch(TILDA_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody
    });
    const text = await r.text();

    // 8) успех, если Тильда ответила 200 и содержит OK (или пусто)
    const ok = r.ok && (text.trim().toUpperCase().includes('OK') || text.trim()==='');
    console.log('[TILDA_NOTIFY]', r.status, text.slice(0,200));

    return res.status(200).json({ ok, forwarded:r.status, tilda:text.slice(0,400) });
  }catch(e){
    console.error('[WEBHOOK_ERROR]', e);
    return res.status(500).json({ ok:false, reason:'internal_error', error:String(e) });
  }
}
