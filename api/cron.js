import OpenAI from "openai";
import { neon } from "@neondatabase/serverless";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function getDatabaseUrl() {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.STORAGE_DATABASE_URL,
    process.env.NEON_DATABASE_URL
  ];

  const value = candidates.find(item => typeof item === "string" && item.trim());

  if (!value) {
    throw new Error("Database URL not found. Connect Neon to this project first.");
  }

  return value;
}

const sql = neon(getDatabaseUrl());

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function bool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractJson(textOutput) {
  if (!textOutput) return null;

  const direct = safeJsonParse(textOutput);
  if (direct) return direct;

  const start = textOutput.indexOf("{");
  const end = textOutput.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    return safeJsonParse(textOutput.slice(start, end + 1));
  }

  return null;
}

function normalizeCountry(value) {
  const allowed = [
    "World",
    "Bangladesh",
    "India",
    "China",
    "USA",
    "Russia",
    "Iran",
    "Israel",
    "Middle East"
  ];

  return allowed.includes(value) ? value : "World";
}

function normalizeTopic(value) {
  const allowed = [
    "World News",
    "Top Topics",
    "Politics",
    "Finance",
    "Technology",
    "Apple",
    "Samsung",
    "Phone Launch",
    "New Popular Tech Product"
  ];

  return allowed.includes(value) ? value : "World News";
}

function normalizeType(value) {
  return value === "rumor" ? "rumor" : "real";
}

function normalizePage(value) {
  return value === "old" ? "old" : "today";
}

function normalizeArticle(item, index) {
  const title = text(item?.title);
  const summary = text(item?.summary);
  const content = text(item?.content);

  if (!title || !summary || !content) {
    return null;
  }

  const country = normalizeCountry(text(item?.country, "World"));
  const topic = normalizeTopic(text(item?.topic, "World News"));
  const type = normalizeType(text(item?.type, "real"));
  const page = normalizePage(text(item?.page, "today"));
  const popular = bool(item?.popular, false);

  const sourceUrl = text(item?.sourceUrl || item?.source_url);
  const imageUrl = text(item?.imageUrl || item?.image_url);
  const publishedAt = text(item?.publishedAt || item?.published_at);
  const providedSlug = text(item?.slug);

  const slug = providedSlug || slugify(`${title}-${country}-${topic}`) || `news-${Date.now()}-${index + 1}`;

  return {
    slug,
    title,
    summary,
    content,
    country,
    topic,
    type,
    page,
    popular,
    sourceUrl,
    imageUrl,
    publishedAt
  };
}

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS news_articles (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT UNIQUE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      country TEXT NOT NULL,
      topic TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'real',
      page TEXT NOT NULL DEFAULT 'today',
      popular BOOLEAN NOT NULL DEFAULT FALSE,
      source_url TEXT,
      image_url TEXT,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function fetchLatestNewsFromAI() {
  const prompt = `
Return only valid JSON.
Do not use markdown.
Do not use code fences.

Use web search to find the latest important world news and latest important tech product news.

Rules:
1. Return up to 20 articles.
2. Use only English.
3. Use only current web-backed information.
4. Cover a mix of:
   World, USA, China, India, Bangladesh, Russia, Iran, Israel, Middle East.
5. Include tech news when available:
   Technology, Apple, Samsung, Phone Launch, New Popular Tech Product.
6. Prefer verified reporting.
7. You may include up to 3 rumor items only if they are clearly presented online as leaks, rumors, or unconfirmed reports.
8. Each article should have:
   title, summary, content, country, topic, type, page, popular, sourceUrl, imageUrl, publishedAt
9. page must be "today".
10. type must be "real" or "rumor".
11. country must be one of:
    "World", "Bangladesh", "India", "China", "USA", "Russia", "Iran", "Israel", "Middle East"
12. topic must be one of:
    "World News", "Top Topics", "Politics", "Finance", "Technology", "Apple", "Samsung", "Phone Launch", "New Popular Tech Product"
13. imageUrl should be a direct article image URL when available, otherwise return an empty string.
14. Do not invent facts.
15. If there are fewer reliable stories, return fewer articles.

Return exactly this JSON shape:
{
  "articles": [
    {
      "slug": "short-unique-slug",
      "title": "Article title",
      "summary": "Short summary",
      "content": "Readable full article in 2 to 4 paragraphs.",
      "country": "World",
      "topic": "World News",
      "type": "real",
      "page": "today",
      "popular": true,
      "sourceUrl": "https://example.com/article",
      "imageUrl": "https://example.com/image.jpg",
      "publishedAt": "2026-03-29T12:00:00.000Z"
    }
  ]
}
`;

  const response = await client.responses.create({
    model: process.env.OPENAI_NEWS_MODEL || "gpt-4.1-mini",
    instructions: "You are a careful global news curator. Return clean JSON only.",
    input: prompt,
    tool_choice: "auto",
    tools: [
      {
        type: "web_search_preview",
        search_context_size: "medium"
      }
    ]
  });

  const parsed = extractJson(response.output_text || "");
  const rawArticles = Array.isArray(parsed?.articles) ? parsed.articles : [];

  const deduped = [];
  const seen = new Set();

  for (let i = 0; i < rawArticles.length; i += 1) {
    const article = normalizeArticle(rawArticles[i], i);
    if (!article) continue;

    const key = `${article.slug}::${article.title.toLowerCase()}`;
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(article);
  }

  return deduped.slice(0, 20);
}

async function archiveCurrentTodayNews() {
  await sql`
    UPDATE news_articles
    SET page = 'old',
        updated_at = NOW()
    WHERE page = 'today'
  `;
}

async function saveArticles(articles) {
  let saved = 0;

  for (const article of articles) {
    const publishedAtValue =
      article.publishedAt && !Number.isNaN(Date.parse(article.publishedAt))
        ? new Date(article.publishedAt).toISOString()
        : null;

    await sql`
      INSERT INTO news_articles (
        slug,
        title,
        summary,
        content,
        country,
        topic,
        type,
        page,
        popular,
        source_url,
        image_url,
        published_at,
        updated_at
      )
      VALUES (
        ${article.slug},
        ${article.title},
        ${article.summary},
        ${article.content},
        ${article.country},
        ${article.topic},
        ${article.type},
        ${article.page},
        ${article.popular},
        ${article.sourceUrl || null},
        ${article.imageUrl || null},
        ${publishedAtValue},
        NOW()
      )
      ON CONFLICT (slug)
      DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        content = EXCLUDED.content,
        country = EXCLUDED.country,
        topic = EXCLUDED.topic,
        type = EXCLUDED.type,
        page = EXCLUDED.page,
        popular = EXCLUDED.popular,
        source_url = EXCLUDED.source_url,
        image_url = EXCLUDED.image_url,
        published_at = EXCLUDED.published_at,
        updated_at = NOW()
    `;

    saved += 1;
  }

  return saved;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (process.env.CRON_SECRET) {
      const authHeader = req.headers.authorization || "";
      const expected = `Bearer ${process.env.CRON_SECRET}`;

      if (authHeader !== expected) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }
    }

    await ensureTable();

    const articles = await fetchLatestNewsFromAI();

    if (!articles.length) {
      return res.status(200).json({
        ok: true,
        saved: 0,
        message: "No new articles returned by AI."
      });
    }

    await archiveCurrentTodayNews();
    const saved = await saveArticles(articles);

    return res.status(200).json({
      ok: true,
      saved,
      message: "News updated successfully."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: String(error)
    });
  }
}
