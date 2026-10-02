import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useLanguage } from "@/lib/i18n";
import { LanguageSelector } from "@/lib/i18n";
import {
  DEPARTMENTS,
  isDepartment,
  type Department,
} from "@/lib/complaint-meta";
import {
  Landmark, ShieldCheck, Loader2, ArrowRight, KeyRound, Lock, ChevronLeft,
  HeartPulse, Droplets, Construction, Waves, IndianRupee, Lightbulb,
  type LucideIcon,
} from "lucide-react";

const ACTIVATION_CODE = "MUNI-2026";

const DEPT_ICONS: Record<Department, LucideIcon> = {
  public_health: HeartPulse,
  water_supply: Droplets,
  roads: Construction,
  drainage: Waves,
  revenue: IndianRupee,
  street_lighting: Lightbulb,
};

function LoginHeader() {
  const { t } = useLanguage();
  return (
    <header className="border-b border-border">
      <div className="page-shell flex items-center justify-between py-3">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full border-2 border-primary/70 text-primary">
            <Landmark className="size-5" />
          </span>
          <span className="font-serif text-lg">{t("brand.name")}</span>
        </Link>
        <LanguageSelector compact />
      </div>
    </header>
  );
}

export default function AuthorityLogin() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const params = useParams<{ department?: string }>();
  const { isAuthenticated, isLoading: authIsLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const activateAuthority = useMutation(api.authority.activateAuthority);
  const setDepartment = useMutation(api.authority.setDepartment);

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the visitor starts signing in, we drive navigation manually so the
  // redirect effect can't fire before the department is activated.
  const interacted = useRef(false);

  const requestOtp = useMutation(api.phoneOtp.requestPhoneOtp);

  const rawDept = params.department;
  const dept: Department | null = isDepartment(rawDept) ? rawDept : null;

  // All hooks must run before any early return (chooser vs. login view).
  const authedRef = useRef(isAuthenticated);
  useEffect(() => {
    authedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    if (authIsLoading || !isAuthenticated || dept === null || interacted.current) return;
    // Already signed in: switch this authority to the chosen department.
    setDepartment({ department: dept })
      .catch(() => {})
      .finally(() => navigate("/authority", { replace: true }));
  }, [authIsLoading, isAuthenticated, dept, setDepartment, navigate]);

  // ── Department chooser (/authority-login) ─────────────────────
  if (rawDept === undefined) {
    return (
      <div className="flex min-h-screen flex-col">
        <LoginHeader />
        <main className="hero-wash page-shell flex flex-1 items-center justify-center py-10">
          <div className="w-full">
            <div className="fade-up mb-8 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full border border-primary/50 bg-card text-primary">
                <ShieldCheck className="size-6" />
              </span>
              <h1 className="mt-4 font-serif text-3xl">{t("auth.dept.title")}</h1>
              <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
                {t("auth.dept.subtitle")}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:gap-4">
              {DEPARTMENTS.map((d, i) => {
                const Icon = DEPT_ICONS[d];
                return (
                  <Link
                    key={d}
                    to={`/authority-login/${d}`}
                    className={`archive-frame paper-card lift fade-up d${(i % 4) + 1} group rounded-lg p-5`}
                  >
                    <div className="archive-frame-inner">
                      <span className="flex size-10 items-center justify-center rounded-full border border-primary/40 bg-primary/5 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="size-5" />
                      </span>
                      <h2 className="mt-3 font-serif text-lg leading-snug">
                        {t(`dept.${d}.title`)}
                      </h2>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t(`dept.${d}.desc`)}
                      </p>
                      <span className="type-label mt-3 inline-flex items-center gap-1 text-[10px] text-primary">
                        {t("auth.dept.open")} <ArrowRight className="size-3" />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              {t("login.orCitizen")}{" "}
              <Link to="/auth" className="font-medium text-primary hover:underline">
                {t("nav.userLogin")}
              </Link>
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Unknown department slug → back to the chooser.
  if (dept === null) return <Navigate to="/authority-login" replace />;

  const DeptIcon = DEPT_ICONS[dept];

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    interacted.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const res = await requestOtp({ phone });
      setDevCode(res.devCode);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    interacted.current = true;
    setIsLoading(true);
    setError(null);
    try {
      await signIn("phone-otp", {
        phone,
        code: otp,
        name: "Municipal Authority",
        role: "authority",
      });

      // The Convex client only picks up the new session a moment after
      // signIn() resolves. Wait for it, or activateAuthority races ahead
      // and sees a signed-out user.
      const deadline = Date.now() + 5000;
      while (!authedRef.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }

      // Small retry in case the session is still settling.
      let activationError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await activateAuthority({ code: activationCode, department: dept });
          activationError = null;
          break;
        } catch (err) {
          activationError = err;
          const msg = err instanceof Error ? err.message : "";
          if (msg.includes("official mobile number") && attempt < 2) {
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
            continue;
          }
          break;
        }
      }
      if (activationError !== null) {
        setError(
          activationError instanceof Error
            ? activationError.message
            : "Activation failed — please check the code.",
        );
        setIsLoading(false);
        return;
      }
      navigate("/authority", { replace: true });
    } catch {
      setError("Incorrect or expired code. Please request a new one.");
      setOtp("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <LoginHeader />

      <main className="hero-wash page-shell flex flex-1 items-center justify-center py-10">
        <div className="archive-frame paper-card fade-up w-full max-w-lg rounded-lg p-8 lg:p-10">
          <div className="archive-frame-inner">
            <div className="gold-rule mb-5 flex items-center justify-between">
              <span className="flex size-11 items-center justify-center rounded-full border border-primary/50 bg-card text-primary">
                <DeptIcon className="size-5" />
              </span>
              <Link
                to="/authority-login"
                className="type-label inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="size-3" /> {t("auth.dept.change")}
              </Link>
            </div>

            <div className="mb-6">
              <p className="type-label text-[10px] text-primary">{t(`dept.${dept}.title`)}</p>
              <h1 className="mt-1 font-serif text-2xl">{t("login.authority.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("login.authority.subtitle")}
              </p>
            </div>

            {step === "phone" && (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label htmlFor="aphone" className="type-label mb-1.5 block text-[10px] text-muted-foreground">
                    {t("login.phone")}
                  </label>
                  <Input
                    id="aphone"
                    type="tel"
                    required
                    placeholder={t("login.phonePlaceholder")}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
                <div>
                  <label htmlFor="acode" className="type-label mb-1.5 block text-[10px] text-muted-foreground">
                    {t("login.activation")}
                  </label>
                  <Input
                    id="acode"
                    value={activationCode}
                    onChange={(e) => setActivationCode(e.target.value.toUpperCase())}
                    placeholder={t("login.activationPlaceholder")}
                    className="type-label"
                  />
                  <p className="type-label mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Lock className="size-3 text-primary" />
                    {t("login.activationHint")} <span className="text-primary">MUNI-2026</span>
                  </p>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading || phone.replace(/\D/g, "").length < 10}>
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  {t("login.sendOtp")}
                </Button>
              </form>
            )}

            {step === "code" && (
              <form onSubmit={handleSignIn} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("login.otpSent")} <span className="font-medium text-foreground">{phone}</span>
                </p>
                <Input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("login.otpPlaceholder")}
                  className="type-label text-center text-lg tracking-[0.4em]"
                  inputMode="numeric"
                  maxLength={6}
                />
                {devCode && (
                  <div className="rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 px-4 py-3 text-center">
                    <p className="type-label text-[10px] text-muted-foreground">{t("login.devCode")}</p>
                    <p className="type-label mt-1 text-2xl font-semibold tracking-[0.3em] text-primary">{devCode}</p>
                  </div>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading || otp.length !== 6 || activationCode !== ACTIVATION_CODE}>
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                  {t("login.authorityCta")}
                </Button>
                {activationCode !== ACTIVATION_CODE && activationCode.length > 0 && (
                  <p className="type-label text-center text-[10px] text-muted-foreground">
                    {t("login.activationNeeded")}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setStep("phone")}
                  className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                >
                  {t("login.changeNumber")}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
