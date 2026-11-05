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
    try { data = await r.json(); } catch {}
    return { status: r.status, ok: r.ok, data };
  } catch (e) {
    return { status: 0, ok: false, data: null, error: e.message };
  }
}

module.exports = async function handler(req, res) {
  try {
    const sessao = await session(req, res);
    if (!sessao || !sessao.access_token) {
      return json(res, 401, { erro: "Mercado Livre não conectado." });
    }

    const token = sessao.access_token;
    const categoryId = "MLB1384";

    const [category, highlights, bulk] = await Promise.all([
      mlFetch(`/categories/${categoryId}`, token),
      mlFetch(`/highlights/MLB/category/${categoryId}`, token),
      mlFetch(
        "/items/bulk?ids=MLB4002919471,MLB5977782288,MLB4039471005,MLB4592320910,MLB4049279695&attributes=body.id,body.title,body.price,body.original_price,body.thumbnail,body.permalink,body.category_id",
        token
      )
    ]);

    const children = Array.isArray(category.data?.children_categories)
      ? category.data.children_categories.map(c => ({ id: c.id, name: c.name }))
      : [];

    const highlightsContent = Array.isArray(highlights.data?.content)
      ? highlights.data.content.slice(0, 10).map(x => ({
          id: x.id,
          type: x.type,
          position: x.position
        }))
      : [];

    return json(res, 200, {
      diagnostico: "MERCADO LIVRE - CATEGORIA BEBÊS",
      categoria: {
        status: category.status,
        ok: category.ok,
        id: category.data?.id,
        nome: category.data?.name,
        filhos: children,
        erro: category.ok ? undefined : category.data
      },
      destaques: {
        status: highlights.status,
        ok: highlights.ok,
        produtos: highlightsContent,
        erro: highlights.ok ? undefined : highlights.data
      },
      teste_items_bulk: {
        status: bulk.status,
        ok: bulk.ok,
        resposta: bulk.data
      }
    });
  } catch (e) {
    return json(res, 500, { diagnostico: "ERRO", mensagem: e.message });
  }
};
