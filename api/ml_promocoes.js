const { session } = require("./lib");

const SITE_ID = "MLB";

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function mlFetch(path, token, options = {}) {
  try {
    const response = await fetch(
      "https://api.mercadolibre.com" + path,
      {
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(options.headers || {})
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
  Categorias principais.

  O /highlights exige uma categoria que tenha
  ranking de mais vendidos disponível.

  Para evitar depender de uma categoria fixa,
  procuramos automaticamente uma subcategoria
  forte e depois consultamos o ranking.
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

/*
  Consulta detalhes da categoria.
*/
async function categoria(id, token) {
  return await mlFetch(
    `/categories/${encodeURIComponent(id)}`,
    token
  );
}

/*
  Encontra uma categoria folha.

  O Mercado Livre informa que /highlights por
  categoria funciona para categorias que possuem
  ranking de mais vendidos disponível.
*/
async function encontrarCategoriasRanking(
  raiz,
  token
) {
  const resultado = await categoria(
    raiz,
    token
  );

  if (!resultado.ok || !resultado.data) {
    return [];
  }

  const dados = resultado.data;

  if (
    !Array.isArray(
      dados.children_categories
    ) ||
    dados.children_categories.length === 0
  ) {
    return [raiz];
  }

  /*
    Pegamos as subcategorias com maior quantidade
    de produtos. Assim não ficamos presos a uma
    categoria pequena.
  */
  const filhos =
    dados.children_categories
      .slice()
      .sort(
        (a, b) =>
          (b.total_items_in_this_category || 0) -
          (a.total_items_in_this_category || 0)
      )
      .slice(0, 4);

  const encontradas = [];

  /*
    Tentamos primeiro os filhos.
  */
  for (const filho of filhos) {
    const sub =
      await categoria(
        filho.id,
        token
      );

    if (
      !sub.ok ||
      !sub.data
    ) {
      continue;
    }

    const subDados =
      sub.data;

    if (
      !Array.isArray(
        subDados.children_categories
      ) ||
      subDados.children_categories.length === 0
    ) {
      encontradas.push(
        filho.id
      );
      continue;
    }

    /*
      Se ainda possui filhos,
      escolhemos os maiores deles.
    */
    const netos =
      subDados.children_categories
        .slice()
        .sort(
          (a, b) =>
            (b.total_items_in_this_category || 0) -
            (a.total_items_in_this_category || 0)
        )
        .slice(0, 3);

    for (const neto of netos) {
      encontradas.push(
        neto.id
      );
    }
  }

  /*
    Remove duplicados.
  */
  return [
    ...new Set(
      encontradas
    )
  ];
}

/*
  Consulta os mais vendidos de uma categoria.
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
  Consulta um anúncio real.
*/
async function item(
  itemId,
  token
) {
  return await mlFetch(
    `/items/${encodeURIComponent(itemId)}`,
    token
  );
}

/*
  Consulta preços atuais.

  A API de preços informa os tipos:
  - standard
  - promotion
*/
async function precos(
  itemId,
  token
) {
  return await mlFetch(
    `/items/${encodeURIComponent(itemId)}/prices`,
    token
  );
}

/*
  Extrai o preço promocional.
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
    typeof promotion.amount !== "number"
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
    typeof standard.amount === "number" &&
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
      ((original - atual) /
        original) *
        100
    );

  return {
    preco: atual,
    preco_original: original,
    desconto,
    tipo_preco: "promotion"
  };
}

/*
  Converte um item do Mercado Livre
  para o formato usado pelo Radar.
*/
function montarProduto(
  dados,
  ranking,
  categoriaNome,
  preco
) {
  const imagem =
    dados.pictures &&
    dados.pictures[0]
      ? (
          dados.pictures[0].secure_url ||
          dados.pictures[0].url ||
          null
        )
      : (
          dados.thumbnail ||
          null
        );

  return {
    id: dados.id,

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
            typeof dados.price === "number"
              ? dados.price
              : null
          ),

    preco:
      preco
        ? preco.preco
        : (
            typeof dados.price === "number"
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
      ranking,

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
  Processa uma categoria.
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

  /*
    O ranking pode trazer:
    ITEM
    PRODUCT
    USER_PRODUCT

    Neste MVP vamos trabalhar primeiro
    com ITEM porque é o anúncio real.
  */
  const itens =
    content.filter(
      x =>
        x &&
        x.type === "ITEM" &&
        x.id
    );

  const produtos = [];

  /*
    No máximo 8 anúncios por categoria,
    para evitar timeout no Vercel.
  */
  const candidatos =
    itens.slice(0, 8);

  for (
    const candidato
    of candidatos
  ) {
    const detalhe =
      await item(
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
      await precos(
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

      const categoriaParam =
        String(
          req.query?.categoria ||
          "todas"
        ).toLowerCase();

      /*
        Se for "todas", buscamos as
        principais categorias.
      */
      let categoriasSelecionadas =
        [];

      if (
        categoriaParam === "todas"
      ) {
        categoriasSelecionadas =
          [
            {
              chave: "celulares",
              nome: "Celulares",
              raiz: "MLB1051"
            },
            {
              chave: "eletronicos",
              nome: "Eletrônicos",
              raiz: "MLB1000"
            },
            {
              chave: "casa",
              nome: "Casa",
              raiz: "MLB1574"
            },
            {
              chave: "informatica",
              nome: "Informática",
              raiz: "MLB1648"
            },
            {
              chave: "games",
              nome: "Games",
              raiz: "MLB1144"
            },
            {
              chave: "moda",
              nome: "Moda",
              raiz: "MLB1430"
            }
          ];
      } else {
        const config =
          CATEGORIAS[
            categoriaParam
          ];

        if (!config) {
          return json(
            res,
            400,
            {
              error:
                "Categoria inválida."
            }
          );
        }

        categoriasSelecionadas =
          [
            {
              chave:
                categoriaParam,

              nome:
                config.nome,

              raiz:
                config.raiz
            }
          ];
      }

      const todos =
        [];

      const erros =
        [];

      /*
        Primeiro descobrimos categorias
        com ranking.
      */
      for (
        const categoria
        of categoriasSelecionadas
      ) {
        if (!categoria.raiz) {
          continue;
        }

        const folhas =
          await encontrarCategoriasRanking(
            categoria.raiz,
            token
          );

        /*
          Se a própria raiz funcionar,
          ela também pode ser usada.
        */
        const candidatas =
          [
            ...new Set([
              ...folhas,
              categoria.raiz
            ])
          ].slice(0, 4);

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
        Remove anúncios duplicados.
      */
      const unicos =
        [];

      const ids =
        new Set();

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
        Depois, mais vendidos.
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

      /*
        Limita a resposta para manter
        o carregamento rápido.
      */
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
