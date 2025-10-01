export default async function handler(req, res) {
  try {
    const response = await fetch("https://api.overpay.tech/v1/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shop-Id": process.env.OVERPAY_SHOP_ID,
        "X-Secret-Key": process.env.OVERPAY_SECRET,
      },
      body: JSON.stringify({
        amount: 100,
        currency: "RUB",
        order_id: "test-" + Date.now(),
        description: "Тестовый заказ",
        return_url: "https://agressor-crew.ru/pay_success",
      }),
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
