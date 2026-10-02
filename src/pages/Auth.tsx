import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useLanguage } from "@/lib/i18n";
import { LanguageSelector } from "@/lib/i18n";
import { Landmark, Loader2, Phone, ShieldCheck, ArrowRight, ArrowLeft, ScrollText } from "lucide-react";

interface AuthProps {
  redirectAfterAuth?: string;
  mode?: "citizen" | "authority";
}

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

export default function AuthPage({ redirectAfterAuth = "/dashboard", mode = "citizen" }: AuthProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(searchParams.get("returnTo"), redirectAfterAuth);
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { signIn } = useAuthActions();

  const requestOtp = useMutation(api.phoneOtp.requestPhoneOtp);

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthority = mode === "authority";

  useEffect(() => {
    if (!authLoading && isAuthenticated) navigate(redirect, { replace: true });
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const res = await requestOtp({ phone });
      setDevCode(res.devCode);
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await signIn("phone-otp", {
        phone,
        code: otp,
        ...(name ? { name } : {}),
        role: isAuthority ? "authority" : "citizen",
      });
      navigate(isAuthority ? "/authority" : redirect, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Incorrect or expired code. Please request a new one.",
      );
      setOtp("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
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

      <main className="hero-wash page-shell flex flex-1 items-center justify-center py-10">
        <div className="archive-frame paper-card fade-up w-full max-w-lg rounded-lg p-8 lg:p-10">
          <div className="archive-frame-inner">
            <div className="gold-rule mb-6">
              <span className="flex size-11 items-center justify-center rounded-full border border-primary/50 bg-card text-primary">
                {isAuthority ? <ShieldCheck className="size-5" /> : <Phone className="size-5" />}
              </span>
            </div>
            <div className="mb-6">
              <h1 className="font-serif text-2xl">
                {isAuthority ? t("login.authority.title") : t("login.citizen.title")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {isAuthority ? t("login.authority.subtitle") : t("login.citizen.subtitle")}
              </p>
            </div>

            {step === "phone" && (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label htmlFor="phone" className="type-label mb-1.5 block text-[10px] text-muted-foreground">
                    {t("login.phone")}
                  </label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    required
                    placeholder={t("login.phonePlaceholder")}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
                {!isAuthority && (
                  <div>
                    <label htmlFor="name" className="type-label mb-1.5 block text-[10px] text-muted-foreground">
                      {t("login.nameOptional")}
                    </label>
                    <Input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading || phone.replace(/\D/g, "").length < 10}>
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t("login.sendOtp")}
                </Button>
              </form>
            )}

            {step === "otp" && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("login.otpSent")} <span className="font-medium text-foreground">{phone}</span>
                </p>
                <div className="flex justify-center py-2">
                  <InputOTP maxLength={6} value={otp} onChange={setOtp} disabled={isLoading}>
                    <InputOTPGroup>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                {devCode && (
                  <div className="rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 px-4 py-3 text-center">
                    <p className="type-label flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
                      <ScrollText className="size-3.5" /> {t("login.devCode")}
                    </p>
                    <p className="type-label mt-1 text-2xl font-semibold tracking-[0.3em] text-primary">{devCode}</p>
                  </div>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading || otp.length !== 6}>
                  {isLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                  {t("login.verify")}
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => { setStep("phone"); setOtp(""); }}
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="size-3.5" /> {t("login.changeNumber")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSendOtp(new Event("submit") as unknown as React.FormEvent)}
                    className="text-primary hover:underline"
                  >
                    {t("login.resend")}
                  </button>
                </div>
              </form>
            )}

            {!isAuthority && (
              <p className="mt-6 border-t border-border pt-4 text-center text-sm text-muted-foreground">
                {t("login.orTrack")}{" "}
                <Link to="/track" className="font-medium text-primary hover:underline">
                  {t("login.trackHere")}
                </Link>
              </p>
            )}
            <p className="type-label mt-6 text-center text-[9px] text-muted-foreground">
              {t("login.formFootnote")}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
