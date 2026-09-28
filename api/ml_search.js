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

    const url = new URL(
      'https://api.mercadolibre.com/products/search'
    );

    url.searchParams.set('status', 'active');
    url.searchParams.set('site_id', 'MLB');
    url.searchParams.set('q', q);

    const r = await fetch(url.toString(), {
      method: 'GET',
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
      title: p.name,
      status: p.status,
      domain_id: p.domain_id,
      settings: p.settings || {},
      attributes: p.attributes || []
    }));

    return res.status(200).json({
      keywords: data.keywords || q,
      paging: data.paging || {},
      results
    });

  } catch (e) {
    return res.status(500).json({
      error: e.message || 'Erro interno'
    });
  }
};
