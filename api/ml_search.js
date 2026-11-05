const { session } = require("./lib");

async function getCategoryName(categoryId, token) {
  if (!categoryId) return null;
  try {
    const response = await fetch(
      "https://api.mercadolibre.com/categories/" + encodeURIComponent(categoryId),
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data.name || null;
  } catch {
    return null;
  }
}

function affiliateCommissionRate(categoryName) {
  const name = String(categoryName || "").toLowerCase();
  if (/beleza|calçados|calcados|roupas|bolsas|esportes|fitness/.test(name)) return 0.16;
  if (/celular|informática|informatica|eletrônicos|eletronicos|áudio|audio|vídeo|video|câmeras|cameras|eletrodomésticos|eletrodomesticos/.test(name)) return 0.05;
  return name ? 0.12 : null;
}

function applyAffiliateCommission(product, categoryName) {
  const rate = affiliateCommissionRate(categoryName);
  const price = Number(product.price);
  product.category_name = categoryName || null;
  product.affiliate_commission_rate = rate;
  product.affiliate_commission_estimate =
    rate !== null && Number.isFinite(price) && price > 0
      ? Math.round(price * rate * 100) / 100
      : null;
  product.affiliate_commission_label = rate !== null ? Math.round(rate * 100) + "%" : null;
  return product;
}

module.exports = async function(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Método não permitido." });
    }

    const sess = await session(req, res);
    if (!sess) {
      return res.status(401).json({ error: "Mercado Livre não conectado." });
    }

    const q = String(req.query?.q || "").trim();
    if (!q) {
      return res.status(400).json({ error: "Digite um termo de busca." });
    }

    // Busca anúncios (itens), pois eles trazem preço e disponibilidade.
    const searchUrl =
      "https://api.mercadolibre.com/sites/MLB/search?q=" +
      encodeURIComponent(q) +
      "&limit=30";

    const searchResponse = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${sess.access_token}`,
        Accept: "application/json"
      }
    });

    const searchText = await searchResponse.text();
    let searchData = {};
    try {
      searchData = JSON.parse(searchText);
    } catch {
      return res.status(502).json({
        error: "O Mercado Livre retornou uma resposta inválida.",
        details: searchText.substring(0, 500)
      });
    }

    if (!searchResponse.ok) {
      return res.status(searchResponse.status).json({
        error: searchData.message || searchData.error || "Erro na busca do Mercado Livre.",
        details: searchData
      });
    }

    const rawProducts = Array.isArray(searchData.results) ? searchData.results : [];
    const products = rawProducts.map(item => {
      const price = typeof item.price === "number" ? item.price : null;
      const originalPrice =
        typeof item.original_price === "number" ? item.original_price : null;
      let discount = null;

      if (price !== null && originalPrice !== null && originalPrice > price && originalPrice > 0) {
        discount = Math.round(((originalPrice - price) / originalPrice) * 100);
      }

      const soldQuantity =
        typeof item.sold_quantity === "number" ? item.sold_quantity : null;
      const availableQuantity =
        typeof item.available_quantity === "number" ? item.available_quantity : null;
      const freeShipping = Boolean(item.shipping && item.shipping.free_shipping === true);

      let score = 0;
      if (discount !== null) {
        if (discount >= 50) score += 35;
        else if (discount >= 40) score += 30;
        else if (discount >= 30) score += 25;
        else if (discount >= 20) score += 18;
        else if (discount >= 10) score += 10;
      }
      score += 20;
      if (freeShipping) score += 10;
      if (availableQuantity !== null && availableQuantity > 0) score += 10;
      if (soldQuantity !== null) {
        if (soldQuantity >= 1000) score += 15;
        else if (soldQuantity >= 500) score += 12;
        else if (soldQuantity >= 100) score += 9;
        else if (soldQuantity >= 50) score += 6;
        else if (soldQuantity > 0) score += 3;
      }

      return {
        id: item.id,
        item_id: item.id,
        title: item.title || "Produto Mercado Livre",
        permalink: item.permalink || `https://www.mercadolivre.com.br/p/${item.id}`,
        image: item.thumbnail ? item.thumbnail.replace(/^http:/, "https:") : null,
        price,
        price_min: null,
        price_max: null,
        original_price: originalPrice,
        discount,
        sold_quantity: soldQuantity,
        available_quantity: availableQuantity,
        free_shipping: freeShipping,
        seller_id: item.seller && item.seller.id ? item.seller.id : null,
        has_winner: true,
        condition: item.condition || "Novo",
        category_id: item.category_id || null,
        category_name: null,
        affiliate_commission_rate: null,
        affiliate_commission_estimate: null,
        affiliate_commission_label: null,
        score: Math.min(score, 100)
      };
    });

    await Promise.all(products.map(async product => {
      const categoryName = await getCategoryName(product.category_id, sess.access_token);
      applyAffiliateCommission(product, categoryName);
    }));

    products.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.discount || 0) - (a.discount || 0);
    });

    return res.status(200).json({
      keywords: q,
      total: products.length,
      results: products
    });
  } catch (error) {
    console.error("ERRO RADAR:", error);
    return res.status(500).json({
      error: "Erro interno no Radar.",
      details: error.message
    });
  }
};
