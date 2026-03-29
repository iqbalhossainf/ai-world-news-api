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
    throw new Error("Database URL not found. Connect Neon to this Vercel project first.");
  }

  return value;
}

const sql = neon(getDatabaseUrl());

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function toBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
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

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizeArticle(item, index) {
  const title = toText(item?.title);
  const summary = toText(item?.summary);
  const content = toText(item?.content);

  if (!title || !summary || !content) {
    return null;
  }

  const country = normalizeCountry(toText(item?.country, "World"));
  const topic = normalizeTopic(toText(item?.topic, "World News"));
  const type = normalizeType(toText(item?.type, "real"));
  const popular = toBool(item?.popular, false);

  const sourceUrl = toText(item?.sourceUrl || item?.source_url);
  const imageUrl = toText(item?.imageUrl || item?.image_url);
  const publishedAt = toText(item?.publishedAt || item?.published_at);

  const baseSlug = toText(item?.slug) || slugify(`${title}-${country}-${topic}`);
  const slug = baseSlug || `news-${Date.now()}-${index + 1}`;

  return {
    slug,
    title,
    summary,
    content,
    country,
    topic,
    type,
    page: "today",
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

Requirements:
1. Return up to 20 articles.
2. Use only current, web-backed information.
3. Cover a broad mix when available:
   World, USA, China, India, Bangladesh, Russia, Iran, Israel, Middle East.
4. Include technology news when available:
   Technology, Apple, Samsung, Phone Launch, New Popular Tech Product.
5. Prefer verified reporting.
6. You may include up to 3 rumor articles only if they are clearly described online as leaks, rumors, or unconfirmed reports.
7. Write in English only.
8. Make the article content readable and medium length, around 2 to 4 paragraphs.
9. page must always be "today".
10. type must be either "real" or "rumor".
11. country must be one of:
    "World", "Bangladesh", "India", "China", "USA", "Russia", "Iran", "Israel", "Middle East"
12. topic must be one of:
    "World News", "Top Topics", "Politics", "Finance", "Technology", "Apple", "Samsung", "Phone Launch", "New Popular Tech Product"
13. If there is not enough reliable news, return fewer items. Do not invent facts.

Return exactly this JSON shape:
{
  "articles": [
    {
      "slug": "short-unique-slug",
      "title": "Article title",
      "summary": "Short summary",
      "content": "Full article content in English",
      "country": "World",
      "topic": "World News",
      "type": "real",
      "page": "today",
      "popular": true,
      "sourceUrl": "https://example.com/article",
      "imageUrl": "",
      "publishedAt": "2026-03-29T12:00:00.000Z"
    }
  ]
}
`;

  const response = await client.responses.create({
    model: process.env.OPENAI_NEWS_MODEL || "gpt-5",
    instructions: "You are a careful global news curator. Return clean JSON only.",
    tools: [
      {
        type: "web_search",
        search_context_size: "medium"
      }
    ],
    tool_choice: "auto",
    input: prompt
  });

  const text = response.output_text || "";
  const parsed = safeJsonParse(text);

  if (!parsed || !Array.isArray(parsed.articles)) {
    return [];
  }

  const normalized = parsed.articles
    .map((item, index) => normalizeArticle(item, index))
    .filter(Boolean);

  const deduped = [];
  const seen = new Set();

  for (const article of normalized) {
    if (seen.has(article.slug)) continue;
    seen.add(article.slug);
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
    await ensureTable();

    const articles = await fetchLatestNewsFromAI();

    if (!articles.length) {
      return res.status(200).json({
        ok: true,
        saved: 0,
        message: "No new articles were returned by AI."
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
