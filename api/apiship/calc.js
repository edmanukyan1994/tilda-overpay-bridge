// /api/apiship/calc.js
// Vercel Serverless Function — расчёт доставки через ApiShip
// Версия: calc-v2.4 (weight → grams, better validation)

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const APISHIP_BASE = 'https://api.apiship.ru/v1';

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    // --- ENV (минимум) ---
    const token = process.env.APISHIP_TOKEN;
    const senderId = process.env.APISHIP_SENDER_ID;     // 2679 (пример)
    const senderGuid = process.env.APISHIP_SENDER_GUID; // 5f29...9d5f (пример)

    if (!token || !senderId || !senderGuid) {
      return res.status(500).json({
        ok: false,
        reason: 'env_missing',
        need: ['APISHIP_TOKEN', 'APISHIP_SENDER_ID', 'APISHIP_SENDER_GUID'],
        version: 'calc-v2.4'
      });
    }

    // --- входные данные от фронта ---
    const {
      // куда доставляем
      toCountryCode,           // "RU", "AM", ...
      toGuid,                  // GUID города (если есть)
      toCity,                  // название города
      toAddress,               // улица/дом (опционально)
      postIndex,               // индекс (желателен для ПВЗ)
      // груз
      weightKg,                // вес в кг (например 0.8)
      lengthCm, widthCm, heightCm, // габариты в см
      // деньги
      declaredValue,           // объявленная ценность, ₽
      // опции
      pickup = true,           // забор (true)
      delivery = true,         // доставка (true)
      services = {}            // доп. услуги ApiShip (если нужны)
    } = req.body || {};

    // базовая валидация
    if (!toCountryCode) {
      return res.status(400).json({ ok: false, reason: 'country_required', version: 'calc-v2.4' });
    }
    if (!toGuid && !toCity) {
      return res.status(400).json({ ok: false, reason: 'dest_required', version: 'calc-v2.4' });
    }
    const wKgNum = Number(weightKg || 0);
    if (!Number.isFinite(wKgNum) || wKgNum <= 0) {
      return res.status(400).json({ ok: false, reason: 'weight_required', version: 'calc-v2.4' });
    }

    // ---- НОРМАЛИЗАЦИЯ ВЕСА И ГАБАРИТОВ ----
    // ApiShip валидирует поле Weight как целое → используем граммы
    const weightGr = Math.max(1, Math.round(wKgNum * 1000)); // минимум 1 грамм
    const len = lengthCm ? Math.round(Number(lengthCm)) : undefined;
    const wid = widthCm  ? Math.round(Number(widthCm))  : undefined;
    const hgt = heightCm ? Math.round(Number(heightCm)) : undefined;

    // ---- МЕЖДУНАРОДНЫЕ ОТПРАВКИ ----
    // Авто-калькулятор для не-RU может не поддерживаться тарифом → сообщаем фронту,
    // чтобы он показал «стоимость уточнит менеджер». При желании подключим спец-эндпоинт.
    if (String(toCountryCode).toUpperCase() !== 'RU') {
      return res.status(200).json({
        ok: false,
        reason: 'no_offers',
        message: 'Автоматический расчёт недоступен для этой страны. Мы подтвердим стоимость доставки менеджером.',
        version: 'calc-v2.4'
      });
    }

    // ---- ПЛАТЁЖНАЯ НАГРУЗКА ДЛЯ КАЛЬКУЛЯТОРА ----
    // Совместимо с их текущим API: /v1/calculator
    const payload = {
      // верхний уровень (как часть нового калькулятора)
      weight: weightGr,
      width:  wid,
      height: hgt,
      length: len,
      assessedCost: declaredValue != null ? Number(declaredValue) : undefined,
      pickupTypes: [1, 2],     // door, point
      deliveryTypes: [1, 2],   // door, point

      from: {
        countryCode: 'RU',
        cityGuid: String(senderGuid),
        warehouseId: Number(senderId)
      },
      to: {
        countryCode: 'RU',
        cityGuid: toGuid ? String(toGuid) : undefined,
        city: (!toGuid && toCity) ? String(toCity) : undefined,
        addressString: toAddress ? String(toAddress) : undefined,
        postIndex: postIndex ? String(postIndex) : undefined
      },

      // места (некоторые интеграции требуют дублирование веса/габаритов тут)
      places: [
        {
          weight: weightGr,
          width:  wid,
          height: hgt,
          length: len
        }
      ],

      // доп. настройки/услуги
      options: {
        pickup: Boolean(pickup),
        delivery: Boolean(delivery),
        ...(services || {})
      }
    };

    const resp = await fetch(`${APISHIP_BASE}/calculator`, {
      method: 'POST',
      headers: {
        'Authorization': token,        // ApiShip ждёт «сырой» токен
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // читаем ответ как текст → затем пытаемся JSON
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        reason: 'apiship_error',
        status: resp.status,
        version: 'calc-v2.4',
        payloadSent: payload,
        data
      });
    }

    // Нормализуем удобный ответ фронту
    const offers =
      Array.isArray(data?.offers) ? data.offers :
      (Array.isArray(data?.data) ? data.data : data);

    return res.status(200).json({
      ok: true,
      version: 'calc-v2.4',
      offers,
      raw: data
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      reason: 'internal_error',
      version: 'calc-v2.4',
      error: String(e)
    });
  }
}
