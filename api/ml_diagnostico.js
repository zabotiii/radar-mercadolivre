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
    } catch (e) {
      data = null;
    }

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

async function buscarProdutos(
  termo,
  token
) {

  const url =
    "/products/search" +
    "?status=active" +
    "&site_id=MLB" +
    "&limit=20" +
    "&q=" +
    encodeURIComponent(termo);

  return await mlFetch(
    url,
    token
  );
}

async function buscarProduto(
  productId,
  token
) {

  return await mlFetch(
    "/products/" +
      encodeURIComponent(productId),
    token
  );
}

module.exports =
  async function handler(req, res) {

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
            erro:
              "Mercado Livre não conectado."
          }
        );
      }

      const token =
        sessao.access_token;

      /*
       * Termos escolhidos para encontrar
       * produtos populares que provavelmente
       * possuem vendedores competindo.
       */

      const termos = [

        "iphone 13 128gb",

        "iphone 15 128gb",

        "iphone 16 128gb",

        "samsung galaxy a55",

        "samsung galaxy s24",

        "xiaomi redmi note",

        "playstation 5",

        "xbox series s",

        "air fryer",

        "smart tv 50",

        "notebook",

        "monitor gamer",

        "headset gamer",

        "smartwatch"

      ];

      const vencedores = [];

      const semVencedor = [];

      const erros = [];

      /*
       * Fazemos as buscas dos termos em paralelo.
       */

      const buscas =
        await Promise.all(
          termos.map(
            termo =>
              buscarProdutos(
                termo,
                token
              )
          )
        );

      for (
        let i = 0;
        i < termos.length;
        i++
      ) {

        const termo =
          termos[i];

        const busca =
          buscas[i];

        if (
          !busca.ok
        ) {

          erros.push({
            termo,
            status:
              busca.status,
            resposta:
              busca.data
          });

          continue;
        }

        const produtos =
          busca.data &&
          Array.isArray(
            busca.data.results
          )
            ? busca.data.results
            : [];

        /*
         * Testa até 10 produtos de cada termo.
         */

        const candidatos =
          produtos.slice(
            0,
            10
          );

        /*
         * Consultamos em paralelo.
         */

        const detalhes =
          await Promise.all(
            candidatos.map(
              produto =>
                buscarProduto(
                  produto.id,
                  token
                )
            )
          );

        for (
          let j = 0;
          j < detalhes.length;
          j++
        ) {

          const detalhe =
            detalhes[j];

          const produto =
            candidatos[j];

          if (
            !detalhe.ok ||
            !detalhe.data
          ) {
            continue;
          }

          /*
           * Encontrou Buy Box.
           */

          if (
            detalhe.data
              .buy_box_winner &&
            detalhe.data
              .buy_box_winner
              .item_id
          ) {

            const winner =
              detalhe.data
                .buy_box_winner;

            vencedores.push({

              termo,

              product_id:
                detalhe.data.id,

              nome:
                detalhe.data.name,

              item_id:
                winner.item_id,

              seller_id:
                winner.seller_id ||
                null,

              preco:
                winner.price ||
                null,

              original_price:
                winner.original_price ||
                null,

              available_quantity:
                winner.available_quantity ||
                null,

              sold_quantity:
                winner.sold_quantity ||
                null,

              frete_gratis:
                winner.shipping &&
                winner.shipping
                  .free_shipping === true,

              permalink:
                detalhe.data
                  .permalink ||
                null,

              imagem:
                detalhe.data
                  .pictures &&
                detalhe.data
                  .pictures[0]
                  ? detalhe.data
                      .pictures[0]
                      .url
                  : null
            });

          } else {

            semVencedor.push({

              termo,

              product_id:
                produto.id,

              nome:
                produto.name,

              buy_box_winner:
                null

            });
          }
        }
      }

      /*
       * Remove duplicados.
       */

      const unicos =
        [];

      const ids =
        new Set();

      for (
        const vencedor
        of vencedores
      ) {

        if (
          !ids.has(
            vencedor.item_id
          )
        ) {

          ids.add(
            vencedor.item_id
          );

          unicos.push(
            vencedor
          );
        }
      }

      return json(
        res,
        200,
        {

          diagnostico:
            "BUSCA DE VENCEDORES CONCLUIDA",

          termos_testados:
            termos,

          quantidade_vencedores:
            unicos.length,

          vencedores:
            unicos.slice(
              0,
              30
            ),

          quantidade_sem_vencedor:
            semVencedor.length,

          erros,

          conclusao:
            unicos.length > 0
              ? "ENCONTRAMOS PRODUTOS COM BUY_BOX_WINNER"
              : "NENHUM DOS PRODUTOS TESTADOS POSSUI BUY_BOX_WINNER"

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
