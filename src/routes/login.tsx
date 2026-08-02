import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Moon, Sun, HardHat, ArrowLeft, Loader2, Globe } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/use-theme";
import { validatePassword } from "@/lib/password-policy";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { setLanguage } from "@/lib/i18n";

export const Route = createFileRoute("/login")({ component: LoginPage });
type Mode = "login" | "signup" | "set-password" | "forgot" | "forgot-sent";

// Taller than the shared Input default (h-9) — this is the primary action
// on the page, matching the substantial field height already established
// on NameGate (h-12) rather than a compact form-row input.
const inputClass = "h-12 rounded-xl text-base";

function LoginPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const { theme, toggleTheme } = useTheme();
  const toggleLanguage = () =>
    setLanguage(i18n.language === "en" ? "de" : "en");

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=invite") || hash.includes("type=recovery")) {
      setMode("set-password");
    }
  }, []);

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === "signup" || mode === "set-password") {
      const passwordError = validatePassword(password, t);
      if (passwordError) {
        toast.error(passwordError);
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "set-password") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success(t("login.toast.passwordSet"));
        navigate({ to: "/dashboard" });
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login`,
        });
        if (error) throw error;
        setMode("forgot-sent");
      } else if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        toast.success(t("login.toast.welcomeBack"));
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success(t("login.toast.accountCreated"));
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, string> = {
    login: t("login.title.login"),
    signup: t("login.title.signup"),
    "set-password": t("login.title.setPassword"),
    forgot: t("login.title.forgot"),
    "forgot-sent": t("login.title.forgotSent"),
  };

  const subtitles: Record<Mode, string> = {
    login: t("login.subtitle.login"),
    signup: t("login.subtitle.signup"),
    "set-password": t("login.subtitle.setPassword"),
    forgot: t("login.subtitle.forgot"),
    "forgot-sent": t("login.subtitle.forgotSent", { email }),
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 transition-colors duration-300">
      <div className="fixed top-6 right-6 z-50 flex items-center gap-2">
        <button
          onClick={toggleLanguage}
          aria-label={t("common.toggleLanguage")}
          className="h-10 px-3 rounded-xl flex items-center gap-1.5 border-2 bg-card text-foreground shadow-md transition-all duration-300 hover:-translate-y-0.5 active:scale-95"
        >
          <Globe size={18} />
          <span className="text-xs font-bold uppercase">{i18n.language}</span>
        </button>
        <button
          onClick={toggleTheme}
          aria-label={t("common.toggleDarkMode")}
          className="w-10 h-10 rounded-xl flex items-center justify-center border-2 bg-card text-foreground shadow-md transition-all duration-300 hover:-translate-y-0.5 active:scale-95"
        >
          {theme === "dark" ? (
            <Sun size={18} className="text-yellow-400" />
          ) : (
            <Moon size={18} />
          )}
        </button>
      </div>

      <div className="w-full max-w-md animate-in fade-in-0 slide-in-from-bottom-4 duration-500">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-orange-500/20 bg-orange-500">
            <HardHat className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">SnapSnag</h1>
          <p className="text-sm text-muted-foreground">{t("login.tagline")}</p>
        </div>

        {(mode === "forgot" || mode === "forgot-sent") && (
          <button
            type="button"
            onClick={() => setMode("login")}
            className="flex items-center gap-1.5 text-sm mb-6 text-muted-foreground hover:text-foreground transition-colors duration-150"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("login.backToSignIn")}
          </button>
        )}

        <div className="rounded-2xl border-2 p-8 mb-6 bg-card card-machined shadow-sm transition-colors duration-300">
          <h2 className="text-xl font-bold text-center mb-6">{titles[mode]}</h2>
          <p className="text-sm text-center mb-6 leading-relaxed text-muted-foreground">
            {subtitles[mode]}
          </p>

          {mode === "forgot-sent" ? (
            <button
              onClick={() => setMode("login")}
              className="w-full py-3.5 rounded-lg font-bold text-sm uppercase tracking-wide text-white bg-orange-500 shadow-[0_4px_12px_rgba(243,141,49,0.3)] transition-all duration-300 active:scale-[0.98]"
            >
              {t("login.backToSignIn")}
            </button>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              {mode !== "set-password" && (
                <div>
                  <label
                    htmlFor="email"
                    className="block text-xs font-semibold uppercase tracking-wider mb-2"
                  >
                    {t("login.email")}
                  </label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("login.emailPlaceholder")}
                    className={inputClass}
                  />
                </div>
              )}

              {(mode === "login" ||
                mode === "signup" ||
                mode === "set-password") && (
                <div>
                  <label
                    htmlFor="password"
                    className="block text-xs font-semibold uppercase tracking-wider mb-2"
                  >
                    {mode === "set-password"
                      ? t("login.choosePassword")
                      : t("login.password")}
                  </label>
                  <PasswordInput
                    id="password"
                    required
                    minLength={mode === "login" ? undefined : 8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("login.passwordPlaceholder")}
                    className={inputClass}
                  />
                  {(mode === "signup" || mode === "set-password") && (
                    <p className="text-xs mt-1.5 text-muted-foreground">
                      {t("login.passwordHint")}
                    </p>
                  )}
                </div>
              )}

              {mode === "login" && (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="text-sm font-semibold text-orange-500 transition-colors duration-150 hover:opacity-80"
                  >
                    {t("login.forgotPassword")}
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3.5 rounded-lg font-bold text-sm uppercase tracking-wide text-white bg-orange-500 shadow-[0_4px_12px_rgba(243,141,49,0.35)] disabled:shadow-none transition-all duration-300 active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : mode === "login" ? (
                  t("login.signIn")
                ) : mode === "signup" ? (
                  t("login.createAccount")
                ) : mode === "set-password" ? (
                  t("login.setPasswordContinue")
                ) : (
                  t("login.sendResetLink")
                )}
              </button>
            </form>
          )}
        </div>

        {(mode === "login" || mode === "signup") && (
          <div className="text-center text-sm text-muted-foreground">
            {mode === "login"
              ? t("login.newToSnapSnag")
              : t("login.alreadyHaveAccount")}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="font-semibold text-orange-500 hover:opacity-80 transition-opacity duration-150"
            >
              {mode === "login" ? t("login.createAccount") : t("login.signIn")}
            </button>
          </div>
        )}

        <p className="text-center text-xs mt-6 font-medium tracking-wide text-muted-foreground/60">
          {t("login.builtFor")}
        </p>
      </div>
    </div>
  );
}
