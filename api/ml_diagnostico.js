const { session } = require("./lib");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.end(JSON.stringify(data));
}

async function mlFetch(path, token) {
  try {
    const response = await fetch(
      "https://api.mercadolibre.com" + path,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    let data = null;

    try {
      data = await response.json();
    } catch {}

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

module.exports = async function handler(req, res) {

  try {

    const sessao =
      await session(req, res);

    if (
      !sessao ||
      !sessao.access_token
    ) {
      return json(res, 401, {
        erro:
          "Mercado Livre não conectado."
      });
    }

    const token =
      sessao.access_token;

    const categorias = [
      {
        nome: "Celulares",
        id: "MLB1051"
      },
      {
        nome: "Eletrônicos",
        id: "MLB1000"
      },
      {
        nome: "Casa",
        id: "MLB1574"
      },
      {
        nome: "Informática",
        id: "MLB1648"
      },
      {
        nome: "Games",
        id: "MLB1144"
      },
      {
        nome: "Moda",
        id: "MLB1430"
      }
    ];

    const resultados = [];

    for (
      const categoria
      of categorias
    ) {

      const highlights =
        await mlFetch(
          `/highlights/MLB/category/${categoria.id}`,
          token
        );

      if (
        !highlights.ok ||
        !highlights.data
      ) {

        resultados.push({
          categoria:
            categoria.nome,

          erro:
            highlights.data ||
            highlights.error ||
            "Erro highlights"
        });

        continue;
      }

      const content =
        Array.isArray(
          highlights.data.content
        )
          ? highlights.data.content
          : [];

      const produtos =
        content.filter(
          x =>
            x &&
            x.type === "PRODUCT" &&
            x.id
        );

      const encontrados = [];

      /*
        Testa no máximo 10 PRODUCTs
        por categoria.
      */

      for (
        const destaque
        of produtos.slice(0, 10)
      ) {

        const product =
          await mlFetch(
            `/products/${encodeURIComponent(destaque.id)}`,
            token
          );

        if (
          !product.ok ||
          !product.data
        ) {
          continue;
        }

        const dados =
          product.data;

        /*
          Primeiro testa o próprio produto.
        */

        if (
          dados.buy_box_winner &&
          dados.buy_box_winner.item_id
        ) {

          encontrados.push({

            origem:
              "PRODUCT_DIRETO",

            product_id:
              dados.id,

            position:
              destaque.position,

            nome:
              dados.name,

            item_id:
              dados.buy_box_winner.item_id,

            seller_id:
              dados.buy_box_winner.seller_id,

            preco:
              dados.buy_box_winner.price,

            original_price:
              dados.buy_box_winner.original_price,

            shipping:
              dados.buy_box_winner.shipping || null

          });

          continue;
        }

        /*
          Agora testa os filhos.
        */

        const children =
          Array.isArray(
            dados.children_ids
          )
            ? dados.children_ids
            : [];

        if (
          children.length === 0
        ) {
          encontrados.push({

            origem:
              "SEM_FILHOS",

            product_id:
              dados.id,

            position:
              destaque.position,

            nome:
              dados.name,

            quantidade_filhos:
              0,

            buy_box_winner:
              null

          });

          continue;
        }

        /*
          Limita a 10 filhos por produto.
        */

        const filhos =
          children.slice(
            0,
            10
          );

        for (
          const childId
          of filhos
        ) {

          const child =
            await mlFetch(
              `/products/${encodeURIComponent(childId)}`,
              token
            );

          if (
            !child.ok ||
            !child.data
          ) {
            continue;
          }

          const childData =
            child.data;

          if (
            childData.buy_box_winner &&
            childData.buy_box_winner.item_id
          ) {

            encontrados.push({

              origem:
                "PRODUCT_FILHO",

              product_id:
                childData.id,

              product_pai:
                dados.id,

              position:
                destaque.position,

              nome:
                childData.name,

              item_id:
                childData.buy_box_winner.item_id,

              seller_id:
                childData.buy_box_winner.seller_id,

              preco:
                childData.buy_box_winner.price,

              original_price:
                childData.buy_box_winner.original_price,

              shipping:
                childData.buy_box_winner.shipping ||
                null

            });

          }

        }

      }

      resultados.push({

        categoria:
          categoria.nome,

        categoria_id:
          categoria.id,

        quantidade_products:
          produtos.length,

        encontrados:
          encontrados.length,

        resultados:
          encontrados

      });

    }

    /*
      Junta todos os vencedores.
    */

    const vencedores =
      [];

    const ids =
      new Set();

    for (
      const categoria
      of resultados
    ) {

      for (
        const item
        of (
          categoria.resultados ||
          []
        )
      ) {

        if (
          item.item_id &&
          !ids.has(
            item.item_id
          )
        ) {

          ids.add(
            item.item_id
          );

          vencedores.push(
            item
          );
        }

      }

    }

    return json(
      res,
      200,
      {

        diagnostico:
          "TESTE PRODUCT FILHOS",

        quantidade_vencedores:
          vencedores.length,

        vencedores:

          vencedores.slice(
            0,
            50
          ),

        categorias:
          resultados,

        conclusao:

          vencedores.length > 0

            ? "ENCONTRAMOS ITENS ATRAVES DOS PRODUCTS OU FILHOS"

            : "NENHUM PRODUCT OU FILHO POSSUI BUY_BOX_WINNER"

      }
    );

  } catch (error) {

    console.error(
      "ERRO DIAGNOSTICO:",
      error
    );

    return json(
      res,
      500,
      {

        diagnostico:
          "ERRO",

        mensagem:
          error.message ||
          String(error)

      }
    );
  }
};
