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

    const [category, highlights] = await Promise.all([
      mlFetch(`/categories/${categoryId}`, token),
      mlFetch(`/highlights/MLB/category/${categoryId}`, token)
    ]);

    const children = Array.isArray(category.data?.children_categories)
      ? category.data.children_categories.map(c => ({ id: c.id, name: c.name }))
      : [];

    const candidates = Array.isArray(highlights.data?.content)
      ? highlights.data.content.filter(x => x && x.type === "PRODUCT" && x.id).slice(0, 3)
      : [];

    const testedProducts = await Promise.all(candidates.map(async candidate => {
      const [catalog, relation] = await Promise.all([
        mlFetch(`/products/${encodeURIComponent(candidate.id)}`, token),
        mlFetch(`/products/${encodeURIComponent(candidate.id)}/items?limit=10`, token)
      ]);

      const rawItems = Array.isArray(relation.data?.results)
        ? relation.data.results
        : Array.isArray(relation.data)
          ? relation.data
          : [];

      return {
        product_id: candidate.id,
        catalog: {
          status: catalog.status,
          ok: catalog.ok,
          name: catalog.data?.name || null,
          image: catalog.data?.pictures?.[0]?.secure_url || catalog.data?.pictures?.[0]?.url || null
        },
        anuncios: {
          status: relation.status,
          ok: relation.ok,
          total: rawItems.length,
          amostra: rawItems.slice(0, 5).map(item => ({
            id: item.item_id || item.id || null,
            title: item.title || null,
            price: item.price ?? item.sale_price ?? null,
            original_price: item.original_price ?? null,
            permalink: item.permalink || null
          })),
          erro: relation.ok ? undefined : relation.data
        }
      };
    }));

    return json(res, 200, {
      diagnostico: "TESTE DE ANÚNCIOS REAIS - BEBÊS",
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
        total_catalogo: Array.isArray(highlights.data?.content) ? highlights.data.content.length : 0,
        produtos_testados: testedProducts
      }
    });
  } catch (e) {
    return json(res, 500, { diagnostico: "ERRO", mensagem: e.message });
  }
};
