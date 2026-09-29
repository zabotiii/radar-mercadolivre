const https = require("https");

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

function parseBing(body) {
  const results = [];
  const re = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?[\s\S]*?<\/li>/gi;
  let m;

  while ((m = re.exec(body)) && results.length < 10) {
    const url = decodeHtml(m[1]);
    const title = decodeHtml(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const snippet = decodeHtml((m[3] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

    if (!/^https?:\/\/(www\.)?facebook\.com\/groups\//i.test(url)) continue;

    results.push({ name: title, url, snippet });
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
      q + " grupo"
    ];

    const all = [];

    for (const term of queries) {
      const url = "https://www.bing.com/search?q=" +
        encodeURIComponent("site:facebook.com/groups " + term) +
        "&count=10";

      const response = await request(url);

      if (response.status !== 200) continue;

      all.push(...parseBing(response.body));
    }

    const unique = [];
    const seen = new Set();

    for (const item of all) {
      const normalized = item.url
        .replace(/\?.*$/, "")
        .replace(/\/$/, "")
        .toLowerCase();

      if (seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push({ ...item, url: normalized });
    }

    return res.status(200).json({
      query: q,
      results: unique.slice(0, 10)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Não foi possível encontrar grupos agora." });
  }
};
