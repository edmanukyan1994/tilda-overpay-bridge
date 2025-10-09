// /api/apiship/calc.js
// Vercel Serverless Function — расчёт доставки через ApiShip
// v2.1 (flat payload + GET /ping for version check)

const HANDLER_VERSION = 'calc-v2.1';

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const APISHIP_BASE = process.env.APISHIP_BASE || 'https://api.apiship.ru'; // без /v1

export default async function handler(req, res) {
  setCORS(res);

  // Быстрый "пинг", чтобы глазами убедиться, что задеплоена новая версия
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, version: HANDLER_VERSION });
  }

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    // ENV
    const token = process.env.APISHIP_TOKEN;            // напр. 3613dd9...
    const senderId = process.env.APISHIP_SENDER_ID;     // 2679
    const senderGuid = process.env.APISHIP_SENDER_GUID; // 5f29...9d5f

    if (!token || !senderId || !senderGuid) {
      return res.status(500).json({
        ok: false,
        reason: 'env_missing',
        need: ['APISHIP_TOKEN', 'APISHIP_SENDER_ID', 'APISHIP_SENDER_GUID']
      });
    }

    // Входные поля
    const {
      toGuid,                  // GUID города получателя (предпочтительно)
      toCity,                  // название города (если нет GUID)
      toAddress,               // улица/дом (опционально)
      weightKg,                // вес в кг (напр. 0.8)
      lengthCm, widthCm, heightCm, // габариты в см (опц.)
      declaredValue,           // объявленная ценность, ₽ (число)
      providerKeys,            // массив строк, напр. ["cdek","boxberry","dpd"]
      pickup = true,           // забор у отправителя (true)
      delivery = true          // доставка до получателя (true)
    } = req.body || {};

    if (!toGuid && !toCity) {
      return res.status(400).json({ ok: false, reason: 'dest_required' });
    }
    if (!weightKg || Number(weightKg) <= 0) {
      return res.status(400).json({ ok: false, reason: 'weight_required' });
    }

    // ApiShip ждёт вес в ГРАММАХ
    const weightG = Math.round(Number(weightKg) * 1000);

    // 1 — до двери, 2 — до ПВЗ
    const pickupTypes   = pickup   ? [1, 2] : [];
    const deliveryTypes = delivery ? [1, 2] : [];

    // ✅ ПЛОСКАЯ схема калькулятора (НЕ packages/ options)
    const payload = {
      weight: weightG,
      width:  widthCm  != null ? Number(widthCm)  : undefined,
      height: heightCm != null ? Number(heightCm) : undefined,
      length: lengthCm != null ? Number(lengthCm) : undefined,
      assessedCost: declaredValue != null ? Number(declaredValue) : undefined,

      pickupTypes,
      deliveryTypes,

      from: {
        countryCode: 'RU',
        cityGuid: String(senderGuid),
        warehouseId: Number(senderId)
      },
      to: {
        countryCode: 'RU',
        cityGuid: toGuid ? String(toGuid) : undefined,
        city: (!toGuid && toCity) ? String(toCity) : undefined,
        addressString: toAddress ? String(toAddress) : undefined
      },

      providerKeys: Array.isArray(providerKeys) && providerKeys.length ? providerKeys : undefined
    };

    const resp = await fetch(`${APISHIP_BASE}/calculator`, {
      method: 'POST',
      headers: {
        // ВАЖНО: без "Bearer "
        'Authorization': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        reason: 'apiship_error',
        status: resp.status,
        version: HANDLER_VERSION,
        payloadSent: payload,
        data
      });
    }

    // Где-то это data.offers, где-то сразу массив
    const offers = Array.isArray(data?.offers) ? data.offers
                  : (Array.isArray(data) ? data
                  : (data?.data || data));

    return res.status(200).json({
      ok: true,
      version: HANDLER_VERSION,
      offers,
      raw: data
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'internal_error', version: HANDLER_VERSION, error: String(e) });
  }
}
