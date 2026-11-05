const { session } = require("./lib");

const BABY_CATEGORY = "MLB1384";
const CATEGORY_MAP = [
  { test: /fralda|lenço|lenco|higiene|pomada|shampoo|toalha/, ids: ["MLB420375"] },
  { test: /mamadeira|amament|papinha|leite|alimenta/, ids: ["MLB5360", "MLB39965"] },
  { test: /carrinho|beb[eê] conforto|passeio/, ids: ["MLB420409"] },
  { test: /berço|berco|quarto|sono/, ids: ["MLB420361"] },
  { test: /maternidade|gestante|bolsa maternidade/, ids: ["MLB420295"] },
  { test: /brinquedo|mordedor|chupeta/, ids: ["MLB1392", "MLB420293"] },
  { test: /roupa|body|macacão|macacao|sapato/, ids: ["MLB1396"] }
];

function commissionRate(name) {
  const n = String(name || "").toLowerCase();
  if (/beleza|calçados|calcados|roupas|bolsas|esportes|fitness/.test(n)) return 0.16;
  if (/celular|informática|informatica|eletrônicos|eletronicos|áudio|audio|vídeo|video|câmeras|cameras|eletrodomésticos|eletrodomesticos/.test(n)) return 0.05;
  return n ? 0.12 : null;
}

async function mlFetch(path, token) {
  try {
    const r = await fetch("https://api.mercadolibre.com" + path, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    let data = null;
    try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e.message };
  }
}

function arr(data) {
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

function matchesQuery(title, query) {
  const words = query.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return true;
  const text = String(title || "").toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return words.every(word => text.includes(word));
}

module.exports = async function(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
    const sess = await session(req, res);
    if (!sess?.access_token) return res.status(401).json({ error: "Mercado Livre não conectado." });

    const q = String(req.query?.q || "").trim();
    if (!q) return res.status(400).json({ error: "Digite um termo de busca." });

    // Tenta primeiro a busca tradicional. Se o endpoint responder 403,
    // usa os destaques do catálogo de Bebês e resolve os anúncios reais.
    const direct = await mlFetch(`/sites/MLB/search?q=${encodeURIComponent(q)}&limit=30`, sess.access_token);
    if (direct.ok) {
      const results = (direct.data?.results || []).map(item => {
        const price = Number.isFinite(item.price) ? item.price : null;
        const original = Number.isFinite(item.original_price) ? item.original_price : null;
        const discount = price !== null && original > price ? Math.round((original-price)/original*100) : null;
        const rate = commissionRate(item.category_id || "bebê");
        return {
          id:item.id, item_id:item.id, title:item.title || "Produto Mercado Livre",
          permalink:item.permalink || `https://www.mercadolivre.com.br/p/${item.id}`,
          image:item.thumbnail?.replace(/^http:/,"https:") || null, price, original_price:original,
          discount, sold_quantity:item.sold_quantity ?? null, available_quantity:item.available_quantity ?? null,
          free_shipping:Boolean(item.shipping?.free_shipping), seller_id:item.seller?.id || null,
          condition:item.condition || "Novo", category_id:item.category_id || null,
          affiliate_commission_rate:rate, affiliate_commission_estimate:rate && price ? Math.round(price*rate*100)/100 : null,
          affiliate_commission_label:rate ? Math.round(rate*100)+"%" : null, score:0
        };
      });
      return res.status(200).json({ keywords:q, total:results.length, results });
    }

    if (direct.status !== 403) {
      return res.status(direct.status || 502).json({ error:"Erro na busca do Mercado Livre.", details:direct.data });
    }

    const mapped = CATEGORY_MAP.find(x => x.test.test(q));
    const categoryIds = mapped ? mapped.ids : [BABY_CATEGORY];
    const catalogIds = new Set();
    for (const categoryId of categoryIds) {
      const highlights = await mlFetch(`/highlights/MLB/category/${categoryId}`, sess.access_token);
      for (const entry of (highlights.data?.content || [])) {
        if (entry?.type === "PRODUCT" && entry.id) catalogIds.add(entry.id);
      }
    }

    const results = [];
    for (const productId of [...catalogIds].slice(0, 8)) {
      const [catalog, relation] = await Promise.all([
        mlFetch(`/products/${encodeURIComponent(productId)}`, sess.access_token),
        mlFetch(`/products/${encodeURIComponent(productId)}/items?limit=10`, sess.access_token)
      ]);
      if (!catalog.ok || !catalog.data) continue;
      const catalogName = catalog.data.name || "";
      if (!matchesQuery(catalogName, q)) continue;

      const itemRefs = arr(relation.data).slice(0, 3);
      for (const ref of itemRefs) {
        const id = ref.item_id || ref.id;
        if (!id) continue;
        const detail = await mlFetch(`/items/${encodeURIComponent(id)}`, sess.access_token);
        const item = detail.data;
        if (!detail.ok || !item) continue;
        const price = Number.isFinite(item.price) ? item.price : Number.isFinite(ref.price) ? ref.price : null;
        const original = Number.isFinite(item.original_price) ? item.original_price : Number.isFinite(ref.original_price) ? ref.original_price : null;
        const discount = price !== null && original !== null && original > price ? Math.round((original-price)/original*100) : null;
        const rate = commissionRate(catalog.data.category_id || "bebê");
        results.push({
          id:item.id || id, item_id:item.id || id, product_id:productId,
          title:item.title || catalogName,
          permalink:item.permalink || `https://www.mercadolivre.com.br/p/${productId}`,
          image:item.thumbnail?.replace(/^http:/,"https:") || catalog.data.pictures?.[0]?.secure_url || null,
          price, original_price:original, discount,
          sold_quantity:item.sold_quantity ?? null, available_quantity:item.available_quantity ?? null,
          free_shipping:Boolean(item.shipping?.free_shipping), seller_id:item.seller_id || null,
          condition:item.condition || "Novo", category_id:item.category_id || catalog.data.category_id || null,
          category_name:catalog.data.category_id || null,
          affiliate_commission_rate:rate,
          affiliate_commission_estimate:rate && price ? Math.round(price*rate*100)/100 : null,
          affiliate_commission_label:rate ? Math.round(rate*100)+"%" : null,
          score:discount ? Math.min(100,20+discount) : 20
        });
      }
    }

    results.sort((a,b) => (b.discount || 0)-(a.discount || 0) || (a.price || Infinity)-(b.price || Infinity));
    return res.status(200).json({
      keywords:q, total:results.length, results,
      source:"Mercado Livre baby catalog highlights fallback",
      notice:results.length ? undefined : "O catálogo respondeu, mas não encontramos anúncios para todos os termos pesquisados. Tente uma palavra mais ampla."
    });
  } catch (error) {
    console.error("ERRO RADAR:", error);
    return res.status(500).json({ error:"Erro interno no Radar.", details:error.message });
  }
};
