"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { generateText } from "ai";
import { vly } from "../lib/vly-integrations";

/**
 * The facts the agent must collect before a complaint can be filed. The first
 * four (the address block) gate the "Continue" button — the agent keeps asking
 * until it has all of them.
 */
export const DETAIL_KEYS = [
  "problem",
  "street",
  "landmark",
  "area",
  "duration",
  "impact",
] as const;

export type DetailKey = (typeof DETAIL_KEYS)[number];

/** The address block. Until all four are known, the wizard stays on step 1. */
export const REQUIRED_KEYS: DetailKey[] = [
  "problem",
  "street",
  "landmark",
  "area",
];

export type Collected = Record<DetailKey, boolean>;

export interface AiTurnResult {
  reply: string;
  issueType: string | null;
  severity: "low" | "medium" | "high" | "critical" | null;
  title: string | null;
  collected: Collected;
  missing: DetailKey[];
  complete: boolean;
  /** True when no model was reachable and the agent fell back to its script. */
  failed: boolean;
}

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

const SEVERITIES = ["low", "medium", "high", "critical"];

const SYSTEM_PROMPT = `You are the AI Civic Agent for Civic Guide AI — a warm, patient municipal clerk who helps citizens report civic problems like potholes, garbage, broken streetlights, water leaks, drainage issues, damaged roads, or stray animal concerns.

CONVERSATION STYLE (very important):
- Reply in the SAME language the citizen used in their latest message (English, Hindi, Telugu, Tamil, Marathi, Bengali, or mixed). If they mix languages, mirror their mix.
- Keep replies SHORT — 1 to 3 spoken-style sentences. You are talking, not writing an essay.
- Sound human, warm and encouraging. Never use bullet points, markdown, emoji or headings.
- Ask exactly ONE question per reply, and only about the single most important thing still missing.
- Never invent facts. If the citizen's answer is unclear, gently ask again in different words.

COLLECT EVERY DETAIL BEFORE MOVING ON (this is mandatory):
Track these six facts across the whole conversation:
- "problem"  — what exactly is wrong
- "street"   — the street, road or lane name where it is
- "landmark" — a nearby landmark (shop, temple, school, bus stop, junction, house number)
- "area"     — the locality, colony, village, ward or city name
- "duration" — how long it has been like this
- "impact"   — who is affected and how badly (children, traffic, flooding, daily use)

Rules for asking:
- ALWAYS get the full address before anything else: street, then landmark, then area. Never skip these and never say the report is ready without them.
- A vague answer like "near my house" is NOT a street. Ask which street or road in different words.
- If the citizen only gives a city, ask for the street and the area inside it.
- After street + landmark + area are known, ask duration, then impact.
- The FIRST and SECOND user messages are usually not enough. Keep asking until all six facts are known.
- Set a flag to true ONLY when the citizen has actually stated that fact in their own words. Never guess, never assume, never fill a flag from your own suggestions.
- Once all six flags are true, tell them you have everything, the report is ready, and invite them to press Continue to add a photo.

Reply ONLY with compact JSON — no markdown fences:
{
  "reply": "your spoken reply in the citizen's language",
  "issueType": "one of: pothole | garbage | streetlight | water_leak | drainage | road_damage | stray_animal | traffic_signal | encroachment | other (or null if unknown)",
  "severity": "low | medium | high | critical (or null if not yet clear)",
  "title": "a short 4-8 word English label for the report (or null)",
  "collected": {
    "problem": true or false,
    "street": true or false,
    "landmark": true or false,
    "area": true or false,
    "duration": true or false,
    "impact": true or false
  }
}
Always include every key in "collected" — carry forward the flags that were already true in this conversation.`;

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

function emptyCollected(): Collected {
  return {
    problem: false,
    street: false,
    landmark: false,
    area: false,
    duration: false,
    impact: false,
  };
}

/** Merge the flags the model reported with what the client already knew. */
function mergeCollected(
  prior: Collected,
  raw: unknown,
): Collected {
  const out: Collected = { ...prior };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of DETAIL_KEYS) {
      if ((raw as Record<string, unknown>)[key] === true) out[key] = true;
    }
  }
  return out;
}

function toSeverity(value: unknown): AiTurnResult["severity"] {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  return SEVERITIES.includes(s) ? (s as AiTurnResult["severity"]) : null;
}

function missingFrom(collected: Collected): DetailKey[] {
  return DETAIL_KEYS.filter((k) => !collected[k]);
}

function buildResult(
  reply: string,
  obj: Record<string, unknown> | null,
  prior: Collected,
  failed: boolean,
): AiTurnResult {
  const collected = obj ? mergeCollected(prior, obj.collected) : prior;
  const missing = missingFrom(collected);
  const issueType =
    obj && typeof obj.issueType === "string" && ISSUE_TYPES.includes(obj.issueType)
      ? obj.issueType
      : null;
  const title =
    obj && typeof obj.title === "string" && obj.title.trim().length > 0
      ? obj.title.trim()
      : null;

  return {
    reply: reply.trim(),
    issueType,
    severity: obj ? toSeverity(obj.severity) : null,
    title,
    collected,
    missing,
    complete: missing.length === 0,
    failed,
  };
}

/**
 * Google Gemini via REST, used as the primary provider. Returns null on any
 * failure so the caller can fall through to the next path.
 */
async function tryGemini(
  apiKey: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ obj: Record<string, unknown> | null; reason: string }> {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 600,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { obj: null, reason: `gemini ${model}: HTTP ${res.status} ${body.slice(0, 200)}` };
      }

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      return { obj: parseModelJson(text), reason: `gemini ${model}: unparseable` };
    } catch (err) {
      const reason = `gemini ${model}: ${err instanceof Error ? err.message : String(err)}`;
      if (model === GEMINI_MODELS[GEMINI_MODELS.length - 1]) return { obj: null, reason };
    }
  }
  return { obj: null, reason: "gemini: no attempt made" };
}

/** Secondary path: the vly gateway through the AI SDK provider. */
async function tryGateway(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  language: string,
): Promise<Record<string, unknown> | null> {
  const prompt = `${SYSTEM_PROMPT}\n\nThe citizen's chosen language is "${language}".\n\nConversation so far:\n${messages
    .map((m) => `${m.role === "user" ? "Citizen" : "Agent"}: ${m.content}`)
    .join("\n")}\n\nReply with the JSON object only.`;

  for (const modelId of ["gpt-4o-mini", "gpt-4o"]) {
    try {
      const { text } = await generateText({
        model: vly.ai.getProvider()(modelId),
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        maxOutputTokens: 600,
      });
      const obj = parseModelJson(text);
      if (obj) return obj;
    } catch {
      // Try the next model / provider.
    }
  }
  return null;
}

/**
 * Last resort: a deterministic script that walks the citizen through the same
 * six questions in their language. The chat never stalls — it just gets less
 * clever. Never throws, never claims to know anything the citizen did not say.
 */
const SCRIPT: Record<string, Record<string, string>> = {
  en: {
    problem: "Of course. First, what exactly is the problem \u2014 a pothole, garbage, a broken streetlight, a water leak?",
    street: "Of course. Which street or road is it on?",
    landmark: "Is there a nearby landmark \u2014 a shop, temple, school, petrol pump or bus stop \u2014 that identifies the spot?",
    area: "Which area, colony, village or ward is this in, and which city?",
    duration: "How long has this been like this \u2014 a day, a week, or months?",
    impact: "Who is affected and how badly \u2014 children, traffic, daily water, flooding?",
  },
  hi: {
    problem: "ज़रूर। समस्या ठीक-ठीक क्या है — गड्ढा, कचरा, टूटी स्ट्रीट लाइट, या पानी का रिसाव?",
    street: "यह किस सड़क या गली में है?",
    landmark: "पास में कोई दुकान, मंदिर, स्कूल, पेट्रोल पंप या बस स्टॉप है जो जगह पहचान दे?",
    area: "यह किस इलाके, मोहल्ले, गाँव या वार्ड में है, और किस शहर में?",
    duration: "यह समस्या कब से है — एक दिन, एक हफ्ता या महीनों?",
    impact: "कौन प्रभावित हो रहा है और कितना — बच्चे, ट्रैफिक, रोज़ का पानी, बाढ़?",
  },
  te: {
    problem: "తప్పక. సమస్య ఏమిటి ఖచ్చితంగా — గుంటలు, చెత్త, పగిలిన స్ట్రీట్ లైట్, నీరు లీక్?",
    street: "ఇది ఏ వీధిలో లేదా రోడ్‌లో ఉంది?",
    landmark: "దగ్గర గుర్తుగా ఉన్న దుకాణం, దేవుణ్డి, పాఠశాల, పెట్రోల్ పంప్ లేదా బస్సు స్టాప్ ఏదైనా ఉందా?",
    area: "ఇది ఏ ప్రాంతం, కాలనీ, గ్రామం లేదా వార్డ్‌లో ఉంది, ఏ నగరంలో?",
    duration: "ఈ సమస్య ఎప్పుడు నుంచి ఉంది — ఒక రోజు, వారం, లేదా నెలలు?",
    impact: "ఎవరు ప్రభావితులవుతున్నారు, ఎంత తీవ్రంగా — పిల్లలు, ట్రాఫిక్, రోజువారీ నీరు, వర్షపు?",
  },
  ta: {
    problem: "சரி. பிரச்சனை என்னென்று சரியாக — குழி, குப்பை, உடைந்த வீதி விளக்கு, நீர் கசிவா?",
    street: "இது எந்த தெரு அல்லது சாலையில் உள்ளது?",
    landmark: "அருகில் இடத்தை குறிக்கும் கடை, கோவில், பள்ளி, பெட்ரோல் பம்ப் அல்லது பேருந்து நிலையம் ஏதாவது உள்ளதா?",
    area: "இது எந்த பகுதி, குடியிருப்பு, கிராமம் அல்லது வார்டில் உள்ளது, எந்த நகரில்?",
    duration: "இது என்று நாட்களாக உள்ளது — ஒரு நாள், ஒரு வாரம், அல்லது மாதங்களா?",
    impact: "யார் பாதிக்கப்படுகிறார்கள், எவ்வளவு — குழந்தைகள், போக்குவரத்து, தினசரி நீர், வெள்ளம்?",
  },
  mr: {
    problem: "नक्की. समस्या नेमकी आहे — खड्डा, कचरा, तुटलेला दिवा, पाण्याची गळती?",
    street: "हे कोणत्या रस्त्यावर किंवा गल्लीत आहे?",
    landmark: "जवळ ठळक दुकान, मंदिर, शाळा, पेट्रोल पंप किंवा बस थांबा आहे का?",
    area: "हे कोणत्या परिसरात, वसाहतात, गावात किंवा वार्डमध्ये आहे, आणि कोणत्या शहरात?",
    duration: "ही समस्या किती दिवसांपासून आहे — एक दिवस, एक आठवडा, की महिने?",
    impact: "कोण प्रभावित होत आहे आणि किती — मुले, वाहतूक, दररोजचे पाणी, पाण्यात बुडणे?",
  },
  bn: {
    problem: "অবশ্যই। সমস্যাটি ঠিক কী — গর্ত, আবর্জনা, ভাঙা স্ট্রিট লাইট, নাকি জল লিক?",
    street: "এটি কোন রাস্তা বা গলিপথে?",
    landmark: "কাছে এমন কোনো দোকান, মন্দির, স্কুল, পেট্রোল পাম্প বা বাস স্টপ আছে যা জায়গাটি চিহ্নিত করবে?",
    area: "এটি কোন এলাকা, কলোনি, গ্রাম বা ওয়ার্ডে, এবং কোন শহরে?",
    duration: "এটি কতদিন ধরে চলছে — একদিন, এক সপ্তাহ, নাকি কয়েক মাস?",
    impact: "কারা ক্ষতিগ্রস্ত হচ্ছেন এবং কতটা — শিশুরা, যানজটি, প্রতিদিনের জল, বন্যা?",
  },
};

function scriptedTurn(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  collected: Collected,
  language: string,
): AiTurnResult {
  const table = SCRIPT[language] ?? SCRIPT.en;
  const userTurns = messages.filter((m) => m.role === "user").length;

  const updated: Collected = { ...collected };
  const askedBefore = missingFrom(collected);

  if (userTurns <= 1) {
    // The opening message always states the problem itself.
    updated.problem = true;
  } else if (askedBefore.length > 0) {
    // The previous assistant turn asked for the first missing field, so this
    // citizen reply answers it.
    updated[askedBefore[0]] = true;
  }

  const target = missingFrom(updated)[0];
  const reply = target ? table[target] : table.impact;

  return buildResult(reply, null, updated, true);
}

export const chatTurn = action({
  args: {
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      }),
    ),
    language: v.string(),
    collected: v.optional(
      v.array(v.union(v.literal("problem"), v.literal("street"), v.literal("landmark"), v.literal("area"), v.literal("duration"), v.literal("impact"))),
    ),
  },
  handler: async (_ctx, { messages, language, collected }): Promise<AiTurnResult> => {
    // The client passes the keys it has already collected so the script
    // fallback can pick up where the conversation left off.
    const prior: Collected = emptyCollected();
    for (const key of collected ?? []) prior[key] = true;

    const history = messages.filter((m) => m.content.trim().length > 0);
    if (history.length === 0) return scriptedTurn(history, prior, language);

    const reasons: string[] = [];
    const apiKey = process.env.GOOGLE_API_KEY;

    if (apiKey) {
      const { obj, reason } = await tryGemini(apiKey, history);
      if (obj && typeof obj.reply === "string" && obj.reply.trim().length > 0) {
        return buildResult(obj.reply, obj, prior, false);
      }
      reasons.push(reason);
    } else {
      reasons.push("gemini: GOOGLE_API_KEY not set");
    }

    const viaGateway = await tryGateway(history, language);
    if (viaGateway && typeof viaGateway.reply === "string" && viaGateway.reply.trim().length > 0) {
      return buildResult(viaGateway.reply, viaGateway, prior, false);
    }
    reasons.push("vly gateway: no model returned a usable reply");

    // Never throw: an unreachable model must not break the citizen's chat.
    console.error("chatTurn: no model reachable, using scripted questions:", reasons.join(" | "));
    return scriptedTurn(history, prior, language);
  },
});