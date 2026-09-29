const { session } = require("./lib");

const SITE_ID = "MLB";

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
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
    } catch {
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
      error: error.message || String(error)
    };
  }
}

/*
====================================================
CATEGORIAS
====================================================
*/

const CATEGORIAS = {
  todas: {
    nome: "Todas",
    raiz: null
  },

  celulares: {
    nome: "Celulares",
    raiz: "MLB1051"
  },

  celular: {
    nome: "Celulares",
    raiz: "MLB1051"
  },

  eletronicos: {
    nome: "Eletrônicos",
    raiz: "MLB1000"
  },

  eletrônico: {
    nome: "Eletrônicos",
    raiz: "MLB1000"
  },

  eletronico: {
    nome: "Eletrônicos",
    raiz: "MLB1000"
  },

  eletrônicos: {
    nome: "Eletrônicos",
    raiz: "MLB1000"
  },

  casa: {
    nome: "Casa",
    raiz: "MLB1574"
  },

  informatica: {
    nome: "Informática",
    raiz: "MLB1648"
  },

  informática: {
    nome: "Informática",
    raiz: "MLB1648"
  },

  games: {
    nome: "Games",
    raiz: "MLB1144"
  },

  game: {
    nome: "Games",
    raiz: "MLB1144"
  },

  moda: {
    nome: "Moda",
    raiz: "MLB1430"
  }
};

/*
====================================================
NORMALIZA CATEGORIA
====================================================
*/

function normalizarCategoria(valor) {

  let categoria =
    String(valor || "todas")
      .trim()
      .toLowerCase();

  categoria =
    categoria
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const mapa = {
    todas: "todas",

    celular: "celulares",
    celulares: "celulares",

    eletronico: "eletronicos",
    eletronicos: "eletronicos",

    casa: "casa",

    informatica: "informatica",

    game: "games",
    games: "games",

    moda: "moda"
  };

  return mapa[categoria] || categoria;
}

/*
====================================================
CATEGORIA DO MERCADO LIVRE
====================================================
*/

async function buscarCategoria(id, token) {

  return await mlFetch(
    `/categories/${encodeURIComponent(id)}`,
    token
  );
}

/*
====================================================
BUSCAR SUBCATEGORIAS
====================================================
*/

async function encontrarCategoriasRanking(
  raiz,
  token
) {

  const resultado =
    await buscarCategoria(
      raiz,
      token
    );

  if (
    !resultado.ok ||
    !resultado.data
  ) {
    return [];
  }

  const dados =
    resultado.data;

  if (
    !Array.isArray(
      dados.children_categories
    ) ||
    dados.children_categories.length === 0
  ) {
    return [raiz];
  }

  const filhos =
    dados.children_categories
      .slice()
      .sort(
        (a, b) =>
          (b.total_items_in_this_category || 0) -
          (a.total_items_in_this_category || 0)
      )
      .slice(0, 5);

  const encontradas = [];

  for (
    const filho
    of filhos
  ) {

    const sub =
      await buscarCategoria(
        filho.id,
        token
      );

    if (
      !sub.ok ||
      !sub.data
    ) {
      continue;
    }

    const dadosSub =
      sub.data;

    if (
      !Array.isArray(
        dadosSub.children_categories
      ) ||
      dadosSub.children_categories.length === 0
    ) {
      encontradas.push(
        filho.id
      );

      continue;
    }

    const netos =
      dadosSub.children_categories
        .slice()
        .sort(
          (a, b) =>
            (b.total_items_in_this_category || 0) -
            (a.total_items_in_this_category || 0)
        )
        .slice(0, 3);

    for (
      const neto
      of netos
    ) {
      encontradas.push(
        neto.id
      );
    }
  }

  return [
    ...new Set(
      encontradas
    )
  ];
}

/*
====================================================
HIGHLIGHTS
====================================================
*/

async function highlights(
  categoryId,
  token
) {

  return await mlFetch(
    `/highlights/${SITE_ID}/category/${encodeURIComponent(categoryId)}`,
    token
  );
}

/*
====================================================
ITEM
====================================================
*/

async function buscarItem(
  itemId,
  token
) {

  return await mlFetch(
    `/items/${encodeURIComponent(itemId)}`,
    token
  );
}

/*
====================================================
PREÇOS
====================================================
*/

async function buscarPrecos(
  itemId,
  token
) {

  return await mlFetch(
    `/items/${encodeURIComponent(itemId)}/prices`,
    token
  );
}

/*
====================================================
ANALISAR PROMOÇÃO
====================================================
*/

function analisarPrecos(
  dados
) {

  if (
    !dados ||
    !Array.isArray(
      dados.prices
    )
  ) {
    return null;
  }

  const standard =
    dados.prices.find(
      p =>
        p.type === "standard"
    );

  const promotion =
    dados.prices.find(
      p =>
        p.type === "promotion"
    );

  if (
    !promotion ||
    typeof promotion.amount !==
      "number"
  ) {
    return null;
  }

  const atual =
    promotion.amount;

  let original =
    null;

  if (
    typeof promotion.regular_amount ===
      "number" &&
    promotion.regular_amount > atual
  ) {
    original =
      promotion.regular_amount;
  }

  if (
    original === null &&
    standard &&
    typeof standard.amount ===
      "number" &&
    standard.amount > atual
  ) {
    original =
      standard.amount;
  }

  if (
    original === null ||
    original <= atual
  ) {
    return null;
  }

  const desconto =
    Math.round(
      (
        (original - atual) /
        original
      ) * 100
    );

  return {
    preco: atual,
    preco_original: original,
    desconto
  };
}

/*
====================================================
MONTAR PRODUTO
====================================================
*/

function montarProduto(
  dados,
  ranking,
  categoriaNome,
  preco
) {

  let imagem = null;

  if (
    Array.isArray(
      dados.pictures
    ) &&
    dados.pictures.length
  ) {
    imagem =
      dados.pictures[0].secure_url ||
      dados.pictures[0].url ||
      null;
  }

  if (!imagem) {
    imagem =
      dados.thumbnail ||
      null;
  }

  return {

    id:
      dados.id,

    item_id:
      dados.id,

    title:
      dados.title ||
      "Produto Mercado Livre",

    titulo:
      dados.title ||
      "Produto Mercado Livre",

    price:
      preco
        ? preco.preco
        : (
            typeof dados.price ===
              "number"
              ? dados.price
              : null
          ),

    preco:
      preco
        ? preco.preco
        : (
            typeof dados.price ===
              "number"
              ? dados.price
              : null
          ),

    original_price:
      preco
        ? preco.preco_original
        : null,

    preco_original:
      preco
        ? preco.preco_original
        : null,

    discount:
      preco
        ? preco.desconto
        : 0,

    desconto:
      preco
        ? preco.desconto
        : 0,

    thumbnail:
      imagem,

    imagem:
      imagem,

    permalink:
      dados.permalink ||
      `https://www.mercadolivre.com.br/p/${dados.id}`,

    link:
      dados.permalink ||
      `https://www.mercadolivre.com.br/p/${dados.id}`,

    category_id:
      dados.category_id ||
      null,

    categoria:
      categoriaNome,

    ranking:
      ranking || null,

    mais_vendido:
      true,

    promocao:
      !!preco,

    tipo:
      preco
        ? "PROMOCAO"
        : "MAIS_VENDIDO",

    sold_quantity:
      dados.sold_quantity ??
      null,

    available_quantity:
      dados.available_quantity ??
      null,

    condition:
      dados.condition ||
      null
  };
}

/*
====================================================
PROCESSAR CATEGORIA
====================================================
*/

async function processarCategoria(
  categoryId,
  categoriaNome,
  token
) {

  const ranking =
    await highlights(
      categoryId,
      token
    );

  if (
    !ranking.ok ||
    !ranking.data
  ) {

    return {
      produtos: [],
      erro: {
        categoria_id:
          categoryId,

        categoria:
          categoriaNome,

        status:
          ranking.status,

        resposta:
          ranking.data
      }
    };
  }

  const content =
    Array.isArray(
      ranking.data.content
    )
      ? ranking.data.content
      : [];

  const itens =
    content.filter(
      x =>
        x &&
        x.type === "ITEM" &&
        x.id
    );

  const produtos = [];

  /*
    Limite para evitar timeout.
  */

  const candidatos =
    itens.slice(
      0,
      10
    );

  /*
    Processa os anúncios.
  */

  for (
    const candidato
    of candidatos
  ) {

    const detalhe =
      await buscarItem(
        candidato.id,
        token
      );

    if (
      !detalhe.ok ||
      !detalhe.data
    ) {
      continue;
    }

    const dados =
      detalhe.data;

    const precoDados =
      await buscarPrecos(
        candidato.id,
        token
      );

    const preco =
      precoDados.ok
        ? analisarPrecos(
            precoDados.data
          )
        : null;

    produtos.push(
      montarProduto(
        dados,
        candidato.position,
        categoriaNome,
        preco
      )
    );
  }

  return {
    produtos,
    erro: null
  };
}

/*
====================================================
HANDLER
====================================================
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

      const token =
        sessao.access_token;

      /*
        Pega a categoria enviada
        pela tela.
      */

      const categoriaOriginal =
        req.query &&
        req.query.categoria
          ? req.query.categoria
          : "todas";

      const categoriaParam =
        normalizarCategoria(
          categoriaOriginal
        );

      /*
        Lista de categorias.
      */

      const categoriasBase = {

        celulares: {
          nome: "Celulares",
          raiz: "MLB1051"
        },

        eletronicos: {
          nome: "Eletrônicos",
          raiz: "MLB1000"
        },

        casa: {
          nome: "Casa",
          raiz: "MLB1574"
        },

        informatica: {
          nome: "Informática",
          raiz: "MLB1648"
        },

        games: {
          nome: "Games",
          raiz: "MLB1144"
        },

        moda: {
          nome: "Moda",
          raiz: "MLB1430"
        }
      };

      let categoriasSelecionadas = [];

      /*
        TODAS
      */

      if (
        categoriaParam ===
        "todas"
      ) {

        categoriasSelecionadas =
          Object.entries(
            categoriasBase
          ).map(
            ([chave, valor]) => ({
              chave,
              ...valor
            })
          );

      }

      /*
        CATEGORIA ESPECÍFICA
      */

      else if (
        categoriasBase[
          categoriaParam
        ]
      ) {

        categoriasSelecionadas =
          [
            {
              chave:
                categoriaParam,

              ...categoriasBase[
                categoriaParam
              ]
            }
          ];

      }

      /*
        CATEGORIA DESCONHECIDA
      */

      else {

        return json(
          res,
          400,
          {
            error:
              "Categoria inválida.",

            categoria_recebida:
              categoriaOriginal,

            categoria_normalizada:
              categoriaParam,

            categorias_validas:
              [
                "todas",
                "celulares",
                "eletronicos",
                "casa",
                "informatica",
                "games",
                "moda"
              ]
          }
        );
      }

      const todos = [];
      const erros = [];

      /*
        Processa categorias.
      */

      for (
        const categoria
        of categoriasSelecionadas
      ) {

        const folhas =
          await encontrarCategoriasRanking(
            categoria.raiz,
            token
          );

        const candidatas =
          [
            ...new Set([
              ...folhas,
              categoria.raiz
            ])
          ].slice(
            0,
            4
          );

        for (
          const categoryId
          of candidatas
        ) {

          const resultado =
            await processarCategoria(
              categoryId,
              categoria.nome,
              token
            );

          if (
            resultado.erro
          ) {
            erros.push(
              resultado.erro
            );
          }

          todos.push(
            ...resultado.produtos
          );
        }
      }

      /*
        Remove duplicados.
      */

      const unicos = [];
      const ids = new Set();

      for (
        const produto
        of todos
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
        Promoções primeiro.
      */

      unicos.sort(
        (a, b) => {

          if (
            Boolean(b.promocao) !==
            Boolean(a.promocao)
          ) {

            return b.promocao
              ? 1
              : -1;
          }

          if (
            (b.desconto || 0) !==
            (a.desconto || 0)
          ) {

            return (
              (b.desconto || 0) -
              (a.desconto || 0)
            );
          }

          return (
            (a.ranking || 999) -
            (b.ranking || 999)
          );
        }
      );

      const produtos =
        unicos.slice(
          0,
          30
        );

      const promocoes =
        produtos.filter(
          p =>
            p.promocao
        );

      return json(
        res,
        200,
        {

          ok: true,

          categoria:
            categoriaParam,

          total:
            produtos.length,

          quantidade_promocoes:
            promocoes.length,

          quantidade_mais_vendidos:
            produtos.filter(
              p =>
                !p.promocao
            ).length,

          produtos,

          promocoes,

          erros,

          fonte:
            "Mercado Livre /highlights + /items + /items/{id}/prices"
        }
      );

    } catch (error) {

      console.error(
        "ERRO ML PROMOCOES:",
        error
      );

      return json(
        res,
        500,
        {
          error:
            error.message ||
            String(error)
        }
      );
    }
  };
