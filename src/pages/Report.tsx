import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useLanguage } from "@/lib/i18n";
import { LanguageSelector } from "@/lib/i18n";
import { useSpeechInput, useSpeechOutput } from "@/hooks/use-speech";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useOsmAddress, MapPicker, MapOverlayButton, DEFAULT_MAP_CENTER } from "@/hooks/use-map";
import { EvidenceCollector, type EvidenceItem } from "@/components/EvidenceCollector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Mic, MicOff, Send, Volume2, VolumeX, Loader2, MapPin, FileText,
  MessageSquareText, Camera, CheckCircle2, ArrowLeft, ArrowRight, Copy, Check,
  Navigation, Compass, ExternalLink,
} from "lucide-react";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

// Convex HTTP actions live on the `.site` deployment URL.
const CONVEX_HTTP_BASE =
  import.meta.env.VITE_CONVEX_URL?.replace(".cloud", ".site") ?? "";

interface AiReport {
  title: string;
  summary: string;
  observations: string;
  recommendedAction: string;
  riskNote: string;
  issueType: string;
  severity: "low" | "medium" | "high" | "critical";
  /** True when no AI model was reachable and this was built from the transcript. */
  failed?: boolean;
}

const STEPS = ["describe", "evidence", "location", "report", "filed"] as const;

/** Mirrors DETAIL_KEYS / REQUIRED_KEYS in src/convex/aiAgent.ts. */
const DETAIL_KEYS = [
  "problem",
  "street",
  "landmark",
  "area",
  "duration",
  "impact",
] as const;

type DetailKey = (typeof DETAIL_KEYS)[number];
type Collected = Record<DetailKey, boolean>;

/** The address block the agent must have before the wizard can continue. */
const REQUIRED_KEYS: DetailKey[] = ["problem", "street", "landmark", "area"];

const EMPTY_COLLECTED: Collected = {
  problem: false,
  street: false,
  landmark: false,
  area: false,
  duration: false,
  impact: false,
};

const GREETINGS: Record<string, string> = {
  en: "Namaste! I'm the Civic Guide agent. Tell me — what problem are you facing? For example, a pothole, a garbage pile or a broken streetlight.",
  hi: "नमस्ते! मैं सिविक गाइड एजेंट हूँ। बताइए — क्या समस्या हो रही है? जैसे गड्ढा, कचरा या टूटी स्ट्रीट लाइट।",
  te: "నమస్తే! నేను సివిక్ గైడ్ ఏజెంట్‌ని. చెప్పండి — ఏ సమస్య ఎదుర్కొంటున్నారు? ఉదాహరణకు గుంటలు, చెత్త లేదా పగిలిన స్ట్రీట్ లైట్.",
  ta: "வணக்கம்! நான் சிவிக் கைடு முகவர். சொல்லுங்கள் — என்ன பிரச்சனை? உதாரணமாக குழி, குப்பை அல்லது உடைந்த வீதி விளக்கு.",
  mr: "नमस्कार! मी सिव्हिक गाइड एजंट आहे. सांगा — काय समस्या आहे? उदा. खड्डा, कचरा किंवा खराब झालेला पथदिवा.",
  bn: "নমস্কার! আমি সিভিক গাইড এজেন্ট। বলুন — কী সমস্যা হচ্ছে? যেমন গর্ত, আবর্জনা বা ভাঙা স্ট্রিট লাইট।",
};

export default function Report() {
  const { t, lang, speechCode } = useLanguage();
  const navigate = useNavigate();

  const chatTurn = useAction(api.aiAgent.chatTurn);
  const generateReportAction = useAction(api.aiReport.generateReport);
  const createComplaint = useMutation(api.complaints.createComplaint);

  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  // ── Chat state ────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [issueType, setIssueType] = useState<string | null>(null);
  const [aiSeverity, setAiSeverity] = useState<string | null>(null);
  const [collected, setCollected] = useState<Collected>(EMPTY_COLLECTED);
  const chatRef = useRef<HTMLDivElement>(null);

  const speechInput = useSpeechInput(speechCode);
  const speechOutput = useSpeechOutput(speechCode);

  // ── Evidence state ───────────────────────────────────────────
  const [files, setFiles] = useState<EvidenceItem[]>([]);

  // ── Location state ───────────────────────────────────────────
  const geo = useGeolocation(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const lookupAddress = useOsmAddress(CONVEX_HTTP_BASE);

  // ── Report / filing state ────────────────────────────────────
  const [report, setReport] = useState<AiReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [filing, setFiling] = useState(false);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Greet once when the wizard opens.
  useEffect(() => {
    setMessages([{ role: "assistant", content: GREETINGS[lang] ?? GREETINGS.en }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speakGreeting = useCallback(() => {
    speechOutput.speak(messages[0]?.content ?? GREETINGS[lang] ?? GREETINGS.en);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || thinking) return;
      const next: ChatMsg[] = [...messages, { role: "user", content }];
      setMessages(next);
      setInput("");
      speechInput.reset();
      setThinking(true);
      try {
        const res = await chatTurn({
          messages: next,
          language: lang,
          collected: DETAIL_KEYS.filter((k) => collected[k]),
        });
        setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
        if (res.issueType) setIssueType(res.issueType);
        if (res.severity) setAiSeverity(res.severity);
        if (res.collected) setCollected(res.collected);
        if (res.failed) toast.warning(t("report.agentScriptedNote"));
        speechOutput.speak(res.reply);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              err instanceof Error
                ? err.message
                : t("report.chatFallback"),
          },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [messages, thinking, chatTurn, lang, speechOutput, speechInput, collected, t],
  );

  // Auto-send the final transcript when the microphone stops.
  const lastSentRef = useRef("");
  useEffect(() => {
    if (!speechInput.listening && speechInput.transcript && !thinking) {
      if (speechInput.transcript !== lastSentRef.current) {
        lastSentRef.current = speechInput.transcript;
        void send(speechInput.transcript);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechInput.listening, speechInput.transcript, thinking]);

  const missingRequired = REQUIRED_KEYS.filter((k) => !collected[k]);
  const canContinueFromChat = missingRequired.length === 0 && !thinking;

  // GPS → pin (every fresh fix moves the pin; manual taps are unaffected
  // because geo.pos only changes when a new fix arrives)
  useEffect(() => {
    if (geo.pos) setPin({ lat: geo.pos.lat, lng: geo.pos.lng });
  }, [geo.pos]);

  // pin → address
  useEffect(() => {
    if (!pin) return;
    let cancelled = false;
    setAddress(null);
    void lookupAddress(pin.lat, pin.lng).then((addr) => {
      if (!cancelled) setAddress(addr);
    });
    return () => {
      cancelled = true;
    };
  }, [pin, lookupAddress]);

  const generate = async () => {
    if (!pin) return;
    setGenerating(true);
    try {
      const imageDescriptions = files
        .filter((f) => f.kind === "photo" && f.aiAnalysis)
        .map((f) => f.aiAnalysis!);
      const res = await generateReportAction({
        transcript: messages,
        imageDescriptions,
        lat: pin.lat,
        lng: pin.lng,
        address: address ?? undefined,
        language: lang,
      });
      setReport(res);
      setStepIdx(3);
      if (res.failed) {
        toast.warning(t("report.aiFallbackNote"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("report.toastReportFailed"));
    } finally {
      setGenerating(false);
    }
  };

  const fileComplaint = async () => {
    if (!report || !pin) return;
    setFiling(true);
    try {
      const res = await createComplaint({
        draft: {
          title: report.title,
          description: report.summary,
          issueType: issueType ?? report.issueType,
          severity: (aiSeverity ?? report.severity) as "low" | "medium" | "high" | "critical",
          language: lang,
          transcript: messages,
          evidence: files.map((f) => ({
            kind: f.kind,
            mimeType: f.mimeType,
            dataUrl: f.dataUrl,
            name: f.name,
            aiAnalysis: f.aiAnalysis,
          })),
          location: {
            lat: pin.lat,
            lng: pin.lng,
            accuracy: geo.pos?.accuracy,
            address: address ?? undefined,
          },
          aiReport: {
            summary: report.summary,
            observations: report.observations,
            recommendedAction: report.recommendedAction,
            riskNote: report.riskNote,
          },
        },
      });
      setTrackingId(res.trackingId);
      setStepIdx(4);
      speechOutput.stopSpeaking();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("report.toastFileFailed"));
    } finally {
      setFiling(false);
    }
  };

  const resetWizard = () => {
    setStepIdx(0);
    setMessages([{ role: "assistant", content: GREETINGS[lang] ?? GREETINGS.en }]);
    setFiles([]);
    setPin(null);
    setAddress(null);
    setReport(null);
    setTrackingId(null);
    setIssueType(null);
    setAiSeverity(null);
    setCollected(EMPTY_COLLECTED);
    lastSentRef.current = "";
  };

  const stepLabels = [
    t("report.step1"),
    t("report.step2"),
    t("report.step3"),
    t("report.step4"),
    t("report.step5"),
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <ArrowLeft className="size-4 text-muted-foreground" />
            <span className="font-serif">{t("brand.name")}</span>
          </Link>
          <LanguageSelector compact />
        </div>
      </header>

      <main className="hero-wash mx-auto w-full max-w-4xl px-4 py-8">
        {/* Stepper */}
        <ol className="mb-8 flex items-center gap-2">
          {stepLabels.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-all ${
                    i < stepIdx
                      ? "border-primary bg-primary text-primary-foreground"
                      : i === stepIdx
                        ? "scale-110 border-2 border-primary text-primary shadow-sm"
                        : "border-border text-muted-foreground"
                  }`}
                >
                  {i < stepIdx ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span
                  className={`type-label hidden text-[10px] sm:block ${
                    i === stepIdx ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < stepLabels.length - 1 && (
                <span className={`h-px flex-1 transition-colors ${i < stepIdx ? "bg-primary" : "bg-border"}`} />
              )}
            </li>
          ))}
        </ol>

        {/* ── Step 1: AI conversation ─────────────────────────── */}
        {step === "describe" && (
          <section className="archive-frame rounded-lg border border-border bg-card shadow-sm">
            <div className="archive-frame-inner p-5 sm:p-6">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="size-5 text-primary" />
                  <h2 className="font-serif text-xl">{t("report.chatTitle")}</h2>
                </div>
                <button
                  type="button"
                  onClick={speakGreeting}
                  className="type-label flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <Volume2 className="size-3.5" /> Hear greeting
                </button>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">{t("report.chatHint")}</p>

              <div
                ref={chatRef}
                className="mb-4 h-[46vh] min-h-72 space-y-3 overflow-y-auto rounded border border-border bg-background p-4 xl:h-[56vh]"
              >
                {messages.map((m, i) => (
                  <div key={i} className={`flex fade-up ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "rounded-br-sm bg-primary text-primary-foreground shadow-sm"
                          : "rounded-bl-sm border border-border bg-card text-foreground shadow-sm"
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
                {thinking && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1.5 rounded-lg rounded-bl-sm border border-border bg-card px-4 py-3 shadow-sm">
                      {[0, 1, 2].map((d) => (
                        <span key={d} className="typing-dot size-1.5 rounded-full bg-primary" />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {speechInput.interim && (
                <p className="mb-2 text-xs italic text-muted-foreground">“{speechInput.interim}…”</p>
              )}
              {speechInput.error && <p className="mb-2 text-sm text-destructive">{speechInput.error}</p>}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (speechInput.listening ? speechInput.stop() : speechInput.start())}
                  className={`flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    speechInput.listening
                      ? "border-destructive bg-destructive text-white"
                      : "border-primary bg-card text-primary hover:bg-accent"
                  }`}
                  aria-label={speechInput.listening ? t("report.stopMic") : t("report.mic")}
                >
                  {speechInput.listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
                </button>
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  placeholder={t("report.typeMessage")}
                  className="flex-1"
                />
                <Button
                  size="icon"
                  onClick={() => void send(input)}
                  disabled={!input.trim() || thinking}
                  aria-label={t("report.send")}
                >
                  <Send className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    if (speechOutput.muted) {
                      speechOutput.setMuted(false);
                    } else {
                      speechOutput.setMuted(true);
                      speechOutput.stopSpeaking();
                    }
                  }}
                  aria-label={t("report.voiceToggle")}
                  title={speechOutput.muted ? t("report.voiceOff") : t("report.voiceOn")}
                >
                  {speechOutput.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </Button>
              </div>

              {speechInput.listening && (
                <p className="type-label mt-2 flex items-center gap-2 text-[10px] text-destructive">
                  <span className="inline-block size-2 animate-pulse rounded-full bg-destructive" />
                  {t("common.listening")} {t("report.micStopHint")}
                </p>
              )}
              {speechOutput.speaking && (
                <p className="type-label mt-2 text-[10px] text-primary">{t("common.speaking")}</p>
              )}

              {/* Collected details — the wizard stays locked until the full
                  address block (problem, street, landmark, area) is known. */}
              <div className="mt-4 rounded border border-border bg-background/60 p-3">
                <p className="type-label mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t("report.detailTitle")}
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {DETAIL_KEYS.map((key) => {
                    const done = collected[key];
                    const required = REQUIRED_KEYS.includes(key);
                    return (
                      <li
                        key={key}
                        className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          done
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : required
                              ? "border-dashed border-border text-muted-foreground"
                              : "border-dashed border-border/70 text-muted-foreground/70"
                        }`}
                      >
                        <span
                          className={`flex size-3.5 items-center justify-center rounded-full text-[9px] ${
                            done ? "bg-primary text-primary-foreground" : "border border-current"
                          }`}
                        >
                          {done ? <Check className="size-2.5" /> : ""}
                        </span>
                        {t(`report.detail.${key}`)}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">
                  {canContinueFromChat
                    ? t("report.chatDone")
                    : t("report.addressPending")}
                </p>
                <Button onClick={() => setStepIdx(1)} disabled={!canContinueFromChat} className="shrink-0">
                  {t("common.next")} <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* ── Step 2: Evidence ───────────────────────────────── */}
        {step === "evidence" && (
          <section className="archive-frame paper-card fade-up rounded-lg">
            <div className="archive-frame-inner p-5 sm:p-6">
              <div className="mb-1 flex items-center gap-2">
                <Camera className="size-5 text-primary" />
                <h2 className="font-serif text-xl">{t("report.evidenceTitle")}</h2>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">{t("report.evidenceHint")}</p>

              <EvidenceCollector files={files} onChange={setFiles} />

              <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                <Button variant="ghost" onClick={() => setStepIdx(0)}>
                  <ArrowLeft className="size-4" /> {t("common.back")}
                </Button>
                <Button onClick={() => setStepIdx(2)} disabled={files.length === 0}>
                  {t("common.next")} <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* ── Step 3: Location ───────────────────────────────── */}
        {step === "location" && (
          <section className="archive-frame paper-card fade-up rounded-lg">
            <div className="archive-frame-inner p-5 sm:p-6">
              <div className="mb-1 flex items-center gap-2">
                <MapPin className="size-5 text-primary" />
                <h2 className="font-serif text-xl">{t("report.locTitle")}</h2>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">{t("report.locHint")}</p>

              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={geo.request} disabled={geo.loading}>
                  {geo.loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> {t("report.locating")}
                    </>
                  ) : (
                    <>
                      <Navigation className="size-4" /> {t("report.useGps")}
                    </>
                  )}
                </Button>
                {geo.pos && (
                  <span className="type-label text-[10px] text-muted-foreground">
                    GPS ±{Math.round(geo.pos.accuracy ?? 0)} m
                  </span>
                )}
              </div>

              {/* Friendly fallback when GPS is denied / unavailable */}
              {geo.error ? (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-600/40 bg-amber-500/10 px-4 py-3">
                  <Compass className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" />
                  <div>
                    <p className="type-label text-[10px] text-amber-800 dark:text-amber-300">
                      {t("report.gpsFallback")}
                    </p>
                    <p className="mt-0.5 text-sm text-amber-900/80 dark:text-amber-200/70">
                      {geo.error}
                    </p>
                  </div>
                </div>
              ) : (
                !pin && (
                  <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Compass className="size-4 text-primary" />
                    {t("report.manualHint")}
                  </p>
                )
              )}

              <MapPicker
                center={pin ?? DEFAULT_MAP_CENTER}
                pin={pin}
                onPick={(p) => setPin(p)}
                recenterSignal={geo.pos}
                className="h-80 w-full rounded-lg border border-border sm:h-96 xl:h-[30rem]"
                overlay={
                  geo.pos && pin ? (
                    <MapOverlayButton
                      label={t("report.useGps")}
                      onClick={() => setPin({ lat: geo.pos!.lat, lng: geo.pos!.lng })}
                    >
                      {t("report.useGps")}
                    </MapOverlayButton>
 ) : null
                }
              />

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <p>
                  <span className="type-label text-[10px]">{t("report.address")}: </span>
                  {pin
                    ? (address === null
                        ? t("report.addrLoading")
                        : (address ?? `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`))
                    : t("report.locDenied")}
                </p>
                {pin && (
                  <a
                    href={`https://www.google.com/maps?q=${pin.lat},${pin.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="type-label inline-flex items-center gap-1 text-[10px] text-primary underline-offset-2 hover:underline"
                  >
                    {t("report.verifyPin")} <ExternalLink className="size-3" />
                  </a>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                <Button variant="ghost" onClick={() => setStepIdx(1)}>
                  <ArrowLeft className="size-4" /> {t("common.back")}
                </Button>
                <Button onClick={generate} disabled={!pin || generating}>
                  {generating ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> {t("common.thinking")}
                    </>
                  ) : (
                    <>
                      <FileText className="size-4" /> {t("report.continueLoc")}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* ── Step 4: AI report ──────────────────────────────── */}
        {step === "report" && report && pin && (
          <section className="archive-frame paper-card fade-up rounded-lg">
            <div className="archive-frame-inner p-5 sm:p-6">
              <div className="mb-1 flex items-center gap-2">
                <FileText className="size-5 text-primary" />
                <h2 className="font-serif text-xl">{report.title || t("report.finalTitle")}</h2>
              </div>
              <p className="mb-5 text-sm text-muted-foreground">{t("report.finalHint")}</p>

              <dl className="space-y-4 text-sm">
                <div className="rounded border border-border bg-background p-4">
                  <dt className="type-label mb-1 text-[10px] text-muted-foreground">{t("report.summary")}</dt>
                  <dd className="leading-relaxed">{report.summary}</dd>
                </div>
                <div className="rounded border border-border bg-background p-4">
                  <dt className="type-label mb-1 text-[10px] text-muted-foreground">{t("report.observations")}</dt>
                  <dd className="leading-relaxed">{report.observations}</dd>
                </div>
                <div className="rounded border border-border bg-background p-4">
                  <dt className="type-label mb-1 text-[10px] text-muted-foreground">{t("report.action")}</dt>
                  <dd className="leading-relaxed">{report.recommendedAction}</dd>
                </div>
                <div className="rounded border border-border bg-background p-4">
                  <dt className="type-label mb-1 text-[10px] text-muted-foreground">{t("report.risk")}</dt>
                  <dd className="leading-relaxed">{report.riskNote}</dd>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded border border-border bg-background p-3">
                    <dt className="type-label text-[10px] text-muted-foreground">{t("report.issueType")}</dt>
                    <dd className="mt-0.5 font-medium capitalize">
                      {(issueType ?? report.issueType).replace("_", " ")}
                    </dd>
                  </div>
                  <div className="rounded border border-border bg-background p-3">
                    <dt className="type-label text-[10px] text-muted-foreground">{t("report.severity")}</dt>
                    <dd className="mt-0.5 font-medium capitalize">{aiSeverity ?? report.severity}</dd>
                  </div>
                </div>
                <div className="rounded border border-border bg-background p-3">
                  <dt className="type-label text-[10px] text-muted-foreground">{t("report.address")}</dt>
                  <dd className="mt-0.5">{address ?? `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`}</dd>
                </div>
              </dl>

              <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                <Button variant="ghost" onClick={() => setStepIdx(2)}>
                  <ArrowLeft className="size-4" /> {t("common.back")}
                </Button>
                <Button onClick={fileComplaint} disabled={filing}>
                  {filing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> {t("report.filing")}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="size-4" /> {t("report.file")}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* ── Step 5: Filed ──────────────────────────────────── */}
        {step === "filed" && trackingId && (
          <section className="archive-frame paper-card fade-up rounded-lg">
            <div className="archive-frame-inner p-8 text-center">
              <div className="stamp-in stamp-seal mx-auto flex size-24 items-center justify-center text-primary">
                <div className="text-center">
                  <p className="type-label text-[9px]">Filed</p>
                  <CheckCircle2 className="mx-auto size-7" />
                </div>
              </div>
              <h2 className="mt-5 font-serif text-2xl">{t("report.filedTitle")}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("report.filedText")}</p>
              <div className="mx-auto mt-6 w-fit rounded-lg border-2 border-primary/60 bg-background px-8 py-4 shadow-inner">
                <p className="type-label text-[10px] text-muted-foreground">{t("report.trackId")}</p>
                <p className="type-label mt-1 text-2xl font-semibold tracking-widest text-primary">
                  {trackingId}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  void navigator.clipboard.writeText(trackingId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? t("report.copied") : t("report.copyId")}
              </Button>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button onClick={() => navigate("/dashboard")}>{t("report.goDashboard")}</Button>
                <Button variant="outline" onClick={resetWizard}>
                  {t("report.newComplaint")}
                </Button>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
