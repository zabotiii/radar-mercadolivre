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

    // Busca produtos no catálogo
    const searchUrl = new URL(
      'https://api.mercadolibre.com/products/search'
    );

    searchUrl.searchParams.set('status', 'active');
    searchUrl.searchParams.set('site_id', 'MLB');
    searchUrl.searchParams.set('q', q);

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: {
        Authorization: `Bearer ${s.access_token}`,
        Accept: 'application/json'
      }
    });

    const searchData = await searchResponse.json();

    if (!searchResponse.ok) {
      return res.status(searchResponse.status).json({
        error:
          searchData.message ||
          searchData.error ||
          'Erro na busca do Mercado Livre',
        details: searchData
      });
    }

    // Pega os detalhes de cada produto
    const results = await Promise.all(
      (searchData.results || []).slice(0, 12).map(async (product) => {
        try {
          const detailResponse = await fetch(
            `https://api.mercadolibre.com/products/${product.id}`,
            {
              headers: {
                Authorization: `Bearer ${s.access_token}`,
                Accept: 'application/json'
              }
            }
          );

          const detail = await detailResponse.json();

          if (!detailResponse.ok) {
            return {
              id: product.id,
              title: product.name,
              price: 0,
              thumbnail: '',
              permalink:
                detail.permalink ||
                `https://www.mercadolivre.com.br/p/${product.id}`,
              sold_quantity: 0,
              condition: 'Novo',
              product_id: product.id
            };
          }

          const winner = detail.buy_box_winner || {};

          const picture =
            detail.pictures &&
            detail.pictures.length > 0
              ? detail.pictures[0].url
              : '';

          return {
            id: winner.item_id || product.id,
            product_id: product.id,
            title: detail.name || product.name,
            price: Number(winner.price || 0),
            thumbnail: picture,
            permalink:
              detail.permalink ||
              (winner.item_id
                ? `https://www.mercadolivre.com.br/p/${product.id}`
                : `https://www.mercadolivre.com.br/p/${product.id}`),
            sold_quantity: Number(winner.sold_quantity || 0),
            condition: 'Novo'
          };
        } catch (error) {
          return {
            id: product.id,
            product_id: product.id,
            title: product.name,
            price: 0,
            thumbnail: '',
            permalink: `https://www.mercadolivre.com.br/p/${product.id}`,
            sold_quantity: 0,
            condition: 'Novo'
          };
        }
      })
    );

    return res.status(200).json({
      keywords: searchData.keywords || q,
      paging: searchData.paging || {},
      results
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message || 'Erro interno'
    });
  }
};
