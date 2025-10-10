// /api/apiship/calc.js
// Vercel Serverless Function — расчёт доставки через ApiShip (calc-v2.2)

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const APISHIP_BASE = process.env.APISHIP_BASE || 'https://api.apiship.ru/v1';

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    // --- ENV ---
    const token = process.env.APISHIP_TOKEN;           // строка токена (может быть без "Bearer ")
    const senderId = process.env.APISHIP_SENDER_ID;    // warehouseId (например: 2679)
    const senderGuid = process.env.APISHIP_SENDER_GUID;// cityGuid     (например: 5f29...9d5f)

    if (!token || !senderId || !senderGuid) {
      return res.status(500).json({
        ok: false,
        reason: 'env_missing',
        need: ['APISHIP_TOKEN', 'APISHIP_SENDER_ID', 'APISHIP_SENDER_GUID']
      });
    }

    // --- входные данные ---
    const {
      // страна/город получателя
      toCountryCode,          // "RU" | "AM" | "KZ" | "BY" | ...
      toGuid,                 // GUID города получателя (желательно для нероссийских стран)
      toCity,                 // строка названия города, если нет GUID
      toAddress,              // улица/дом (опц.)
      postIndex,              // индекс (опц.; обязателен для ПВЗ в ряде кейсов)

      // габариты и вес
      weightKg,
      lengthCm, widthCm, heightCm,

      // деньги
      declaredValue,

      // опции
      pickup = true,
      delivery = true
    } = req.body || {};

    // Базовая валидация
    if (!weightKg || Number(weightKg) <= 0) {
      return res.status(400).json({ ok: false, reason: 'weight_required' });
    }
    if (!toGuid && !toCity) {
      return res.status(400).json({ ok: false, reason: 'dest_required' });
    }

    // Важная логика для НЕ-России:
    // если страна указана и это НЕ RU, но нет GUID, чаще всего провайдеры не дадут тарифы.
    // Возвращаем мягкую деградацию, чтобы фронт не падал и дал оформить вручную.
    if (toCountryCode && toCountryCode !== 'RU' && !toGuid) {
      return res.status(200).json({
        ok: false,
        reason: 'no_offers',
        message: 'Автоматический расчёт недоступен для этой страны. Мы подтвердим стоимость доставки менеджером.',
        version: 'calc-v2.2'
      });
    }

    // Сбор payload под калькулятор ApiShip
    const payload = {
      // Плоская форма (совместима с их калькулятором)
      weight: Math.round(Number(weightKg) * 1000) / 1000, // кг
      width:  widthCm ? Number(widthCm) : undefined,
      height: heightCm ? Number(heightCm) : undefined,
      length: lengthCm ? Number(lengthCm) : undefined,
      assessedCost: declaredValue != null ? Number(declaredValue) : undefined,

      // Разрешаем и курьер, и ПВЗ
      pickupTypes: [1, 2],     // 1 - от двери, 2 - от пункта
      deliveryTypes: [1, 2],   // 1 - до двери, 2 - до пункта

      from: {
        countryCode: 'RU',                     // наш склад в РФ
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

    // Заголовок авторизации: подстраховка — если токен без префикса, добавим Bearer
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
      // Если валидация по городу/региону — отдадим это наверх, фронт покажет текст
      return res.status(resp.status).json({
        ok: false,
        reason: 'apiship_error',
        status: resp.status,
        version: 'calc-v2.2',
        payloadSent: payload,
        data
      });
    }

    // ApiShip может вернуть разную структуру; нормализуем к offers
    const offers = Array.isArray(data?.offers) ? data.offers
                  : data?.data?.offers ? data.data.offers
                  : data?.data || data;

    if (!offers || (Array.isArray(offers) && offers.length === 0)) {
      return res.status(200).json({
        ok: false,
        reason: 'no_offers',
        message: 'Подходящих тарифов не найдено. Попробуйте другой адрес или страну.',
        version: 'calc-v2.2'
      });
    }

    return res.status(200).json({
      ok: true,
      version: 'calc-v2.2',
      offers,
      raw: data
    });

  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'internal_error', error: String(e) });
  }
}
