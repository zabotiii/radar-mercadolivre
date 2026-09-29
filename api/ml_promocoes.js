const { session } = require("./lib");

const CATEGORIAS = {
  todas: "",
  celulares: "celular smartphone iphone samsung",
  eletronicos: "eletronicos fone headset smartwatch televisao",
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
  const r = await fetch("https://api.mercadolibre.com" + path, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  let data = null;

  try {
    data = await r.json();
  } catch (_) {
    data = null;
  }

  return {
    ok: r.ok,
    status: r.status,
    data
  };
}

function numero(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function desconto(preco, original) {
  if (
    typeof preco !== "number" ||
    typeof original !== "number" ||
    original <= preco ||
    original <= 0
  ) {
    return 0;
  }

  return Math.round(((original - preco) / original) * 100);
}

function scoreProduto(p) {
  let score = 0;

  if (p.preco != null) score += 30;
  if (p.desconto >= 10) score += 20;
  if (p.desconto >= 20) score += 10;
  if (p.desconto >= 30) score += 10;
  if (p.fretegratis) score += 10;
  if (p.vencedor) score += 10;
  if (p.quantidade > 0) score += 5;
  if (p.vendidos > 20) score += 5;

  return Math.min(score, 100);
}

function limitarTexto(texto, max = 180) {
  if (!texto) return "";
  return String(texto).trim().slice(0, max);
}

async function buscarPreco(itemId, accessToken) {
  if (!itemId) return null;

  const resposta = await mlFetch(
    `/items/${encodeURIComponent(itemId)}/prices`,
    accessToken
  );

  if (!resposta.ok || !resposta.data) {
    return null;
  }

  const lista = Array.isArray(resposta.data.prices)
    ? resposta.data.prices
    : [];

  if (!lista.length) {
    return null;
  }

  /*
   * O Mercado Livre pode retornar preços standard e promotion.
   * Priorizamos promotion quando estiver válida.
   */
  const validos = lista.filter((p) => {
    return (
      p &&
      typeof p.amount === "number" &&
      (!p.conditions || !p.conditions.context_restrictions ||
        p.conditions.context_restrictions.includes("channel_marketplace"))
    );
  });

  if (!validos.length) {
    return null;
  }

  const promocional = validos.find((p) => p.type === "promotion");

  const standard = validos.find((p) => p.type === "standard");

  const escolhido = promocional || standard || validos[0];

  let original = null;

  if (promocional && standard) {
    original = numero(standard.amount);
  }

  if (original == null && promocional) {
    original = numero(promocional.regular_amount);
  }

  return {
    preco: numero(escolhido.amount),
    original,
    tipo: escolhido.type || "standard",
    promocao: escolhido.promotion_id || null,
    moeda: escolhido.currency_id || "BRL"
  };
}

async function buscarDetalhesProduto(productId, accessToken) {
  const resposta = await mlFetch(
    `/products/${encodeURIComponent(productId)}`,
    accessToken
  );

  if (!resposta.ok || !resposta.data) {
    return null;
  }

  return resposta.data;
}

async function buscarItem(itemId, accessToken) {
  if (!itemId) return null;

  const resposta = await mlFetch(
    `/items/${encodeURIComponent(itemId)}`,
    accessToken
  );

  if (!resposta.ok || !resposta.data) {
    return null;
  }

  return resposta.data;
}

async function processarProduto(product, accessToken) {
  try {
    const productId = product.id;

    const detalhe = await buscarDetalhesProduto(
      productId,
      accessToken
    );

    if (!detalhe) return null;

    let winner = detalhe.buy_box_winner || null;

    /*
     * Em alguns produtos o vencedor pode não estar diretamente
     * disponível. Tentamos alguns children_ids.
     */
    if (!winner && Array.isArray(detalhe.children_ids)) {
      const filhos = detalhe.children_ids.slice(0, 3);

      for (const childId of filhos) {
        const filho = await buscarDetalhesProduto(
          childId,
          accessToken
        );

        if (filho && filho.buy_box_winner) {
          winner = filho.buy_box_winner;
          break;
        }
      }
    }

    /*
     * Sem vencedor não conseguimos montar uma oferta confiável.
     */
    if (!winner || !winner.item_id) {
      return null;
    }

    const itemId = winner.item_id;

    /*
     * Buscamos o item para pegar permalink, título,
     * quantidade e outros dados de apoio.
     */
    const item = await buscarItem(itemId, accessToken);

    /*
     * Buscamos o preço pelo endpoint oficial /prices.
     */
    const precoInfo = await buscarPreco(
      itemId,
      accessToken
    );

    /*
     * Se /prices não retornar, usamos o preço que veio
     * diretamente no buy_box_winner como fallback.
     */
    const preco =
      precoInfo && precoInfo.preco != null
        ? precoInfo.preco
        : numero(winner.price);

    let original =
      precoInfo && precoInfo.original != null
        ? precoInfo.original
        : numero(winner.original_price);

    /*
     * Fallback adicional para publicação.
     */
    if (original == null && item) {
      original = numero(item.original_price);
    }

    const desc = desconto(preco, original);

    const shipping =
      winner.shipping ||
      (item && item.shipping) ||
      {};

    const fretegratis =
      shipping.free_shipping === true ||
      (Array.isArray(shipping.tags) &&
        shipping.tags.includes("mandatory_free_shipping"));

    const quantidade =
      numero(winner.available_quantity) ??
      (item ? numero(item.available_quantity) : null) ??
      0;

    const vendidos =
      item && numero(item.sold_quantity) != null
        ? item.sold_quantity
        : 0;

    const titulo =
      (item && item.title) ||
      detalhe.name ||
      product.name ||
      "Produto Mercado Livre";

    const permalink =
      (item && item.permalink) ||
      winner.permalink ||
      detalhe.permalink ||
      product.permalink ||
      `https://www.mercadolivre.com.br/`;

    const imagem =
      (item &&
        Array.isArray(item.pictures) &&
        item.pictures[0] &&
        (item.pictures[0].secure_url || item.pictures[0].url)) ||
      (Array.isArray(product.pictures) &&
        product.pictures[0] &&
        (product.pictures[0].secure_url ||
          product.pictures[0].url)) ||
      null;

    const resultado = {
      id: itemId,
      product_id: productId,
      titulo: limitarTexto(titulo, 220),
      imagem,
      permalink,
      preco,
      preco_original: original,
      desconto: desc,
      tipo_preco: precoInfo ? precoInfo.tipo : null,
      promocao_id: precoInfo ? precoInfo.promocao : null,
      moeda:
        (precoInfo && precoInfo.moeda) ||
        winner.currency_id ||
        (item && item.currency_id) ||
        "BRL",
      vencedor: true,
      seller_id: winner.seller_id || null,
      quantidade,
      vendidos,
      fretegratis,
      score: 0
    };

    resultado.score = scoreProduto(resultado);

    return resultado;
  } catch (erro) {
    console.error(
      "Erro processando produto:",
      product && product.id,
      erro
    );

    return null;
  }
}

module.exports = async function handler(req, res) {
  try {
    const sessao = await session(req, res);

    if (!sessao || !sessao.access_token) {
      return json(res, 401, {
        error: "Mercado Livre não conectado."
      });
    }

    const categoria =
      String(
        (req.query && req.query.categoria) || "todas"
      ).toLowerCase();

    const termo =
      CATEGORIAS[categoria] !== undefined
        ? CATEGORIAS[categoria]
        : "";

    /*
     * Busca produtos de catálogo.
     */
    const limiteBusca = 30;

    const url =
      `/products/search?status=active&site_id=MLB` +
      `&q=${encodeURIComponent(termo)}` +
      `&limit=${limiteBusca}`;

    const busca = await mlFetch(
      url,
      sessao.access_token
    );

    if (!busca.ok || !busca.data) {
      return json(res, 502, {
        error: "Erro ao buscar produtos no Mercado Livre.",
        detalhes: busca.data || null
      });
    }

    const produtos = Array.isArray(busca.data.results)
      ? busca.data.results
      : [];

    /*
     * Processamos em pequenos grupos para não estourar
     * o tempo da função do Vercel.
     */
    const resultados = [];

    const tamanhoGrupo = 5;

    for (
      let inicio = 0;
      inicio < produtos.length;
      inicio += tamanhoGrupo
    ) {
      const grupo = produtos.slice(
        inicio,
        inicio + tamanhoGrupo
      );

      const processados = await Promise.all(
        grupo.map((p) =>
          processarProduto(
            p,
            sessao.access_token
          )
        )
      );

      for (const resultado of processados) {
        if (
          resultado &&
          resultado.preco != null
        ) {
          resultados.push(resultado);
        }
      }

      /*
       * Se já temos ofertas suficientes,
       * não precisamos continuar fazendo chamadas.
       */
      if (resultados.length >= 50) {
        break;
      }
    }

    resultados.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (b.desconto !== a.desconto) {
        return b.desconto - a.desconto;
      }

      return b.vendidos - a.vendidos;
    });

    return json(res, 200, {
      categoria,
      termo,
      total: resultados.length,
      resultados: resultados.slice(0, 50)
    });
  } catch (erro) {
    console.error("ERRO ml_promocoes:", erro);

    return json(res, 500, {
      error: "Erro interno ao buscar promoções.",
      message: erro.message
    });
  }
};
