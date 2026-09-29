const { session } = require("./lib");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.end(JSON.stringify(data));
}

async function consultar(url, accessToken) {
  try {
    const resposta = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    let dados = null;

    try {
      dados = await resposta.json();
    } catch (e) {
      dados = null;
    }

    return {
      sucesso: resposta.ok,
      status: resposta.status,
      dados
    };

  } catch (erro) {
    return {
      sucesso: false,
      status: 0,
      erro:
        erro.message ||
        String(erro)
    };
  }
}

module.exports = async function handler(req, res) {
  try {

    /*
     * Recupera a sessão já utilizada pelo Radar.
     */
    const sessao = await session(req, res);

    if (
      !sessao ||
      !sessao.access_token
    ) {
      return json(res, 401, {
        conectado: false,
        erro:
          "Não existe uma sessão válida do Mercado Livre."
      });
    }

    const appId =
      process.env.ML_CLIENT_ID;

    const userId =
      sessao.user_id;

    if (!appId) {
      return json(res, 500, {
        erro:
          "ML_CLIENT_ID não está configurado no Vercel."
      });
    }

    /*
     * =====================================================
     * TESTE 1
     * Detalhes da aplicação
     * =====================================================
     */

    const aplicacao =
      await consultar(
        `https://api.mercadolibre.com/applications/${appId}`,
        sessao.access_token
      );

    /*
     * =====================================================
     * TESTE 2
     * Aplicações autorizadas pelo usuário
     * =====================================================
     */

    let grants = null;

    if (userId) {

      grants =
        await consultar(
          `https://api.mercadolibre.com/users/${userId}/applications`,
          sessao.access_token
        );

    }

    /*
     * =====================================================
     * TESTE 3
     * Usuário atual
     * =====================================================
     */

    const usuario =
      await consultar(
        "https://api.mercadolibre.com/users/me",
        sessao.access_token
      );

    /*
     * =====================================================
     * RESULTADO
     * =====================================================
     */

    return json(res, 200, {

      diagnostico: "OK",

      app_id:
        appId,

      user_id:
        userId || null,

      token_funcionando:
        usuario.status === 200,

      usuario: {
        status:
          usuario.status,

        resposta:
          usuario.dados
      },

      aplicacao: {
        status:
          aplicacao.status,

        resposta:
          aplicacao.dados,

        erro:
          aplicacao.erro || null
      },

      autorizacao_usuario: {
        status:
          grants
            ? grants.status
            : null,

        resposta:
          grants
            ? grants.dados
            : null,

        erro:
          grants
            ? grants.erro || null
            : null
      },

      observacao:
        "Este endpoint é apenas diagnóstico e não altera nenhuma configuração."
    });

  } catch (erro) {

    console.error(
      "ERRO DIAGNOSTICO ML:",
      erro
    );

    return json(res, 500, {

      diagnostico:
        "ERRO",

      mensagem:
        erro.message ||
        String(erro),

      stack:
        process.env.NODE_ENV ===
        "development"
          ? erro.stack
          : undefined
    });
  }
};
