import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function stripCodeFence(text) {
  if (!text) return "";
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(stripCodeFence(text));
  } catch {
    return [];
  }
}

function toStringValue(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function toBooleanValue(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeTextBlock(block) {
  return {
    title: toStringValue(block?.title),
    summary: toStringValue(block?.summary),
    content: toStringValue(block?.content)
  };
}

function normalizeArticle(item, index) {
  const validCountries = ["Bangladesh", "China", "India", "USA", "Russia"];
  const validTopics = ["Politics", "Finance", "Technology", "Top Topics"];
  const validTypes = ["real", "rumor"];
  const validPages = ["today", "old"];

  const country = validCountries.includes(item?.country) ? item.country : "USA";
  const topic = validTopics.includes(item?.topic) ? item.topic : "Technology";
  const type = validTypes.includes(item?.type) ? item.type : "real";
  const page = validPages.includes(item?.page) ? item.page : "today";

  const updatedAt = toStringValue(item?.updatedAt, new Date().toISOString());

  const text = {
    en: normalizeTextBlock(item?.text?.en),
    bn: normalizeTextBlock(item?.text?.bn),
    ar: normalizeTextBlock(item?.text?.ar)
  };

  if (!text.en.title || !text.en.summary || !text.en.content) {
    return null;
  }

  return {
    id: Number.isInteger(item?.id) ? item.id : index + 1,
    country,
    topic,
    type,
    page,
    popular: toBooleanValue(item?.popular, false),
    updatedAt,
    text
  };
}

function normalizeArticles(data) {
  if (!Array.isArray(data)) return [];

  return data
    .map((item, index) => normalizeArticle(item, index))
    .filter(Boolean)
    .slice(0, 20);
}

export async function GET() {
  try {
    const now = new Date().toISOString();

    const prompt = `
You are generating data for a world news website.

Search the web and return ONLY valid JSON.
Do not return markdown.
Do not return explanations.
Do not return code fences.

Return an array with up to 20 articles.

Rules:
1. Include only globally relevant news.
2. Use only these countries when suitable:
   Bangladesh, China, India, USA, Russia
3. Use only these topics:
   Politics, Finance, Technology, Top Topics
4. Use only these types:
   real, rumor
5. Use only these pages:
   today, old
6. "real" means verified reporting.
7. "rumor" means non verified or uncertain reporting.
8. "today" means current fresh items.
9. "old" means archived older items.
10. Each article must include English, Bangla, and Arabic text.
11. If you cannot confidently produce a clean result, return [].

Required JSON shape:
[
  {
    "id": 1,
    "country": "Bangladesh",
    "topic": "Politics",
    "type": "real",
    "page": "today",
    "popular": true,
    "updatedAt": "${now}",
    "text": {
      "en": {
        "title": "English title",
        "summary": "English summary",
        "content": "Full English article"
      },
      "bn": {
        "title": "Bangla title",
        "summary": "Bangla summary",
        "content": "Full Bangla article"
      },
      "ar": {
        "title": "Arabic title",
        "summary": "Arabic summary",
        "content": "Full Arabic article"
      }
    }
  }
]

Focus on:
1. verified world news
2. rumors clearly marked as rumor
3. major global topics
4. clean, readable article text
5. premium news website format
`;

    const response = await client.responses.create({
      model: "gpt-5",
      tools: [{ type: "web_search" }],
      input: prompt
    });

    const raw = response.output_text || "[]";
    const parsed = safeJsonParse(raw);
    const articles = normalizeArticles(parsed);

    return Response.json(articles);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: String(error)
      },
      { status: 500 }
    );
  }
}
