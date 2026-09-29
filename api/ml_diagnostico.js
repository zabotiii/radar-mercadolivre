const { session } = require("./lib");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.end(JSON.stringify(data));
}

async function consultar(url, token) {
  try {
    const resposta = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });

    let dados = null;

    try {
      dados = await resposta.json();
    } catch (e) {
      dados = null;
    }

    return {
      status: resposta.status,
      ok: resposta.ok,
      resposta: dados
    };

  } catch (erro) {
    return {
      status: 0,
      ok: false,
      erro: erro.message || String(erro)
    };
  }
}

module.exports = async function handler(req, res) {
  try {

    const sessao = await session(req, res);

    if (!sessao || !sessao.access_token) {
      return json(res, 401, {
        erro: "Mercado Livre não conectado."
      });
    }

    const token = sessao.access_token;

    /*
     * Produto real que o /products/search
     * retornou no nosso diagnóstico.
     */
    const productId = "MLB50181722";

    /*
     * TESTE 1
     * Detalhes do produto
     */
    const produto = await consultar(
      "https://api.mercadolibre.com/products/" +
        productId,
      token
    );

    /*
     * TESTE 2
     * Se houver vencedor, testamos o item.
     */
    let item = null;
    let prices = null;

    let itemId = null;

    if (
      produto.ok &&
      produto.resposta &&
      produto.resposta.buy_box_winner &&
      produto.resposta.buy_box_winner.item_id
    ) {
      itemId =
        produto.resposta.buy_box_winner.item_id;

      item = await consultar(
        "https://api.mercadolibre.com/items/" +
          encodeURIComponent(itemId),
        token
      );

      prices = await consultar(
        "https://api.mercadolibre.com/items/" +
          encodeURIComponent(itemId) +
          "/prices",
        token
      );
    }

    /*
     * Retorno resumido + resposta completa
     */
    return json(res, 200, {

      diagnostico: "PRODUTO_TESTADO",

      product_id: productId,

      produto: {
        status: produto.status,
        funcionando: produto.ok,

        id:
          produto.resposta
            ? produto.resposta.id
            : null,

        nome:
          produto.resposta
            ? produto.resposta.name
            : null,

        buy_box_winner:
          produto.resposta
            ? produto.resposta.buy_box_winner || null
            : null,

        children_ids:
          produto.resposta
            ? produto.resposta.children_ids || []
            : [],

        resposta_completa:
          produto.resposta
      },

      item: {
        item_id: itemId,

        status:
          item
            ? item.status
            : null,

        funcionando:
          item
            ? item.ok
            : false,

        resposta:
          item
            ? item.resposta
            : null
      },

      prices: {
        item_id: itemId,

        status:
          prices
            ? prices.status
            : null,

        funcionando:
          prices
            ? prices.ok
            : false,

        resposta:
          prices
            ? prices.resposta
            : null
      },

      conclusao: {
        product:
          produto.ok
            ? "OK"
            : "ERRO",

        buy_box_winner:
          produto.resposta &&
          produto.resposta.buy_box_winner
            ? "ENCONTRADO"
            : "NÃO ENCONTRADO",

        item:
          item && item.ok
            ? "OK"
            : "NÃO TESTADO",

        prices:
          prices && prices.ok
            ? "OK"
            : "NÃO TESTADO"
      }
    });

  } catch (erro) {

    console.error(
      "ERRO DIAGNOSTICO:",
      erro
    );

    return json(res, 500, {
      diagnostico: "ERRO",
      mensagem:
        erro.message ||
        String(erro)
    });
  }
};
