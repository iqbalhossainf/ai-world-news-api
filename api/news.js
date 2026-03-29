import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function GET() {
  try {
    const response = await client.responses.create({
      model: "gpt-5.4",
      input: "Return exactly this and nothing else: []"
    });

    const text = response.output_text || "[]";

    let data = [];
    try {
      data = JSON.parse(text);
    } catch {
      data = [];
    }

    if (!Array.isArray(data)) {
      data = [];
    }

    return Response.json(data);
  } catch (error) {
    return Response.json(
      {
        error: "Failed to load news"
      },
      { status: 500 }
    );
  }
}
