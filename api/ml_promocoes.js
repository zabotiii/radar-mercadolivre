const { session } = require("./lib");

const CATEGORIAS = {
  todas: [
    "iphone 15",
    "iphone 16",
    "samsung galaxy",
    "xiaomi",
    "smart tv",
    "air fryer",
    "notebook",
    "headset",
    "playstation 5",
    "xbox",
    "tenis"
  ],

  celulares: [
    "iphone 15",
    "iphone 16",
    "iphone 13",
    "samsung galaxy s23",
    "samsung galaxy s24",
    "samsung galaxy a55",
    "xiaomi redmi note"
  ],

  eletronicos: [
    "smart tv",
    "headset",
    "fone bluetooth",
    "smartwatch",
    "caixa de som",
    "soundbar",
    "tablet"
  ],

  casa: [
    "air fryer",
    "cafeteira",
    "liquidificador",
    "aspirador",
    "ventilador",
    "microondas",
    "panela eletrica"
  ],

  informatica: [
    "notebook",
    "monitor gamer",
    "teclado mecanico",
    "mouse gamer",
    "ssd",
    "memoria ram",
    "placa de video"
  ],

  games: [
    "playstation 5",
    "xbox series s",
    "xbox series x",
    "nintendo switch",
    "controle ps5",
    "controle xbox",
    "headset gamer"
  ],

  moda: [
    "tenis masculino",
    "tenis feminino",
    "camiseta masculina",
    "moletom",
    "calca jeans",
    "tenis nike",
    "tenis adidas"
  ]
};

function json(res, status, data) {
  res.statusCode = status;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.end(
    JSON.stringify(data)
  );
}

async function mlFetch(
  path,
  accessToken
) {
  try {

    const resposta =
      await fetch(
        "https://api.mercadolibre.com" +
          path,
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${accessToken}`,

            Accept:
              "application/json"
          }
        }
      );

    let dados = null;

    try {
      dados =
        await resposta.json();
    } catch (e) {
      dados = null;
    }

    return {
      ok:
        resposta.ok,

      status:
        resposta.status,

      data:
        dados
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
  if (
    typeof valor === "number" &&
    Number.isFinite(valor)
  ) {
    return valor;
  }

  return null;
}

function calcularDesconto(
  preco,
  original
) {

  if (
    typeof preco !==
      "number" ||

    typeof original !==
      "number" ||

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

function calcularScore(
  produto
) {

  let pontos = 0;

  if (
    produto.preco != null
  ) {
    pontos += 30;
  }

  if (
    produto.desconto >= 10
  ) {
    pontos += 15;
  }

  if (
    produto.desconto >= 20
  ) {
    pontos += 10;
  }

  if (
    produto.desconto >= 30
  ) {
    pontos += 10;
  }

  if (
    produto.fretegratis
  ) {
    pontos += 10;
  }

  if (
    produto.promocao
  ) {
    pontos += 10;
  }

  if (
    produto.quantidade > 0
  ) {
    pontos += 5;
  }

  if (
    produto.vendidos > 50
  ) {
    pontos += 10;
  }

  return Math.min(
    pontos,
    100
  );
}

/*
=====================================================
BUSCA CATÁLOGO
=====================================================
*/

async function buscarCatalogo(
  termo,
  accessToken
) {

  const url =
    "/products/search" +
    "?status=active" +
    "&site_id=MLB" +
    "&limit=20" +
    "&q=" +
    encodeURIComponent(
      termo
    );

  return await mlFetch(
    url,
    accessToken
  );
}

/*
=====================================================
DETALHE DO PRODUTO
=====================================================
*/

async function buscarProduto(
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
=====================================================
PROCESSA PRODUTO
=====================================================
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

    let detalhe =
      await buscarProduto(
        resultado.id,
        accessToken
      );

    if (!detalhe) {
      return null;
    }

    /*
     * Primeiro tenta o vencedor.
     */

    let winner =
      detalhe.buy_box_winner ||
      null;

    /*
     * Se não houver vencedor,
     * tenta os filhos.
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

      const detalhes =
        await Promise.all(
          filhos.map(
            id =>
              buscarProduto(
                id,
                accessToken
              )
          )
        );

      for (
        const filho
        of detalhes
      ) {

        if (
          filho &&
          filho.buy_box_winner
        ) {

          winner =
            filho.buy_box_winner;

          detalhe =
            filho;

          break;
        }
      }
    }

    /*
     * Se encontramos vencedor,
     * usamos seus dados.
     */

    if (
      winner &&
      winner.item_id
    ) {

      const preco =
        numero(
          winner.price
        );

      if (
        preco == null
      ) {
        return null;
      }

      const original =
        numero(
          winner.original_price
        );

      const desconto =
        calcularDesconto(
          preco,
          original
        );

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

      let imagem = null;

      if (
        Array.isArray(
          detalhe.pictures
        ) &&
        detalhe.pictures.length
      ) {

        imagem =
          detalhe.pictures[0].url ||
          null;
      }

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
          "https://www.mercadolivre.com.br/",

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
          "BRL"
      };

      produto.score =
        calcularScore(
          produto
        );

      return produto;
    }

    /*
     * =================================================
     * FALLBACK
     *
     * Se o catálogo não tiver buy_box_winner,
     * tentamos aproveitar dados que vieram
     * diretamente no resultado da busca.
     * =================================================
     */

    const precoResultado =
      numero(
        resultado.price
      );

    if (
      precoResultado == null
    ) {
      return null;
    }

    const originalResultado =
      numero(
        resultado.original_price
      );

    const descontoResultado =
      calcularDesconto(
        precoResultado,
        originalResultado
      );

    const shippingResultado =
      resultado.shipping ||
      {};

    const fretegratisResultado =
      shippingResultado
        .free_shipping === true;

    let imagemResultado =
      null;

    if (
      Array.isArray(
        resultado.pictures
      ) &&
      resultado.pictures.length
    ) {

      imagemResultado =
        resultado.pictures[0].url ||
        null;
    }

    if (
      !imagemResultado &&
      Array.isArray(
        detalhe.pictures
      ) &&
      detalhe.pictures.length
    ) {

      imagemResultado =
        detalhe.pictures[0].url ||
        null;
    }

    const produtoFallback = {

      id:
        resultado.id,

      product_id:
        detalhe.id,

      titulo:
        resultado.title ||
        resultado.name ||
        detalhe.name ||
        "Produto Mercado Livre",

      imagem:
        imagemResultado,

      permalink:
        resultado.permalink ||
        "https://www.mercadolivre.com.br/",

      preco:
        precoResultado,

      preco_original:
        originalResultado,

      desconto:
        descontoResultado,

      vencedor:
        false,

      seller_id:
        resultado.seller &&
        resultado.seller.id
          ? resultado.seller.id
          : null,

      quantidade:
        numero(
          resultado.available_quantity
        ) ?? 0,

      vendidos:
        numero(
          resultado.sold_quantity
        ) ?? 0,

      fretegratis:
        fretegratisResultado,

      promocao:
        descontoResultado > 0,

      promocao_id:
        null,

      moeda:
        resultado.currency_id ||
        "BRL"
    };

    produtoFallback.score =
      calcularScore(
        produtoFallback
      );

    return produtoFallback;

  } catch (erro) {

    console.error(
      "Erro processando produto:",
      erro
    );

    return null;
  }
}

/*
=====================================================
HANDLER
=====================================================
*/

module.exports =
  async function handler(
    req,
    res
  ) {

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
            error:
              "Mercado Livre não conectado."
          }
        );
      }

      const categoria =
        String(
          (
            req.query &&
            req.query.categoria
          ) ||
          "todas"
        ).toLowerCase();

      const buscas =
        CATEGORIAS[
          categoria
        ] ||
        CATEGORIAS.todas;

      const resultados = [];

      /*
       * Para não fazer chamadas demais,
       * usamos no máximo 4 buscas.
       */

      const termos =
        buscas.slice(
          0,
          4
        );

      for (
        const termo
        of termos
      ) {

        const busca =
          await buscarCatalogo(
            termo,
            sessao.access_token
          );

        if (
          !busca.ok
        ) {

          console.error(
            "Erro na busca:",
            termo,
            busca.status,
            busca.data
          );

          continue;
        }

        const produtos =
          Array.isArray(
            busca.data &&
            busca.data.results
          )
            ? busca.data.results
            : [];

        /*
         * Processa 5 produtos por vez.
         */

        const grupo =
          produtos.slice(
            0,
            10
          );

        for (
          let i = 0;
          i < grupo.length;
          i += 5
        ) {

          const bloco =
            grupo.slice(
              i,
              i + 5
            );

          const processados =
            await Promise.all(
              bloco.map(
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
           * Já temos ofertas suficientes.
           */

          if (
            resultados.length >= 30
          ) {
            break;
          }
        }

        if (
          resultados.length >= 30
        ) {
          break;
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
        const produto
        of resultados
      ) {

        if (
          !ids.has(
            produto.id
          )
        ) {

          ids.add(
            produto.id
          );

          unicos.push(
            produto
          );
        }
      }

      /*
       * Ordenação.
       */

      unicos.sort(
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

          termos_pesquisados:
            termos,

          total:
            unicos.length,

          resultados:
            unicos.slice(
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
