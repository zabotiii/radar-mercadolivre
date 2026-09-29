const { session } = require("./lib");

const SITE_ID = "MLB";

const CATEGORIES = {
  todas: [
    ["Celulares", "MLB1051"],
    ["Eletrônicos", "MLB1000"],
    ["Casa", "MLB1574"],
    ["Informática", "MLB1648"],
    ["Games", "MLB1144"],
    ["Moda", "MLB1430"]
  ],
  celulares: [["Celulares", "MLB1051"]],
  eletronicos: [["Eletrônicos", "MLB1000"]],
  casa: [["Casa", "MLB1574"]],
  informatica: [["Informática", "MLB1648"]],
  games: [["Games", "MLB1144"]],
  moda: [["Moda", "MLB1430"]]
};

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function normalizeCategory(value) {
  return String(value || "todas")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[^a-z0-9]+/i, "")
    .replace(/[^a-z0-9]+$/i, "")
    .replace(/^celulares$/, "celulares")
    .replace(/^eletronicos$/, "eletronicos")
    .replace(/^informatica$/, "informatica");
}

async function mlFetch(path, token) {
  try {
    const response = await fetch("https://api.mercadolibre.com" + path, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });

    let data = null;
    try {
      data = await response.json();
    } catch {}

    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error.message || String(error) };
  }
}

async function getHighlights(categoryId, token) {
  return mlFetch(
    `/highlights/${SITE_ID}/category/${encodeURIComponent(categoryId)}`,
    token
  );
}

async function getItemBulk(ids, token) {
  if (!ids.length) return { ok: true, status: 200, data: [] };

  return mlFetch(
    `/items/bulk?ids=${ids.join(",")}`,
    token
  );
}

function normalizeBulkResponse(data) {
  if (!Array.isArray(data)) return [];

  return data
    .map((entry) => {
      if (!entry) return null;

      // /items/bulk normalmente vem como { code, body }
      if (entry.body) return entry.body;

      // alguns formatos podem trazer o próprio objeto
      if (entry.id || entry.title) return entry;

      return null;
    })
    .filter(Boolean);
}

function imageOf(item) {
  if (item.thumbnail) return item.thumbnail;

  if (Array.isArray(item.pictures) && item.pictures[0]) {
    return item.pictures[0].secure_url || item.pictures[0].url || null;
  }

  return null;
}

function buildAffiliateLink(productUrl) {
  // Não inventa nem reaproveita um link de afiliado genérico.
  // O usuário pode copiar o link oficial dele pelo botão existente.
  return productUrl || null;
}

function scoreProduct({ discount, price, position, freeShipping, soldQuantity }) {
  let score = 0;

  if (typeof discount === "number") {
    if (discount >= 50) score += 45;
    else if (discount >= 40) score += 38;
    else if (discount >= 30) score += 30;
    else if (discount >= 20) score += 22;
    else if (discount >= 10) score += 12;
  }

  if (freeShipping) score += 10;

  if (typeof soldQuantity === "number") {
    if (soldQuantity >= 1000) score += 25;
    else if (soldQuantity >= 500) score += 20;
    else if (soldQuantity >= 100) score += 15;
    else if (soldQuantity >= 50) score += 10;
    else if (soldQuantity > 0) score += 5;
  }

  if (typeof position === "number") {
    if (position <= 3) score += 15;
    else if (position <= 10) score += 10;
    else if (position <= 20) score += 5;
  }

  if (typeof price === "number" && price > 0) score += 5;

  return Math.min(score, 100);
}

function extractPrice(item) {
  const price =
    typeof item.sale_price === "number"
      ? item.sale_price
      : typeof item.price === "number"
        ? item.price
        : null;

  const original =
    typeof item.original_price === "number"
      ? item.original_price
      : typeof item.base_price === "number"
        ? item.base_price
        : null;

  let discount = null;

  if (
    typeof price === "number" &&
    typeof original === "number" &&
    original > price &&
    original > 0
  ) {
    discount = Math.round(((original - price) / original) * 100);
  }

  return {
    price,
    originalPrice: discount !== null ? original : null,
    discount
  };
}

function buildProducts(highlightContent, items) {
  const byId = new Map(items.map((item) => [item.id, item]));

  return highlightContent
    .filter((x) => x && x.type === "ITEM" && x.id)
    .map((highlight) => {
      const item = byId.get(highlight.id);
      if (!item) return null;

      const prices = extractPrice(item);

      const freeShipping =
        Boolean(item.shipping && item.shipping.free_shipping === true);

      const product = {
        id: item.id,
        item_id: item.id,
        title: item.title || "Produto Mercado Livre",
        titulo: item.title || "Produto Mercado Livre",
        permalink:
          item.permalink ||
          `https://www.mercadolivre.com.br/p/${item.id}`,
        link:
          item.permalink ||
          `https://www.mercadolivre.com.br/p/${item.id}`,
        image: imageOf(item),
        imagem: imageOf(item),
        thumbnail: imageOf(item),

        price: prices.price,
        preco: prices.price,

        original_price: prices.originalPrice,
        preco_original: prices.originalPrice,

        discount: prices.discount,
        desconto: prices.discount,

        free_shipping: freeShipping,
        frete_gratis: freeShipping,

        sold_quantity:
          typeof item.sold_quantity === "number"
            ? item.sold_quantity
            : null,

        available_quantity:
          typeof item.available_quantity === "number"
            ? item.available_quantity
            : null,

        condition: item.condition || "Novo",

        position: highlight.position || null,
        ranking: highlight.position || null,

        has_winner: false,
        promocao: prices.discount !== null,
        mais_vendido: true,

        tipo:
          prices.discount !== null
            ? "PROMOCAO"
            : "MAIS_VENDIDO"
      };

      product.score = scoreProduct({
        discount: product.discount,
        price: product.price,
        position: product.position,
        freeShipping: product.free_shipping,
        soldQuantity: product.sold_quantity
      });

      product.affiliate_candidate_url = buildAffiliateLink(product.permalink);

      return product;
    })
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
  try {
    const sessao = await session(req, res);

    if (!sessao || !sessao.access_token) {
      return json(res, 401, {
        error: "Mercado Livre não conectado."
      });
    }

    const category = normalizeCategory(req.query?.categoria || "todas");
    const selected = CATEGORIES[category] || CATEGORIES.todas;

    const allProducts = [];
    const errors = [];

    for (const [categoryName, categoryId] of selected) {
      const ranking = await getHighlights(categoryId, sessao.access_token);

      if (!ranking.ok || !ranking.data) {
        errors.push({
          categoria: categoryName,
          categoria_id: categoryId,
          status: ranking.status,
          resposta: ranking.data
        });
        continue;
      }

      const content = Array.isArray(ranking.data.content)
        ? ranking.data.content
        : [];

      // O highlights pode trazer PRODUCT/USER_PRODUCT/ITEM.
      // Só ITEM pode ser resolvido via /items/bulk sem depender do buy_box.
      const itemHighlights = content.filter(
        (x) => x && x.type === "ITEM" && x.id
      );

      const ids = itemHighlights.slice(0, 20).map((x) => x.id);

      const bulk = await getItemBulk(ids, sessao.access_token);

      if (!bulk.ok) {
        errors.push({
          categoria: categoryName,
          categoria_id: categoryId,
          etapa: "items/bulk",
          status: bulk.status,
          resposta: bulk.data
        });
        continue;
      }

      const items = normalizeBulkResponse(bulk.data);

      const products = buildProducts(itemHighlights, items);

      for (const product of products) {
        product.categoria = categoryName;
        allProducts.push(product);
      }
    }

    const unique = [];
    const seen = new Set();

    for (const product of allProducts) {
      if (!seen.has(product.id)) {
        seen.add(product.id);
        unique.push(product);
      }
    }

    unique.sort((a, b) => {
      const da = a.discount ?? -1;
      const db = b.discount ?? -1;

      if (db !== da) return db - da;
      return (a.position || 999) - (b.position || 999);
    });

    const results = unique.slice(0, 30);

    return json(res, 200, {
      ok: true,
      categoria: category,
      total: results.length,
      quantidade_promocoes: results.filter((p) => p.promocao).length,
      quantidade_mais_vendidos: results.filter((p) => !p.promocao).length,
      results,
      produtos: results,
      promocoes: results.filter((p) => p.promocao),
      erros: errors,
      fonte: "Mercado Livre /highlights + /items/bulk",
      observacao:
        "Promoções só são marcadas quando o próprio item fornece preço atual e preço original diferentes."
    });
  } catch (error) {
    console.error("ERRO ML PROMOCOES:", error);

    return json(res, 500, {
      error: error.message || String(error)
    });
  }
};
