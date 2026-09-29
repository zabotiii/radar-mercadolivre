const { session } = require("./lib");

module.exports = async (req, res) => {
  try {
    const fb = await session(req, res);
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
      name: page.name,
      access_token: page.access_token
    }));

    return res.status(200).json({
      connected: true,
      selectedPageId: fb.page_id || null,
      selectedPageName: fb.page_name || null,
      pages: pages.map(({ id, name }) => ({ id, name }))
    });
  } catch (error) {
    console.error("facebook_pages:", error);
    return res.status(500).json({
      connected: false,
      pages: [],
      error: error.message || "Erro ao consultar Facebook."
    });
  }
};