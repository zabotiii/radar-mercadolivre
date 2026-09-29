const https = require("https");

const SEARCH_HOSTS = [
  "https://www.google.com/search?q=",
  "https://html.duckduckgo.com/html/?q=",
  "https://www.bing.com/search?format=rss&q="
];

function cleanQuery(q) {
  return String(q || "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function request(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
      }
    }, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(8000, () => req.destroy(new Error("timeout")));
  });
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseSearchResults(body) {
  const results = [];

  // Bing RSS costuma entregar o link final diretamente e é mais estável
  // que depender da estrutura HTML da página de resultados.
  const rssRe = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>(https?:\/\/[^<]+)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/gi;
  let m;

  while ((m = rssRe.exec(body)) && results.length < 10) {
    const url = decodeHtml(m[2]).trim();
    const title = decodeHtml(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const snippet = decodeHtml(m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

    if (/^https?:\/\/(www\.)?facebook\.com\/groups\//i.test(url)) {
      results.push({ name: title, url, snippet });
    }
  }

  if (results.length) return results;

  // Fallback para HTML do Bing, aceitando pequenas mudanças de estrutura.
  const linkRe = /<a[^>]+href="(https?:\/\/[^"]*facebook\.com\/groups\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  while ((m = linkRe.exec(body)) && results.length < 10) {
    const url = decodeHtml(m[1]).replace(/&amp;/g, "&");
    const title = decodeHtml(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

    if (!results.some(x => x.url === url)) {
      results.push({
        name: title || "Grupo Facebook",
        url,
        snippet: "Grupo público encontrado na busca"
      });
    }
  }

  return results;
}

module.exports = async (req, res) => {
  try {
    const q = cleanQuery(req.query && req.query.q);

    if (!q) {
      return res.status(400).json({ error: "Informe um produto." });
    }

    const queries = [
      q + " ofertas promoções",
      q + " achadinhos",
      q + " grupo facebook",
      q + " promoções facebook"
    ];

    const all = [];

    for (const term of queries) {
      const search = "site:facebook.com/groups " + term;

      for (const host of SEARCH_HOSTS) {
        try {
          const url = host + encodeURIComponent(search) + "&num=10&count=10";
          const response = await request(url);
          if (response.status !== 200) continue;

          let found = [];
          if (host.includes("google.com")) {
            found = parseGoogle(response.body);
          } else {
            found = parseSearchResults(response.body);
            if (!found.length) found = extractFacebookGroups(response.body);
          }

          all.push(...found);
          if (found.length >= 5) break;
        } catch (e) {
          console.error("search provider error", host, e.message);
        }
      }
    }
