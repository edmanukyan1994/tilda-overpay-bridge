export default async function handler(req, res) {
  try {
    const shopId = process.env.OVERPAY_SHOP_ID;
    const secret = process.env.OVERPAY_SECRET;
    if (!shopId || !secret) {
      return res.status(500).json({ ok: false, reason: "env_missing" });
    }

    const auth = "Basic " + Buffer.from(`${shopId}:${secret}`).toString("base64");

    const body = {
      checkout: {
        transaction_type: "payment",
        iframe: false,
        order: {
          amount: 100,              // 1 RUB в минорных единицах
          currency: "RUB",
          description: "Test order"
        },
        success_url: "https://agressor-crew.ru/pay_success",
        decline_url: "https://agressor-crew.ru/pay_success",
        fail_url: "https://agressor-crew.ru/pay_success",
        cancel_url: "https://agressor-crew.ru/pay_success",
        notification_url: `${process.env.APP_BASE_URL?.replace(/\/$/,'') || "https://tilda-overpay-bridge.vercel.app"}/api/payments/webhook`
      }
    };

    const r = await fetch("https://checkout.overpay.io/ctp/api/checkouts", {
      method: "POST",
      headers: {
        "Authorization": auth,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-API-Version": "2"
      },
      body: JSON.stringify(body)
    });

    const data = await r.json().catch(() => ({}));
    const redirectUrl = data?.checkout?.redirect_url || data?.redirect_url;
    const token = data?.checkout?.token || data?.token;

    if (!r.ok || !redirectUrl) {
      return res.status(502).json({ ok: false, reason: "overpay_no_redirect", data });
    }
    return res.status(200).json({ ok: true, redirectUrl, token, raw: data });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: "fetch_failed", error: String(e) });
  }
}
