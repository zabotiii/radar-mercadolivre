const crypto = require("crypto");

const ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function moneyNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function originalPriceFromDiscount(price, discountRate) {
  if (!Number.isFinite(price) || !Number.isFinite(discountRate) || discountRate <= 0 || discountRate >= 100) {
    return null;
  }
  const original = price / (1 - discountRate / 100);
  return Math.round(original * 100) / 100;
}

async function shopeeGraphQL(query) {
  const appId = process.env.SHOPEE_APP_ID;
  const secret = process.env.SHOPEE_SECRET;

  if (!appId || !secret) {
    return {
      configured: false,
      results: [],
      message: "🟠 Shopee ainda não configurada: aguardando AppID e Secret da Open API."
    };
  }

  const payload = JSON.stringify({ query });
  const timestamp = Math.floor(Date.now() / 1000);
  const factor = String(appId) + String(timestamp) + payload + String(secret);
  const signature = crypto.createHash("sha256").update(factor, "utf8").digest("hex");

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": "SHA256 Credential=" + appId + ", Timestamp=" + timestamp + ", Signature=" + signature,
      "Content-Type": "application/json"
    },
    body: payload
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "A Shopee recusou a consulta da Open API.");
  }

  if (Array.isArray(data.errors) && data.errors.length) {
    throw new Error(data.errors[0]?.message || "A Shopee retornou um erro na Open API.");
  }

  return data;
}

function normalizeOffer(item) {
  const priceMin = moneyNumber(item.priceMin);
  const priceMax = moneyNumber(item.priceMax);
  const discount = moneyNumber(item.priceDiscountRate);
  const commissionRate = moneyNumber(item.commissionRate);
  const commission = moneyNumber(item.commission);

  return {
    store: "shopee",
    id: String(item.itemId || ""),
    item_id: String(item.itemId || ""),
    shopee_item_id: item.itemId || null,
    shop_id: item.shopId || null,
    title: item.productName || "Produto Shopee",
    image: item.imageUrl || "",
    price: priceMin,
    price_min: priceMin,
    price_max: priceMax,
    original_price: originalPriceFromDiscount(priceMin, discount),
    discount: Number.isFinite(discount) ? discount : null,
    commission_rate: Number.isFinite(commissionRate) ? commissionRate : null,
    commission_estimate: Number.isFinite(commission) ? commission : (
      Number.isFinite(priceMin) && Number.isFinite(commissionRate)
        ? Math.round(priceMin * commissionRate * 100) / 100
        : null
    ),
    commission_label: Number.isFinite(commissionRate)
      ? Math.round(commissionRate * 100) + "%"
      : null,
    sold_quantity: Number.isFinite(Number(item.sales)) ? Number(item.sales) : 0,
    rating: item.ratingStar || null,
    shop_name: item.shopName || "",
    product_link: item.productLink || "",
    affiliate_link: item.offerLink || "",
    free_shipping: false,
    mais_vendido: Number(item.sales) >= 100,
    score: Math.min(
      100,
      Math.round(
        40 +
        (Number.isFinite(discount) ? Math.min(discount, 40) * 0.8 : 0) +
        (Number.isFinite(commissionRate) ? Math.min(commissionRate * 100, 20) * 0.7 : 0) +
        (Number(item.sales) >= 1000 ? 12 : Number(item.sales) >= 500 ? 8 : Number(item.sales) >= 100 ? 5 : 0)
      )
    ),
    permalink: item.productLink || ""
  };
}

module.exports = async function handler(req, res) {
  try {
    const q = String(req.query?.q || "").trim();

    if (!q) {
      return json(res, 400, { error: "Digite o produto que deseja procurar." });
    }

    if (!process.env.SHOPEE_APP_ID || !process.env.SHOPEE_SECRET) {
      return json(res, 200, {
        configured: false,
        results: [],
        message: "🟠 Shopee aguardando acesso à Open API. Assim que a Shopee liberar seu AppID e Secret, basta cadastrar as credenciais na Vercel."
      });
    }

    const safeKeyword = q.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\"');

    const query = "{\\n" +
      "  productOfferV2(keyword: \\"" + safeKeyword + "\\", page: 1, sortType: 2, limit: 20) {\\n" +
      "    nodes {\\n" +
      "      itemId commissionRate sellerCommissionRate shopeeCommissionRate commission sales\\n" +
      "      priceMax priceMin productCatIds ratingStar priceDiscountRate imageUrl productName\\n" +
      "      shopId shopName shopType productLink offerLink\\n" +
      "    }\\n" +
      "    pageInfo { hasNextPage page }\\n" +
      "  }\\n" +
      "}";

    const data = await shopeeGraphQL(query);
    const nodes = Array.isArray(data?.data?.productOfferV2?.nodes)
      ? data.data.productOfferV2.nodes
      : [];

    const results = nodes
      .map(normalizeOffer)
      .filter(item => item.title && item.price !== null);

    return json(res, 200, {
      configured: true,
      source: "shopee_affiliate_open_api",
      results
    });
  } catch (error) {
    console.error("Shopee search error:", error);
    return json(res, 200, {
      configured: false,
      results: [],
      message: "🟠 Não foi possível consultar a Shopee agora: " + (error.message || String(error))
    });
  }
};
