// /api/apiship/calc.js
// Vercel Serverless Function — расчёт доставки через ApiShip

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const APISHIP_BASE = process.env.APISHIP_BASE || 'https://api.apiship.ru'; // без /v1

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    // ENV
    const token = process.env.APISHIP_TOKEN;            // например: 3613dd9...
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
      // Опционально можно ограничить перевозчиков
      providerKeys,            // массив строк, например: ["cdek","boxberry","dpd"]
      // Режимы (по умолчанию считаем обе стороны)
      pickup = true,           // забор у отправителя (true)
      delivery = true          // доставка до получателя (true)
    } = req.body || {};

    if (!toGuid && !toCity) {
      return res.status(400).json({ ok: false, reason: 'dest_required' });
    }
    if (!weightKg || Number(weightKg) <= 0) {
      return res.status(400).json({ ok: false, reason: 'weight_required' });
    }

    // Калькулятор ждёт вес в ГРАММАХ и плоские размеры
    const weightG = Math.round(Number(weightKg) * 1000);

    // pickupTypes / deliveryTypes:
    // 1 — до двери, 2 — до ПВЗ (оставляем обе опции, чтобы получить максимум вариантов)
    const pickupTypes = pickup ? [1, 2] : [];
    const deliveryTypes = delivery ? [1, 2] : [];

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
        // addressString можно не указывать, если склад задан через warehouseId
      },
      to: {
        countryCode: 'RU',
        cityGuid: toGuid ? String(toGuid) : undefined,
        city: (!toGuid && toCity) ? String(toCity) : undefined,
        addressString: toAddress ? String(toAddress) : undefined
      },

      // опционально: ограничение по операторам
      providerKeys: Array.isArray(providerKeys) && providerKeys.length ? providerKeys : undefined
    };

    // Запрос в ApiShip (ВАЖНО: Authorization без Bearer)
    const resp = await fetch(`${APISHIP_BASE}/calculator`, {
      method: 'POST',
      headers: {
        'Authorization': token,           // ← без "Bearer "
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
        payloadSent: payload,
        data
      });
    }

    // Нормализуем ответ: где-то это data.offers, где-то сразу список
    const offers = Array.isArray(data?.offers) ? data.offers : (Array.isArray(data) ? data : data?.data || data);

    return res.status(200).json({
      ok: true,
      offers,
      raw: data
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'internal_error', error: String(e) });
  }
}
