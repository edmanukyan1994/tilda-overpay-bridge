// /api/apiship/order.js
// Создание отправления в ApiShip (после успешной оплаты)

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const APISHIP_BASE = process.env.APISHIP_BASE || 'https://api.apiship.ru/v1';

export default async function handler(req, res){
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method_not_allowed' });

  try{
    // ——— ENV c данными отправителя (заполняются 1 раз)
    const token = process.env.APISHIP_TOKEN;
    const senderCityGuid   = process.env.APISHIP_SENDER_GUID;     // напр.: 5f290be7-14ff-4ccd-8bc8-2871a9ca9d5f (Мытищи)
    const senderContact    = process.env.APISHIP_SENDER_CONTACT || 'Agressor Crew';
    const senderPhone      = process.env.APISHIP_SENDER_PHONE   || '+7(999)000-00-00';
    const senderEmail      = process.env.APISHIP_SENDER_EMAIL   || 'store@example.com';
    const senderAddressStr = process.env.APISHIP_SENDER_ADDRESS || '141014, Мытищи, проспект Астрахова, 14';
    const returnAddressStr = process.env.APISHIP_RETURN_ADDRESS || senderAddressStr;

    if (!token || !senderCityGuid){
      return res.status(500).json({ ok:false, reason:'env_missing', need:['APISHIP_TOKEN','APISHIP_SENDER_GUID'] });
    }

    // ——— ВХОДНЫЕ ДАННЫЕ ОТ ФРОНТА / LOVABLE
    // Минимум, что нужно: offer из калькулятора, получатель, посылка и связка с заказом (order_ref)
    const {
      order_ref,                          // UUID заказа из Lovable (связка оплат/доставки)
      // выбор тарифа из calc (обязателен)
      providerKey,                        // напр. "cdek"
      tariffId,                           // числовой id тарифа (из offers[*].tariffId)
      pickupType,                         // 1 = от двери отправителя, 2 = сдача в пункт
      deliveryType,                       // 1 = до двери, 2 = до ПВЗ/постамата
      pointInId,                          // если сдаём на пункт (когда pickupType=2)
      pointOutId,                         // если выдача в пункт (когда deliveryType=2)

      // поля получателя
      recipient: {
        contactName,
        phone,
        email,
        countryCode = 'RU',
        region, city, street, house,
        addressString,                    // можно одной строкой — ApiShip сам распарсит
        postIndex
      } = {},

      // размеры/вес/ценность
      package: {
        weightKg, lengthCm, widthCm, heightCm,
        assessedCost,                     // объявленная ценность (в ₽)
        items = []                        // [{ description, quantity, weightGr, price }]
      } = {},

      // опционально
      description = 'Order from Agressor Crew',
      codCost = 0                         // наложенный платёж — нам не нужен, оставляем 0
    } = req.body || {};

    // базовая валидация
    if (!order_ref)  return res.status(400).json({ ok:false, reason:'order_ref_required' });
    if (!providerKey || !tariffId) return res.status(400).json({ ok:false, reason:'offer_required' });
    if (!weightKg)   return res.status(400).json({ ok:false, reason:'weight_required' });
    if (!contactName || !phone) return res.status(400).json({ ok:false, reason:'recipient_required' });

    // ApiShip в /orders ожидает вес в граммах, размеры в см
    const weightGr = Math.round(Number(weightKg) * 1000);

    // формируем items для places: вес в граммах обязателен
    const placeItems = Array.isArray(items) && items.length
      ? items.map(it=>({
          description: String(it.description || 'Товар'),
          quantity: Number(it.quantity || 1),
          weight: Number(it.weightGr || Math.max(100, Math.round(weightGr))), // подстрахуемся минимумом
          assessedCost: it.price != null ? Number(it.price) : undefined
        }))
      : [{
          description: 'Посылка',
          quantity: 1,
          weight: Math.max(100, Math.round(weightGr)),
          assessedCost: assessedCost != null ? Number(assessedCost) : undefined
        }];

    const orderPayload = {
      order: {
        clientNumber: String(order_ref),
        description: description,
        weight: weightGr,
        height: heightCm ? Number(heightCm) : undefined,
        length: lengthCm ? Number(lengthCm) : undefined,
        width:  widthCm  ? Number(widthCm)  : undefined,
        providerKey: String(providerKey),
        pickupType: Number(pickupType || 1),
        deliveryType: Number(deliveryType || 1),
        tariffId: Number(tariffId),
        ...(pointInId  ? { pointInId:  Number(pointInId)  } : {}),
        ...(pointOutId ? { pointOutId: Number(pointOutId) } : {})
      },
      cost: {
        codCost: Number(codCost || 0),
        assessedCost: assessedCost != null ? Number(assessedCost) : undefined
      },
      sender: {
        phone: senderPhone,
        contactName: senderContact,
        email: senderEmail,
        countryCode: 'RU',
        cityGuid: senderCityGuid,
        addressString: senderAddressStr
      },
      recipient: {
        phone: String(phone),
        contactName: String(contactName),
        email: email ? String(email) : undefined,
        countryCode,
        // Можно одной строкой — ApiShip распарсит (официально поддерживается)
        addressString: addressString
          || [postIndex, region, city, street, house].filter(Boolean).join(', ')
          || undefined,
        ...(postIndex ? { postIndex: String(postIndex) } : {}),
        ...(city     ? { city: String(city) } : {})
      },
      returnAddress: {
        phone: senderPhone,
        contactName: senderContact,
        countryCode: 'RU',
        addressString: returnAddressStr
      },
      places: [
        {
          placeNumber: order_ref,
          height: heightCm ? Number(heightCm) : undefined,
          length: lengthCm ? Number(lengthCm) : undefined,
          width:  widthCm  ? Number(widthCm)  : undefined,
          weight: weightGr,
          items: placeItems
        }
      ]
    };

    const resp = await fetch(`${APISHIP_BASE}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`, // токен из личного кабинета
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(orderPayload)
    });

    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!resp.ok){
      return res.status(resp.status).json({
        ok:false,
        reason:'apiship_error',
        status: resp.status,
        payloadSent: orderPayload,
        data
      });
    }

    // У ApiShip в ответе обычно приходит id заказа, номер и статусы
    return res.status(200).json({
      ok:true,
      order: data,
      sent: orderPayload
    });

  }catch(e){
    return res.status(500).json({ ok:false, reason:'internal_error', error: String(e) });
  }
}
