import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useLanguage } from "@/lib/i18n";
import { LanguageSelector } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPicker } from "@/hooks/use-map";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  Landmark, Search, Loader2, MapPin, Camera, Clock, FileText, ArrowLeft,
} from "lucide-react";
import type { ComplaintStatus } from "@/lib/complaint-meta";

// Citizen-facing wording: the department's internal "assigned" stage is what a
// citizen experiences as "Pending" — accepted but the work has not started.
const STAGE_LABEL_KEY: Record<string, string> = {
  new: "track.stage.new",
  verified: "track.stage.verified",
  assigned: "track.stage.assigned",
  in_progress: "track.stage.in_progress",
  resolved: "track.stage.resolved",
};

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Track() {
  const { t } = useLanguage();
  const [trackingId, setTrackingId] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState<{ id: string; phone: string } | null>(null);
  const [searching, setSearching] = useState(false);

  // Only run the query once the user has submitted.
  const result = useQuery(
    api.complaints.trackComplaint,
    submitted ? { trackingId: submitted.id, phone: submitted.phone } : "skip",
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingId.trim() || phone.replace(/\D/g, "").length < 10) return;
    setSearching(true);
    setSubmitted({ id: trackingId.trim().toUpperCase(), phone: phone.trim() });
    setTimeout(() => setSearching(false), 300);
  };

  const stageLabel = (status: string) =>
    t(STAGE_LABEL_KEY[status] ?? `status.${status}`);

  // Oldest → newest. `statusHistory` is appended server-side, so the final
  // entry is always the complaint's current state.
  const history = (
    result
      ? ((result as unknown as {
          statusHistory?: Array<{ status: string; at?: number; actor?: string; note?: string }>;
        }).statusHistory ?? [])
      : []
  )
    .filter((h) => typeof h.status === "string")
    .map((h) => ({ ...h, at: h.at ?? Date.now() }));

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-full border-2 border-primary/70 text-primary">
              <Landmark className="size-5" />
            </span>
            <span className="font-serif text-lg">{t("brand.name")}</span>
          </Link>
          <LanguageSelector compact />
        </div>
      </header>

      <main className="hero-wash mx-auto flex w-full max-w-4xl flex-col items-center px-4 py-10">
        <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {t("nav.home")}
        </Link>

        <h1 className="fade-up font-serif text-3xl">{t("track.title")}</h1>
        <p className="fade-up d1 mt-2 text-sm text-muted-foreground">{t("track.subtitle")}</p>

        <form onSubmit={onSubmit} className="archive-frame paper-card fade-up d2 mt-6 w-full max-w-2xl rounded-lg p-5 lg:p-6">
          <div className="archive-frame-inner space-y-4">
            <div>
              <label htmlFor="tid" className="type-label mb-1.5 block text-[10px] text-muted-foreground">
                {t("track.id")}
              </label>
              <Input
                id="tid"
                value={trackingId}
                onChange={(e) => setTrackingId(e.target.value.toUpperCase())}
                placeholder={t("track.idPlaceholder")}
                className="type-label"
                required
              />
            </div>
            <div>
              <label htmlFor="tphone" className="type-label mb-1.5 block text-[10px] text-muted-foreground">
                {t("track.phone")}
              </label>
              <Input
                id="tphone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("login.phonePlaceholder")}
                required
              />
            </div>
            {result === null && (
              <p className="text-sm text-destructive">{t("track.notFound")}</p>
            )}
            <Button type="submit" className="w-full" disabled={searching}>
              {searching ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {t("track.tracking")}
                </>
              ) : (
                <>
                  <Search className="size-4" /> {t("track.submit")}
                </>
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {t("track.privacyNote")}
            </p>
          </div>
        </form>

        {result && (
          <section className="archive-frame paper-card fade-up mt-6 w-full max-w-3xl rounded-lg p-5 lg:p-6">
            <div className="archive-frame-inner space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="type-label text-xs text-primary">{result.trackingId}</span>
                <span className="type-label rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-[10px] text-primary">
                  {t(`status.${result.status}`)}
                </span>
              </div>
              <h2 className="font-serif text-xl">{result.title}</h2>
              <p className="text-sm leading-relaxed">{result.description}</p>

              {/* ── Action timeline (dynamic) ─────────────────────── */}
              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="type-label text-[10px] text-muted-foreground">
                    {t("track.timeline")}
                  </p>
                  <span className="type-label rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-[10px] text-primary">
                    {stageLabel(result.status)}
                  </span>
                </div>

                <ol className="relative space-y-4 border-l-2 border-border pl-5">
                  {history.map((h, i) => {
                    const isCurrent = i === history.length - 1;
                    return (
                      <li key={i} className="relative">
                        <span
                          className={`absolute -left-[1.5625rem] top-1.5 size-2.5 rounded-full border-2 ${
                            isCurrent
                              ? "border-primary bg-primary"
                              : "border-border bg-card"
                          }`}
                        />
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="font-serif text-sm">{stageLabel(h.status)}</span>
                          <span className="type-label text-[9px] text-muted-foreground">
                            {fmtDate(h.at)}
                          </span>
                          {isCurrent && (
                            <span className="type-label rounded-full border border-primary/50 px-2 py-0.5 text-[9px] text-primary">
                              {t("track.currently")}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {h.actor === "authority"
                            ? t("track.actorAuthority")
                            : t("track.actorCitizen")}
                        </p>
                        {h.note && (
                          <p className="mt-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-xs leading-relaxed">
                            {h.note}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                <p className="flex items-center gap-1.5">
                  <MapPin className="size-3.5" />
                  {result.location.address ?? `${result.location.lat.toFixed(4)}, ${result.location.lng.toFixed(4)}`}
                </p>
                <p className="flex items-center gap-1.5">
                  <Clock className="size-3.5" /> {fmtDate(result.createdAt)}
                </p>
                <p className="flex items-center gap-1.5 capitalize">
                  <FileText className="size-3.5" /> {result.issueType.replace("_", " ")} — {t(`severity.${result.severity}`)}
                </p>
                {result.evidence.length > 0 && (
                  <p className="flex items-center gap-1.5">
                    <Camera className="size-3.5" /> {result.evidence.length} attachment(s)
                  </p>
                )}
              </div>

              {result.evidence.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
                  {result.evidence.map((e, i) => (
                    <img key={i} src={e.dataUrl} alt="" className="h-24 w-full rounded border border-border object-cover" />
                  ))}
                </div>
              )}

              <div className="h-64 overflow-hidden rounded border border-border lg:h-80">
                <MapPicker
                  center={result.location}
                  pin={result.location}
                  interactive={false}
                  className="h-full w-full"
                />
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
