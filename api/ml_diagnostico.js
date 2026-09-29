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
    const r = await fetch(
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
      data = await r.json();
    } catch {}

    return {
      status: r.status,
      ok: r.ok,
      data
    };

  } catch (e) {
    return {
      status: 0,
      ok: false,
      data: null,
      error: e.message
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
        erro: "Mercado Livre não conectado."
      });
    }

    const token =
      sessao.access_token;

    /*
      IDs que o próprio highlights
      já entregou para nossa aplicação.
    */

    const ids = [
      "MLB4002919471",
      "MLB5977782288",
      "MLB4039471005",
      "MLB4592320910",
      "MLB4049279695"
    ];

    const url =
      `/items/bulk?ids=${ids.join(",")}` +
      `&attributes=body.id,body.title,body.price,body.original_price,body.thumbnail,body.permalink,body.category_id`;

    const resultado =
      await mlFetch(
        url,
        token
      );

    return json(
      res,
      200,
      {
        diagnostico:
          "TESTE ITEMS BULK",

        status:
          resultado.status,

        ok:
          resultado.ok,

        resposta:
          resultado.data,

        conclusao:
          resultado.ok
            ? "ITEMS BULK FUNCIONOU"
            : "ITEMS BULK TAMBEM FOI BLOQUEADO"
      }
    );

  } catch (e) {

    return json(
      res,
      500,
      {
        diagnostico:
          "ERRO",

        mensagem:
          e.message
      }
    );
  }
};
