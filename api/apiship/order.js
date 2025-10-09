// /api/apiship/order.js
// Создание отправления в ApiShip (после успешной оплаты)
// v2.1 (base без /v1 + Authorization: <token> как в calc)

const HANDLER_VERSION = 'order-v2.1';

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const APISHIP_BASE = process.env.APISHIP_BASE || 'https://api.apiship.ru'; // без /v1

export default async function handler(req, res){
  cors(res);

  // Пинг для проверки, что именно эта версия задеплоена
  if (req.method === 'GET') {
    return res.status(200).json({ ok:true, version: HANDLER_VERSION });
  }

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method_not_allowed' });

  try{
    // ENV отправителя
    const token = process.env.APISHIP_TOKEN;                 // напр. 3613dd9...
    const senderCityGuid = process.env.APISHIP_SENDER_GUID;  // 5f29...9d5f (Мытищи)
    const senderContact  = process.env.APISHIP_SENDER_CONTACT || 'Agressor Crew';
    const senderPhone    = process.env.APISHIP_SENDER_PHONE   || '+7(999)000-00-00';
    const senderEmail    = process.env.APISHIP_SENDER_EMAIL   || 'store@example.com';
    const senderAddress  = process.env.APISHIP_SENDER_ADDRESS || '141014, Мытищи, проспект Астрахова, 14';
    const returnAddress  = process.env.APISHIP_RETURN_ADDRESS || senderAddress;

    if (!token || !senderCityGuid){
      return res.status(500).json({ ok:false, reason:'env_missing', need:['APISHIP_TOKEN','APISHIP_SENDER_GUID'] });
    }

    // Входные данные
    const {
      order_ref,
      providerKey,
      tariffId,
      pickupType,     // 1=забор у нас, 2=сдаём на ПВЗ
      deliveryType,   // 1=до двери, 2=выдача в ПВЗ
      pointInId,
      pointOutId,

      recipient = {},
      package: pkg = {},
      description = 'Order from Agressor Crew',
      codCost = 0
    } = req.body || {};

    const {
      contactName,
      phone,
      email,
      countryCode = 'RU',
      region, city, street, house,
      addressString,
      postIndex
    } = recipient;

    const {
      weightKg,
      lengthCm, widthCm, heightCm,
      assessedCost,
      items = []
    } = pkg;

    // Валидация
    if (!order_ref) return res.status(400).json({ ok:false, reason:'order_ref_required' });
    if (!providerKey || !tariffId) return res.status(400).json({ ok:false, reason:'offer_required' });
    if (!weightKg) return res.status(400).json({ ok:false, reason:'weight_required' });
    if (!contactName || !phone) return res.status(400).json({ ok:false, reason:'recipient_required' });

    const weightGr = Math.round(Number(weightKg) * 1000);

    const placeItems = Array.isArray(items) && items.length
      ? items.map(it=>({
          description: String(it.description || 'Товар'),
          quantity: Number(it.quantity || 1),
          weight: Number(it.weightGr || Math.max(100, weightGr)),
          assessedCost: it.price != null ? Number(it.price) : undefined
        }))
      : [{
          description: 'Посылка',
          quantity: 1,
          weight: Math.max(100, weightGr),
          assessedCost: assessedCost != null ? Number(assessedCost) : undefined
        }];

    const orderPayload = {
      order: {
        clientNumber: String(order_ref),
        description: String(description),
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
        cityGuid: String(senderCityGuid),
        addressString: senderAddress
      },
      recipient: {
        phone: String(phone),
        contactName: String(contactName),
        email: email ? String(email) : undefined,
        countryCode,
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
        addressString: returnAddress
      },
      places: [
        {
          placeNumber: String(order_ref),
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
        // Важно: как и в calc — БЕЗ "Bearer "
        'Authorization': token,
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
        version: HANDLER_VERSION,
        payloadSent: orderPayload,
        data
      });
    }

    return res.status(200).json({
      ok:true,
      version: HANDLER_VERSION,
      order: data,
      sent: orderPayload
    });

  }catch(e){
    return res.status(500).json({ ok:false, reason:'internal_error', version: HANDLER_VERSION, error: String(e) });
  }
}
