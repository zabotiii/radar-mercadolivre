const https = require("https");

async function serperSearch(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      q: "site:facebook.com/groups " + query,
      gl: "br",
      hl: "pt-br",
      num: 10
    })
  });

  if (!response.ok) return [];

  const data = await response.json();
  return (data.organic || [])
    .filter(item => /facebook\.com\/groups\//i.test(item.link || ""))
    .map(item => ({
      name: item.title || "Grupo Facebook",
      url: item.link,
      snippet: item.snippet || "Grupo relacionado ao produto."
    }));
}

function cleanQuery(q) {
  return String(q || "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function request(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8"
      }
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => body += chunk);
      response.on("end", () => resolve({ status: response.statusCode || 0, body }));
    });

    req.on("error", reject);
    req.setTimeout(7000, () => req.destroy(new Error("timeout")));
  });
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeFacebookUrl(url) {
  let value = decodeHtml(url).trim();

  try {
    value = decodeURIComponent(value);
  } catch (_) {}

  value = value.replace(/\\/g, "/");

  const match = value.match(/https?:\/\/(?:www\.)?facebook\.com\/groups\/[^\s"'<>?&#)]+/i);
  if (!match) return null;

  return match[0]
    .replace(/[),.;]+$/, "")
    .replace(/\/$/, "");
}

function addResult(results, seen, url, name, snippet) {
  const normalized = normalizeFacebookUrl(url);
  if (!normalized) return;

  const key = normalized.toLowerCase();
  if (seen.has(key)) return;

  seen.add(key);
  results.push({
    name: decodeHtml(name || "Grupo Facebook")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Grupo Facebook",
    url: normalized,
    snippet: decodeHtml(snippet || "Grupo relacionado ao produto encontrado na pesquisa.")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  });
}

function parseBingRss(body) {
  const results = [];
  const seen = new Set();
  const re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/gi;
  let m;

  while ((m = re.exec(body)) && results.length < 10) {
    addResult(results, seen, m[2], m[1], m[3]);
  }

  return results;
}

function parseHtmlLinks(body) {
  const results = [];
  const seen = new Set();
  const decoded = decodeHtml(body);

  const re = /https?:\/\/(?:www\.)?facebook\.com\/groups\/[^\s"'<>?&#)]+/gi;
  let m;

  while ((m = re.exec(decoded)) && results.length < 10) {
    addResult(results, seen, m[0], "Grupo Facebook", "Grupo relacionado ao produto encontrado na pesquisa.");
  }

  return results;
}

function parseGoogle(body) {
  const results = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(body)) && results.length < 10) {
    if (!/facebook\.com\/groups\//i.test(m[1])) continue;
    addResult(results, seen, m[1], m[2], "Grupo relacionado ao produto encontrado na pesquisa.");
  }

  if (!results.length) return parseHtmlLinks(body);
  return results;
}

async function searchProvider(provider, query) {
  let url;

  if (provider === "google") {
    url = "https://www.google.com/search?q=" +
      encodeURIComponent("site:facebook.com/groups " + query) +
      "&num=10&filter=0";
  } else if (provider === "duckduckgo") {
    url = "https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent("site:facebook.com/groups " + query);
  } else {
    url = "https://www.bing.com/search?format=rss&q=" +
      encodeURIComponent("site:facebook.com/groups " + query);
  }

  const response = await request(url);
  if (response.status !== 200) return [];

  if (provider === "google") return parseGoogle(response.body);
  if (provider === "bing") return parseBingRss(response.body);

  return parseHtmlLinks(response.body);
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
      q + " promoções",
      q + " grupo"
    ];

    const results = [];
    const seen = new Set();

    // Quando a chave da Serper existe, usamos somente a busca profissional.
    // Isso evita estourar o tempo limite do Vercel fazendo várias buscas externas.
    if (process.env.SERPER_API_KEY) {
      const serperQueries = [
        q + " ofertas promoções",
        q + " achadinhos grupo"
      ];

      try {
        const batches = await Promise.all(
          serperQueries.map(query => serperSearch(query))
        );

        for (const found of batches) {
          for (const item of found) {
            addResult(results, seen, item.url, item.name, item.snippet);
            if (results.length >= 10) break;
          }
          if (results.length >= 10) break;
        }
      } catch (error) {
        console.error("Serper search error:", error.message);
      }

      return res.status(200).json({
        query: q,
        results: results.slice(0, 10),
        fallbackSearch:
          "https://www.facebook.com/search/groups/?q=" + encodeURIComponent(q),
        source: "serper"
      });
    }

    // Fallback gratuito somente quando não existe SERPER_API_KEY.
    // Limitamos as tentativas para não ultrapassar o tempo do Vercel.
    const fallbackQueries = [
      q + " ofertas promoções",
      q + " achadinhos"
    ];

    for (const query of fallbackQueries) {
      for (const provider of ["google", "bing"]) {
        try {
          const found = await searchProvider(provider, query);

          for (const item of found) {
            addResult(results, seen, item.url, item.name, item.snippet);
            if (results.length >= 10) break;
          }

          if (results.length >= 10) break;
        } catch (error) {
          console.error("Facebook group search error:", provider, error.message);
        }
      }

      if (results.length >= 10) break;
    }

    return res.status(200).json({
      query: q,
      results: results.slice(0, 10),
      fallbackSearch:
        "https://www.facebook.com/search/groups/?q=" + encodeURIComponent(q)
    });
  } catch (error) {
    console.error("facebook_groups:", error);
    return res.status(200).json({
      query: cleanQuery(req.query && req.query.q),
      results: [],
      fallbackSearch:
        "https://www.facebook.com/search/groups/?q=" +
        encodeURIComponent(cleanQuery(req.query && req.query.q)),
      warning: "A pesquisa externa não respondeu. Use a busca do Facebook."
    });
  }
};
