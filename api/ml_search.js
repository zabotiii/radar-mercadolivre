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
              product_id: product.id,
              title: product.name,
              price: null,
              thumbnail: '',
              permalink: `https://www.mercadolivre.com.br/p/${product.id}`,
              sold_quantity: null,
              condition: 'Novo',
              has_winner: false
            };
          }

          const winner = detail.buy_box_winner || null;

          const thumbnail =
            detail.pictures && detail.pictures.length
              ? detail.pictures[0].url
              : '';

          return {
            id: winner?.item_id || product.id,
            product_id: product.id,
            title: detail.name || product.name,

            // Só mostra preço quando realmente existe
            price:
              typeof winner?.price === 'number'
                ? winner.price
                : null,

            thumbnail,

            permalink:
              detail.permalink ||
              `https://www.mercadolivre.com.br/p/${product.id}`,

            // Usa a venda do vencedor ou, quando disponível,
            // a venda informada no próprio produto
            sold_quantity:
              typeof winner?.sold_quantity === 'number'
                ? winner.sold_quantity
                : typeof detail.sold_quantity === 'number'
                ? detail.sold_quantity
                : null,

            condition: 'Novo',

            has_winner: !!winner,

            seller_id: winner?.seller_id || null,

            available_quantity:
              typeof winner?.available_quantity === 'number'
                ? winner.available_quantity
                : null,

            free_shipping:
              winner?.shipping?.free_shipping === true
          };
        } catch (error) {
          return {
            id: product.id,
            product_id: product.id,
            title: product.name,
            price: null,
            thumbnail: '',
            permalink: `https://www.mercadolivre.com.br/p/${product.id}`,
            sold_quantity: null,
            condition: 'Novo',
            has_winner: false
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
