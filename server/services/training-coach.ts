import Anthropic from "@anthropic-ai/sdk";
import { storage } from "../storage.js";
import { suggestNextWeight } from "../../shared/training.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GRAMS_PER_LB = 453.59237;
const gramsToLbs = (g: number) => Math.round((g / GRAMS_PER_LB) * 10) / 10;

export interface AdaptiveProposal {
  templateExerciseId: number;
  templateName: string;
  exerciseName: string;
  field: "targetWeightGrams";
  currentValue: number | null;
  proposedValue: number;
  reason: string;
}

export interface AdaptiveProposalsResult {
  proposals: AdaptiveProposal[];
  notes: string[];
}

interface Candidate {
  id: number;
  templateExerciseId: number;
  templateName: string;
  exerciseName: string;
  currentValue: number | null;
  proposedValue: number;
  autoNote: string;
}

const PROMPT = `You are a training coach reviewing proposed weight increases for a lifter's workout plan.
Each candidate already has a proposed new target weight, computed from their most recent session
(they hit every rep at the top of their target range, so a small increase is suggested).

Your job is ONLY to:
1. Decide whether each candidate's increase looks reasonable given the lifter's goals, or whether
   it should be held back (e.g. conflicts with a stated goal, looks too aggressive for the exercise).
2. Write a short (<=20 words) human-readable reason for each candidate you keep.
3. Optionally add up to 2 short general notes for the lifter.

You must NOT invent new weight values or reference exercises that aren't in the candidate list.
Respond with ONLY valid JSON (no markdown) of this exact shape:
{
  "items": [{ "id": <candidate id>, "include": <boolean>, "reason": "<short reason>" }],
  "notes": ["<optional general note>"]
}`;

/**
 * Builds approval-gated proposals for the user's active routine: for each
 * template exercise where the lifter hit every rep last session, suggests
 * bumping the target weight. Claude may only annotate/filter candidates —
 * proposedValue and templateExerciseId always come from server-computed
 * candidates, never from the model's response.
 */
export async function generateAdaptiveProposals(userId: number): Promise<AdaptiveProposalsResult> {
  const routine = await storage.getActiveRoutine(userId);
  if (!routine) return { proposals: [], notes: [] };

  const templateIds = [...new Set(
    routine.days.map(d => d.templateId).filter((id): id is number => id != null)
  )];
  if (templateIds.length === 0) return { proposals: [], notes: [] };

  const templateNames = new Map(
    routine.days.filter(d => d.templateId != null).map(d => [d.templateId as number, d.focus])
  );

  const candidates: Candidate[] = [];
  let nextId = 0;

  for (const templateId of templateIds) {
    const templateExercises = await storage.getTemplateExercisesWithDetails(templateId);
    for (const te of templateExercises) {
      const history = await storage.getExerciseHistory(te.exerciseId, userId);
      if (history.length === 0) continue;
      const lastSession = history[history.length - 1];
      const suggestion = suggestNextWeight(lastSession.setsData, te.targetReps, te.equipment);
      if (!suggestion) continue;
      if (suggestion.weightGrams <= (te.targetWeightGrams ?? 0)) continue;

      candidates.push({
        id: nextId++,
        templateExerciseId: te.id,
        templateName: templateNames.get(templateId) ?? "Workout",
        exerciseName: te.exerciseName,
        currentValue: te.targetWeightGrams,
        proposedValue: Math.round(suggestion.weightGrams),
        autoNote: suggestion.note,
      });
    }
  }

  if (candidates.length === 0) return { proposals: [], notes: [] };

  const goals = await storage.getGoals(userId);
  const goalSummaries = goals
    .filter((g: any) => g.isActive)
    .map((g: any) => `${g.type}${g.deadline ? ` by ${g.deadline}` : ""}`);

  const candidateSummaries = candidates.map(c => ({
    id: c.id,
    exercise: c.exerciseName,
    workout: c.templateName,
    currentTargetLbs: c.currentValue != null ? gramsToLbs(c.currentValue) : null,
    proposedTargetLbs: gramsToLbs(c.proposedValue),
    autoNote: c.autoNote,
  }));

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `${PROMPT}\n\nLifter's active goals: ${JSON.stringify(goalSummaries)}\n\nCandidates: ${JSON.stringify(candidateSummaries)}`,
      }],
    });

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    const cleaned = (textBlock?.text ?? "").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const byId = new Map(candidates.map(c => [c.id, c]));
    const proposals: AdaptiveProposal[] = [];
    for (const item of Array.isArray(parsed?.items) ? parsed.items : []) {
      const candidate = byId.get(Number(item?.id));
      if (!candidate || item?.include !== true) continue;
      proposals.push({
        templateExerciseId: candidate.templateExerciseId,
        templateName: candidate.templateName,
        exerciseName: candidate.exerciseName,
        field: "targetWeightGrams",
        currentValue: candidate.currentValue,
        proposedValue: candidate.proposedValue,
        reason: typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : candidate.autoNote,
      });
    }
    const notes = Array.isArray(parsed?.notes) ? parsed.notes.filter((n: any) => typeof n === "string").slice(0, 2) : [];

    return { proposals, notes };
  } catch (err) {
    console.error("generateAdaptiveProposals error:", err);
    // Fall back to the auto-computed candidates, unfiltered.
    return {
      proposals: candidates.map(c => ({
        templateExerciseId: c.templateExerciseId,
        templateName: c.templateName,
        exerciseName: c.exerciseName,
        field: "targetWeightGrams",
        currentValue: c.currentValue,
        proposedValue: c.proposedValue,
        reason: c.autoNote,
      })),
      notes: [],
    };
  }
}
