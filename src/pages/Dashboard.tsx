import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/i18n";
import { LanguageSelector } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Landmark, Plus, MapPin, Camera, FileText, ChevronDown, ChevronRight,
  ScrollText, LogOut, Phone, Clock,
} from "lucide-react";
import { useAuthActions } from "@convex-dev/auth/react";
import { COMPLAINT_STATUSES, type ComplaintStatus } from "@/lib/complaint-meta";

const STATUS_FLOW: ComplaintStatus[] = ["new", "verified", "assigned", "in_progress", "resolved"];

function StatusBadge({ status }: { status: ComplaintStatus }) {
  const { t } = useLanguage();
  const styles: Record<ComplaintStatus, string> = {
    new: "border-chart-1/50 bg-chart-1/10 text-chart-1",
    verified: "border-chart-2/50 bg-chart-2/10 text-chart-2",
    assigned: "border-chart-3/50 bg-chart-3/10 text-chart-3",
    in_progress: "border-chart-4/50 bg-chart-4/10 text-chart-4",
    resolved: "border-chart-5/50 bg-chart-5/10 text-chart-5",
  };
  return (
    <span className={`type-label rounded-full border px-2.5 py-0.5 text-[10px] ${styles[status]}`}>
      {t(`status.${status}`)}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: "low" | "medium" | "high" | "critical" }) {
  const { t } = useLanguage();
  const styles: Record<string, string> = {
    low: "border-chart-3/50 bg-chart-3/10 text-chart-3",
    medium: "border-chart-2/60 bg-chart-2/10 text-chart-2",
    high: "border-chart-4/60 bg-chart-4/10 text-chart-4",
    critical: "border-destructive/60 bg-destructive/10 text-destructive",
  };
  return (
    <span className={`type-label rounded-full border px-2 py-0.5 text-[10px] ${styles[severity]}`}>
      {t(`severity.${severity}`)}
    </span>
  );
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Dashboard() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { signOut } = useAuthActions();
  const complaints = useQuery(api.complaints.listMyComplaints, {});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<ComplaintStatus | "all">("all");

  const visible = useMemo(
    () => (complaints ?? []).filter((c) => filter === "all" || c.status === filter),
    [complaints, filter],
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="page-shell flex items-center justify-between py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-full border-2 border-primary/70 text-primary">
              <Landmark className="size-5" />
            </span>
            <span className="font-serif text-lg">{t("brand.name")}</span>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSelector compact />
            <Button size="sm" variant="ghost" onClick={() => void signOut()}>
              <LogOut className="size-4" /> <span className="hidden sm:inline">{t("nav.signOut")}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="page-shell py-8">
        <div className="fade-up flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="type-label text-[10px] text-muted-foreground">{t("dashboard.record")}</p>
            <h1 className="mt-1 font-serif text-3xl">
              {t("dashboard.welcome")}, {user?.name ?? t("dashboard.citizen")}
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Phone className="size-3.5" /> {user?.phone ?? "—"}
            </p>
          </div>
          <Button asChild className="press shadow-sm">
            <Link to="/report">
              <Plus className="size-4" /> {t("nav.report")}
            </Link>
          </Button>
        </div>

        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-xl">{t("dashboard.myComplaints")}</h2>
            <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-4">
              <button
                onClick={() => setFilter("all")}
                className={`type-label min-w-[7rem] rounded-full border-2 px-6 py-3 text-center text-sm transition-colors ${
                  filter === "all"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-foreground"
                }`}
              >
                {t("common.all")}
              </button>
              {STATUS_FLOW.map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`type-label min-w-[7rem] rounded-full border-2 px-6 py-3 text-center text-sm transition-colors ${
                    filter === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-foreground"
                }`}
                >
                  {t(`status.${s}`)}
                </button>
              ))}
            </div>
          </div>

          {complaints === undefined ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-card" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="archive-frame paper-card rounded-lg border-dashed p-10 text-center">
              <div className="archive-frame-inner">
                <ScrollText className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{t("dashboard.none")}</p>
                <Button className="press mt-4" asChild>
                  <Link to="/report">{t("dashboard.noneCta")}</Link>
                </Button>
              </div>
            </div>
          ) : (
            <ul className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {visible.map((c) => {
                const stage = STATUS_FLOW.indexOf(c.status);
                return (
                  <li key={c._id} className="archive-frame paper-card lift fade-up rounded-lg">
                    <div className="archive-frame-inner">
                      <button
                        className="flex w-full items-start justify-between gap-4 p-4 text-left"
                        onClick={() => setExpanded(expanded === c._id ? null : c._id)}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="type-label text-[10px] text-primary">{c.trackingId}</span>
                            <StatusBadge status={c.status} />
                            <SeverityBadge severity={c.severity} />
                          </div>
                          <h3 className="mt-1.5 truncate font-serif text-base">{c.title}</h3>
                          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                            <MapPin className="size-3.5 shrink-0" />
                            {c.location.address ?? `${c.location.lat.toFixed(4)}, ${c.location.lng.toFixed(4)}`}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="size-3.5 shrink-0" /> {fmtDate(c.createdAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {c.evidence.length > 0 && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Camera className="size-3.5" /> {c.evidence.length}
                            </span>
                          )}
                          {expanded === c._id ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                        </div>
                      </button>

                      {expanded === c._id && (
                        <div className="border-t border-border p-4">
                          {/* Status timeline */}
                          <div className="mb-5 flex flex-wrap items-center gap-1">
                            {STATUS_FLOW.map((s, i) => (
                              <div key={s} className="flex items-center gap-1">
                                <span
                                  className={`flex size-6 items-center justify-center rounded-full border text-[10px] ${
                                    i <= stage
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border text-muted-foreground"
                                  }`}
                                >
                                  {i + 1}
                                </span>
                                <span className={`type-label hidden text-[9px] sm:block ${i <= stage ? "text-foreground" : "text-muted-foreground"}`}>
                                  {t(`status.${s}`)}
                                </span>
                                {i < STATUS_FLOW.length - 1 && <span className={`h-px w-4 sm:w-6 ${i < stage ? "bg-primary" : "bg-border"}`} />}
                              </div>
                            ))}
                          </div>

                          <p className="text-sm leading-relaxed">{c.description}</p>                            {c.aiReport && (
                              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div className="rounded border border-border bg-background p-3 text-xs">
                                <p className="type-label mb-1 text-[9px] text-muted-foreground">{t("report.observations")}</p>
                                <p className="leading-relaxed">{c.aiReport.observations}</p>
                              </div>
                              <div className="rounded border border-border bg-background p-3 text-xs">
                                <p className="type-label mb-1 text-[9px] text-muted-foreground">{t("report.action")}</p>
                                <p className="leading-relaxed">{c.aiReport.recommendedAction}</p>
                              </div>
                            </div>
                          )}                              {c.evidence.length > 0 && (
                                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                              {c.evidence.map((e, i) => (
                                <img
                                  key={i}
                                  src={e.dataUrl}
                                  alt={e.name ?? "evidence"}
                                  className="h-24 w-full rounded border border-border object-cover"
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
