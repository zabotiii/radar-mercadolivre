const { session } = require("./lib");

const CATEGORIAS = {
  todas: "",
  celulares: "celular smartphone iphone samsung",
  eletronicos: "fone headset smartwatch televisão",
  casa: "casa cozinha eletrodoméstico",
  informatica: "notebook computador mouse teclado monitor",
  games: "playstation xbox nintendo videogame",
  moda: "tênis camiseta roupa mochila"
};

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.end(JSON.stringify(data));
}

async function mlFetch(path, accessToken) {
  const response = await fetch(
    "https://api.mercadolibre.com" + path,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
}

function num(value) {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

function desconto(preco, original) {
  if (
    typeof preco !== "number" ||
    typeof original !== "number" ||
    original <= 0 ||
    preco >= original
  ) {
    return 0;
  }

  return Math.round(
    ((original - preco) / original) * 100
  );
}

function score(item) {
  let pontos = 0;

  if (item.preco != null) pontos += 30;
  if (item.desconto >= 10) pontos += 15;
  if (item.desconto >= 20) pontos += 10;
  if (item.desconto >= 30) pontos += 10;
  if (item.fretegratis) pontos += 10;
  if (item.vendidos > 20) pontos += 10;
  if (item.quantidade > 0) pontos += 5;
  if (item.promocao) pontos += 10;

  return Math.min(pontos, 100);
}

/*
 * Busca produtos usando o endpoint de pesquisa
 * que já funciona no Radar.
 */
async function buscarCatalogo(
  termo,
  accessToken
) {
  let url =
    "/sites/MLB/search" +
    "?limit=30" +
    "&sort=relevance";

  if (termo) {
    url +=
      "&q=" +
      encodeURIComponent(termo);
  }

  return await mlFetch(
    url,
    accessToken
  );
}

/*
 * Busca informações atualizadas do anúncio.
 */
async function buscarItem(
  itemId,
  accessToken
) {
  const resposta = await mlFetch(
    "/items/" +
      encodeURIComponent(itemId),
    accessToken
  );

  if (!resposta.ok) {
    return null;
  }

  return resposta.data;
}

/*
 * Busca os preços atuais.
 */
async function buscarPrecos(
  itemId,
  accessToken
) {
  const resposta = await mlFetch(
    "/items/" +
      encodeURIComponent(itemId) +
      "/prices",
    accessToken
  );

  if (
    !resposta.ok ||
    !resposta.data
  ) {
    return null;
  }

  const prices =
    Array.isArray(
      resposta.data.prices
    )
      ? resposta.data.prices
      : [];

  if (!prices.length) {
    return null;
  }

  const promotion =
    prices.find(
      p =>
        p &&
        p.type === "promotion" &&
        typeof p.amount === "number"
    );

  const standard =
    prices.find(
      p =>
        p &&
        p.type === "standard" &&
        typeof p.amount === "number"
    );

  const escolhido =
    promotion ||
    standard ||
    prices.find(
      p =>
        p &&
        typeof p.amount === "number"
    );

  if (!escolhido) {
    return null;
  }

  let original = null;

  if (
    promotion &&
    standard
  ) {
    original =
      standard.amount;
  }

  if (
    original == null &&
    promotion &&
    typeof promotion.regular_amount ===
      "number"
  ) {
    original =
      promotion.regular_amount;
  }

  return {
    preco:
      escolhido.amount,

    original,

    tipo:
      escolhido.type ||
      "standard",

    promotion_id:
      escolhido.promotion_id ||
      null,

    moeda:
      escolhido.currency_id ||
      "BRL"
  };
}

/*
 * Monta cada produto.
 */
async function montarProduto(
  resultado,
  accessToken
) {
  try {
    if (
      !resultado ||
      !resultado.id
    ) {
      return null;
    }

    const itemId =
      resultado.id;

    /*
     * O resultado da busca já traz
     * informações de preço.
     */
    const item =
      await buscarItem(
        itemId,
        accessToken
      );

    if (!item) {
      return null;
    }

    /*
     * Busca preços atuais.
     */
    const priceInfo =
      await buscarPrecos(
        itemId,
        accessToken
      );

    /*
     * Primeiro tenta o endpoint /prices.
     * Depois usa os dados do anúncio.
     */
    let preco = null;

    if (
      priceInfo &&
      typeof priceInfo.preco ===
        "number"
    ) {
      preco =
        priceInfo.preco;
    }

    if (
      preco == null &&
      typeof resultado.price ===
        "number"
    ) {
      preco =
        resultado.price;
    }

    if (
      preco == null &&
      typeof item.price ===
        "number"
    ) {
      preco =
        item.price;
    }

    /*
     * Preço original.
     */
    let original = null;

    if (
      priceInfo &&
      typeof priceInfo.original ===
        "number"
    ) {
      original =
        priceInfo.original;
    }

    if (
      original == null &&
      typeof resultado.original_price ===
        "number"
    ) {
      original =
        resultado.original_price;
    }

    if (
      original == null &&
      typeof item.original_price ===
        "number"
    ) {
      original =
        item.original_price;
    }

    const percentual =
      desconto(
        preco,
        original
      );

    /*
     * Frete grátis.
     */
    const shipping =
      item.shipping || {};

    const fretegratis =
      shipping.free_shipping ===
        true ||
      (
        Array.isArray(
          shipping.tags
        ) &&
        shipping.tags.includes(
          "mandatory_free_shipping"
        )
      );

    /*
     * Quantidade disponível.
     */
    const quantidade =
      num(
        item.available_quantity
      ) ?? 0;

    /*
     * Quantidade vendida.
     */
    const vendidos =
      num(
        item.sold_quantity
      ) ?? 0;

    /*
     * Imagem.
     */
    let imagem = null;

    if (
      Array.isArray(
        item.pictures
      ) &&
      item.pictures.length
    ) {
      imagem =
        item.pictures[0]
          .secure_url ||
        item.pictures[0]
          .url ||
        null;
    }

    /*
     * Link oficial do produto.
     */
    const permalink =
      item.permalink ||
      `https://www.mercadolivre.com.br/`;

    const produto = {
      id: item.id,

      product_id:
        item.catalog_product_id ||
        null,

      titulo:
        item.title ||
        "Produto Mercado Livre",

      imagem,

      permalink,

      preco,

      preco_original:
        original,

      desconto:
        percentual,

      vencedor:
        true,

      seller_id:
        item.seller_id ||
        null,

      quantidade,

      vendidos,

      fretegratis,

      promocao:
        priceInfo &&
        priceInfo.tipo ===
          "promotion",

      promocao_id:
        priceInfo
          ? priceInfo.promotion_id
          : null,

      tipo_preco:
        priceInfo
          ? priceInfo.tipo
          : null,

      moeda:
        priceInfo
          ? priceInfo.moeda
          : (
              item.currency_id ||
              "BRL"
            )
    };

    produto.score =
      score(produto);

    return produto;

  } catch (error) {
    console.error(
      "Erro ao montar produto:",
      error
    );

    return null;
  }
}

module.exports =
  async function handler(
    req,
    res
  ) {
    try {

      /*
       * Verifica conexão.
       */
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

      /*
       * Categoria escolhida.
       */
      const categoria =
        String(
          (
            req.query &&
            req.query.categoria
          ) ||
          "todas"
        ).toLowerCase();

      const termo =
        Object.prototype.hasOwnProperty.call(
          CATEGORIAS,
          categoria
        )
          ? CATEGORIAS[categoria]
          : "";

      /*
       * BUSCA PRINCIPAL
       */
      const busca =
        await buscarCatalogo(
          termo,
          sessao.access_token
        );

      /*
       * Se a busca falhar,
       * mostra a resposta real.
       */
      if (!busca.ok) {
        return json(
          res,
          502,
          {
            error:
              "Erro ao buscar produtos no Mercado Livre.",

            status:
              busca.status,

            resposta:
              busca.data || null
          }
        );
      }

      const lista =
        Array.isArray(
          busca.data &&
          busca.data.results
        )
          ? busca.data.results
          : [];

      if (!lista.length) {
        return json(
          res,
          200,
          {
            categoria,
            termo,
            total: 0,
            resultados: []
          }
        );
      }

      /*
       * Processa os anúncios
       * em pequenos grupos.
       */
      const resultados = [];

      const grupoTamanho = 5;

      for (
        let inicio = 0;
        inicio < lista.length;
        inicio += grupoTamanho
      ) {

        const grupo =
          lista.slice(
            inicio,
            inicio +
              grupoTamanho
          );

        const processados =
          await Promise.all(
            grupo.map(
              produto =>
                montarProduto(
                  produto,
                  sessao.access_token
                )
            )
          );

        for (
          const produto
          of processados
        ) {
          if (
            produto &&
            produto.preco != null
          ) {
            resultados.push(
              produto
            );
          }
        }

        /*
         * Para evitar timeout.
         */
        if (
          resultados.length >= 30
        ) {
          break;
        }
      }

      /*
       * Ordena pelas melhores
       * oportunidades.
       */
      resultados.sort(
        (a, b) => {

          if (
            b.score !==
            a.score
          ) {
            return (
              b.score -
              a.score
            );
          }

          if (
            b.desconto !==
            a.desconto
          ) {
            return (
              b.desconto -
              a.desconto
            );
          }

          return (
            b.vendidos -
            a.vendidos
          );
        }
      );

      /*
       * Resposta final.
       */
      return json(
        res,
        200,
        {
          categoria,

          termo,

          total:
            resultados.length,

          resultados:
            resultados.slice(
              0,
              30
            )
        }
      );

    } catch (error) {

      console.error(
        "ERRO ml_promocoes:",
        error
      );

      return json(
        res,
        500,
        {
          error:
            "Erro interno ao buscar promoções.",

          message:
            error.message ||
            String(error)
        }
      );
    }
  };
