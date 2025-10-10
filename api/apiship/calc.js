// /api/apiship/calc.js
// Vercel Serverless Function — расчёт доставки через ApiShip
// Версия: calc-v2.5-intl (разрешили не-RU, вес → граммы, мягкий фолбэк)

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
    const token = process.env.APISHIP_TOKEN;
    const senderId = process.env.APISHIP_SENDER_ID;     // пример: 2679
    const senderGuid = process.env.APISHIP_SENDER_GUID; // пример: 5f29...9d5f

    if (!token || !senderId || !senderGuid) {
      return res.status(500).json({
        ok: false,
        reason: 'env_missing',
        need: ['APISHIP_TOKEN', 'APISHIP_SENDER_ID', 'APISHIP_SENDER_GUID'],
        version: 'calc-v2.5-intl'
      });
    }

    const {
      toCountryCode,   // "RU" | "AM" | "KZ" | "BY" | ...
      toGuid,          // GUID города получателя (желательно для зарубежа)
      toCity,          // название города (если нет GUID)
      toAddress,       // улица/дом (опц.)
      postIndex,       // индекс (для ПВЗ)
      weightKg,        // кг (например 0.8)
      lengthCm, widthCm, heightCm,
      declaredValue,   // ₽
      pickup = true,
      delivery = true,
      services = {}
    } = req.body || {};

    // валидация
    if (!toCountryCode) {
      return res.status(400).json({ ok: false, reason: 'country_required', version: 'calc-v2.5-intl' });
    }
    if (!toGuid && !toCity) {
      return res.status(400).json({ ok: false, reason: 'dest_required', version: 'calc-v2.5-intl' });
    }
    const wKg = Number(weightKg || 0);
    if (!Number.isFinite(wKg) || wKg <= 0) {
      return res.status(400).json({ ok: false, reason: 'weight_required', version: 'calc-v2.5-intl' });
    }

    // нормализация
    const weightGr = Math.max(1, Math.round(wKg * 1000)); // граммы, целое
    const len = lengthCm ? Math.round(Number(lengthCm)) : undefined;
    const wid = widthCm  ? Math.round(Number(widthCm))  : undefined;
    const hgt = heightCm ? Math.round(Number(heightCm)) : undefined;

    // соберём payload под /v1/calculator
    const payload = {
      weight: weightGr,
      width:  wid,
      height: hgt,
      length: len,
      assessedCost: declaredValue != null ? Number(declaredValue) : undefined,
      pickupTypes: [1, 2],
      deliveryTypes: [1, 2],

      from: {
        countryCode: 'RU',
        cityGuid: String(senderGuid),
        warehouseId: Number(senderId)
      },
      to: {
        countryCode: String(toCountryCode).toUpperCase(),
        cityGuid: toGuid ? String(toGuid) : undefined,
        city: (!toGuid && toCity) ? String(toCity) : undefined,
        addressString: toAddress ? String(toAddress) : undefined,
        postIndex: postIndex ? String(postIndex) : undefined
      },

      places: [
        {
          weight: weightGr,
          width:  wid,
          height: hgt,
          length: len
        }
      ],

      options: {
        pickup: Boolean(pickup),
        delivery: Boolean(delivery),
        ...(services || {})
      }
    };

    const resp = await fetch(`${APISHIP_BASE}/calculator`, {
      method: 'POST',
      headers: {
        'Authorization': token, // сырой токен ApiShip
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!resp.ok) {
      // Типичная международная проблема — не распознан город/регион.
      const validation = Array.isArray(data?.errors) ? data.errors.map(e => `${e.field}: ${Array.isArray(e.message)?e.message.join(', '):e.message}`).join('; ') : '';
      const isIntlNoCity = String(toCountryCode).toUpperCase() !== 'RU' && validation.includes('city');
      if (isIntlNoCity) {
        return res.status(200).json({
          ok: false,
          reason: 'no_offers',
          message: 'Для этой страны нужен уточнённый город (GUID). Мы подтвердим стоимость менеджером.',
          version: 'calc-v2.5-intl',
          hint: 'Попробуйте передать toGuid (cityGuid) из справочника ApiShip.',
          payloadSent: payload,
          data
        });
      }
      return res.status(resp.status).json({
        ok: false,
        reason: 'apiship_error',
        status: resp.status,
        version: 'calc-v2.5-intl',
        payloadSent: payload,
        data
      });
    }

    const offers =
      Array.isArray(data?.offers) ? data.offers :
      (Array.isArray(data?.data) ? data.data : data);

    return res.status(200).json({
      ok: true,
      version: 'calc-v2.5-intl',
      offers,
      raw: data
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      reason: 'internal_error',
      version: 'calc-v2.5-intl',
      error: String(e)
    });
  }
}
