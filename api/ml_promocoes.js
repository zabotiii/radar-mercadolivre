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

function numero(valor) {
  return typeof valor === "number" &&
    Number.isFinite(valor)
    ? valor
    : null;
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
  let pontos = 0;

  if (produto.preco != null) {
    pontos += 30;
  }

  if (produto.desconto >= 10) {
    pontos += 15;
  }

  if (produto.desconto >= 20) {
    pontos += 10;
  }

  if (produto.desconto >= 30) {
    pontos += 10;
  }

  if (produto.fretegratis) {
    pontos += 10;
  }

  if (produto.vendidos >= 1000) {
    pontos += 10;
  } else if (produto.vendidos >= 500) {
    pontos += 8;
  } else if (produto.vendidos >= 100) {
    pontos += 6;
  } else if (produto.vendidos > 0) {
    pontos += 3;
  }

  if (produto.quantidade > 0) {
    pontos += 5;
  }

  if (produto.desconto >= 10) {
    pontos += 10;
  }

  return Math.min(pontos, 100);
}

/*
 * BUSCA PÚBLICA DO MERCADO LIVRE
 *
 * Importante:
 * Não enviamos Authorization aqui.
 *
 * O erro 403 que encontramos estava acontecendo
 * justamente quando essa chamada recebia o
 * access token da aplicação.
 */
async function buscarAnuncios(termo) {
  let url =
    "https://api.mercadolibre.com/sites/MLB/search" +
    "?limit=50" +
    "&sort=relevance";

  if (termo) {
    url +=
      "&q=" +
      encodeURIComponent(termo);
  }

  const resposta = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  let dados = null;

  try {
    dados = await resposta.json();
  } catch (erro) {
    dados = null;
  }

  return {
    ok: resposta.ok,
    status: resposta.status,
    data: dados,
    url
  };
}

/*
 * Busca preço atual do anúncio.
 *
 * Essa consulta também é feita sem enviar
 * o access token, evitando o bloqueio 403
 * que encontramos.
 */
async function buscarPrecos(itemId) {
  if (!itemId) {
    return null;
  }

  const url =
    "https://api.mercadolibre.com/items/" +
    encodeURIComponent(itemId) +
    "/prices";

  try {
    const resposta = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    if (!resposta.ok) {
      return null;
    }

    const dados = await resposta.json();

    if (
      !dados ||
      !Array.isArray(dados.prices)
    ) {
      return null;
    }

    const precos =
      dados.prices.filter(
        p =>
          p &&
          typeof p.amount === "number"
      );

    if (!precos.length) {
      return null;
    }

    const promocao =
      precos.find(
        p =>
          p.type === "promotion"
      );

    const normal =
      precos.find(
        p =>
          p.type === "standard"
      );

    const escolhido =
      promocao ||
      normal ||
      precos[0];

    let original = null;

    if (
      promocao &&
      normal
    ) {
      original =
        normal.amount;
    }

    if (
      original == null &&
      promocao &&
      typeof promocao.regular_amount ===
        "number"
    ) {
      original =
        promocao.regular_amount;
    }

    return {
      preco:
        escolhido.amount,

      original,

      promocao:
        escolhido.type ===
        "promotion",

      promotion_id:
        escolhido.promotion_id ||
        null,

      moeda:
        escolhido.currency_id ||
        "BRL"
    };

  } catch (erro) {
    console.error(
      "Erro ao buscar preços:",
      erro
    );

    return null;
  }
}

async function montarProduto(
  anuncio
) {
  try {
    if (
      !anuncio ||
      !anuncio.id
    ) {
      return null;
    }

    /*
     * Preço que já veio na busca.
     */
    let preco =
      numero(anuncio.price);

    /*
     * Preço original que veio na busca.
     */
    let original =
      numero(
        anuncio.original_price
      );

    /*
     * Tentamos confirmar pelo endpoint
     * de preços.
     */
    const priceInfo =
      await buscarPrecos(
        anuncio.id
      );

    if (
      priceInfo &&
      typeof priceInfo.preco ===
        "number"
    ) {
      preco =
        priceInfo.preco;
    }

    if (
      priceInfo &&
      typeof priceInfo.original ===
        "number"
    ) {
      original =
        priceInfo.original;
    }

    /*
     * Imagem.
     */
    let imagem = null;

    if (
      Array.isArray(
        anuncio.thumbnail_id
          ? [anuncio.thumbnail_id]
          : []
      )
    ) {
      imagem =
        anuncio.thumbnail || null;
    }

    if (!imagem) {
      imagem =
        anuncio.thumbnail ||
        null;
    }

    /*
     * Frete grátis.
     */
    const fretegratis =
      anuncio.shipping &&
      anuncio.shipping.free_shipping ===
        true;

    /*
     * Quantidade.
     */
    const quantidade =
      numero(
        anuncio.available_quantity
      ) ?? 0;

    /*
     * Vendas.
     */
    const vendidos =
      numero(
        anuncio.sold_quantity
      ) ?? 0;

    /*
     * Desconto.
     */
    const desconto =
      calcularDesconto(
        preco,
        original
      );

    const produto = {
      id:
        anuncio.id,

      product_id:
        anuncio.catalog_product_id ||
        null,

      titulo:
        anuncio.title ||
        "Produto Mercado Livre",

      imagem,

      permalink:
        anuncio.permalink ||
        "https://www.mercadolivre.com.br/",

      preco,

      preco_original:
        original,

      desconto,

      vencedor:
        true,

      seller_id:
        anuncio.seller &&
        anuncio.seller.id
          ? anuncio.seller.id
          : null,

      quantidade,

      vendidos,

      fretegratis,

      promocao:
        priceInfo
          ? Boolean(
              priceInfo.promocao
            )
          : desconto > 0,

      promocao_id:
        priceInfo
          ? priceInfo.promotion_id
          : null,

      tipo_preco:
        priceInfo
          ? (
              priceInfo.promocao
                ? "promotion"
                : "standard"
            )
          : null,

      moeda:
        priceInfo
          ? priceInfo.moeda
          : "BRL"
    };

    produto.score =
      calcularScore(produto);

    return produto;

  } catch (erro) {
    console.error(
      "Erro ao montar produto:",
      erro
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
       * Mantemos a sessão para o Radar
       * continuar exigindo a conexão com
       * o Mercado Livre.
       *
       * A busca dos anúncios, porém,
       * não utiliza o token.
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
       * Categoria.
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
       * BUSCA
       */
      const busca =
        await buscarAnuncios(
          termo
        );

      /*
       * Se a busca falhar,
       * mostra o erro real.
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

      const anuncios =
        busca.data &&
        Array.isArray(
          busca.data.results
        )
          ? busca.data.results
          : [];

      if (!anuncios.length) {

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
       * Processamos 10 por vez.
       */
      const resultados = [];

      const tamanhoGrupo = 10;

      for (
        let inicio = 0;
        inicio < anuncios.length;
        inicio += tamanhoGrupo
      ) {

        const grupo =
          anuncios.slice(
            inicio,
            inicio +
              tamanhoGrupo
          );

        const produtos =
          await Promise.all(
            grupo.map(
              anuncio =>
                montarProduto(
                  anuncio
                )
            )
          );

        for (
          const produto
          of produtos
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

        if (
          resultados.length >= 50
        ) {
          break;
        }
      }

      /*
       * Ordenação.
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
              50
            )
        }
      );

    } catch (erro) {

      console.error(
        "ERRO ml_promocoes:",
        erro
      );

      return json(
        res,
        500,
        {
          error:
            "Erro interno ao buscar promoções.",

          message:
            erro.message ||
            String(erro)
        }
      );
    }
  };
