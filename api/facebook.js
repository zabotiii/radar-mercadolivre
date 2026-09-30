const crypto = require("crypto");
const { cookies, cookie, enc, dec, session } = require("./lib");

module.exports = async (req, res) => {
  try {
    const action = String((req.query && req.query.action) || "");

    if (action === "callback") {
      const code = req.query && req.query.code;
      const state = req.query && req.query.state;
      const cs = cookies(req);

      if (!code || !state || !cs.fb_state || state !== cs.fb_state) {
        return res.redirect("/?facebook=error&message=" + encodeURIComponent("Autorização inválida ou expirada."));
      }

      const appId = process.env.FB_APP_ID;
      const appSecret = process.env.FB_APP_SECRET;
      const redirectUri = process.env.FB_REDIRECT_URI;

      if (!appId || !appSecret || !redirectUri) {
        return res.redirect("/?facebook=error&message=" + encodeURIComponent("Configure as variáveis do Facebook na Vercel."));
      }

      const tokenUrl =
        "https://graph.facebook.com/v26.0/oauth/access_token?" +
        new URLSearchParams({
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: redirectUri,
          code
        }).toString();

      const tokenResponse = await fetch(tokenUrl);
      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || !tokenData.access_token) {
        throw new Error(tokenData.error?.message || "Não foi possível obter o token do Facebook.");
      }

      const fbSession = {
        user_access_token: tokenData.access_token,
        exp: Date.now() + ((tokenData.expires_in || 5184000) - 300) * 1000
      };

      res.setHeader("Set-Cookie", [
        cookie("fb_session", enc(fbSession), 5184000),
        "fb_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"
      ]);

      return res.redirect("/?facebook=connected");
    }

    if (action === "login") {
      const appId = process.env.FB_APP_ID;
      const redirectUri = process.env.FB_REDIRECT_URI;
      if (!appId || !redirectUri) {
        return res.status(500).json({ error: "Configure FB_APP_ID e FB_REDIRECT_URI na Vercel." });
      }

      const state = crypto.randomBytes(24).toString("hex");
      res.setHeader("Set-Cookie", cookie("fb_state", state, 600));

      const scopes = [
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "business_management"
      ].join(",");

      const url =
        "https://www.facebook.com/v26.0/dialog/oauth" +
        "?client_id=" + encodeURIComponent(appId) +
        "&redirect_uri=" + encodeURIComponent(redirectUri) +
        "&state=" + encodeURIComponent(state) +
        "&scope=" + encodeURIComponent(scopes);

      res.writeHead(302, { Location: url });
      return res.end();
    }

    if (action === "pages") {
      const fb = dec(cookies(req).fb_session || "");
      if (!fb?.user_access_token) {
        return res.status(401).json({ connected: false, pages: [] });
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
        return res.status(400).json({
          connected: true,
          pages: [],
          error: data.error?.message || "Não foi possível consultar as páginas."
        });
      }

      const pages = (data.data || []).map(page => ({
        id: page.id,
        name: page.name
      }));

      // Diagnóstico seguro: nunca devolve tokens ao navegador.
      let permissions = [];
      try {
        const permUrl =
          "https://graph.facebook.com/v26.0/me/permissions?" +
          new URLSearchParams({
            access_token: fb.user_access_token
          }).toString();

        const permResponse = await fetch(permUrl);
        const permData = await permResponse.json();

        if (permResponse.ok) {
          permissions = (permData.data || []).map(item => ({
            permission: item.permission,
            status: item.status
          }));
        }
      } catch (_) {
        // O diagnóstico de permissões é opcional; não impede a listagem.
      }

      return res.status(200).json({
        connected: true,
        selectedPageId: fb.page_id || null,
        selectedPageName: fb.page_name || null,
        pages,
        debug: {
          page_count: pages.length,
          permissions
        }
      });
    }

    if (action === "select") {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
      }

      const fb = dec(cookies(req).fb_session || "");
      if (!fb?.user_access_token) {
        return res.status(401).json({ error: "Facebook não conectado." });
      }

      const body = typeof req.body === "object" ? req.body : {};
      const pageId = String(body.page_id || "");
      if (!pageId) return res.status(400).json({ error: "Informe a página." });

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
    }

    if (action === "publish") {
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
      if (!message) return res.status(400).json({ error: "O post está sem texto." });

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
    }

    return res.status(400).json({ error: "Ação inválida." });
  } catch (error) {
    console.error("facebook:", error);
    return res.status(500).json({ error: error.message || "Erro no Facebook." });
  }
};
