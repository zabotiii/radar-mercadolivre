const AMAZON_MARKETPLACE = "www.amazon.com.br";
const TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const API_URL = "https://creatorsapi.amazon/catalog/v1/searchItems";

async function getAmazonToken() {
  const clientId = process.env.AMAZON_CLIENT_ID;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "creatorsapi::default"
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.message || "Não foi possível autenticar na Amazon.");
  }
  return data.access_token;
}

function normalizeAmazonItem(item) {
  const listing = Array.isArray(item.offersV2?.listings)
    ? (item.offersV2.listings.find(x => x.isBuyBoxWinner) || item.offersV2.listings[0])
    : null;

  const price = Number(listing?.price?.money?.amount);
  const originalPrice = Number(listing?.price?.savingBasis?.money?.amount);
  const savingsPercent = Number(listing?.price?.savings?.percentage);

  return {
    store: "amazon",
    id: item.asin,
    asin: item.asin,
    item_id: item.asin,
    title: item.itemInfo?.title?.displayValue || "Produto Amazon",
    image: item.images?.primary?.large?.url || item.images?.primary?.medium?.url || item.images?.primary?.small?.url || "",
    price: Number.isFinite(price) ? price : null,
    original_price: Number.isFinite(originalPrice) && originalPrice > price ? originalPrice : null,
    discount: Number.isFinite(savingsPercent) ? savingsPercent : null,
    condition: listing?.condition?.value || "Novo",
    has_winner: !!listing?.isBuyBoxWinner,
    free_shipping: false,
    mais_vendido: false,
    sold_quantity: 0,
    score: Number.isFinite(savingsPercent) ? Math.min(100, Math.round(45 + savingsPercent * 1.2)) : 45,
    permalink: item.detailPageURL || "",
    affiliate_link: item.detailPageURL || "",
    amazon_deal: !!listing?.dealDetails,
    amazon_seller: listing?.merchantInfo?.name || ""
  };
}

module.exports = async (req, res) => {
  try {
    const q = String(req.query?.q || "").trim();

    if (!q) return res.status(400).json({ error: "Digite o produto que deseja procurar." });

    if (!process.env.AMAZON_CLIENT_ID || !process.env.AMAZON_CLIENT_SECRET || !process.env.AMAZON_PARTNER_TAG) {
      return res.status(200).json({
        configured: false,
        results: [],
        message: "🟠 Amazon ainda não configurada: falta cadastrar AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET e AMAZON_PARTNER_TAG na Vercel."
      });
    }

    const token = await getAmazonToken();

    const body = {
      keywords: q,
      partnerTag: process.env.AMAZON_PARTNER_TAG,
      marketplace: AMAZON_MARKETPLACE,
      searchIndex: "All",
      itemCount: 10,
      itemPage: 1,
      sortBy: "Relevance",
      currencyOfPreference: "BRL",
      languagesOfPreference: ["pt_BR"],
      resources: [
        "images.primary.large",
        "itemInfo.title",
        "offersV2.listings.price",
        "offersV2.listings.isBuyBoxWinner",
        "offersV2.listings.dealDetails",
        "offersV2.listings.condition",
        "offersV2.listings.merchantInfo"
      ]
    };

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "x-marketplace": AMAZON_MARKETPLACE
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Amazon Creators API:", data);
      return res.status(response.status).json({
        error: data.message || data.errors?.[0]?.message || "A Amazon recusou a consulta."
      });
    }

    const results = Array.isArray(data.searchResult?.items)
      ? data.searchResult.items.map(normalizeAmazonItem).filter(item => item.title)
      : [];

    return res.status(200).json({ configured: true, source: "amazon_creators_api", results });
  } catch (error) {
    console.error("Amazon search error:", error);
    return res.status(200).json({
      configured: false,
      results: [],
      message: "🟠 Não foi possível consultar a Amazon agora: " + error.message
    });
  }
};
