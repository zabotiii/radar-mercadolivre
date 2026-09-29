const { session } = require("./lib");

const CATEGORIAS = {
  todas: "",
  celulares: "celular smartphone iphone samsung",
  eletronicos: "fone headset smartwatch televisao",
  casa: "casa cozinha eletrodomestico",
  informatica: "notebook computador mouse teclado monitor",
  games: "video game playstation xbox nintendo",
  moda: "roupa tenis camiseta mochila"
};

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
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

function numberOrNull(value) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  return null;
}

function calcularDesconto(preco, original) {
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

function calcularScore(produto) {
  let score = 0;

  if (produto.preco != null) {
    score += 30;
  }

  if (produto.desconto >= 10) {
    score += 15;
  }

  if (produto.desconto >= 20) {
    score += 10;
  }

  if (produto.desconto >= 30) {
    score += 10;
  }

  if (produto.vencedor) {
    score += 15;
  }

  if (produto.fretegratis) {
    score += 10;
  }

  if (produto.quantidade > 0) {
    score += 5;
  }

  if (produto.vendidos > 20) {
    score += 5;
  }

  return Math.min(score, 100);
}

async function buscarProdutos(accessToken, termo) {
  /*
   * IMPORTANTE:
   * A busca /products/search pode apresentar limitações
   * dependendo da conta/endpoints disponíveis.
   *
   * Por isso fazemos a consulta de forma simples
   * e retornamos a resposta completa em caso de erro.
   */

  let path =
    "/products/search?status=active&site_id=MLB&limit=20";

  if (termo) {
    path += `&q=${encodeURIComponent(termo)}`;
  }

  return await mlFetch(path, accessToken);
}

async function buscarProduto(productId, accessToken) {
  if (!productId) {
    return null;
  }

  const resposta = await mlFetch(
    `/products/${encodeURIComponent(productId)}`,
    accessToken
  );

  if (!resposta.ok) {
    return null;
  }

  return resposta.data;
}

async function buscarItem(itemId, accessToken) {
  if (!itemId) {
    return null;
  }

  const resposta = await mlFetch(
    `/items/${encodeURIComponent(itemId)}`,
    accessToken
  );

  if (!resposta.ok) {
    return null;
  }

  return resposta.data;
}

async function buscarPrecos(itemId, accessToken) {
  if (!itemId) {
    return null;
  }

  const resposta = await mlFetch(
    `/items/${encodeURIComponent(itemId)}/prices`,
    accessToken
  );

  if (!resposta.ok || !resposta.data) {
    return null;
  }

  const prices = Array.isArray(resposta.data.prices)
    ? resposta.data.prices
    : [];

  if (!prices.length) {
    return null;
  }

  const promotion = prices.find(
    (price) =>
      price &&
      price.type === "promotion" &&
      typeof price.amount === "number"
  );

  const standard = prices.find(
    (price) =>
      price &&
      price.type === "standard" &&
      typeof price.amount === "number"
  );

  const selected =
    promotion ||
    standard ||
    prices.find(
      (price) =>
        price &&
        typeof price.amount === "number"
    );

  if (!selected) {
    return null;
  }

  let original = null;

  if (promotion && standard) {
    original = standard.amount;
  }

  if (
    original == null &&
    promotion &&
    typeof promotion.regular_amount === "number"
  ) {
    original = promotion.regular_amount;
  }

  return {
    preco: selected.amount,
    original,
    tipo: selected.type || "standard",
    promotion_id:
      selected.promotion_id || null,
    currency_id:
      selected.currency_id || "BRL"
  };
}

async function montarOferta(
  produto,
  accessToken
) {
  try {
    if (!produto || !produto.id) {
      return null;
    }

    const detalhe = await buscarProduto(
      produto.id,
      accessToken
    );

    if (!detalhe) {
      return null;
    }

    let winner =
      detalhe.buy_box_winner || null;

    /*
     * Se não houver vencedor diretamente,
     * verificamos alguns filhos.
     */
    if (
      !winner &&
      Array.isArray(detalhe.children_ids)
    ) {
      const children =
        detalhe.children_ids.slice(0, 3);

      for (const childId of children) {
        const child = await buscarProduto(
          childId,
          accessToken
        );

        if (
          child &&
          child.buy_box_winner
        ) {
          winner = child.buy_box_winner;
          break;
        }
      }
    }

    /*
     * Sem item vencedor não conseguimos
     * gerar uma oferta confiável.
     */
    if (!winner || !winner.item_id) {
      return null;
    }

    const itemId = winner.item_id;

    const item = await buscarItem(
      itemId,
      accessToken
    );

    const priceInfo = await buscarPrecos(
      itemId,
      accessToken
    );

    /*
     * Preço principal.
     */
    let preco = null;

    if (
      priceInfo &&
      typeof priceInfo.preco === "number"
    ) {
      preco = priceInfo.preco;
    }

    if (
      preco == null &&
      typeof winner.price === "number"
    ) {
      preco = winner.price;
    }

    /*
     * Preço original.
     */
    let original = null;

    if (
      priceInfo &&
      typeof priceInfo.original === "number"
    ) {
      original = priceInfo.original;
    }

    if (
      original == null &&
      typeof winner.original_price === "number"
    ) {
      original = winner.original_price;
    }

    if (
      original == null &&
      item &&
      typeof item.original_price === "number"
    ) {
      original = item.original_price;
    }

    const desconto = calcularDesconto(
      preco,
      original
    );

    const shipping =
      winner.shipping ||
      (item && item.shipping) ||
      {};

    const fretegratis =
      shipping.free_shipping === true ||
      (
        Array.isArray(shipping.tags) &&
        shipping.tags.includes(
          "mandatory_free_shipping"
        )
      );

    const quantidade =
      numberOrNull(
        winner.available_quantity
      ) ??
      numberOrNull(
        item && item.available_quantity
      ) ??
      0;

    const vendidos =
      numberOrNull(
        item && item.sold_quantity
      ) ?? 0;

    const titulo =
      (item && item.title) ||
      detalhe.name ||
      produto.name ||
      "Produto Mercado Livre";

    const permalink =
      (item && item.permalink) ||
      winner.permalink ||
      `https://www.mercadolivre.com.br/`;

    let imagem = null;

    if (
      item &&
      Array.isArray(item.pictures) &&
      item.pictures.length
    ) {
      imagem =
        item.pictures[0].secure_url ||
        item.pictures[0].url ||
        null;
    }

    if (
      !imagem &&
      produto &&
      Array.isArray(produto.pictures) &&
      produto.pictures.length
    ) {
      imagem =
        produto.pictures[0].secure_url ||
        produto.pictures[0].url ||
        null;
    }

    const oferta = {
      id: itemId,

      product_id: produto.id,

      titulo,

      imagem,

      permalink,

      preco,

      preco_original: original,

      desconto,

      vencedor: true,

      seller_id:
        winner.seller_id || null,

      quantidade,

      vendidos,

      fretegratis,

      tipo_preco:
        priceInfo
          ? priceInfo.tipo
          : null,

      promocao_id:
        priceInfo
          ? priceInfo.promotion_id
          : null,

      moeda:
        (priceInfo &&
          priceInfo.currency_id) ||
        winner.currency_id ||
        "BRL"
    };

    oferta.score =
      calcularScore(oferta);

    return oferta;

  } catch (error) {
    console.error(
      "Erro ao montar oferta:",
      error
    );

    return null;
  }
}

module.exports = async function handler(
  req,
  res
) {
  try {

    /*
     * Verifica conexão do Mercado Livre.
     */
    const sessao =
      await session(req, res);

    if (
      !sessao ||
      !sessao.access_token
    ) {
      return json(res, 401, {
        error:
          "Mercado Livre não conectado."
      });
    }

    const categoria =
      String(
        (
          req.query &&
          req.query.categoria
        ) || "todas"
      ).toLowerCase();

    const termo =
      Object.prototype.hasOwnProperty.call(
        CATEGORIAS,
        categoria
      )
        ? CATEGORIAS[categoria]
        : "";

    /*
     * BUSCA INICIAL
     */
    const busca =
      await buscarProdutos(
        sessao.access_token,
        termo
      );

    /*
     * SE DER ERRO, AGORA DEVOLVEMOS
     * A RESPOSTA REAL DO MERCADO LIVRE.
     */
    if (!busca.ok) {
      return json(res, 502, {
        error:
          "Erro ao buscar produtos no Mercado Livre.",

        status:
          busca.status,

        resposta_mercado_livre:
          busca.data || null
      });
    }

    if (!busca.data) {
      return json(res, 502, {
        error:
          "Mercado Livre não retornou dados.",

        status:
          busca.status,

        resposta_mercado_livre:
          null
      });
    }

    const produtos =
      Array.isArray(
        busca.data.results
      )
        ? busca.data.results
        : [];

    /*
     * Processamos em grupos pequenos
     * para evitar timeout no Vercel.
     */
    const resultados = [];

    const tamanhoGrupo = 4;

    for (
      let i = 0;
      i < produtos.length;
      i += tamanhoGrupo
    ) {

      const grupo =
        produtos.slice(
          i,
          i + tamanhoGrupo
        );

      const ofertas =
        await Promise.all(
          grupo.map(
            (produto) =>
              montarOferta(
                produto,
                sessao.access_token
              )
          )
        );

      for (const oferta of ofertas) {

        if (
          oferta &&
          oferta.preco != null
        ) {
          resultados.push(
            oferta
          );
        }
      }

      /*
       * Já temos ofertas suficientes.
       */
      if (
        resultados.length >= 30
      ) {
        break;
      }
    }

    /*
     * Ordenação:
     * primeiro score,
     * depois desconto,
     * depois vendas.
     */
    resultados.sort(
      (a, b) => {

        if (
          b.score !== a.score
        ) {
          return (
            b.score - a.score
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

    return json(res, 200, {

      categoria,

      termo,

      total:
        resultados.length,

      resultados:
        resultados.slice(
          0,
          30
        )

    });

  } catch (error) {

    console.error(
      "ERRO ml_promocoes:",
      error
    );

    return json(res, 500, {

      error:
        "Erro interno ao buscar promoções.",

      message:
        error.message || String(error)

    });
  }
};
