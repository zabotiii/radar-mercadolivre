const { session } = require("./lib");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.end(JSON.stringify(data));
}

async function consultar(url, accessToken) {
  try {
    const resposta = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
      erro:
        erro.message ||
        String(erro)
    };
  }
}

module.exports = async function handler(req, res) {

  try {

    /*
     * =====================================================
     * SESSÃO
     * =====================================================
     */

    const sessao =
      await session(req, res);

    if (
      !sessao ||
      !sessao.access_token
    ) {
      return json(res, 401, {
        diagnostico: "ERRO",
        conectado: false,
        mensagem:
          "Sessão do Mercado Livre não encontrada."
      });
    }

    const token =
      sessao.access_token;

    const appId =
      process.env.ML_CLIENT_ID;

    /*
     * =====================================================
     * TESTE 1 - USUÁRIO
     * =====================================================
     */

    const usuario =
      await consultar(
        "https://api.mercadolibre.com/users/me",
        token
      );

    /*
     * =====================================================
     * TESTE 2 - APLICAÇÃO
     * =====================================================
     */

    const aplicacao =
      await consultar(
        "https://api.mercadolibre.com/applications/" +
          appId,
        token
      );

    /*
     * =====================================================
     * TESTE 3 - PRODUCTS/SEARCH
     * =====================================================
     */

    const productsSearch =
      await consultar(
        "https://api.mercadolibre.com/products/search" +
          "?status=active" +
          "&site_id=MLB" +
          "&q=iphone" +
          "&limit=1",
        token
      );

    /*
     * =====================================================
     * TESTE 4 - SITES/MLB/SEARCH
     * =====================================================
     */

    const sitesSearch =
      await consultar(
        "https://api.mercadolibre.com/sites/MLB/search" +
          "?q=iphone" +
          "&limit=1",
        token
      );

    /*
     * =====================================================
     * PEGAR ITEM REAL
     *
     * Se uma das buscas funcionar, pegamos
     * automaticamente um item real para testar
     * o endpoint /items.
     * =====================================================
     */

    let itemId = null;
    let origemItem = null;

    /*
     * Primeiro tentamos a busca tradicional.
     */

    if (
      sitesSearch.ok &&
      sitesSearch.resposta &&
      Array.isArray(
        sitesSearch.resposta.results
      ) &&
      sitesSearch.resposta.results.length
    ) {

      itemId =
        sitesSearch.resposta
          .results[0]
          .id;

      origemItem =
        "sites/MLB/search";
    }

    /*
     * Se não conseguiu pela busca tradicional,
     * tenta encontrar item através do catálogo.
     */

    if (
      !itemId &&
      productsSearch.ok &&
      productsSearch.resposta
    ) {

      const produtos =
        Array.isArray(
          productsSearch.resposta.results
        )
          ? productsSearch.resposta.results
          : [];

      if (produtos.length) {

        const produto =
          produtos[0];

        /*
         * Tenta pegar o vencedor diretamente.
         */

        if (
          produto.buy_box_winner &&
          produto.buy_box_winner.item_id
        ) {

          itemId =
            produto.buy_box_winner.item_id;

          origemItem =
            "products/search -> buy_box_winner";

        }

        /*
         * Caso o resultado seja somente um ID
         * de produto, consulta o produto.
         */

        if (!itemId && produto.id) {

          const detalhe =
            await consultar(
              "https://api.mercadolibre.com/products/" +
                encodeURIComponent(
                  produto.id
                ),
              token
            );

          if (
            detalhe.ok &&
            detalhe.resposta &&
            detalhe.resposta.buy_box_winner &&
            detalhe.resposta.buy_box_winner.item_id
          ) {

            itemId =
              detalhe.resposta
                .buy_box_winner
                .item_id;

            origemItem =
              "products/{id} -> buy_box_winner";
          }
        }
      }
    }

    /*
     * =====================================================
     * TESTE 5 - ITEMS
     * =====================================================
     */

    let itemTeste = {
      status: null,
      ok: false,
      item_id: null,
      origem: null,
      resposta: null,
      erro: null
    };

    if (itemId) {

      const item =
        await consultar(
          "https://api.mercadolibre.com/items/" +
            encodeURIComponent(itemId),
          token
        );

      itemTeste = {
        status:
          item.status,

        ok:
          item.ok,

        item_id:
          itemId,

        origem:
          origemItem,

        resposta:
          item.resposta,

        erro:
          item.erro || null
      };

    } else {

      itemTeste = {
        status: null,

        ok: false,

        item_id: null,

        origem: null,

        resposta: null,

        erro:
          "Nenhum item foi encontrado porque as buscas anteriores não retornaram um item."
      };
    }

    /*
     * =====================================================
     * TESTE 6 - PRICES
     * =====================================================
     */

    let pricesTeste = {
      status: null,
      ok: false,
      item_id: itemId,
      resposta: null,
      erro: null
    };

    if (itemId) {

      const prices =
        await consultar(
          "https://api.mercadolibre.com/items/" +
            encodeURIComponent(itemId) +
            "/prices",
          token
        );

      pricesTeste = {
        status:
          prices.status,

        ok:
          prices.ok,

        item_id:
          itemId,

        resposta:
          prices.resposta,

        erro:
          prices.erro || null
      };

    } else {

      pricesTeste = {
        status: null,

        ok: false,

        item_id: null,

        resposta: null,

        erro:
          "Não foi possível testar /prices porque nenhum item foi encontrado."
      };
    }

    /*
     * =====================================================
     * RESULTADO RESUMIDO
     * =====================================================
     */

    return json(res, 200, {

      diagnostico:
        "CONCLUIDO",

      app_id:
        appId,

      usuario: {
        status:
          usuario.status,

        funcionando:
          usuario.status === 200
      },

      aplicacao: {
        status:
          aplicacao.status,

        funcionando:
          aplicacao.status === 200,

        active:
          aplicacao.resposta
            ? aplicacao.resposta.active
            : null,

        blocked:
          aplicacao.resposta
            ? aplicacao.resposta.blocked
            : null,

        disabled:
          aplicacao.resposta
            ? aplicacao.resposta.disabled
            : null,

        certification_status:
          aplicacao.resposta
            ? aplicacao.resposta
                .certification_status
            : null
      },

      testes: {

        products_search: {
          status:
            productsSearch.status,

          funcionando:
            productsSearch.ok,

          resposta:
            productsSearch.resposta
        },

        sites_search: {
          status:
            sitesSearch.status,

          funcionando:
            sitesSearch.ok,

          resposta:
            sitesSearch.resposta
        },

        item: itemTeste,

        prices: pricesTeste
      },

      conclusao_rapida: {

        oauth:
          usuario.status === 200
            ? "OK"
            : "ERRO",

        aplicacao:
          aplicacao.status === 200 &&
          aplicacao.resposta &&
          aplicacao.resposta.active === true &&
          aplicacao.resposta.blocked === false &&
          aplicacao.resposta.disabled === false
            ? "ATIVA"
            : "VERIFICAR",

        products_search:
          productsSearch.ok
            ? "FUNCIONANDO"
            : "BLOQUEADO/ERRO",

        sites_search:
          sitesSearch.ok
            ? "FUNCIONANDO"
            : "BLOQUEADO/ERRO",

        item:
          itemTeste.ok
            ? "FUNCIONANDO"
            : "BLOQUEADO/ERRO",

        prices:
          pricesTeste.ok
            ? "FUNCIONANDO"
            : "BLOQUEADO/ERRO"
      },

      observacao:
        "Este diagnóstico somente consulta a API e não altera nenhuma configuração."
    });

  } catch (erro) {

    console.error(
      "ERRO NO DIAGNOSTICO:",
      erro
    );

    return json(res, 500, {

      diagnostico:
        "ERRO",

      mensagem:
        erro.message ||
        String(erro)
    });
  }
};
