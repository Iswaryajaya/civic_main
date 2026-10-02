"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { generateText } from "ai";
import { vly } from "../lib/vly-integrations";

export interface ImageAnalysis {
  valid: boolean;
  detectedIssue: string | null;
  description: string;
  severity: "low" | "medium" | "high" | "critical" | null;
  /** True when no provider could actually see the image. */
  failed: boolean;
}

const VISION_PROMPT = `You are the computer-vision module of a civic complaint system. You will be shown a photo. Decide whether it shows a civic problem that a municipal department should fix.

MARK "valid": true WHEN the photo shows any of these:
- Garbage: piles of rubbish, litter, plastic bags, bottles, cardboard, mixed waste, overflowing bins, or waste left on a roadside, kerb, park, drain or vacant plot
- Illegal dumping, or waste stacked on open ground
- Potholes, broken or sunken roads, damaged footpaths, cracked kerbs
- Water leaks, sewage overflow, standing flood water, open manholes
- Clogged or overflowing drains, broken stormwater grates
- Streetlights that are broken, tilted, dark or missing
- Fallen trees or large debris blocking a road or footpath
- Damaged public property: broken benches, fences, railings, signboards, bus shelters, public toilets
- Stray cattle, dogs or animals obstructing a road
- Encroachment: goods, stalls or structures blocking a footpath, road or drain
- Traffic signals that are broken, dark or out of order

MARK "valid": false ONLY WHEN the photo is clearly one of these:
- A selfie, a portrait, or a photo focused on people or faces
- A document, ID card, receipt, screenshot, or a photo of a screen
- A photo of a pet or a personal moment
- A plain landscape, building or wall with no visible damage, waste or defect
- An image too blurry, too dark or too cropped to tell what it is

Be honest and literal. Describe ONLY what is actually visible in the photo. If you cannot see the image, say so in "description" and return "valid": false — never guess at its contents.

Reply ONLY with compact JSON, no prose and no markdown:
{
  "valid": true or false,
  "detectedIssue": "exactly one of: pothole | garbage | streetlight | water_leak | drainage | road_damage | stray_animal | traffic_signal | encroachment | other  (use null when valid is false)",
  "description": "one short sentence in simple English describing what you actually see",
  "severity": "low | medium | high | critical   (low for minor litter, medium for a moderate pile, high for a large pile or blocked drain, critical only for immediate danger)"
}`;

const ISSUE_TYPES = [
  "pothole",
  "garbage",
  "streetlight",
  "water_leak",
  "drainage",
  "road_damage",
  "stray_animal",
  "traffic_signal",
  "encroachment",
  "other",
];

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"] as const;

/**
 * Pull a JSON object out of a model response that may be wrapped in markdown
 * fences, prefixed with prose, or truncated mid-object because the token
 * budget ran out.
 */
function parseModelJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const unfenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i++) {
    const ch = unfenced[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(unfenced.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  if (depth > 0) {
    try {
      return JSON.parse(unfenced.slice(start) + "}".repeat(depth)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function toSeverity(value: unknown): ImageAnalysis["severity"] {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return ["low", "medium", "high", "critical"].includes(v)
    ? (v as "low" | "medium" | "high" | "critical")
    : null;
}

function toAnalysis(obj: Record<string, unknown>): ImageAnalysis {
  const description =
    typeof obj.description === "string" && obj.description.trim().length > 0
      ? obj.description.trim()
      : "Photo attached to the complaint.";

  const detected =
    typeof obj.detectedIssue === "string" && ISSUE_TYPES.includes(obj.detectedIssue)
      ? obj.detectedIssue
      : null;

  return {
    valid: obj.valid === true,
    detectedIssue: detected,
    description,
    severity: toSeverity(obj.severity),
    failed: false,
  };
}

function failed(reason: string): ImageAnalysis {
  console.error("analyzeImage failed:", reason);
  return {
    valid: false,
    detectedIssue: null,
    description:
      "The AI check could not run on this photo, but it has been attached to your complaint.",
    severity: null,
    failed: true,
  };
}

/**
 * Google Gemini vision call. Gemini takes the image as inline base64 in a REST
 * payload, so no SDK dependency is needed and the bytes definitely reach the
 * model. Returns null on any failure so the caller can try the next provider.
 */
async function tryGemini(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
): Promise<{ result: ImageAnalysis | null; reason: string }> {
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: VISION_PROMPT },
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 400,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { result: null, reason: `gemini ${model}: HTTP ${res.status} ${body.slice(0, 200)}` };
      }

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const obj = parseModelJson(text);
      if (!obj) return { result: null, reason: `gemini ${model}: unparseable response` };
      return { result: toAnalysis(obj), reason: "" };
    } catch (err) {
      const reason = `${model}: ${err instanceof Error ? err.message : String(err)}`;
      if (model === GEMINI_MODELS[GEMINI_MODELS.length - 1]) {
        return { result: null, reason };
      }
    }
  }
  return { result: null, reason: "gemini: no attempt made" };
}

/**
 * Existing vly gateway, kept as a secondary path. Uses the AI SDK provider
 * rather than the raw `completion()` helper, whose `content` type is a plain
 * string — passing a multimodal array through it silently drops the image and
 * the model answers from the prompt alone.
 */
async function tryGateway(imageBase64: string, mimeType: string): Promise<ImageAnalysis | null> {
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  for (const modelId of ["gpt-4o-mini", "gpt-4o"]) {
    try {
      const { text } = await generateText({
        model: vly.ai.getProvider()(modelId),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: VISION_PROMPT },
              { type: "image", image: dataUrl },
            ],
          },
        ],
        temperature: 0.1,
        maxOutputTokens: 400,
      });
      const obj = parseModelJson(text);
      if (obj) return toAnalysis(obj);
    } catch {
      // Try the next model / provider.
    }
  }
  return null;
}

export const analyzeImage = action({
  args: { imageBase64: v.string(), mimeType: v.string() },
  handler: async (_ctx, { imageBase64, mimeType }): Promise<ImageAnalysis> => {
    if (!imageBase64 || imageBase64.length < 64) return failed("empty or truncated payload");

    const reasons: string[] = [];

    // Primary: Gemini, which reliably accepts inline base64 images.
    const apiKey = process.env.GOOGLE_API_KEY;
    if (apiKey) {
      const { result, reason } = await tryGemini(apiKey, imageBase64, mimeType);
      if (result) return result;
      reasons.push(reason);
    } else {
      reasons.push("gemini: GOOGLE_API_KEY not set");
    }

    // Secondary: the vly gateway, in case it routes images for some models.
    const viaGateway = await tryGateway(imageBase64, mimeType);
    if (viaGateway) return viaGateway;
    reasons.push("vly gateway: no model returned a usable result");

    // Never throw and never invent a verdict: an unreachable vision model must
    // not block filing a report, and must not describe an image it never saw.
    return failed(reasons.join(" | "));
  },
});
