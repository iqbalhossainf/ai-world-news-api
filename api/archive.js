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
    throw new Error("Database URL not found.");
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
    page: "old",
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

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const requestedLimit = Number(url.searchParams.get("limit") || 100);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 300)
        : 100;

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
      WHERE page = 'old'
      ORDER BY COALESCE(published_at, updated_at, created_at) DESC
      LIMIT ${limit}
    `;

    const data = rows.map(normalizeArticle);

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
