import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation } from "convex/react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useAuthActions } from "@convex-dev/auth/react";
import { useLanguage } from "@/lib/i18n";
import { LanguageSelector } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPicker } from "@/hooks/use-map";
import {
  COMPLAINT_STATUSES,
  SEVERITY_COLORS,
  isDepartment,
  type ComplaintStatus,
} from "@/lib/complaint-meta";
import {
  Landmark, LogOut, ShieldCheck, MapPinned, BarChart3, LayoutList, Loader2,
  MapPin, Camera, Phone, Check, X, MessageSquareQuote, RefreshCw, ExternalLink,
  Clock, ScrollText, ChevronLeft, Sprout, FileSearch, X as XIcon,
} from "lucide-react";

const STATUS_FLOW: ComplaintStatus[] = ["new", "verified", "assigned", "in_progress", "resolved"];

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

type Tab = "queue" | "analytics" | "map";

interface ComplaintDoc {
  _id: string;
  trackingId: string;
  title: string;
  description: string;
  issueType: string;
  severity: "low" | "medium" | "high" | "critical";
  status: ComplaintStatus;
  phone: string;
  language: string;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  evidence: Array<{ kind: string; dataUrl: string; name?: string; aiAnalysis?: string }>;
  location: { lat: number; lng: number; accuracy?: number; address?: string };
  aiReport?: { summary: string; observations: string; recommendedAction: string; riskNote: string };
  aiReviewed?: boolean;
  reviewNote?: string;
  statusHistory: Array<{ status: ComplaintStatus; at: number; actor: string; note?: string }>;
  createdAt: number;
}

export default function Authority() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { signOut } = useAuthActions();

  const complaints = useQuery(api.complaints.listAllComplaints, {});
  const analytics = useQuery(api.complaints.authorityAnalytics, {});
  const reviewAiReport = useMutation(api.complaints.reviewAiReport);
  const updateStatus = useMutation(api.complaints.updateStatus);
  const resetDemo = useMutation(api.complaints.resetDemo);
  const seedDemo = useMutation(api.complaints.seedDemo);

  const [tab, setTab] = useState<Tab>("queue");
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [busy, setBusy] = useState(false);

  const list = (complaints ?? []) as unknown as ComplaintDoc[];
  const selected = list.find((c) => c._id === selectedId) ?? null;

  const filtered = useMemo(
    () => list.filter((c) => statusFilter === "all" || c.status === statusFilter),
    [list, statusFilter],
  );

  // City map framing: centre on the centroid of every complaint and pick a zoom
  // level from the spread, so all pins are visible instead of only the first.
  const mapView = useMemo(() => {
    const fallback = { center: { lat: 12.9716, lng: 77.5946 }, zoom: 12 };
    if (list.length === 0) return fallback;

    const lats = list.map((c) => c.location.lat);
    const lngs = list.map((c) => c.location.lng);
    const center = {
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
      lng: lngs.reduce((a, b) => a + b, 0) / lngs.length,
    };

    const span = Math.max(
      Math.max(...lats) - Math.min(...lats),
      Math.max(...lngs) - Math.min(...lngs),
    );

    const zoom = span > 0.5 ? 10 : span > 0.2 ? 11 : span > 0.05 ? 12 : span > 0.01 ? 13 : 15;
    return { center, zoom };
  }, [list]);

  const doReview = async (id: string, decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await reviewAiReport({ complaintId: id as never, decision, note: reviewNote || undefined });
      toast.success(decision === "approve" ? t("auth.toastApproved") : t("auth.toastRevision"));
      setReviewNote("");
      setSelectedId(null);
      setDetailOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.toastReviewFailed"));
    } finally {
      setBusy(false);
    }
  };

  const doStatus = async (id: string, status: ComplaintStatus) => {
    setBusy(true);
    try {
      const note = statusNote.trim() || undefined;
      await updateStatus({ complaintId: id as never, status, note });
      setStatusNote("");
      toast.success(`${t("auth.toastStatus")} ${t(`status.${status}`)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.toastUpdateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    if (!window.confirm(t("auth.toastResetConfirm"))) return;
    setBusy(true);
    try {
      await resetDemo({});
      toast.success(t("auth.toastResetDone"));
      setSelectedId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.toastResetFailed"));
    } finally {
      setBusy(false);
    }
  };

  const doSeed = async () => {
    setBusy(true);
    try {
      const res = await seedDemo({});
      if (res.ok) toast.success(`${t("auth.seedDemo")}: ${res.created}`);
      else toast.info(res.reason ?? "—");
      setSelectedId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.toastSeedFailed"));
    } finally {
      setBusy(false);
    }
  };

  // ── Guards ────────────────────────────────────────────────────
  if (user && user.role !== "admin") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="archive-frame max-w-md rounded-lg border border-border bg-card p-8 text-center">
          <div className="archive-frame-inner">
            <ShieldCheck className="mx-auto size-8 text-destructive" />
            <h1 className="mt-3 font-serif text-xl">{t("auth.guardTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("auth.guardText")}</p>
            <Button className="mt-5" asChild>
              <Link to="/dashboard">{t("auth.guardCta")}</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="page-shell flex items-center justify-between py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-full border-2 border-primary/70 text-primary">
              <ShieldCheck className="size-5" />
            </span>
            <span>
              <span className="block font-serif text-lg leading-tight">{t("auth.dashboard")}</span>
              <span className="type-label block text-[10px] text-muted-foreground">
                {user?.name ?? "Authority"} ·{" "}
                {isDepartment(user?.department)
                  ? t(`dept.${user.department}.title`)
                  : t("brand.name")}
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSelector compact />
            <Button size="sm" variant="ghost" onClick={doSeed} disabled={busy} title={t("auth.seedDemo")}>
              <Sprout className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={doReset} disabled={busy} title={t("auth.resetDemo")}>
              <RefreshCw className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void signOut()}>
              <LogOut className="size-4" /> <span className="hidden sm:inline">{t("nav.signOut")}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="page-shell py-6">
        {/* Tabs */}
        <div className="mb-6 flex flex-wrap items-center gap-2.5 sm:gap-3">
          {([
            ["queue", LayoutList, t("auth.tabQueue")],
            ["analytics", BarChart3, t("auth.tabAnalytics")],
            ["map", MapPinned, t("auth.tabMap")],
          ] as const).map(([key, Icon, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`type-label flex min-w-[11rem] items-center justify-center gap-2 rounded-lg border px-5 py-3 text-center text-sm leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                tab === key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-foreground"
              }`}
            >
              <Icon className="size-[18px] shrink-0" /> {label}
            </button>
          ))}
        </div>

        {/* ── QUEUE ─────────────────────────────────────────────── */}
        {tab === "queue" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-5">
              <button
                onClick={() => setStatusFilter("all")}
                className={`type-label min-w-[9.5rem] rounded-full border-2 px-8 py-4 text-center text-base leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  statusFilter === "all"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-foreground"
                }`}
              >
                {t("auth.filterAll")}
              </button>
              {STATUS_FLOW.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`type-label min-w-[9.5rem] rounded-full border-2 px-8 py-4 text-center text-base leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    statusFilter === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {t(`status.${s}`)}
                </button>
              ))}
            </div>

            {complaints === undefined ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-card" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="archive-frame paper-card rounded-lg border-dashed p-10 text-center">
                <div className="archive-frame-inner">
                  <ScrollText className="mx-auto size-8 text-muted-foreground" />
                  <p className="mt-3 text-sm text-muted-foreground">{t("auth.emptyQueue")}</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filtered.map((c) => (
                  <div key={c._id}>
                    <button
                      onClick={() => {
                        setSelectedId(c._id);
                        setDetailOpen(true);
                      }}
                      className="archive-frame paper-card lift fade-up flex h-full w-full flex-col rounded-lg text-left transition-all hover:bg-accent"
                    >
                      <div className="archive-frame-inner flex h-full flex-col p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="type-label text-[10px] text-primary">{c.trackingId}</span>
                          <span className="type-label rounded-full border border-border px-2 py-0.5 text-[9px] text-muted-foreground">
                            {t(`status.${c.status}`)}
                          </span>
                        </div>

                        <p className="mt-1.5 line-clamp-2 font-serif text-base leading-snug">{c.title}</p>

                        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="size-3 shrink-0" />
                          <span className="truncate">
                            {c.location.address ?? `${c.location.lat.toFixed(3)}, ${c.location.lng.toFixed(3)}`}
                          </span>
                        </p>

                        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-[10px] text-muted-foreground">
                          <span className="capitalize">{c.issueType.replace("_", " ")}</span>
                          <span
                            className="rounded px-1.5 py-0.5 text-[9px] uppercase"
                            style={{
                              background: `${SEVERITY_COLORS[c.severity]}22`,
                              color: SEVERITY_COLORS[c.severity],
                            }}
                          >
                            {c.severity}
                          </span>
                          {c.evidence.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Camera className="size-3" /> {c.evidence.length}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" /> {fmtDate(c.createdAt)}
                          </span>
                          {!c.aiReviewed && (
                            <span className="type-label text-[9px] text-primary">{t("auth.aiPending")}</span>
                          )}
                          <span className="type-label ml-auto inline-flex items-center gap-1 text-[9px] text-primary">
                            {t("auth.viewDetails")} <FileSearch className="size-3" />
                          </span>
                        </div>
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Complaint detail modal ───────────────────────── */}
            {detailOpen && selected && (
              <div
                className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm sm:p-6"
                role="dialog"
                aria-modal="true"
                aria-label={selected.title}
                onClick={() => setDetailOpen(false)}
              >
                <section
                  className="archive-frame paper-card fade-up my-4 w-full max-w-4xl rounded-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="archive-frame-inner p-5 lg:p-6">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <button
                          onClick={() => setDetailOpen(false)}
                          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                        >
                          <ChevronLeft className="size-4" /> {t("auth.backToQueue")}
                        </button>
                        <button
                          onClick={() => setDetailOpen(false)}
                          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                          aria-label={t("auth.closeDetail")}
                        >
                          <XIcon className="size-4" /> {t("auth.closeDetail")}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="type-label text-[10px] text-primary">{selected.trackingId}</p>
                          <h2 className="mt-0.5 font-serif text-xl">{selected.title}</h2>
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="size-3.5" /> {fmtDate(selected.createdAt)} ·{" "}
                            <Phone className="size-3.5" /> {selected.phone}
                          </p>
                        </div>
                        <span className="type-label rounded-full border border-border px-3 py-1 text-[10px]">
                          {t(`status.${selected.status}`)}
                        </span>
                      </div>

                      {/* AI review panel */}
                      <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
                        <p className="type-label mb-2 flex items-center gap-2 text-[10px] text-primary">
                          <MessageSquareQuote className="size-4" /> {t("auth.reviewTitle")}
                          {selected.aiReviewed && (
                            <span className="rounded-full border border-primary/50 px-2 py-0.5 text-[9px]">approved</span>
                          )}
                        </p>
                        {selected.aiReport && (
                          <dl className="space-y-2.5 text-sm">
                            <div>
                              <dt className="type-label text-[9px] text-muted-foreground">{t("report.summary")}</dt>
                              <dd className="leading-relaxed">{selected.aiReport.summary}</dd>
                            </div>
                            <div>
                              <dt className="type-label text-[9px] text-muted-foreground">{t("report.observations")}</dt>
                              <dd className="leading-relaxed">{selected.aiReport.observations}</dd>
                            </div>
                            <div>
                              <dt className="type-label text-[9px] text-muted-foreground">{t("report.action")}</dt>
                              <dd className="leading-relaxed">{selected.aiReport.recommendedAction}</dd>
                            </div>
                            <div>
                              <dt className="type-label text-[9px] text-muted-foreground">{t("report.risk")}</dt>
                              <dd className="leading-relaxed">{selected.aiReport.riskNote}</dd>
                            </div>
                          </dl>
                        )}

                        {!selected.aiReviewed && (
                          <div className="mt-4 space-y-2.5 border-t border-primary/20 pt-3">
                            <Input
                              value={reviewNote}
                              onChange={(e) => setReviewNote(e.target.value)}
                              placeholder={t("auth.notePlaceholder")}
                              className="text-sm"
                            />
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => doReview(selected._id, "approve")} disabled={busy}>
                                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                                {t("auth.approve")}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => doReview(selected._id, "reject")} disabled={busy}>
                                <X className="size-4" /> {t("auth.reject")}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* status workflow */}
                      <div className="mt-4">
                        <p className="type-label mb-2 text-[10px] text-muted-foreground">{t("auth.moveStatus")}</p>
                        <Input
                          value={statusNote}
                          onChange={(e) => setStatusNote(e.target.value)}
                          placeholder={t("auth.statusNotePlaceholder")}
                          className="mb-2 text-sm"
                        />
                        <div className="flex flex-wrap items-center gap-1">
                          {STATUS_FLOW.map((s, i) => {
                            const current = STATUS_FLOW.indexOf(selected.status);
                            return (
                              <div key={s} className="flex items-center gap-1">
                                <button
                                  onClick={() => doStatus(selected._id, s)}
                                  disabled={busy}
                                  className={`type-label rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
                                    s === selected.status
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border text-muted-foreground hover:bg-accent"
                                  }`}
                                >
                                  {i + 1}. {t(`status.${s}`)}
                                </button>
                                {i < STATUS_FLOW.length - 1 && <span className="h-px w-3 bg-border" />}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* evidence */}
                      {selected.evidence.length > 0 && (
                        <div className="mt-4">
                          <p className="type-label mb-2 text-[10px] text-muted-foreground">{t("auth.evidence")}</p>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {selected.evidence.map((e, i) => (
                              <figure key={i} className="overflow-hidden rounded border border-border">
                                <img src={e.dataUrl} alt={e.name ?? ""} className="h-28 w-full object-cover" />
                                {e.aiAnalysis && (
                                  <figcaption className="px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                                    {e.aiAnalysis}
                                  </figcaption>
                                )}
                              </figure>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* transcript */}
                      {selected.transcript.length > 0 && (
                        <details className="mt-4 rounded border border-border bg-background">
                          <summary className="type-label cursor-pointer px-3 py-2 text-[10px] text-muted-foreground">
                            {t("auth.transcript")}
                          </summary>
                          <div className="max-h-56 space-y-2 overflow-y-auto px-3 pb-3">
                            {selected.transcript.map((m, i) => (
                              <p key={i} className="text-xs leading-relaxed">
                                <span className="type-label mr-1.5 text-[9px] text-primary">
                                  {m.role === "user" ? t("auth.speakerCitizen") : t("auth.speakerAgent")}
                                </span>
                                {m.content}
                              </p>
                            ))}
                          </div>
                        </details>
                      )}

                      {/* map */}
                      <div className="mt-4">
                        <p className="type-label mb-2 text-[10px] text-muted-foreground">{t("report.locTitle")}</p>
                        <div className="h-56 overflow-hidden rounded border border-border">
                          <MapPicker
                            center={selected.location}
                            pin={selected.location}
                            interactive={false}
                            className="h-full w-full"
                          />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="size-3.5" />
                            {selected.location.address ?? `${selected.location.lat.toFixed(5)}, ${selected.location.lng.toFixed(5)}`}
                          </p>
                          <a
                            href={`https://www.google.com/maps?q=${selected.location.lat},${selected.location.lng}`}
                            target="_blank"
                            rel="noreferrer"
                            className="type-label inline-flex items-center gap-1 text-[10px] text-primary underline-offset-2 hover:underline"
                          >
                            {t("report.verifyPin")} <ExternalLink className="size-3" />
                          </a>
                        </div>
                      </div>

                      {/* history */}
                      {selected.statusHistory.length > 1 && (
                        <details className="mt-4 rounded border border-border bg-background">
                          <summary className="type-label cursor-pointer px-3 py-2 text-[10px] text-muted-foreground">
                            {t("auth.statusHistory")}
                          </summary>
                          <ul className="space-y-1.5 px-3 pb-3 text-xs text-muted-foreground">
                            {selected.statusHistory.map((h, i) => (
                              <li key={i}>
                                <span className="type-label text-[9px] text-foreground">{t(`status.${h.status}`)}</span>{" "}
                                — {fmtDate(h.at)} ({h.actor}){h.note ? ` · ${h.note}` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                  </div>
                </section>
              </div>
            )}
          </div>
        )}

        {/* ── ANALYTICS ─────────────────────────────────────────── */}
        {tab === "analytics" && analytics && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {[
                { label: t("auth.stats.total"), value: analytics.total },
                { label: t("auth.stats.week"), value: analytics.last7Days },
                { label: t("auth.stats.open"), value: analytics.total - (analytics.byStatus.resolved ?? 0) },
                { label: t("auth.stats.resolved"), value: analytics.byStatus.resolved ?? 0 },
                { label: t("auth.stats.avgDays"), value: analytics.avgResolutionDays.toFixed(1) },
              ].map((s, i) => (
                <div key={s.label} className={`archive-frame paper-card lift fade-up d${i + 1} rounded-lg p-4`}>
                  <div className="archive-frame-inner">
                    <p className="type-label text-[9px] text-muted-foreground">{s.label}</p>
                    <p className="mt-1 font-serif text-3xl">{s.value}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="paper-card rounded-lg p-4">
              <p className="type-label mb-3 text-[10px] text-muted-foreground">{t("auth.trend")}</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { weekday: "short" })}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={24} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" fill="var(--chart-1)" radius={[3, 3, 0, 0]} name="Complaints" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
              {[
                { title: t("auth.byType"), data: analytics.byType },
                { title: t("auth.bySeverity"), data: analytics.bySeverity },
                { title: t("auth.byStatus"), data: analytics.byStatus },
                { title: t("auth.byLocation"), data: analytics.byLocation },
              ].map(({ title, data }) => {
                const rows = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 8);
                const max = Math.max(1, ...rows.map(([, v]) => v));
                return (
                  <div key={title} className="paper-card rounded-lg p-4">
                    <p className="type-label mb-3 text-[10px] text-muted-foreground">{title}</p>
                    {rows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("auth.noData")}</p>
                    ) : (
                      <ul className="space-y-2">
                        {rows.map(([k, v]) => (
                          <li key={k} className="flex items-center gap-2 text-xs">
                            <span className="w-28 shrink-0 truncate capitalize sm:w-36">{k.replace("_", " ")}</span>
                            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <span
                                className="block h-full rounded-full bg-primary"
                                style={{ width: `${(v / max) * 100}%` }}
                              />
                            </span>
                            <span className="type-label w-6 text-right text-[10px]">{v}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── CITY MAP ──────────────────────────────────────────── */}
        {tab === "map" && (
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-lg border border-border">
              <MapPicker
                center={mapView.center}
                pin={null}
                pins={list.map((c) => ({
                  lat: c.location.lat,
                  lng: c.location.lng,
                  color: SEVERITY_COLORS[c.severity],
                  label: `${c.trackingId} — ${c.title}`,
                }))}
                interactive
                zoom={mapView.zoom}
                className="h-[70vh] w-full"
              />
            </div>
            <div className="paper-card rounded-lg p-4">
              <p className="type-label mb-3 text-[10px] text-muted-foreground">{t("auth.mapList")}</p>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                {list.slice(0, 12).map((c) => (
                  <li key={c._id} className="flex items-center gap-2 rounded border border-border bg-background p-2.5 text-xs">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: SEVERITY_COLORS[c.severity] }}
                    />
                    <span className="type-label text-[9px] text-primary">{c.trackingId}</span>
                    <span className="truncate">{c.location.address ?? `${c.location.lat.toFixed(3)}, ${c.location.lng.toFixed(3)}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
