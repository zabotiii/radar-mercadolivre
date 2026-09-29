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
  const v = String(value || "todas")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (v === "todas") return "todas";
  if (v === "celular" || v === "celulares") return "celulares";
  if (v === "eletronico" || v === "eletronicos") return "eletronicos";
  if (v === "casa") return "casa";
  if (v === "informatica") return "informatica";
  if (v === "game" || v === "games") return "games";
  if (v === "moda") return "moda";

  return v;
}

async function mlFetch(path, token) {
  try {
    const response = await fetch(
      "https://api.mercadolibre.com" + path,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    let data = null;

    try {
      data = await response.json();
    } catch {}

    return {
      ok: response.ok,
      status: response.status,
      data
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error.message || String(error)
    };
  }
}

async function getHighlights(categoryId, token) {
  return mlFetch(
    `/highlights/${SITE_ID}/category/${encodeURIComponent(categoryId)}`,
    token
  );
}

async function getProduct(productId, token) {
  return mlFetch(
    `/products/${encodeURIComponent(productId)}`,
    token
  );
}

/*
  ENDPOINT OFICIAL DO CATÁLOGO:
  retorna as publicações relacionadas ao produto,
  inclusive preço, seller, estoque e frete.
*/
async function getProductItems(productId, token) {
  return mlFetch(
    `/products/${encodeURIComponent(productId)}/items?limit=20`,
    token
  );
}

function affiliateCommissionRate(categoryName) {
  const name = String(categoryName || "").toLowerCase();

  if (/beleza|calçados|calcados|roupas|bolsas|esportes|fitness/.test(name)) return 0.16;
  if (/celular|informática|informatica|eletrônicos|eletronicos|áudio|audio|vídeo|video|câmeras|cameras|eletrodomésticos|eletrodomesticos/.test(name)) return 0.05;

  // Faixa padrão atual para as demais categorias participantes.
  if (name) return 0.12;

  return null;
}

function addCommission(product, categoryName) {
  const rate = affiliateCommissionRate(categoryName);
  const price = Number(product.price);

  product.affiliate_commission_rate = rate;
  product.affiliate_commission_estimate =
    rate !== null && Number.isFinite(price) && price > 0
      ? Math.round(price * rate * 100) / 100
      : null;

  product.affiliate_commission_label =
    rate !== null
      ? Math.round(rate * 100) + "%"
      : null;

  return product;
}

function getImage(product) {
  if (
    product &&
    Array.isArray(product.pictures) &&
    product.pictures.length
  ) {
    return (
      product.pictures[0].secure_url ||
      product.pictures[0].url ||
      null
    );
  }

  return null;
}

function numeric(value) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  return null;
}

function discountFrom(price, originalPrice) {
  if (
    typeof price !== "number" ||
    typeof originalPrice !== "number" ||
    originalPrice <= price ||
    originalPrice <= 0
  ) {
    return null;
  }

  return Math.round(
    ((originalPrice - price) / originalPrice) * 100
  );
}

function score({
  discount,
  price,
  position,
  freeShipping,
  soldQuantity,
  hasSeller
}) {
  let total = 0;

  if (typeof discount === "number") {
    if (discount >= 50) total += 55;
    else if (discount >= 40) total += 48;
    else if (discount >= 30) total += 40;
    else if (discount >= 20) total += 30;
    else if (discount >= 10) total += 20;
  }

  if (freeShipping) total += 10;
  if (hasSeller) total += 10;
  if (typeof price === "number") total += 10;

  if (typeof soldQuantity === "number") {
    if (soldQuantity >= 1000) total += 10;
    else if (soldQuantity >= 500) total += 8;
    else if (soldQuantity >= 100) total += 6;
    else if (soldQuantity > 0) total += 3;
  }

  if (typeof position === "number") {
    if (position <= 3) total += 5;
    else if (position <= 10) total += 3;
  }

  return Math.min(total, 100);
}

function normalizeResults(data) {
  if (!data) return [];

  if (Array.isArray(data.results)) {
    return data.results;
  }

  if (Array.isArray(data)) {
    return data;
  }

  return [];
}

function itemIdOf(item) {
  if (!item) return null;
  return item.item_id || item.id || null;
}

function makeItemUrl(item, catalogUrl, catalogProductId) {
  if (item && item.permalink) return item.permalink;
  if (catalogUrl) return catalogUrl;
  if (catalogProductId) return `https://www.mercadolivre.com.br/p/${encodeURIComponent(catalogProductId)}`;
  if (item && item.item_id) return `https://www.mercadolivre.com.br/p/${encodeURIComponent(item.item_id)}`;
  if (item && item.id) return `https://www.mercadolivre.com.br/p/${encodeURIComponent(item.id)}`;
  return null;
}

function buildCandidate({
  item,
  catalog,
  categoryName,
  position
}) {
  const realItemId = itemIdOf(item);

  const price = numeric(
    item.price ??
    item.sale_price ??
    item.current_price
  );

  const originalPrice = numeric(
    item.original_price ??
    item.regular_amount ??
    item.base_price
  );

  const discount =
    discountFrom(
      price,
      originalPrice
    );

  const shipping =
    item.shipping || {};

  const freeShipping =
    shipping.free_shipping === true ||
    (
      Array.isArray(shipping.tags) &&
      shipping.tags.includes(
        "mandatory_free_shipping"
      )
    );

  const catalogUrl =
    catalog &&
    catalog.permalink
      ? catalog.permalink
      : null;

  const product = {
    id:
      realItemId,

    item_id:
      realItemId,

    product_id:
      catalog.id ||
      null,

    title:
      catalog.name ||
      item.title ||
      "Produto Mercado Livre",

    titulo:
      catalog.name ||
      item.title ||
      "Produto Mercado Livre",

    permalink:
      makeItemUrl(
        item,
        catalogUrl,
        catalog.id
      ),

    link:
      makeItemUrl(
        item,
        catalogUrl
      ),

    image:
      getImage(catalog),

    imagem:
      getImage(catalog),

    thumbnail:
      getImage(catalog),

    price,

    preco:
      price,

    original_price:
      discount !== null
        ? originalPrice
        : null,

    preco_original:
      discount !== null
        ? originalPrice
        : null,

    discount,

    desconto:
      discount,

    free_shipping:
      freeShipping,

    frete_gratis:
      freeShipping,

    sold_quantity:
      numeric(
        item.sold_quantity
      ),

    available_quantity:
      numeric(
        item.available_quantity
      ),

    seller_id:
      item.seller_id ||
      null,

    condition:
      item.condition ||
      "new",

    category_id:
      item.category_id ||
      (
        catalog &&
        catalog.category_id
      ) ||
      null,

    categoria:
      categoryName,

    position:
      position || null,

    ranking:
      position || null,

    has_winner:
      Boolean(
        catalog &&
        catalog.buy_box_winner &&
        catalog.buy_box_winner.item_id ===
          realItemId
      ),

    mais_vendido:
      true,

    promocao:
      discount !== null &&
      discount > 0,

    tipo:
      discount !== null &&
      discount > 0
        ? "PROMOCAO"
        : "MAIS_VENDIDO",

    score:
      score({
        discount,
        price,
        position,
        freeShipping,
        soldQuantity:
          numeric(item.sold_quantity),
        hasSeller:
          Boolean(item.seller_id)
      })
  };

  return product;
}

async function processCategory(
  categoryName,
  categoryId,
  token
) {
  const highlights =
    await getHighlights(
      categoryId,
      token
    );

  if (
    !highlights.ok ||
    !highlights.data
  ) {
    return {
      products: [],
      error: {
        categoria: categoryName,
        etapa: "highlights",
        status: highlights.status,
        resposta: highlights.data
      }
    };
  }

  const content =
    Array.isArray(highlights.data.content)
      ? highlights.data.content
      : [];

  /*
    Trabalhamos com PRODUCT porque
    o endpoint /products/{id}/items
    transforma o produto de catálogo
    em publicações reais com preços.
  */
  const candidates =
    content
      .filter(
        (x) =>
          x &&
          x.type === "PRODUCT" &&
          x.id
      )
      .slice(0, 10);

  const products = [];

  /*
    Processa poucos produtos por categoria
    para evitar timeout.
  */
  for (
    const candidate
    of candidates
  ) {
    const catalogResponse =
      await getProduct(
        candidate.id,
        token
      );

    if (
      !catalogResponse.ok ||
      !catalogResponse.data
    ) {
      continue;
    }

    const catalog =
      catalogResponse.data;

    const relation =
      await getProductItems(
        candidate.id,
        token
      );

    if (
      !relation.ok ||
      !relation.data
    ) {
      continue;
    }

    const items =
      normalizeResults(
        relation.data
      );

    /*
      Pega até 3 anúncios por produto.
      Ordena pelo menor preço para trazer
      oportunidades reais.
    */
    const validItems =
      items
        .filter(
          (item) =>
            item &&
            itemIdOf(item)
        )
        .sort(
          (a, b) =>
            (
              numeric(a.price) ??
              Number.MAX_SAFE_INTEGER
            ) -
            (
              numeric(b.price) ??
              Number.MAX_SAFE_INTEGER
            )
        )
        .slice(0, 3);

    for (
      const item
      of validItems
    ) {
      products.push(
        buildCandidate({
          item,
          catalog,
          categoryName,
          position:
            candidate.position
        })
      );
    }
  }

  return {
    products,
    error: null
  };
}

module.exports = async function handler(
  req,
  res
) {
  try {
    const sessao =
      await session(
        req,
        res
      );

    if (
      !sessao ||
      !sessao.access_token
    ) {
      return json(
        res,
        401,
        {
          error:
            "Mercado Livre não conectado."
        }
      );
    }

    const category =
      normalizeCategory(
        req.query?.categoria ||
        "todas"
      );

    const selected =
      CATEGORIES[category];

    if (!selected) {
      return json(
        res,
        400,
        {
          error:
            "Categoria inválida."
        }
      );
    }

    const allProducts = [];
    const errors = [];

    for (
      const [categoryName, categoryId]
      of selected
    ) {
      const result =
        await processCategory(
          categoryName,
          categoryId,
          sessao.access_token
        );

      allProducts.push(
        ...result.products
      );

      if (result.error) {
        errors.push(
          result.error
        );
      }
    }

    /*
      Elimina duplicados.
    */
    const byProduct = new Map();

    for (const product of allProducts) {
      const key = product.product_id || product.item_id;
      const current = byProduct.get(key);

      if (!current) {
        byProduct.set(key, product);
        continue;
      }

      const currentDiscount = current.discount ?? -1;
      const newDiscount = product.discount ?? -1;
      const currentPrice = current.price ?? Number.MAX_SAFE_INTEGER;
      const newPrice = product.price ?? Number.MAX_SAFE_INTEGER;

      if (
        newDiscount > currentDiscount ||
        (newDiscount === currentDiscount && newPrice < currentPrice)
      ) {
        byProduct.set(key, product);
      }
    }

    const unique = [...byProduct.values()];

    /*
      Promoções reais primeiro.
      Depois preço disponível.
      Depois maior score.
    */
    unique.sort(
      (a, b) => {
        const pa =
          a.promocao ? 1 : 0;

        const pb =
          b.promocao ? 1 : 0;

        if (pb !== pa) {
          return pb - pa;
        }

        const da =
          a.discount ?? -1;

        const db =
          b.discount ?? -1;

        if (db !== da) {
          return db - da;
        }

        const sa =
          a.score || 0;

        const sb =
          b.score || 0;

        if (sb !== sa) {
          return sb - sa;
        }

        return (
          (a.position || 999) -
          (b.position || 999)
        );
      }
    );

    const results =
      unique.slice(
        0,
        30
      );

    const promotions =
      results.filter(
        (p) =>
          p.promocao
      );

    return json(
      res,
      200,
      {
        ok: true,

        categoria:
          category,

        total:
          results.length,

        quantidade_promocoes:
          promotions.length,

        quantidade_mais_vendidos:
          results.filter(
            (p) =>
              !p.promocao
          ).length,

        results,

        produtos:
          results,

        promocoes:
          promotions,

        erros:
          errors,

        fonte:
          "Mercado Livre /highlights + /products/{product_id}/items"
      }
    );

  } catch (error) {
    console.error(
      "ERRO ML PROMOCOES:",
      error
    );

    return json(
      res,
      500,
      {
        error:
          error.message ||
          String(error)
      }
    );
  }
};
