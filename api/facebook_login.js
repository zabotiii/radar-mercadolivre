const crypto = require("crypto");
const { cookie } = require("./lib");

module.exports = async (req, res) => {
  const appId = process.env.FB_APP_ID;
  const redirectUri = process.env.FB_REDIRECT_URI;
  if (!appId || !redirectUri) {
    return res.status(500).json({
      error: "Configure FB_APP_ID e FB_REDIRECT_URI na Vercel."
    });
  }

  const state = crypto.randomBytes(24).toString("hex");
  res.setHeader("Set-Cookie", cookie("fb_state", state, 600));

  const scopes = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts"
  ].join(",");

  const url =
    "https://www.facebook.com/v26.0/dialog/oauth" +
    "?client_id=" + encodeURIComponent(appId) +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&state=" + encodeURIComponent(state) +
    "&scope=" + encodeURIComponent(scopes);

  res.writeHead(302, { Location: url });
  res.end();
};