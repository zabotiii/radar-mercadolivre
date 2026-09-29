const { session } = require("./lib");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
  try {
    const sessao = await session(req, res);

    if (!sessao || !sessao.access_token) {
      return json(res, 401, {
        connected: false,
        error: "Mercado Livre não conectado."
      });
    }

    const appId = process.env.ML_CLIENT_ID;

    const resposta = await fetch(
      `https://api.mercadolibre.com/applications/${appId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${sessao.access_token}`,
          Accept: "application/json"
        }
      }
    );

    let dados = null;

    try {
      dados = await resposta.json();
    } catch (e) {
      dados = null;
    }

    return json(res, 200, {
      token_valido: true,

      status_api: resposta.status,

      aplicacao: dados
    });

  } catch (error) {
    console.error(
      "ERRO DIAGNOSTICO:",
      error
    );

    return json(res, 500, {
      error: "Erro no diagnóstico.",
      message:
        error.message ||
        String(error)
    });
  }
};const { session } = require("./lib");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
  try {
    const sessao = await session(req, res);

    if (!sessao || !sessao.access_token) {
      return json(res, 401, {
        connected: false,
        error: "Mercado Livre não conectado."
      });
    }

    const appId = process.env.ML_CLIENT_ID;

    const resposta = await fetch(
      `https://api.mercadolibre.com/applications/${appId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${sessao.access_token}`,
          Accept: "application/json"
        }
      }
    );

    let dados = null;

    try {
      dados = await resposta.json();
    } catch (e) {
      dados = null;
    }

    return json(res, 200, {
      token_valido: true,

      status_api: resposta.status,

      aplicacao: dados
    });

  } catch (error) {
    console.error(
      "ERRO DIAGNOSTICO:",
      error
    );

    return json(res, 500, {
      error: "Erro no diagnóstico.",
      message:
        error.message ||
        String(error)
    });
  }
};
