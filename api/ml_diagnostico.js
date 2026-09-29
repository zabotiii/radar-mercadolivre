const { session } = require("./lib");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.end(JSON.stringify(data));
}

async function mlFetch(path, token) {
  try {

    const response = await fetch(
      "https://api.mercadolibre.com" + path,
      {
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
      error:
        error.message ||
        String(error)
    };
  }
}

module.exports = async function handler(req, res) {

  try {

    const sessao =
      await session(req, res);

    if (
      !sessao ||
      !sessao.access_token
    ) {

      return json(
        res,
        401,
        {
          erro:
            "Mercado Livre não conectado."
        }
      );
    }

    const token =
      sessao.access_token;

    const categorias = [

      {
        nome: "Celulares",
        id: "MLB1051"
      },

      {
        nome: "Eletrônicos",
        id: "MLB1000"
      },

      {
        nome: "Casa",
        id: "MLB1574"
      },

      {
        nome: "Informática",
        id: "MLB1648"
      },

      {
        nome: "Games",
        id: "MLB1144"
      },

      {
        nome: "Moda",
        id: "MLB1430"
      }

    ];

    const resultados = [];

    for (
      const categoria
      of categorias
    ) {

      /*
        Busca ranking
      */

      const ranking =
        await mlFetch(
          `/highlights/MLB/category/${categoria.id}`,
          token
        );

      if (
        !ranking.ok ||
        !ranking.data
      ) {

        resultados.push({
          categoria:
            categoria.nome,

          erro:
            ranking.data ||
            ranking.error ||
            "Erro no highlights"
        });

        continue;
      }

      const content =
        Array.isArray(
          ranking.data.content
        )
          ? ranking.data.content
          : [];

      /*
        IMPORTANTE:
        Agora pegamos somente ITEM.

        ITEM = anúncio real.
      */

      const itens =
        content.filter(
          x =>
            x &&
            x.type === "ITEM" &&
            x.id
        );

      const produtos = [];

      /*
        Testa todos os ITEMs encontrados.
      */

      for (
        const destaque
        of itens
      ) {

        /*
          Dados do anúncio
        */

        const item =
          await mlFetch(
            `/items/${encodeURIComponent(destaque.id)}`,
            token
          );

        /*
          Preços
        */

        const prices =
          await mlFetch(
            `/items/${encodeURIComponent(destaque.id)}/prices`,
            token
          );

        /*
          Sale price
        */

        const salePrice =
          await mlFetch(
            `/items/${encodeURIComponent(destaque.id)}/sale_price?context=channel_marketplace`,
            token
          );

        /*
          Analisa preços
        */

        let standard = null;
        let promotion = null;

        if (
          prices.ok &&
          prices.data &&
          Array.isArray(
            prices.data.prices
          )
        ) {

          standard =
            prices.data.prices.find(
              p =>
                p.type === "standard"
            ) || null;

          promotion =
            prices.data.prices.find(
              p =>
                p.type === "promotion"
            ) || null;
        }

        /*
          Dados do sale_price
        */

        let venda = null;

        if (
          salePrice.ok &&
          salePrice.data
        ) {

          venda = {
            amount:
              salePrice.data.amount ??
              null,

            regular_amount:
              salePrice.data.regular_amount ??
              null,

            currency_id:
              salePrice.data.currency_id ??
              null,

            metadata:
              salePrice.data.metadata ??
              null
          };
        }

        /*
          Decide se existe promoção.
        */

        let promocao = false;

        let precoAtual = null;

        let precoOriginal = null;

        let desconto = 0;

        /*
          Primeiro usamos sale_price.
        */

        if (
          venda &&
          typeof venda.amount ===
            "number"
        ) {

          precoAtual =
            venda.amount;

          if (
            typeof venda.regular_amount ===
              "number" &&
            venda.regular_amount >
              venda.amount
          ) {

            precoOriginal =
              venda.regular_amount;

            promocao = true;
          }
        }

        /*
          Se não encontrou,
          tenta /prices.
        */

        if (
          !promocao &&
          promotion &&
          typeof promotion.amount ===
            "number" &&
          typeof promotion.regular_amount ===
            "number" &&
          promotion.regular_amount >
            promotion.amount
        ) {

          precoAtual =
            promotion.amount;

          precoOriginal =
            promotion.regular_amount;

          promocao = true;
        }

        /*
          Calcula desconto.
        */

        if (
          promocao &&
          precoAtual !== null &&
          precoOriginal !== null &&
          precoOriginal > 0
        ) {

          desconto =
            Math.round(
              (
                (
                  precoOriginal -
                  precoAtual
                ) /
                precoOriginal
              ) * 100
            );
        }

        /*
          Monta resultado.
        */

        produtos.push({

          position:
            destaque.position,

          item_id:
            destaque.id,

          tipo:
            destaque.type,

          titulo:
            item.data &&
            item.data.title
              ? item.data.title
              : null,

          permalink:
            item.data &&
            item.data.permalink
              ? item.data.permalink
              : null,

          thumbnail:
            item.data &&
            (
              item.data.thumbnail ||
              (
                Array.isArray(
                  item.data.pictures
                ) &&
                item.data.pictures[0]
                  ? (
                      item.data.pictures[0]
                        .secure_url ||
                      item.data.pictures[0]
                        .url
                    )
                  : null
              )
            ),

          promocao,

          preco_atual:
            precoAtual,

          preco_original:
            precoOriginal,

          desconto,

          standard:

            standard
              ? {
                  amount:
                    standard.amount,

                  regular_amount:
                    standard.regular_amount,

                  currency_id:
                    standard.currency_id
                }
              : null,

          promotion:

            promotion
              ? {
                  amount:
                    promotion.amount,

                  regular_amount:
                    promotion.regular_amount,

                  currency_id:
                    promotion.currency_id
                }
              : null,

          sale_price:
            venda,

          sale_price_status:
            salePrice.status,

          prices_status:
            prices.status,

          item_status:
            item.status

        });
      }

      resultados.push({

        categoria:
          categoria.nome,

        categoria_id:
          categoria.id,

        quantidade_itens:
          itens.length,

        quantidade_promocoes:
          produtos.filter(
            p =>
              p.promocao
          ).length,

        itens:
          produtos

      });
    }

    /*
      Junta todas as promoções
    */

    const promocoes = [];

    for (
      const categoria
      of resultados
    ) {

      for (
        const produto
        of (
          categoria.itens ||
          []
        )
      ) {

        if (
          produto.promocao
        ) {

          promocoes.push({

            categoria:
              categoria.categoria,

            ...produto

          });
        }
      }
    }

    /*
      Ordena pelo maior desconto.
    */

    promocoes.sort(
      (a, b) =>
        (b.desconto || 0) -
        (a.desconto || 0)
    );

    return json(
      res,
      200,
      {

        diagnostico:
          "TESTE DE PROMOÇÕES EM ITEMS",

        quantidade_itens:
          resultados.reduce(
            (total, categoria) =>
              total +
              (
                categoria.quantidade_itens ||
                0
              ),
            0
          ),

        quantidade_promocoes:
          promocoes.length,

        promocoes:
          promocoes.slice(
            0,
            50
          ),

        categorias:
          resultados,

        conclusao:

          promocoes.length > 0

            ? "ENCONTRAMOS PROMOÇÕES EM ITEMS"

            : "NENHUM ITEM TESTADO POSSUI PREÇO PROMOCIONAL"

      }
    );

  } catch (error) {

    console.error(
      "ERRO DIAGNOSTICO:",
      error
    );

    return json(
      res,
      500,
      {

        diagnostico:
          "ERRO",

        mensagem:
          error.message ||
          String(error)

      }
    );
  }
};
