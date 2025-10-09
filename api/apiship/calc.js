// /api/apiship/calc.js
// Vercel Serverless Function — расчёт доставки через ApiShip

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
    const senderId = process.env.APISHIP_SENDER_ID;            // 2679
    const senderGuid = process.env.APISHIP_SENDER_GUID;        // 5f29...9d5f

    if (!token || !senderId || !senderGuid) {
      return res.status(500).json({
        ok: false,
        reason: 'env_missing',
        need: ['APISHIP_TOKEN', 'APISHIP_SENDER_ID', 'APISHIP_SENDER_GUID']
      });
    }

    // --- входные данные от фронта ---
    const {
      // куда доставляем (любой из вариантов работает; чем точнее — тем лучше)
      toGuid,                  // GUID города получателя (предпочтительно)
      toCity,                  // название города (если нет GUID)
      toAddress,               // улица/дом (опционально)
      // груз
      weightKg,                // вес в кг (напр. 0.8)
      lengthCm, widthCm, heightCm, // габариты в см (опционально)
      // деньги
      declaredValue,           // объявленная ценность, ₽
      // опции
      pickup = true,           // забор от склада/пункта (true)
      delivery = true,         // доставка до клиента (true)
      services = {}            // доп. услуги ApiShip (если знаешь коды)
    } = req.body || {};

    // базовая валидация
    if (!toGuid && !toCity) {
      return res.status(400).json({ ok: false, reason: 'dest_required' });
    }
    if (!weightKg || Number(weightKg) <= 0) {
      return res.status(400).json({ ok: false, reason: 'weight_required' });
    }

    // формируем тело запроса под калькулятор ApiShip
    // Схема совместима с актуальным API: from/to, packages, options.
    // Если у тебя есть точные требования под вашего тарифа — добавим поля.
    const payload = {
      from: {
        // склад-отправитель
        cityGuid: String(senderGuid),
        warehouseId: Number(senderId)
      },
      to: {
        // можно передать GUID города или просто название
        cityGuid: toGuid ? String(toGuid) : undefined,
        city: (!toGuid && toCity) ? String(toCity) : undefined,
        address: toAddress ? String(toAddress) : undefined
      },
      packages: [
        {
          // ApiShip ожидает размеры обычно в сантиметрах, вес — в килограммах
          weight: Number(weightKg),
          length: lengthCm ? Number(lengthCm) : undefined,
          width:  widthCm  ? Number(widthCm)  : undefined,
          height: heightCm ? Number(heightCm) : undefined,
          assessedCost: declaredValue != null ? Number(declaredValue) : undefined
        }
      ],
      options: {
        pickup: Boolean(pickup),
        delivery: Boolean(delivery),
        ...(services || {})
      }
    };

    // делаем запрос в ApiShip
    const resp = await fetch(`${APISHIP_BASE}/calculator`, {
      method: 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // пробуем читать JSON/текст (ApiShip иногда присылает детальные ошибки как текст)
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

    // Нормализуем удобный ответ фронту
    const offers = Array.isArray(data?.offers) ? data.offers : data?.data || data;
    return res.status(200).json({
      ok: true,
      offers,        // список предложений служб: цена, срок, служба, режимы (курьер/ПВЗ)
      raw: data      // полный оригинальный ответ (на всякий случай)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'internal_error', error: String(e) });
  }
}
