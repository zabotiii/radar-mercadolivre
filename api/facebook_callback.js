const { cookies, cookie, enc } = require("./lib");

module.exports = async (req, res) => {
  try {
    const code = req.query && req.query.code;
    const state = req.query && req.query.state;
    const c = cookies(req);

    if (!code || !state || !c.fb_state || state !== c.fb_state) {
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

    const session = {
      user_access_token: tokenData.access_token,
      exp: Date.now() + ((tokenData.expires_in || 5184000) - 300) * 1000
    };

    res.setHeader("Set-Cookie", [
      cookie("fb_session", enc(session), 5184000),
      "fb_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"
    ]);

    res.redirect("/?facebook=connected");
  } catch (error) {
    console.error("facebook_callback:", error);
    res.redirect("/?facebook=error&message=" + encodeURIComponent(error.message || "Erro ao conectar Facebook."));
  }
};