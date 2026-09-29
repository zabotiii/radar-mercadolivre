const { cookies, dec } = require("./lib");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido." });
    }

    const fb = dec(cookies(req).fb_session || "");
    if (!fb?.page_id || !fb?.page_access_token) {
      return res.status(401).json({
        error: "Conecte o Facebook e selecione uma Página primeiro."
      });
    }

    const body = typeof req.body === "object" ? req.body : {};
    const message = String(body.message || "").trim();
    const link = String(body.link || "").trim();

    if (!message) {
      return res.status(400).json({ error: "O post está sem texto." });
    }

    const params = new URLSearchParams({
      message,
      access_token: fb.page_access_token
    });

    if (link) params.set("link", link);

    const response = await fetch(
      "https://graph.facebook.com/v26.0/" +
      encodeURIComponent(fb.page_id) +
      "/feed",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({
        error: data.error?.message || "O Facebook recusou a publicação.",
        code: data.error?.code || null
      });
    }

    return res.status(200).json({
      published: true,
      pageId: fb.page_id,
      pageName: fb.page_name,
      postId: data.id || null
    });
  } catch (error) {
    console.error("facebook_publish:", error);
    return res.status(500).json({
      error: error.message || "Erro ao publicar no Facebook."
    });
  }
};