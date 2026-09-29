const { session } = require("./lib");

module.exports = async function (req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        error: "Método não permitido."
      });
    }

    const sess = await session(req, res);

    if (!sess || !sess.access_token) {
      return res.status(401).json({
        error: "Conecte sua conta do Mercado Livre primeiro."
      });
    }

    const token = sess.access_token;

    // =========================================================
    // CATEGORIAS
    // =========================================================

    const categorias = {
      "📱 Celulares": [
        "celular",
        "smartphone",
        "iphone",
        "samsung galaxy"
      ],

      "🎧 Eletrônicos": [
        "fone bluetooth",
        "smartwatch",
        "caixa de som bluetooth",
        "tv smart"
      ],

      "🏠 Casa": [
        "air fryer",
        "aspirador de pó",
        "cafeteira",
        "liquidificador",
        "ventilador"
      ],

      "💻 Informática": [
        "notebook",
        "monitor",
        "teclado gamer",
        "mouse gamer",
        "ssd"
      ],

      "🎮 Games": [
        "playstation 5",
        "xbox",
        "nintendo switch",
        "controle gamer",
        "headset gamer"
      ],

      "👕 Moda": [
        "tênis masculino",
        "tênis feminino",
        "camiseta",
        "mochila",
        "relógio"
      ]
    };

    const categoriaSolicitada =
      String(req.query?.categoria || "Todas").trim();

    let termos = [];

    if (
      categoriaSolicitada !== "Todas" &&
      categorias[categoriaSolicitada]
    ) {
      termos = categorias[categoriaSolicitada].map(
        termo => ({
          categoria: categoriaSolicitada,
          termo
        })
      );
    } else {
      for (const [categoria, lista] of Object.entries(
        categorias
      )) {
        for (const termo of lista) {
          termos.push({
            categoria,
            termo
          });
        }
      }
    }

    // =========================================================
    // REQUEST MERCADO LIVRE
    // =========================================================

    async function mlRequest(url) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      });

      const text = await response.text();

      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(
          `Resposta inválida do Mercado Livre (${response.status}).`
        );
      }

      if (!response.ok) {
        throw new Error(
          data.message ||
          data.error ||
          `Erro Mercado Livre ${response.status}.`
        );
      }

      return data;
    }

    // =========================================================
    // BUSCAR PRODUTOS DE CATÁLOGO
    // =========================================================

    const mapaProdutos = new Map();

    for (const item of termos) {
      try {
        const url =
          "https://api.mercadolibre.com/products/search" +
          "?status=active" +
          "&site_id=MLB" +
          "&q=" +
          encodeURIComponent(item.termo) +
          "&limit=10";

        const data = await mlRequest(url);

        const produtos = Array.isArray(data.results)
          ? data.results
          : [];

        for (const produto of produtos) {
          if (!produto.id) continue;

          if (!mapaProdutos.has(produto.id)) {
            mapaProdutos.set(produto.id, {
              id: produto.id,
              categoria: item.categoria,
              termo: item.termo
            });
          }
        }
      } catch (error) {
        console.error(
          "Erro na busca:",
          item.termo,
          error.message
        );
      }
    }

    // =========================================================
    // PROCESSAR PRODUTOS
    // =========================================================

    const resultados = [];

    /*
      Limitamos a quantidade para evitar excesso
      de chamadas na API.
    */
    const candidatos =
      Array.from(mapaProdutos.values()).slice(0, 40);

    for (const base of candidatos) {
      try {

        // =====================================================
        // DETALHE DO PRODUTO
        // =====================================================

        const produto =
          await mlRequest(
            "https://api.mercadolibre.com/products/" +
            encodeURIComponent(base.id)
          );

        let winner =
          produto.buy_box_winner || null;

        // =====================================================
        // FALLBACK:
        // ALGUNS PRODUTOS POSSUEM FILHOS
        // =====================================================

        if (
          !winner &&
          Array.isArray(produto.children_ids) &&
          produto.children_ids.length
        ) {

          const children =
            produto.children_ids.slice(0, 3);

          for (const childId of children) {

            try {

              const child =
                await mlRequest(
                  "https://api.mercadolibre.com/products/" +
                  encodeURIComponent(childId)
                );

              if (
                child &&
                child.buy_box_winner
              ) {
                winner =
                  child.buy_box_winner;

                break;
              }

            } catch (error) {
              console.error(
                "Erro no produto filho:",
                childId,
                error.message
              );
            }
          }
        }

        // =====================================================
        // DADOS INICIAIS
        // =====================================================

        let price = null;

        let originalPrice = null;

        let priceMin = null;

        let priceMax = null;

        let discount = null;

        let soldQuantity = null;

        let availableQuantity = null;

        let freeShipping = false;

        let itemId = null;

        let sellerId = null;

        let itemTitle = null;

        let itemPermalink = null;

        // =====================================================
        // SE ENCONTROU PUBLICAÇÃO VENCEDORA
        // =====================================================

        if (winner) {

          itemId =
            winner.item_id || null;

          sellerId =
            winner.seller_id || null;

          if (
            typeof winner.price === "number"
          ) {
            price =
              winner.price;
          }

          if (
            winner.price_range &&
            typeof winner.price_range.min ===
              "number"
          ) {
            priceMin =
              winner.price_range.min;
          }

          if (
            winner.price_range &&
            typeof winner.price_range.max ===
              "number"
          ) {
            priceMax =
              winner.price_range.max;
          }

          if (
            typeof winner.original_price ===
              "number"
          ) {
            originalPrice =
              winner.original_price;
          }

          if (
            typeof winner.sold_quantity ===
              "number"
          ) {
            soldQuantity =
              winner.sold_quantity;
          }

          if (
            typeof winner.available_quantity ===
              "number"
          ) {
            availableQuantity =
              winner.available_quantity;
          }

          if (
            winner.shipping &&
            winner.shipping.free_shipping === true
          ) {
            freeShipping = true;
          }

        }

        // =====================================================
        // CONSULTAR O ITEM VENCEDOR
        // =====================================================

        if (itemId) {

          try {

            const item =
              await mlRequest(
                "https://api.mercadolibre.com/items/" +
                encodeURIComponent(itemId)
              );

            itemTitle =
              item.title || null;

            itemPermalink =
              item.permalink || null;

            if (
              typeof item.price === "number" &&
              price === null
            ) {
              price =
                item.price;
            }

            if (
              typeof item.original_price ===
                "number"
            ) {
              originalPrice =
                item.original_price;
            }

            if (
              typeof item.available_quantity ===
                "number"
            ) {
              availableQuantity =
                item.available_quantity;
            }

            if (
              typeof item.sold_quantity ===
                "number"
            ) {
              soldQuantity =
                item.sold_quantity;
            }

            if (
              item.shipping &&
              item.shipping.free_shipping === true
            ) {
              freeShipping = true;
            }

          } catch (error) {

            console.error(
              "Erro ao consultar item:",
              itemId,
              error.message
            );

          }

        }

        // =====================================================
        // CONSULTAR PREÇOS DO ITEM
        // =====================================================

        if (itemId) {

          try {

            const prices =
              await mlRequest(
                "https://api.mercadolibre.com/items/" +
                encodeURIComponent(itemId) +
                "/prices"
              );

            if (
              Array.isArray(prices.prices)
            ) {

              const standard =
                prices.prices.find(
                  p =>
                    p.type === "standard"
                );

              const promotion =
                prices.prices.find(
                  p =>
                    p.type === "promotion"
                );

              if (
                promotion &&
                typeof promotion.amount ===
                  "number"
              ) {

                if (
                  !price ||
                  promotion.amount < price
                ) {
                  price =
                    promotion.amount;
                }

                if (
                  standard &&
                  typeof standard.amount ===
                    "number"
                ) {
                  originalPrice =
                    standard.amount;
                }

              } else if (
                !price &&
                standard &&
                typeof standard.amount ===
                  "number"
              ) {

                price =
                  standard.amount;

              }

            }

          } catch (error) {

            console.error(
              "Erro ao consultar preços:",
              itemId,
              error.message
            );

          }

        }

        // =====================================================
        // CALCULAR DESCONTO
        // =====================================================

        if (
          typeof price === "number" &&
          typeof originalPrice === "number" &&
          originalPrice > price
        ) {

          discount =
            Math.round(
              (
                (originalPrice - price) /
                originalPrice
              ) * 100
            );

        }

        // =====================================================
        // RADAR SCORE
        // =====================================================

        let score = 0;

        if (winner) {
          score += 20;
        }

        if (discount !== null) {

          if (discount >= 50) {
            score += 45;
          } else if (discount >= 40) {
            score += 40;
          } else if (discount >= 30) {
            score += 32;
          } else if (discount >= 20) {
            score += 24;
          } else if (discount >= 10) {
            score += 12;
          }

        }

        if (freeShipping) {
          score += 15;
        }

        if (
          typeof soldQuantity ===
            "number"
        ) {

          if (soldQuantity >= 1000) {
            score += 15;
          } else if (soldQuantity >= 500) {
            score += 12;
          } else if (soldQuantity >= 100) {
            score += 9;
          } else if (soldQuantity >= 20) {
            score += 5;
          }

        }

        if (
          typeof availableQuantity ===
            "number" &&
          availableQuantity > 0
        ) {
          score += 5;
        }

        if (score > 100) {
          score = 100;
        }

        // =====================================================
        // IMAGEM
        // =====================================================

        let image = null;

        if (
          Array.isArray(
            produto.pictures
          ) &&
          produto.pictures.length
        ) {

          image =
            produto.pictures[0].url ||
            produto.pictures[0].secure_url ||
            null;

        }

        // =====================================================
        // LINK
        // =====================================================

        const permalink =
          itemPermalink ||
          produto.permalink ||
          null;

        // =====================================================
        // TÍTULO
        // =====================================================

        const title =
          itemTitle ||
          produto.name ||
          produto.title ||
          "Produto Mercado Livre";

        // =====================================================
        // ADICIONAR RESULTADO
        // =====================================================

        resultados.push({

          id:
            produto.id,

          title,

          category:
            base.categoria,

          search_term:
            base.termo,

          image,

          permalink,

          price,

          original_price:
            originalPrice,

          price_min:
            priceMin,

          price_max:
            priceMax,

          discount,

          sold_quantity:
            soldQuantity,

          available_quantity:
            availableQuantity,

          free_shipping:
            freeShipping,

          has_winner:
            !!winner,

          item_id:
            itemId,

          seller_id:
            sellerId,

          condition:
            "Novo",

          score

        });

      } catch (error) {

        console.error(
          "Erro ao processar produto:",
          base.id,
          error.message
        );

      }
    }

    // =========================================================
    // ORDENAR
    // =========================================================

    resultados.sort(
      (a, b) => {

        if (
          b.score !== a.score
        ) {
          return (
            b.score -
            a.score
          );
        }

        const descontoA =
          typeof a.discount ===
            "number"
            ? a.discount
            : 0;

        const descontoB =
          typeof b.discount ===
            "number"
            ? b.discount
            : 0;

        return (
          descontoB -
          descontoA
        );

      }
    );

    // =========================================================
    // PRIORIZAR OFERTAS REAIS
    // =========================================================

    resultados.sort(
      (a, b) => {

        const aOferta =
          a.price !== null &&
          a.has_winner;

        const bOferta =
          b.price !== null &&
          b.has_winner;

        if (
          aOferta &&
          !bOferta
        ) {
          return -1;
        }

        if (
          !aOferta &&
          bOferta
        ) {
          return 1;
        }

        return 0;

      }
    );

    // =========================================================
    // RETORNO
    // =========================================================

    return res.status(200).json({

      success: true,

      categoria:
        categoriaSolicitada,

      total:
        resultados.length,

      results:
        resultados.slice(
          0,
          50
        )

    });

  } catch (error) {

    console.error(
      "Erro geral no Radar:",
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
