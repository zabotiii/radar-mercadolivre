const {
  requireSession,
  json,
  mlFetch
} = require("./lib");

function money(value) {
  if (typeof value !== "number") return null;

  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function calculateDiscount(price, originalPrice) {
  if (
    typeof price !== "number" ||
    typeof originalPrice !== "number" ||
    originalPrice <= price ||
    originalPrice <= 0
  ) {
    return null;
  }

  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

function calculateScore(product) {
  let score = 0;

  // Desconto
  if (typeof product.discount === "number") {
    if (product.discount >= 50) score += 35;
    else if (product.discount >= 40) score += 30;
    else if (product.discount >= 30) score += 25;
    else if (product.discount >= 20) score += 18;
    else if (product.discount >= 10) score += 10;
  }

  // Anúncio vencedor
  if (product.has_winner) {
    score += 20;
  }

  // Frete grátis
  if (product.free_shipping) {
    score += 10;
  }

  // Disponibilidade
  if (
    typeof product.available_quantity === "number" &&
    product.available_quantity > 0
  ) {
    score += 10;
  }

  // Vendas
  if (typeof product.sold_quantity === "number") {
    if (product.sold_quantity >= 1000) score += 15;
    else if (product.sold_quantity >= 500) score += 12;
    else if (product.sold_quantity >= 100) score += 9;
    else if (product.sold_quantity >= 50) score += 6;
    else if (product.sold_quantity > 0) score += 3;
  }

  return Math.min(score, 100);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return json(res, 405, {
        error: "Método não permitido"
      });
    }

    const session = await requireSession(req, res);

    if (!session) {
      return;
    }

    const q = String(req.query.q || "").trim();

    if (!q) {
      return json(res, 400, {
        error: "Informe um termo de busca."
      });
    }

    const searchUrl =
      "https://api.mercadolibre.com/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      "&q=" +
      encodeURIComponent(q) +
      "&limit=30";

    const searchResponse = await mlFetch(
      searchUrl,
      session.access_token
    );

    if (!searchResponse.ok) {
      const text = await searchResponse.text();

      return json(res, searchResponse.status, {
        error: "Erro na busca do Mercado Livre.",
        details: text
      });
    }

    const searchData = await searchResponse.json();

    const rawProducts = Array.isArray(searchData.results)
      ? searchData.results
      : [];

    const products = [];

    for (const product of rawProducts) {
      try {
        const detailResponse = await mlFetch(
          `https://api.mercadolibre.com/products/${encodeURIComponent(
            product.id
          )}`,
          session.access_token
        );

        if (!detailResponse.ok) {
          continue;
        }

        const detail = await detailResponse.json();

        const winner = detail.buy_box_winner || null;

        const price =
          winner && typeof winner.price === "number"
            ? winner.price
            : null;

        const priceRange =
          detail.buy_box_winner_price_range || null;

        const priceMin =
          priceRange &&
          typeof priceRange.min === "number"
            ? priceRange.min
            : null;

        const priceMax =
          priceRange &&
          typeof priceRange.max === "number"
            ? priceRange.max
            : null;

        const originalPrice =
          winner &&
          typeof winner.original_price === "number"
            ? winner.original_price
            : null;

        const discount = calculateDiscount(
          price,
          originalPrice
        );

        const soldQuantity =
          winner &&
          typeof winner.sold_quantity === "number"
            ? winner.sold_quantity
            : null;

        const availableQuantity =
          winner &&
          typeof winner.available_quantity === "number"
            ? winner.available_quantity
            : null;

        const freeShipping =
          winner &&
          winner.shipping &&
          winner.shipping.free_shipping === true;

        const sellerId =
          winner && winner.seller_id
            ? winner.seller_id
            : null;

        const image =
          detail.pictures &&
          detail.pictures.length > 0
            ? detail.pictures[0].url
            : null;

        const permalink =
          detail.permalink ||
          product.permalink ||
          `https://www.mercadolivre.com.br/p/${product.id}`;

        const itemId =
          winner && winner.item_id
            ? winner.item_id
            : null;

        const result = {
          id: product.id,
          item_id: itemId,

          title:
            detail.name ||
            product.name ||
            "Produto Mercado Livre",

          permalink,

          image,

          price,
          price_min: priceMin,
          price_max: priceMax,
          original_price: originalPrice,

          discount,

          sold_quantity: soldQuantity,
          available_quantity: availableQuantity,

          free_shipping: Boolean(freeShipping),

          seller_id: sellerId,

          has_winner: Boolean(winner),

          condition: "Novo",

          score: 0
        };

        result.score = calculateScore(result);

        products.push(result);
      } catch (error) {
        console.error(
          "Erro ao processar produto:",
          product.id,
          error
        );
      }
    }

    // Primeiro os melhores scores
    products.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (
        typeof b.discount === "number" &&
        typeof a.discount === "number"
      ) {
        return b.discount - a.discount;
      }

      return 0;
    });

    return json(res, 200, {
      keywords: q,
      total: products.length,
      results: products
    });
  } catch (error) {
    console.error(error);

    return json(res, 500, {
      error: "Erro interno.",
      details: error.message
    });
  }
}
