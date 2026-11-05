const { session } = require("./lib");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function mlFetch(path, token) {
  try {
    const r = await fetch("https://api.mercadolibre.com" + path, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });

    let data = null;
    try {
      data = await r.json();
    } catch {}

    return { status: r.status, ok: r.ok, data };
  } catch (e) {
    return { status: 0, ok: false, error: e.message };
  }
}

module.exports = async function handler(req, res) {
  try {
    const sess = await session(req, res);

    if (!sess || !sess.access_token) {
      return json(res, 401, {
        erro: "Mercado Livre não conectado."
      });
    }

    const category = await mlFetch(
      "/categories/MLB1384",
      sess.access_token
    );

    const highlights = await mlFetch(
      "/highlights/MLB/category/MLB1384",
      sess.access_token
    );

    const children = Array.isArray(
      category.data?.children_categories
    )
      ? category.data.children_categories.map(c => ({
          id: c.id,
          name: c.name
        }))
      : [];

    const products = Array.isArray(
      highlights.data?.content
    )
      ? highlights.data.content.slice(0, 8).map(x => ({
          id: x.id,
          type: x.type,
          position: x.position
        }))
      : [];

    return json(res, 200, {
      diagnostico: "TESTE CATEGORIA BEBÊS",
      categoria: {
        status: category.status,
        ok: category.ok,
        id: category.data?.id,
        nome: category.data?.name,
        filhos: children
      },
      destaques: {
        status: highlights.status,
        ok: highlights.ok,
        produtos: products,
        resposta_erro: highlights.ok
          ? undefined
          : highlights.data
      }
    });

  } catch (e) {
    return json(res, 500, {
      erro: e.message
    });
  }
};
