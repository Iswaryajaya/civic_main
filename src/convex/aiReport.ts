"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { generateText } from "ai";
import { vly } from "../lib/vly-integrations";

export interface AiReport {
  title: string;
  summary: string;
  observations: string;
  recommendedAction: string;
  riskNote: string;
  issueType: string;
  severity: "low" | "medium" | "high" | "critical";
  /**
   * True when no model could actually be reached, so the fields below were
   * assembled locally from the transcript rather than written by a model.
   */
  failed: boolean;
}

const REPORT_PROMPT = `You are writing the official structured report for a civic complaint, to be reviewed by a municipal authority. Use simple, formal English.

Reply ONLY with compact JSON:
{
  "title": "short 4-8 word report title",
  "summary": "2-3 sentence summary: what the problem is, where exactly (use the landmark and address), since when, and who is affected",
  "observations": "what the evidence photos show, in 1-2 sentences",
  "recommendedAction": "the concrete municipal action needed, 1-2 sentences",
  "riskNote": "the public-safety risk if not fixed soon, 1 sentence",
  "issueType": "one of: pothole | garbage | streetlight | water_leak | drainage | road_damage | stray_animal | traffic_signal | encroachment | other",
  "severity": "low | medium | high | critical"
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

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"] as const;

type Turn = { role: "user" | "assistant"; content: string };

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

function toReport(obj: Record<string, unknown>): AiReport {
  const str = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;

  const issueType =
    typeof obj.issueType === "string" && ISSUE_TYPES.includes(obj.issueType)
      ? obj.issueType
      : "other";

  const severity =
    typeof obj.severity === "string" && SEVERITIES.includes(obj.severity as never)
      ? (obj.severity as AiReport["severity"])
      : "medium";

  return {
    title: str(obj.title, "Civic complaint"),
    summary: str(obj.summary, ""),
    observations: str(obj.observations, ""),
    recommendedAction: str(obj.recommendedAction, ""),
    riskNote: str(obj.riskNote, ""),
    issueType,
    severity,
    failed: false,
  };
}

/**
 * Gemini is the primary path: it accepts the whole request as plain JSON over
 * REST, so there is no gateway in the middle to fail. Returns null on any
 * failure so the caller can fall through to the next provider.
 */
async function tryGemini(apiKey: string, userPrompt: string): Promise<AiReport | null> {
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: REPORT_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 700,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!res.ok) return null;

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const obj = parseModelJson(text);
      if (obj) return toReport(obj);
    } catch {
      // Try the next model.
    }
  }
  return null;
}

/** Secondary path: the existing vly gateway via the AI SDK provider. */
async function tryGateway(userPrompt: string): Promise<AiReport | null> {
  for (const modelId of ["gpt-4o-mini", "gpt-4o"]) {
    try {
      const { text } = await generateText({
        model: vly.ai.getProvider()(modelId),
        system: REPORT_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        temperature: 0.4,
        maxOutputTokens: 700,
      });
      const obj = parseModelJson(text);
      if (obj) return toReport(obj);
    } catch {
      // Try the next model.
    }
  }
  return null;
}

/**
 * Last resort when no model is reachable. Filing a complaint must never be
 * blocked by an outage, so assemble an honest report from what the citizen
 * actually said. This is deliberately plain and never invents facts — it only
 * reuses the citizen's own words.
 */
function fallbackFromTranscript(
  turns: Turn[],
  address: string | undefined,
  evidenceCount: number,
): AiReport {
  const citizen = turns
    .filter((t) => t.role === "user")
    .map((t) => t.content.trim())
    .filter((c) => c.length > 0);

  // The longest citizen message is almost always the fullest description.
  const detail = citizen.reduce(
    (best, c) => (c.length > best.length ? c : best),
    "",
  );

  const where = address ?? "the reported location";
  const summary =
    detail.length > 0
      ? `${detail} Reported at ${where}.`
      : `A civic problem was reported at ${where}. The citizen did not add a written description in this conversation.`;

  const evidenceLine =
    evidenceCount > 0
      ? `${evidenceCount} photo${evidenceCount === 1 ? " was" : "s were"} attached to the report.`
      : "No photos were attached to this report.";

  return {
    title: address ? `Civic issue near ${address}` : "Civic complaint",
    summary,
    observations: evidenceLine,
    recommendedAction:
      "Please inspect the location and carry out the necessary municipal repair work.",
    riskNote:
      "Unresolved civic defects can become a risk to public safety if left unattended.",
    issueType: "other",
    severity: "medium",
    failed: true,
  };
}

export const generateReport = action({
  args: {
    transcript: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      }),
    ),
    imageDescriptions: v.array(v.string()),
    address: v.optional(v.string()),
    lat: v.number(),
    lng: v.number(),
    language: v.string(),
  },
  handler: async (_ctx, args): Promise<AiReport> => {
    const evidence = args.imageDescriptions.length
      ? args.imageDescriptions.map((d, i) => `Photo ${i + 1}: ${d}`).join("\n")
      : "No photos were provided.";

    const convo = args.transcript
      .map((m) => `${m.role === "user" ? "Citizen" : "Agent"}: ${m.content}`)
      .join("\n");

    const userPrompt = `Citizen's preferred language: ${args.language}\n\nConversation transcript:\n${convo}\n\nEvidence:\n${evidence}\n\nLocation: latitude ${args.lat}, longitude ${args.lng}${args.address ? `, address: ${args.address}` : ""}`;

    // Primary: Gemini.
    const apiKey = process.env.GOOGLE_API_KEY;
    if (apiKey) {
      const viaGemini = await tryGemini(apiKey, userPrompt);
      if (viaGemini) return viaGemini;
    }

    // Secondary: the vly gateway.
    const viaGateway = await tryGateway(userPrompt);
    if (viaGateway) return viaGateway;

    // Never throw: a model outage must not stop a citizen from reporting a
    // problem, so fall back to their own words.
    console.error("generateReport: no model reachable, using transcript fallback");
    return fallbackFromTranscript(args.transcript, args.address, args.imageDescriptions.length);
  },
});
