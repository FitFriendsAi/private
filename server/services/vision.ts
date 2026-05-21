import Anthropic from "@anthropic-ai/sdk";
import type { NutritionFacts } from "./food-lookup.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LABEL_PROMPT = `You are a nutrition label reader. Extract the nutrition information from this image of a food product's nutrition facts label.

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "name": "product name if visible, otherwise 'Scanned Food'",
  "brand": "brand name if visible, otherwise null",
  "servingSizeG": <serving size in grams as a number>,
  "servingUnit": "<serving description, e.g. '1 cup (240g)'>",
  "calories": <number>,
  "proteinG": <grams of protein as number>,
  "carbsG": <grams of total carbohydrates as number>,
  "fatG": <grams of total fat as number>,
  "fiberG": <grams of dietary fiber as number or null if not present>,
  "sodiumMg": <milligrams of sodium as number or null if not present>,
  "sugarG": <grams of total sugars as number or null if not present>
}

If a value is not visible or unclear, use null for optional fields or 0 for required fields.
Convert all units to the specified units (g, mg, kcal).`;

export async function parseNutritionLabel(imageBase64: string, mediaType: string): Promise<NutritionFacts | null> {
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: imageBase64,
              },
            },
            { type: "text", text: LABEL_PROMPT },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      name: parsed.name || "Scanned Food",
      brand: parsed.brand || undefined,
      servingSizeG: parsed.servingSizeG || 100,
      servingUnit: parsed.servingUnit || "serving",
      calories: Math.round(parsed.calories || 0),
      proteinG: parsed.proteinG || 0,
      carbsG: parsed.carbsG || 0,
      fatG: parsed.fatG || 0,
      fiberG: parsed.fiberG ?? undefined,
      sodiumMg: parsed.sodiumMg ?? undefined,
      sugarG: parsed.sugarG ?? undefined,
    };
  } catch (err) {
    console.error("Vision parse error:", err);
    return null;
  }
}
