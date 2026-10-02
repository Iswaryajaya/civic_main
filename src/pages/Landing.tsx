import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage, LanguageSelector } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { MapPicker } from "@/hooks/use-map";
import {
  Mic,
  Camera,
  MapPin,
  FileCheck2,
  Languages,
  Eye,
  ShieldCheck,
  Route,
  Landmark,
  ScrollText,
  ArrowRight,
  Phone,
  Radio,
  Sparkles,
  MessageSquareText,
  BadgeCheck,
} from "lucide-react";

function Divider() {
  return (
    <div className="gold-rule py-2" aria-hidden>
      <Landmark className="size-4" />
    </div>
  );
}

const HERO_TRUST = [
  { icon: Languages, key: "hero.trust1" },
  { icon: Camera, key: "hero.trust2" },
  { icon: Radio, key: "hero.trust3" },
] as const;

const HOW_STEPS = [
  { icon: Mic, title: "how.step1.title", text: "how.step1.text" },
  { icon: Camera, title: "how.step2.title", text: "how.step2.text" },
  { icon: MapPin, title: "how.step3.title", text: "how.step3.text" },
  { icon: FileCheck2, title: "how.step4.title", text: "how.step4.text" },
] as const;

const FEATURES = [
  { icon: Languages, title: "features.f1.title", text: "features.f1.text" },
  { icon: Eye, title: "features.f2.title", text: "features.f2.text" },
  { icon: MapPin, title: "features.f3.title", text: "features.f3.text" },
  { icon: FileCheck2, title: "features.f4.title", text: "features.f4.text" },
  { icon: ShieldCheck, title: "features.f5.title", text: "features.f5.text" },
  { icon: ScrollText, title: "features.f6.title", text: "features.f6.text" },
] as const;

const JOURNEY: ReadonlyArray<{
  id: string;
  at?: string;
  atKey?: string;
  labelKey: string;
}> = [
  { id: "new", at: "09:12", labelKey: "journey.1" },
  { id: "verified", at: "09:14", labelKey: "journey.2" },
  { id: "assigned", at: "11:30", labelKey: "journey.3" },
  { id: "in_progress", at: "14:05", labelKey: "journey.4" },
  { id: "resolved", atKey: "journey.day2", labelKey: "journey.5" },
];

export default function Landing() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, user } = useAuth();

  return (
    <div className="min-h-screen">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="page-shell flex items-center justify-between gap-3 py-3">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-full border-2 border-primary/70 text-primary transition-transform group-hover:-rotate-6">
              <Landmark className="size-5" />
            </span>
            <span>
              <span className="block font-serif text-lg leading-tight">{t("brand.name")}</span>
              <span className="type-label block text-[10px] text-muted-foreground">
                {t("brand.tagline")}
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-5 text-sm md:flex">
            <a href="#how" className="text-muted-foreground transition-colors hover:text-foreground">
              {t("nav.how")}
            </a>
            <a href="#features" className="text-muted-foreground transition-colors hover:text-foreground">
              {t("nav.features")}
            </a>
            <Link to="/track" className="text-muted-foreground transition-colors hover:text-foreground">
              {t("nav.track")}
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <LanguageSelector compact />
            {isLoading ? null : isAuthenticated ? (
              <Button size="sm" onClick={() => navigate(user?.role === "admin" ? "/authority" : "/dashboard")}>
                {t("nav.dashboard")}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" asChild className="hidden sm:inline-flex">
                  <Link to="/authority-login">{t("nav.authorityLogin")}</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/auth">{t("nav.userLogin")}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="hero-wash relative overflow-hidden border-b border-border">
        <div className="page-shell grid gap-12 py-16 md:grid-cols-[1.15fr_1fr] md:py-24">
          <div className="fade-up">
            <span className="type-label inline-flex items-center gap-2 rounded-full border border-primary/40 bg-card px-3 py-1 text-[11px] text-primary shadow-sm">
              <Sparkles className="size-3.5" /> {t("hero.badge")}
            </span>
            <h1 className="mt-5 font-serif text-4xl leading-[1.12] sm:text-5xl">
              {t("hero.title")}
              <span className="mt-2 block">
                <span className="wave-underline inline-block">{t("brand.tagline")}</span>
              </span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
              {t("hero.subtitle")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild className="press shadow-md">
                <Link to="/report">
                  <Mic className="size-4" /> {t("hero.cta1")}
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="press">
                <Link to="/track">
                  <Route className="size-4" /> {t("hero.cta2")}
                </Link>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {HERO_TRUST.map(({ icon: Icon, key }) => (
                <span key={key} className="flex items-center gap-2">
                  <Icon className="size-4 text-primary" /> {t(key)}
                </span>
              ))}
            </div>
          </div>

          {/* Floating archival document */}
          <div className="fade-up d2 float-slow relative">
            <div className="archive-frame paper-card relative rounded-lg p-6">
              <div className="archive-frame-inner">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="type-label text-[10px] text-muted-foreground">{t("doc.office")}</p>
                    <p className="font-serif text-xl">{t("doc.title")}</p>
                  </div>
                  <div className="stamp-in stamp-seal flex size-20 flex-col items-center justify-center border-destructive/70 p-2 text-center text-[8px] leading-tight text-destructive">
                    <span>{t("doc.verified")}</span>
                    <span className="type-label text-[7px]">{t("doc.byAgent")}</span>
                  </div>
                </div>
                <Divider />
                <dl className="space-y-2.5 text-sm">
                  {[
                    [t("doc.no"), "CGA-2026-8F3K2Q", true],
                    [t("doc.nature"), t("doc.natureValue"), false],
                    [t("doc.evidence"), t("doc.evidenceValue"), false],
                    [t("doc.locality"), "12.97° N, 77.59° E", false],
                  ].map(([label, value, mono]) => (
                    <div key={label as string} className="ledger-row">
                      <dt className="type-label shrink-0 text-[10px] text-muted-foreground">{label}</dt>
                      <span className="leaders" />
                      <dd className={mono ? "type-label text-xs text-primary" : "text-right"}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-5 h-36 overflow-hidden rounded border border-border shadow-inner">
                  <MapPicker
                    center={{ lat: 12.9716, lng: 77.5946 }}
                    pin={{ lat: 12.9716, lng: 77.5946 }}
                    interactive={false}
                    className="h-full w-full"
                  />
                </div>
                <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Phone className="size-3.5" /> {t("doc.voiceNote")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Live journey strip ─────────────────────────────────── */}
      <section className="border-b border-border bg-card/60">
        <div className="page-shell py-6">
          <div className="flex items-center gap-3 overflow-x-auto pb-1">
            {JOURNEY.map((j, i) => (
              <div key={j.id} className="flex shrink-0 items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                    {i + 1}
                  </span>
                  <div className="leading-tight">
                    <p className="type-label text-[9px] text-muted-foreground">
                      {j.atKey ? t(j.atKey) : j.at}
                    </p>
                    <p className="text-xs font-medium">{t(j.labelKey)}</p>
                  </div>
                </div>
                {i < JOURNEY.length - 1 && <span className="h-px w-8 bg-primary/40 sm:w-14" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────── */}
      <section id="how" className="band border-b border-border py-16">
        <div className="page-shell">
          <div className="fade-up">
            <p className="type-label text-center text-[10px] text-muted-foreground">{t("how.kicker")}</p>
            <h2 className="mt-1 text-center font-serif text-3xl">{t("how.title")}</h2>
            <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-muted-foreground">
              {t("how.subtitle")}
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:gap-5">
            {HOW_STEPS.map((s, i) => (
              <div
                key={s.title}
                className={`archive-frame paper-card lift fade-up d${i + 1} rounded-lg p-5`}
              >
                <div className="archive-frame-inner">
                  <div className="flex items-center justify-between">
                    <span className="type-label text-[10px] text-muted-foreground">
                      {t("how.stepLabel")} {i + 1}
                    </span>
                    <s.icon className="size-6 text-primary" />
                  </div>
                  <h3 className="mt-3 font-serif text-lg">{t(s.title)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(s.text)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────── */}
      <section id="features" className="border-b border-border py-16">
        <div className="page-shell">
          <p className="type-label text-center text-[10px] text-muted-foreground">{t("features.kicker")}</p>
          <h2 className="mt-1 text-center font-serif text-3xl">{t("features.title")}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-muted-foreground">
            {t("features.subtitle")}
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="paper-card lift group rounded-lg p-5 transition-colors hover:bg-accent/40"
              >
                <span className="flex size-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary transition-transform group-hover:-rotate-6">
                  <f.icon className="size-5" />
                </span>
                <h3 className="mt-3 font-serif text-lg">{t(f.title)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(f.text)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────── */}
      <section className="hero-wash border-t border-border py-20">
        <div className="page-shell text-center">
          <div className="gold-rule">
            <MessageSquareText className="size-5" />
          </div>
          <h2 className="mt-6 font-serif text-3xl">{t("cta.title")}</h2>
          <p className="mt-3 text-sm text-muted-foreground">{t("cta.text")}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild className="press shadow-md">
              <Link to="/report">
                {t("hero.cta1")} <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="press">
              <Link to="/track">{t("nav.track")}</Link>
            </Button>
          </div>
          <p className="type-label mt-10 inline-flex items-center gap-2 text-[10px] text-muted-foreground">
            <BadgeCheck className="size-3.5 text-primary" /> {t("footer.note")}
          </p>
        </div>
      </section>
    </div>
  );
}
