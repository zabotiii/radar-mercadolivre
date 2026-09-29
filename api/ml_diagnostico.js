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
      error: error.message
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
      return json(res, 401, {
        erro:
          "Mercado Livre não conectado."
      });
    }

    const token =
      sessao.access_token;

    /*
      Primeiro testamos diretamente
      uma categoria folha conhecida.
    */

    const categorias = [
      "MLB1051",
      "MLB1000",
      "MLB1574",
      "MLB1648",
      "MLB1144",
      "MLB1430"
    ];

    const resultados = [];

    for (
      const categoria
      of categorias
    ) {

      const r =
        await mlFetch(
          `/highlights/MLB/category/${categoria}`,
          token
        );

      const content =
        r.ok &&
        r.data &&
        Array.isArray(
          r.data.content
        )
          ? r.data.content
          : [];

      const tipos = {};

      for (
        const item
        of content
      ) {

        const tipo =
          item.type ||
          "SEM_TIPO";

        tipos[tipo] =
          (tipos[tipo] || 0) + 1;
      }

      resultados.push({

        categoria,

        status:
          r.status,

        ok:
          r.ok,

        quantidade:
          content.length,

        tipos,

        primeiros:
          content.slice(
            0,
            20
          )

      });
    }

    /*
      Também testa diretamente alguns
      PRODUCT IDs encontrados.
    */

    const products = [];

    for (
      const resultado
      of resultados
    ) {

      const lista =
        resultado.primeiros ||
        [];

      const productIds =
        lista
          .filter(
            x =>
              x.type ===
              "PRODUCT"
          )
          .slice(
            0,
            3
          );

      for (
        const produto
        of productIds
      ) {

        const r =
          await mlFetch(
            `/products/${encodeURIComponent(produto.id)}`,
            token
          );

        products.push({

          id:
            produto.id,

          status:
            r.status,

          ok:
            r.ok,

          nome:
            r.data &&
            r.data.name
              ? r.data.name
              : null,

          buy_box_winner:
            r.data &&
            r.data.buy_box_winner
              ? {
                  item_id:
                    r.data
                      .buy_box_winner
                      .item_id ||
                    null,

                  seller_id:
                    r.data
                      .buy_box_winner
                      .seller_id ||
                    null,

                  price:
                    r.data
                      .buy_box_winner
                      .price ||
                    null
                }
              : null

        });
      }
    }

    /*
      USER PRODUCTS
    */

    const userProducts = [];

    for (
      const resultado
      of resultados
    ) {

      const lista =
        resultado.primeiros ||
        [];

      const ups =
        lista
          .filter(
            x =>
              x.type ===
              "USER_PRODUCT"
          )
          .slice(
            0,
            3
          );

      for (
        const up
        of ups
      ) {

        const r =
          await mlFetch(
            `/user-products/${encodeURIComponent(up.id)}`,
            token
          );

        userProducts.push({

          id:
            up.id,

          status:
            r.status,

          ok:
            r.ok,

          resposta:
            r.data

        });
      }
    }

    return json(
      res,
      200,
      {

        diagnostico:
          "HIGHLIGHTS COMPLETO",

        categorias:
          resultados,

        products,

        userProducts

      }
    );

  } catch (error) {

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
