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
    .replace(/[\u0300-\u036f]/g, "");
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

function decodeHtml(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const s = String(value || "").trim();

  if (!s) return null;

  const br = s
    .replace(/[^0-9,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const n = Number(br);

  return Number.isFinite(n) ? n : null;
}

function firstMatch(text, regexes) {
  for (const re of regexes) {
    const m = text.match(re);
    if (m && m[1] != null) {
      return decodeHtml(m[1]).trim();
    }
  }

  return null;
}

/*
  Página pública do Mercado Livre.

  A API oficial está restringindo os dados de vários ITEMs
  de vendedores terceiros para este aplicativo (403).
  O highlights, porém, entrega Product IDs públicos.
  Usamos a página pública do produto como fallback para
  montar título, imagem, preço e possíveis referências
  promocionais sem depender de /items/{id}.
*/


async function publicProductPage(productId) {
  const fallbackUrl =
    "https://www.mercadolivre.com.br/p/" +
    encodeURIComponent(productId);

  try {
    const response = await fetch(fallbackUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36"
      },
      redirect: "follow"
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        url: fallbackUrl
      };
    }

    const html = await response.text();

    function attr(tag, name) {
      const re = new RegExp(
        name + "\\s*=\\s*[\"']([^\"']+)[\"']",
        "i"
      );

      const m = tag.match(re);

      return m
        ? decodeHtml(m[1]).trim()
        : null;
    }

    let title = null;
    let image = null;

    const metaTags = [
      ...html.matchAll(/<meta\b[^>]*>/gi)
    ];

    for (const m of metaTags) {
      const tag = m[0];

      const property =
        attr(tag, "property") ||
        attr(tag, "name");

      const content =
        attr(tag, "content");

      if (!content) continue;

      const key =
        String(property || "").toLowerCase();

      if (
        !title &&
        (
          key === "og:title" ||
          key === "twitter:title"
        )
      ) {
        title = content;
      }

      if (
        !image &&
        (
          key === "og:image" ||
          key === "twitter:image"
        )
      ) {
        image = content;
      }
    }

    if (!title) {
      title = firstMatch(html, [
        /<title[^>]*>([\s\S]*?)<\/title>/i
      ]);
    }

    /*
      JSON-LD.
    */
    const jsonLdBlocks = [
      ...html.matchAll(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
      )
    ];

    let jsonLdPrice = null;

    for (const block of jsonLdBlocks) {
      try {
        const parsed =
          JSON.parse(block[1]);

        const entries =
          Array.isArray(parsed)
            ? parsed
            : [parsed];

        for (const entry of entries) {
          if (
            !entry ||
            typeof entry !== "object"
          ) {
            continue;
          }

          if (
            !title &&
            entry.name
          ) {
            title =
              String(entry.name);
          }

          if (
            !image &&
            typeof entry.image === "string"
          ) {
            image =
              entry.image;
          }

          const offers =
            entry.offers;

          if (
            offers &&
            typeof offers === "object"
          ) {
            const list =
              Array.isArray(offers)
                ? offers
                : [offers];

            for (
              const offer
              of list
            ) {
              if (
                !offer ||
                typeof offer !== "object"
              ) {
                continue;
              }

              if (
                jsonLdPrice === null &&
                offer.price != null
              ) {
                const n =
                  toNumber(
                    offer.price
                  );

                if (
                  n !== null &&
                  n > 0
                ) {
                  jsonLdPrice =
                    n;
                }
              }
            }
          }
        }
      } catch {}
    }

    /*
      Meta de preço.
    */
    let price = null;

    for (const m of metaTags) {
      const tag = m[0];

      const property =
        attr(tag, "property") ||
        attr(tag, "name");

      const content =
        attr(tag, "content");

      const key =
        String(property || "").toLowerCase();

      if (
        content &&
        (
          key === "product:price:amount" ||
          key === "product:price"
        )
      ) {
        const n =
          toNumber(content);

        if (
          n !== null &&
          n > 0
        ) {
          price = n;
          break;
        }
      }
    }

    if (
      price === null &&
      jsonLdPrice !== null
    ) {
      price =
        jsonLdPrice;
    }

    /*
      Valores monetários visíveis.
    */
    const visibleAmounts = [];

    const moneyRe =
      /andes-money-amount__fraction[^>]*>\s*([\d.]+)\s*<([\s\S]{0,220})/gi;

    for (
      const m
      of html.matchAll(moneyRe)
    ) {
      const fraction =
        m[1];

      const tail =
        m[2] || "";

      let value =
        toNumber(fraction);

      const centsMatch =
        tail.match(
          /andes-money-amount__cents[^>]*>\s*(\d{1,2})\s*</i
        );

      if (
        centsMatch &&
        value !== null
      ) {
        const cents =
          centsMatch[1]
            .padStart(2, "0");

        value =
          Number(
            String(
              Math.trunc(value)
            ) +
            "." +
            cents
          );
      }

      if (
        value !== null &&
        value > 0 &&
        value < 100000000
      ) {
        visibleAmounts.push(
          value
        );
      }
    }

    const uniqueAmounts =
      [...new Set(
        visibleAmounts
      )];

    if (
      price === null &&
      uniqueAmounts.length
    ) {
      price =
        uniqueAmounts[0];
    }

    /*
      Preço original.
    */
    let originalPrice =
      toNumber(
        firstMatch(html, [
          /"original_price"\s*:\s*"?([0-9]+(?:\.\d+)?)"?/i,
          /"originalPrice"\s*:\s*"?([0-9]+(?:\.\d+)?)"?/i,
          /"regular_amount"\s*:\s*"?([0-9]+(?:\.\d+)?)"?/i,
          /"regularAmount"\s*:\s*"?([0-9]+(?:\.\d+)?)"?/i,
          /"list_price"\s*:\s*"?([0-9]+(?:\.\d+)?)"?/i
        ])
      );

    if (
      originalPrice === null &&
      price !== null
    ) {
      const bigger =
        uniqueAmounts.find(
          (n) => n > price
        );

      if (
        bigger !== undefined
      ) {
        originalPrice =
          bigger;
      }
    }

    let discount =
      toNumber(
        firstMatch(html, [
          /"(?:discount|discount_percentage|discountPercentage)"\s*:\s*"?([0-9]+(?:\.\d+)?)"?/i,
          /(?:^|\s)(\d{1,2})\s*%\\s*OFF(?:\s|<|$)/i
        ])
      );

    if (
      price !== null &&
      originalPrice !== null &&
      originalPrice > price &&
      originalPrice > 0
    ) {
      discount =
        Math.round(
          (
            (originalPrice - price) /
            originalPrice
          ) * 100
        );
    } else if (
      discount !== null &&
      (
        discount <= 0 ||
        discount > 95
      )
    ) {
      discount = null;
    }

    return {
      ok: true,
      status: response.status,
      url:
        response.url ||
        fallbackUrl,
      title,
      image,
      price,
      originalPrice,
      discount
    };

  } catch (error) {

    return {
      ok: false,
      status: 0,
      url: fallbackUrl,
      error:
        error.message ||
        String(error)
    };

  }
}
async function getProduct(productId, token) {
  return mlFetch(
    `/products/${encodeURIComponent(productId)}`,
    token
  );
}

async function getHighlights(categoryId, token) {
  return mlFetch(
    `/highlights/${SITE_ID}/category/${encodeURIComponent(categoryId)}`,
    token
  );
}

function imageFromProduct(detail) {
  if (
    detail &&
    Array.isArray(detail.pictures) &&
    detail.pictures.length
  ) {
    return (
      detail.pictures[0].secure_url ||
      detail.pictures[0].url ||
      null
    );
  }

  return null;
}

function scoreProduct({
  discount,
  position,
  freeShipping,
  hasPrice
}) {
  let score = 0;

  if (typeof discount === "number") {
    if (discount >= 50) score += 55;
    else if (discount >= 40) score += 48;
    else if (discount >= 30) score += 40;
    else if (discount >= 20) score += 30;
    else if (discount >= 10) score += 20;
  }

  if (freeShipping) score += 10;
  if (hasPrice) score += 10;

  if (typeof position === "number") {
    if (position <= 3) score += 25;
    else if (position <= 10) score += 18;
    else score += 10;
  }

  return Math.min(score, 100);
}

async function processCategory(categoryName, categoryId, token) {
  const ranking = await getHighlights(categoryId, token);

  if (!ranking.ok || !ranking.data) {
    return {
      products: [],
      error: {
        categoria: categoryName,
        categoria_id: categoryId,
        etapa: "highlights",
        status: ranking.status,
        resposta: ranking.data
      }
    };
  }

  const content = Array.isArray(ranking.data.content)
    ? ranking.data.content
    : [];

  /*
    Preferimos PRODUCT porque /products/{id} é público
    para esta aplicação e devolve nome/imagens/link.
    ITEM de terceiros está retornando 403 nos endpoints
    de item, portanto não o usamos para preencher cards vazios.
  */
  const candidates = content
    .filter((x) => x && x.type === "PRODUCT" && x.id)
    .slice(0, 12);

  const products = [];

  /*
    Processamento limitado e paralelo para manter
    o carregamento razoável no Vercel.
  */
  const chunks = [];

  for (let i = 0; i < candidates.length; i += 4) {
    chunks.push(candidates.slice(i, i + 4));
  }

  for (const chunk of chunks) {
    const details = await Promise.all(
      chunk.map(async (candidate) => {
        const apiDetail = await getProduct(
          candidate.id,
          token
        );

        /*
          A página pública complementa o que a API
          não estiver trazendo.
        */
        const publicData =
          await publicProductPage(candidate.id);

        return {
          candidate,
          apiDetail,
          publicData
        };
      })
    );

    for (const result of details) {
      const {
        candidate,
        apiDetail,
        publicData
      } = result;

      const detail =
        apiDetail.ok && apiDetail.data
          ? apiDetail.data
          : null;

      const title =
        (detail && detail.name) ||
        (publicData.ok && publicData.title) ||
        `Produto Mercado Livre ${candidate.id}`;

      const image =
        (publicData.ok && publicData.image) ||
        imageFromProduct(detail);

      const permalink =
        (detail && detail.permalink) ||
        (publicData.ok && publicData.url) ||
        `https://www.mercadolivre.com.br/p/${candidate.id}`;

      /*
        Preço da oferta vencedora, se existir.
      */
      let price =
        detail &&
        detail.buy_box_winner &&
        typeof detail.buy_box_winner.price === "number"
          ? detail.buy_box_winner.price
          : null;

      let originalPrice =
        detail &&
        detail.buy_box_winner &&
        typeof detail.buy_box_winner.original_price === "number"
          ? detail.buy_box_winner.original_price
          : null;

      let discount = null;

      if (
        price !== null &&
        originalPrice !== null &&
        originalPrice > price
      ) {
        discount = Math.round(
          ((originalPrice - price) / originalPrice) * 100
        );
      }

      /*
        Fallback para a página pública.
      */
      if (
        price === null &&
        publicData.ok &&
        typeof publicData.price === "number"
      ) {
        price = publicData.price;
      }

      if (
        originalPrice === null &&
        publicData.ok &&
        typeof publicData.originalPrice === "number"
      ) {
        originalPrice = publicData.originalPrice;
      }

      if (
        publicData.ok &&
        typeof publicData.discount === "number" &&
        publicData.discount > 0
      ) {
        discount = publicData.discount;
      }

      if (
        price !== null &&
        originalPrice !== null &&
        originalPrice > price &&
        originalPrice > 0
      ) {
        discount = Math.round(
          ((originalPrice - price) / originalPrice) * 100
        );
      }

      const winner =
        detail && detail.buy_box_winner
          ? detail.buy_box_winner
          : null;

      const freeShipping = Boolean(
        winner &&
        winner.shipping &&
        winner.shipping.free_shipping === true
      );

      const product = {
        id: candidate.id,
        item_id: winner && winner.item_id
          ? winner.item_id
          : null,

        title,
        titulo: title,

        permalink,
        link: permalink,

        image,
        imagem: image,
        thumbnail: image,

        price,
        preco: price,

        original_price:
          originalPrice !== null &&
          originalPrice > price
            ? originalPrice
            : null,

        preco_original:
          originalPrice !== null &&
          originalPrice > price
            ? originalPrice
            : null,

        discount:
          typeof discount === "number"
            ? discount
            : null,

        desconto:
          typeof discount === "number"
            ? discount
            : null,

        free_shipping: freeShipping,
        frete_gratis: freeShipping,

        sold_quantity:
          winner &&
          typeof winner.sold_quantity === "number"
            ? winner.sold_quantity
            : null,

        available_quantity:
          winner &&
          typeof winner.available_quantity === "number"
            ? winner.available_quantity
            : null,

        seller_id:
          winner &&
          winner.seller_id
            ? winner.seller_id
            : null,

        has_winner: Boolean(winner),

        condition: "Novo",

        position:
          typeof candidate.position === "number"
            ? candidate.position
            : null,

        ranking:
          typeof candidate.position === "number"
            ? candidate.position
            : null,

        mais_vendido: true,

        promocao:
          typeof discount === "number" &&
          discount > 0,

        tipo:
          typeof discount === "number" &&
          discount > 0
            ? "PROMOCAO"
            : "MAIS_VENDIDO",

        categoria: categoryName,

        score:
          scoreProduct({
            discount,
            position: candidate.position,
            freeShipping,
            hasPrice: typeof price === "number"
          }),

        fonte_dados:
          publicData.ok
            ? "highlights + products + página pública"
            : "highlights + products"
      };

      /*
        Só entra no resultado se conseguimos
        pelo menos o título. Assim nunca mais
        mostramos cards completamente vazios.
      */
      if (product.title) {
        products.push(product);
      }
    }
  }

  return {
    products,
    error: null
  };
}

module.exports = async function handler(req, res) {
  try {
    const sessao = await session(req, res);

    if (!sessao || !sessao.access_token) {
      return json(res, 401, {
        error: "Mercado Livre não conectado."
      });
    }

    const category = normalizeCategory(
      req.query?.categoria || "todas"
    );

    const selected =
      CATEGORIES[category] || CATEGORIES.todas;

    const allProducts = [];
    const errors = [];

    for (const [categoryName, categoryId] of selected) {
      const result =
        await processCategory(
          categoryName,
          categoryId,
          sessao.access_token
        );

      if (result.error) {
        errors.push(result.error);
      }

      allProducts.push(...result.products);
    }

    /*
      Remove duplicados.
    */
    const unique = [];
    const seen = new Set();

    for (const product of allProducts) {
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      unique.push(product);
    }

    /*
      Promoções primeiro; depois mais vendidos.
    */
    unique.sort((a, b) => {
      const promoA = a.promocao ? 1 : 0;
      const promoB = b.promocao ? 1 : 0;

      if (promoB !== promoA) {
        return promoB - promoA;
      }

      const scoreA = a.score || 0;
      const scoreB = b.score || 0;

      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }

      return (a.position || 999) - (b.position || 999);
    });

    const results = unique.slice(0, 30);

    const promotions =
      results.filter((p) => p.promocao);

    return json(res, 200, {
      ok: true,

      categoria: category,

      total: results.length,

      quantidade_promocoes:
        promotions.length,

      quantidade_mais_vendidos:
        results.filter((p) => !p.promocao).length,

      results,

      produtos: results,

      promocoes: promotions,

      erros: errors,

      fonte:
        "Mercado Livre /highlights + /products + página pública do produto"
    });

  } catch (error) {
    console.error(
      "ERRO ML PROMOCOES:",
      error
    );

    return json(res, 500, {
      error:
        error.message ||
        String(error)
    });
  }
};
