const { session } = require("./lib");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function mlFetch(path, token) {
  try {
    const r = await fetch("https://api.mercadolibre.com" + path, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
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
    const sess = await session(req, res);
    if (!sess?.access_token) return json(res, 401, { erro: "Mercado Livre não conectado." });

    const q = String(req.query?.q || "fralda Pampers").trim();
    const search = await mlFetch(
      `/products/search?status=active&site_id=MLB&q=${encodeURIComponent(q)}&limit=10`,
      sess.access_token
    );

    const products = Array.isArray(search.data?.results) ? search.data.results : [];
    const tested = await Promise.all(products.slice(0, 3).map(async p => {
      const relation = await mlFetch(
        `/products/${encodeURIComponent(p.id)}/items?limit=10`,
        sess.access_token
      );
      const items = Array.isArray(relation.data?.results)
        ? relation.data.results
        : Array.isArray(relation.data) ? relation.data : [];
      return {
        product_id: p.id,
        nome_catalogo: p.name || null,
        status_catalogo: p.status || null,
        domain_id: p.domain_id || null,
        anuncios: {
          status: relation.status,
          ok: relation.ok,
          total: items.length,
          amostra: items.slice(0, 5).map(x => ({
            id: x.item_id || x.id || null,
            preco: x.price ?? x.sale_price ?? null
          })),
          erro: relation.ok ? undefined : relation.data
        }
      };
    }));

    return json(res, 200, {
      diagnostico: "TESTE BUSCA DE CATÁLOGO POR PALAVRA-CHAVE",
      termo: q,
      busca_catalogo: {
        status: search.status,
        ok: search.ok,
        total: search.data?.paging?.total ?? products.length,
        produtos: products.slice(0, 10).map(p => ({ id: p.id, nome: p.name, status: p.status })),
        erro: search.ok ? undefined : search.data
      },
      anuncios_testados: tested
    });
  } catch (e) {
    return json(res, 500, { diagnostico: "ERRO", mensagem: e.message });
  }
};
