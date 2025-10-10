// /api/apiship/calc.js
// Vercel Serverless Function — расчёт доставки через ApiShip (calc-v2.3)

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const APISHIP_BASE = process.env.APISHIP_BASE || 'https://api.apiship.ru/v1';

export default async function handler(req, res) {
  setCORS(res);

  // Лёгкий GET-пинг для проверки деплоя
  if (req.method === 'GET') {
    if (req.query && (req.query.ping === '1' || req.query.ping === 'true')) {
      return res.status(200).json({ ok: true, version: 'calc-v2.3' });
    }
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    // --- ENV ---
    const token = process.env.APISHIP_TOKEN;            // токен ApiShip (можно без префикса)
    const senderId = process.env.APISHIP_SENDER_ID;     // warehouseId (напр. 2679)
    const senderGuid = process.env.APISHIP_SENDER_GUID; // cityGuid    (напр. 5f29...9d5f)

    if (!token || !senderId || !senderGuid) {
      return res.status(500).json({
        ok: false,
        reason: 'env_missing',
        need: ['APISHIP_TOKEN', 'APISHIP_SENDER_ID', 'APISHIP_SENDER_GUID']
      });
    }

    // --- входные данные ---
    const {
      // страна / город получателя
      toCountryCode,          // "RU" | "AM" | "KZ" | "BY" | ...
      toGuid,                 // GUID города получателя (желательно для не-RU)
      toCity,                 // если GUID нет
      toAddress,
      postIndex,

      // габариты и вес
      weightKg,
      lengthCm, widthCm, heightCm,

      // деньги
      declaredValue,

      // флаги
      pickup = true,
      delivery = true
    } = req.body || {};

    // Валидация
    if (!weightKg || Number(weightKg) <= 0) {
      return res.status(400).json({ ok: false, reason: 'weight_required' });
    }
    if (!toGuid && !toCity) {
      return res.status(400).json({ ok: false, reason: 'dest_required' });
    }

    // Для стран != RU без GUID делаем «мягкую деградацию»
    if (toCountryCode && toCountryCode !== 'RU' && !toGuid) {
      return res.status(200).json({
        ok: false,
        reason: 'no_offers',
        message: 'Автоматический расчёт недоступен для этой страны. Мы подтвердим стоимость доставки менеджером.',
        version: 'calc-v2.3'
      });
    }

    // Payload для ApiShip калькулятора (плоская форма)
    const payload = {
      weight: Math.round(Number(weightKg) * 1000) / 1000,
      width:  widthCm ? Number(widthCm) : undefined,
      height: heightCm ? Number(heightCm) : undefined,
      length: lengthCm ? Number(lengthCm) : undefined,
      assessedCost: declaredValue != null ? Number(declaredValue) : undefined,

      pickupTypes: [1, 2],
      deliveryTypes: [1, 2],

      from: {
        countryCode: 'RU',
        cityGuid: String(senderGuid),
        warehouseId: Number(senderId)
      },
      to: {
        countryCode: toCountryCode ? String(toCountryCode) : undefined,
        cityGuid: toGuid ? String(toGuid) : undefined,
        city: (!toGuid && toCity) ? String(toCity) : undefined,
        addressString: toAddress ? String(toAddress) : undefined,
        postIndex: postIndex ? String(postIndex) : undefined
      }
    };

    const authHeader = token.trim().toLowerCase().startsWith('bearer ')
      ? token.trim()
      : `Bearer ${token.trim()}`;

    const resp = await fetch(`${APISHIP_BASE}/calculator`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        reason: 'apiship_error',
        status: resp.status,
        version: 'calc-v2.3',
        payloadSent: payload,
        data
      });
    }

    const offers = Array.isArray(data?.offers) ? data.offers
                  : data?.data?.offers ? data.data.offers
                  : data?.data || data;

    if (!offers || (Array.isArray(offers) && offers.length === 0)) {
      return res.status(200).json({
        ok: false,
        reason: 'no_offers',
        message: 'Подходящих тарифов не найдено. Попробуйте другой адрес или страну.',
        version: 'calc-v2.3'
      });
    }

    return res.status(200).json({
      ok: true,
      version: 'calc-v2.3',
      offers,
      raw: data
    });

  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'internal_error', error: String(e) });
  }
}
