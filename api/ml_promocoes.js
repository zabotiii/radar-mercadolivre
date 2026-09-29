const { session } = require("./lib");

const CATEGORIAS = {
  todas: "ofertas promoção desconto",
  celulares: "celular smartphone iphone samsung xiaomi",
  eletronicos: "fone headset smartwatch televisão tv",
  casa: "casa cozinha eletrodoméstico air fryer",
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
  try {
    const resposta = await fetch(
      "https://api.mercadolibre.com" + path,
      {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    let dados = null;

    try {
      dados = await resposta.json();
    } catch (e) {
      dados = null;
    }

    return {
      ok: resposta.ok,
      status: resposta.status,
      data: dados
    };

  } catch (erro) {

    return {
      ok: false,
      status: 0,
      data: null,
      error:
        erro.message ||
        String(erro)
    };
  }
}

function numero(valor) {
  return (
    typeof valor === "number" &&
    Number.isFinite(valor)
  )
    ? valor
    : null;
}

function calcularDesconto(
  preco,
  original
) {
  if (
    typeof preco !== "number" ||
    typeof original !== "number" ||
    original <= 0 ||
    preco >= original
  ) {
    return 0;
  }

  return Math.round(
    (
      (original - preco) /
      original
    ) * 100
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

  if (produto.fretegratis) {
    score += 10;
  }

  if (produto.quantidade > 0) {
    score += 5;
  }

  if (produto.vendidos > 50) {
    score += 10;
  } else if (produto.vendidos > 0) {
    score += 5;
  }

  if (produto.promocao) {
    score += 10;
  }

  return Math.min(score, 100);
}

/*
 * =====================================================
 * BUSCA DE CATÁLOGO
 *
 * ESTE É O ENDPOINT QUE O DIAGNÓSTICO CONFIRMOU
 * COMO FUNCIONANDO:
 *
 * /products/search
 * =====================================================
 */

async function buscarProdutos(
  termo,
  accessToken
) {

  const url =
    "/products/search" +
    "?status=active" +
    "&site_id=MLB" +
    "&limit=50" +
    "&q=" +
    encodeURIComponent(termo);

  return await mlFetch(
    url,
    accessToken
  );
}

/*
 * =====================================================
 * DETALHE DO PRODUTO
 *
 * Aqui encontramos:
 *
 * buy_box_winner
 * item_id
 * preço
 * frete
 * quantidade
 * vendedor
 * =====================================================
 */

async function buscarDetalheProduto(
  productId,
  accessToken
) {

  if (!productId) {
    return null;
  }

  const resposta =
    await mlFetch(
      "/products/" +
      encodeURIComponent(
        productId
      ),
      accessToken
    );

  if (!resposta.ok) {
    return null;
  }

  return resposta.data;
}

/*
 * =====================================================
 * PROCESSA UM PRODUTO
 * =====================================================
 */

async function processarProduto(
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

    /*
     * Primeiro usamos os dados da busca.
     */
    let detalhe =
      await buscarDetalheProduto(
        resultado.id,
        accessToken
      );

    if (!detalhe) {
      return null;
    }

    /*
     * =================================================
     * BUSCA O VENCEDOR
     * =================================================
     */

    let winner =
      detalhe.buy_box_winner ||
      null;

    /*
     * Alguns resultados podem ser produtos-pai.
     * Nesse caso verificamos os filhos.
     */

    if (
      !winner &&
      Array.isArray(
        detalhe.children_ids
      )
    ) {

      const filhos =
        detalhe.children_ids
          .slice(0, 5);

      /*
       * Consultamos os filhos em paralelo.
       */

      const detalhesFilhos =
        await Promise.all(
          filhos.map(
            childId =>
              buscarDetalheProduto(
                childId,
                accessToken
              )
          )
        );

      for (
        const filho
        of detalhesFilhos
      ) {

        if (
          filho &&
          filho.buy_box_winner
        ) {

          winner =
            filho.buy_box_winner;

          /*
           * Se o filho tem informações
           * melhores, usamos o próprio filho.
           */

          detalhe =
            filho;

          break;
        }
      }
    }

    /*
     * Produto sem publicação vencedora.
     */
    if (
      !winner ||
      !winner.item_id
    ) {
      return null;
    }

    /*
     * =================================================
     * PREÇO
     *
     * O próprio buy_box_winner já traz
     * o preço da publicação vencedora.
     * =================================================
     */

    const preco =
      numero(
        winner.price
      );

    const original =
      numero(
        winner.original_price
      );

    /*
     * Se não houver preço, descartamos.
     */

    if (preco == null) {
      return null;
    }

    /*
     * =================================================
     * DESCONTO
     * =================================================
     */

    const desconto =
      calcularDesconto(
        preco,
        original
      );

    /*
     * =================================================
     * FRETE
     * =================================================
     */

    const shipping =
      winner.shipping ||
      {};

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
     * =================================================
     * IMAGEM
     * =================================================
     */

    let imagem = null;

    if (
      Array.isArray(
        detalhe.pictures
      ) &&
      detalhe.pictures.length
    ) {

      imagem =
        detalhe.pictures[0]
          .url ||
        null;
    }

    /*
     * =================================================
     * RESULTADO
     * =================================================
     */

    const produto = {

      id:
        winner.item_id,

      product_id:
        detalhe.id,

      titulo:
        detalhe.name ||
        resultado.name ||
        "Produto Mercado Livre",

      imagem,

      permalink:
        detalhe.permalink ||
        `https://www.mercadolivre.com.br/`,

      preco,

      preco_original:
        original,

      desconto,

      vencedor:
        true,

      seller_id:
        winner.seller_id ||
        null,

      quantidade:
        numero(
          winner.available_quantity
        ) ?? 0,

      vendidos:
        numero(
          winner.sold_quantity
        ) ?? 0,

      fretegratis,

      promocao:
        desconto > 0 ||
        (
          Array.isArray(
            winner.deal_ids
          ) &&
          winner.deal_ids.length > 0
        ),

      promocao_id:
        Array.isArray(
          winner.deal_ids
        ) &&
        winner.deal_ids.length
          ? winner.deal_ids[0]
          : null,

      moeda:
        winner.currency_id ||
        "BRL",

      listing_type_id:
        winner.listing_type_id ||
        null
    };

    produto.score =
      calcularScore(
        produto
      );

    return produto;

  } catch (erro) {

    console.error(
      "Erro processando produto:",
      erro
    );

    return null;
  }
}

/*
 * =====================================================
 * HANDLER PRINCIPAL
 * =====================================================
 */

module.exports =
  async function handler(
    req,
    res
  ) {

    try {

      /*
       * Verifica sessão.
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
        CATEGORIAS[
          categoria
        ] ||
        CATEGORIAS.todas;

      /*
       * =================================================
       * BUSCA
       * =================================================
       */

      const busca =
        await buscarProdutos(
          termo,
          sessao.access_token
        );

      /*
       * Se houver erro, mostramos
       * a resposta verdadeira.
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
              busca.data ||
              null
          }
        );
      }

      const produtos =
        Array.isArray(
          busca.data &&
          busca.data.results
        )
          ? busca.data.results
          : [];

      /*
       * =================================================
       * PROCESSAMENTO
       *
       * Fazemos 5 por vez para evitar
       * estourar o tempo do Vercel.
       * =================================================
       */

      const resultados = [];

      const tamanhoGrupo = 5;

      for (
        let inicio = 0;
        inicio <
          produtos.length;
        inicio +=
          tamanhoGrupo
      ) {

        const grupo =
          produtos.slice(
            inicio,
            inicio +
              tamanhoGrupo
          );

        const processados =
          await Promise.all(
            grupo.map(
              produto =>
                processarProduto(
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
         * Assim que tivermos 30 ofertas,
         * paramos.
         */

        if (
          resultados.length >= 30
        ) {
          break;
        }
      }

      /*
       * =================================================
       * ORDENAÇÃO
       * =================================================
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
       * =================================================
       * RESPOSTA
       * =================================================
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
