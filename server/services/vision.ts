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

// ── Natural-language & plated-meal logging ───────────────────────────────────
// Turns a free-text description ("2 eggs, toast with butter, black coffee") or a
// photo of a plated meal into structured food line-items with estimated macros.
// Each item's macros are TOTALS for the amount eaten (not per-100g), so the log
// entry uses servings = 1.

export interface ParsedMealItem {
  name: string;
  brand?: string;
  quantity: string;      // human-readable amount, e.g. "2 large eggs"
  servingSizeG: number;  // estimated total grams eaten
  calories: number;      // TOTAL kcal for the amount eaten
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sodiumMg?: number;
  sugarG?: number;
}

const MEAL_SCHEMA = `Return ONLY valid JSON (no markdown, no prose) of this exact shape:
{
  "items": [
    {
      "name": "<short food name, e.g. 'Scrambled Eggs'>",
      "brand": "<brand/restaurant if identifiable, otherwise null>",
      "quantity": "<human amount eaten, e.g. '2 large eggs' or '1 cup'>",
      "servingSizeG": <estimated TOTAL grams eaten as a number>,
      "calories": <TOTAL kcal for that amount, number>,
      "proteinG": <TOTAL grams protein, number>,
      "carbsG": <TOTAL grams carbs, number>,
      "fatG": <TOTAL grams fat, number>,
      "fiberG": <TOTAL grams fiber, number or null>,
      "sodiumMg": <TOTAL mg sodium, number or null>,
      "sugarG": <TOTAL grams sugar, number or null>
    }
  ]
}
All macro values are TOTALS for the amount eaten, NOT per 100g. Use realistic USDA-style
estimates. If an amount isn't specified, assume one typical serving. If you cannot identify
any food, return {"items": []}.`;

const MEAL_TEXT_PROMPT =
  `You are a nutrition estimator. The user describes a meal in plain language. ` +
  `Break it into individual food items and estimate the nutrition for each.\n\n${MEAL_SCHEMA}`;

const MEAL_PHOTO_PROMPT =
  `You are a nutrition estimator. Identify each distinct food on the plate in this photo, ` +
  `estimate the portion size from visual cues, and estimate the nutrition for each item. ` +
  `Be realistic about portions.\n\n${MEAL_SCHEMA}`;

function parseMealResponse(text: string): ParsedMealItem[] | null {
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items
      .map((it: any): ParsedMealItem | null => {
        const calories = Math.round(Number(it.calories) || 0);
        if (!it.name || calories <= 0) return null;
        const num = (v: any) => Math.max(0, Math.round((Number(v) || 0) * 10) / 10);
        return {
          name: String(it.name),
          brand: it.brand || undefined,
          quantity: it.quantity ? String(it.quantity) : "1 serving",
          servingSizeG: Math.max(1, Math.round(Number(it.servingSizeG) || 100)),
          calories,
          proteinG: num(it.proteinG),
          carbsG: num(it.carbsG),
          fatG: num(it.fatG),
          fiberG: it.fiberG != null ? num(it.fiberG) : undefined,
          sodiumMg: it.sodiumMg != null ? Math.round(Number(it.sodiumMg) || 0) : undefined,
          sugarG: it.sugarG != null ? num(it.sugarG) : undefined,
        };
      })
      .filter((x: ParsedMealItem | null): x is ParsedMealItem => x !== null);
  } catch (err) {
    console.error("Meal parse error:", err);
    return null;
  }
}

export async function parseMealText(text: string): Promise<ParsedMealItem[] | null> {
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [{ role: "user", content: `${MEAL_TEXT_PROMPT}\n\nMeal: ${text}` }],
    });
    const out = response.content[0].type === "text" ? response.content[0].text : "";
    return parseMealResponse(out);
  } catch (err) {
    console.error("parseMealText error:", err);
    return null;
  }
}

export async function parseMealPhoto(imageBase64: string, mediaType: string): Promise<ParsedMealItem[] | null> {
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
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
            { type: "text", text: MEAL_PHOTO_PROMPT },
          ],
        },
      ],
    });
    const out = response.content[0].type === "text" ? response.content[0].text : "";
    return parseMealResponse(out);
  } catch (err) {
    console.error("parseMealPhoto error:", err);
    return null;
  }
}

export async function parseNutritionLabel(imageBase64: string, mediaType: string): Promise<NutritionFacts | null> {
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
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
