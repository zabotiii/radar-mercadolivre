const {
  session
} = require("./lib");

async function getCategoryName(categoryId, token) {
  if (!categoryId) return null;

  try {
    const response = await fetch(
      "https://api.mercadolibre.com/categories/" + encodeURIComponent(categoryId),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
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
  if (name) return 0.12;

  return null;
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
  product.affiliate_commission_label =
    rate !== null ? Math.round(rate * 100) + "%" : null;

  return product;
}

module.exports = async function(req, res) {

  try {

    if (req.method !== "GET") {

      return res.status(405).json({
        error: "Método não permitido."
      });

    }


    // Verifica a sessão do Mercado Livre
    const sess = await session(req, res);


    if (!sess) {

      return res.status(401).json({
        error: "Mercado Livre não conectado."
      });

    }


    const q =
      String(
        req.query?.q || ""
      ).trim();


    if (!q) {

      return res.status(400).json({
        error: "Digite um termo de busca."
      });

    }


    // Busca no catálogo atual do Mercado Livre
    const searchUrl =
      "https://api.mercadolibre.com/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      "&q=" +
      encodeURIComponent(q) +
      "&limit=30";


    const searchResponse =
      await fetch(
        searchUrl,
        {
          method: "GET",
          headers: {
            "Authorization":
              `Bearer ${sess.access_token}`,
            "Accept":
              "application/json"
          }
        }
      );


    const searchText =
      await searchResponse.text();


    let searchData = {};

    try {

      searchData =
        JSON.parse(searchText);

    } catch (error) {

      return res.status(502).json({
        error:
          "O Mercado Livre retornou uma resposta inválida.",
        details:
          searchText.substring(0, 500)
      });

    }


    if (!searchResponse.ok) {

      return res.status(
        searchResponse.status
      ).json({

        error:
          searchData.message ||
          searchData.error ||
          "Erro na busca do Mercado Livre.",

        details:
          searchData

      });

    }


    const rawProducts =
      Array.isArray(searchData.results)
        ? searchData.results
        : [];


    const products = [];


    // Busca detalhes de cada produto
    for (
      const product of rawProducts
    ) {

      try {

        const detailResponse =
          await fetch(
            "https://api.mercadolibre.com/products/" +
            encodeURIComponent(product.id),
            {
              method: "GET",
              headers: {
                "Authorization":
                  `Bearer ${sess.access_token}`,
                "Accept":
                  "application/json"
              }
            }
          );


        if (!detailResponse.ok) {
          continue;
        }


        const detailText =
          await detailResponse.text();


        let detail = null;


        try {

          detail =
            JSON.parse(detailText);

        } catch (error) {

          continue;

        }


        const winner =
          detail.buy_box_winner ||
          null;


        const price =
          winner &&
          typeof winner.price === "number"
            ? winner.price
            : null;


        const priceRange =
          detail.buy_box_winner_price_range ||
          null;


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


        let discount = null;


        if (
          typeof price === "number" &&
          typeof originalPrice === "number" &&
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

        }


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
          Boolean(
            winner &&
            winner.shipping &&
            winner.shipping.free_shipping === true
          );


        const sellerId =
          winner &&
          winner.seller_id
            ? winner.seller_id
            : null;


        const image =
          detail.pictures &&
          detail.pictures.length
            ? detail.pictures[0].url
            : null;


        const permalink =
          detail.permalink ||
          product.permalink ||
          `https://www.mercadolivre.com.br/p/${product.id}`;


        const itemId =
          winner &&
          winner.item_id
            ? winner.item_id
            : null;


        // =========================================
        // RADAR SCORE
        // =========================================

        let score = 0;


        if (
          typeof discount === "number"
        ) {

          if (discount >= 50) {

            score += 35;

          } else if (discount >= 40) {

            score += 30;

          } else if (discount >= 30) {

            score += 25;

          } else if (discount >= 20) {

            score += 18;

          } else if (discount >= 10) {

            score += 10;

          }

        }


        if (winner) {
          score += 20;
        }


        if (freeShipping) {
          score += 10;
        }


        if (
          typeof availableQuantity === "number" &&
          availableQuantity > 0
        ) {

          score += 10;

        }


        if (
          typeof soldQuantity === "number"
        ) {

          if (soldQuantity >= 1000) {

            score += 15;

          } else if (soldQuantity >= 500) {

            score += 12;

          } else if (soldQuantity >= 100) {

            score += 9;

          } else if (soldQuantity >= 50) {

            score += 6;

          } else if (soldQuantity > 0) {

            score += 3;

          }

        }


        score =
          Math.min(
            score,
            100
          );


        products.push({

          id:
            product.id,

          item_id:
            itemId,

          title:
            detail.name ||
            product.name ||
            "Produto Mercado Livre",

          permalink,

          image,

          price,

          price_min:
            priceMin,

          price_max:
            priceMax,

          original_price:
            originalPrice,

          discount,

          sold_quantity:
            soldQuantity,

          available_quantity:
            availableQuantity,

          free_shipping:
            freeShipping,

          seller_id:
            sellerId,

          has_winner:
            Boolean(winner),

          condition:
            "Novo",

          category_id:
            detail.category_id ||
            product.category_id ||
            null,

          category_name:
            null,

          affiliate_commission_rate:
            null,

          affiliate_commission_estimate:
            null,

          affiliate_commission_label:
            null,

          score

        });


      } catch (error) {

        console.error(
          "Erro ao processar produto:",
          product.id,
          error
        );

      }

    }


    // =========================================
    // COMISSÃO ESTIMADA
    // =========================================

    await Promise.all(
      products.map(async product => {
        const categoryName = await getCategoryName(
          product.category_id,
          sess.access_token
        );
        applyAffiliateCommission(product, categoryName);
      })
    );

    // =========================================
    // ORDENAÇÃO
    // =========================================

    products.sort(
      (a, b) => {

        if (
          b.score !== a.score
        ) {

          return (
            b.score -
            a.score
          );

        }


        const discountA =
          typeof a.discount === "number"
            ? a.discount
            : 0;


        const discountB =
          typeof b.discount === "number"
            ? b.discount
            : 0;


        return (
          discountB -
          discountA
        );

      }
    );


    return res.status(200).json({

      keywords:
        q,

      total:
        products.length,

      results:
        products

    });


  } catch (error) {

    console.error(
      "ERRO RADAR:",
      error
    );


    return res.status(500).json({

      error:
        "Erro interno no Radar.",

      details:
        error.message

    });

  }

};
