const { session } = require('./lib');

module.exports = async (req, res) => {
  try {
    const s = await session(req, res);

    if (!s) {
      return res.status(401).json({
        error: 'Mercado Livre não conectado. Conecte sua conta novamente.'
      });
    }

    const q = String(req.query.q || '').trim();

    if (!q) {
      return res.status(400).json({
        error: 'Digite um termo para pesquisar.'
      });
    }

    const url = new URL('https://api.mercadolibre.com/sites/MLB/search');

    url.searchParams.set('q', q);
    url.searchParams.set('limit', '20');

    const r = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${s.access_token}`,
        Accept: 'application/json'
      }
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        error: data.message || data.error || 'Erro na busca do Mercado Livre',
        details: data
      });
    }

    const results = (data.results || []).map(p => ({
      id: p.id,
      title: p.title,
      price: p.price,
      thumbnail: p.thumbnail,
      permalink: p.permalink,
      sold_quantity: p.sold_quantity,
      condition: p.condition
    }));

    return res.status(200).json({
      results
    });

  } catch (e) {
    return res.status(500).json({
      error: e.message || 'Erro interno'
    });
  }
};
