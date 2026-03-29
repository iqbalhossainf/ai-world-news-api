import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: `
Return only valid JSON.
Do not use markdown.
Do not use code fences.

Return exactly 1 article in this format:

[
  {
    "id": 1,
    "country": "Bangladesh",
    "topic": "Politics",
    "type": "real",
    "page": "today",
    "popular": true,
    "updatedAt": "${new Date().toISOString()}",
    "text": {
      "en": {
        "title": "A real looking title",
        "summary": "A short summary",
        "content": "A full readable article with 5 to 7 paragraphs."
      }
    }
  }
]

Return only JSON.
      `
    });

    const text = response.output_text || "[]";
    const data = safeParse(text);

    return Response.json(data);
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
