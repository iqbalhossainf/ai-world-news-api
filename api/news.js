import { neon } from "@neondatabase/serverless";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

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

function getSql() {
  return neon(getDatabaseUrl());
}

function toText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function toBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeArticle(row) {
  return {
    id: Number(row.id),
    country: toText(row.country, "World"),
    topic: toText(row.topic, "World News"),
    type: toText(row.type, "real") === "rumor" ? "rumor" : "real",
    page: toText(row.page, "today") === "old" ? "old" : "today",
    popular: toBool(row.popular),
    updatedAt:
      row.updated_at ||
      row.published_at ||
      row.created_at ||
      new Date().toISOString(),
    sourceUrl: toText(row.source_url),
    imageUrl: toText(row.image_url),
    text: {
      en: {
        title: toText(row.title),
        summary: toText(row.summary),
        content: toText(row.content)
      }
    }
  };
}

function matchesSearch(row, search) {
  if (!search) return true;

  const haystack = [
    row.title,
    row.summary,
    row.content,
    row.country,
    row.topic,
    row.type,
    row.page
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(search);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    const page = toText(url.searchParams.get("page")).trim();
    const country = toText(url.searchParams.get("country")).trim();
    const topic = toText(url.searchParams.get("topic")).trim();
    const type = toText(url.searchParams.get("type")).trim();
    const search = toText(url.searchParams.get("search")).trim().toLowerCase();
    const popular = toText(url.searchParams.get("popular")).trim().toLowerCase();

    const requestedLimit = Number(url.searchParams.get("limit") || 200);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 500)
        : 200;

    const sql = getSql();

    const rows = await sql`
      SELECT
        id,
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
        created_at,
        updated_at
      FROM news_articles
      ORDER BY COALESCE(published_at, updated_at, created_at) DESC
      LIMIT ${limit}
    `;

    const filtered = rows.filter(row => {
      if (page && row.page !== page) return false;
      if (country && row.country !== country) return false;
      if (topic && row.topic !== topic) return false;
      if (type && row.type !== type) return false;
      if (popular === "true" && !toBool(row.popular)) return false;
      if (!matchesSearch(row, search)) return false;
      return true;
    });

    const data = filtered.map(normalizeArticle);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: String(error)
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  }
}
