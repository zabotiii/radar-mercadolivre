const { cookies, cookie, enc, dec } = require("./lib");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido." });
    }

    const fb = dec(cookies(req).fb_session || "");
    if (!fb?.user_access_token) {
      return res.status(401).json({ error: "Facebook não conectado." });
    }

    const body = typeof req.body === "object" ? req.body : {};
    const pageId = String(body.page_id || "");

    if (!pageId) {
      return res.status(400).json({ error: "Informe a página." });
    }

    const url =
      "https://graph.facebook.com/v26.0/me/accounts?" +
      new URLSearchParams({
        fields: "id,name,access_token",
        access_token: fb.user_access_token
      }).toString();

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Não foi possível consultar as páginas.");
    }

    const page = (data.data || []).find(item => String(item.id) === pageId);

    if (!page) {
      return res.status(403).json({ error: "A página selecionada não está disponível para esta conta." });
    }

    const next = {
      ...fb,
      page_id: page.id,
      page_name: page.name,
      page_access_token: page.access_token
    };

    res.setHeader("Set-Cookie", cookie("fb_session", enc(next), 5184000));

    return res.status(200).json({
      connected: true,
      page: { id: page.id, name: page.name }
    });
  } catch (error) {
    console.error("facebook_select:", error);
    return res.status(500).json({ error: error.message || "Erro ao selecionar página." });
  }
};