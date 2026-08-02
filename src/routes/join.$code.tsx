import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, HardHat, Sun, Moon, Globe, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, PENDING_INVITE_KEY } from "@/lib/auth-context";
import { useTheme } from "@/lib/use-theme";
import { setLanguage } from "@/lib/i18n";
import { validatePassword } from "@/lib/password-policy";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";

// Public route: anyone with a link can land here. The invite code itself
// is opaque and only usable once (see redeem_invite_code in
// 20260708120000_invite_link_site_workers.sql).
//
// This page *does* show the company name (via get_invite_preview, an anon
// RPC) before asking for a password — a bare "create a password" form with
// zero context reads as untrustworthy to someone who got a link from a
// manager rather than choosing to sign up. That RPC deliberately returns
// only company name + role (never the manager's email or anything else),
// and resolves identically (NULL) for a wrong, expired, or already-used
// code — no separate path or timing tell between those cases. Codes are
// 32-char high-entropy tokens, not guessable, so this doesn't meaningfully
// change what a brute-force attempt could already infer from attempting a
// full signup + redeem.
//
// Two things this page must never do, learned the hard way:
//   1. Redeem a code against whatever session happens to already be active
//      in the browser. If a manager opens their own invite link to test it
//      without signing out first, redemption must not silently run as
//      *them* — that overwrites the account that's already logged in with
//      the invited role. We always sign out before starting a fresh join.
//   2. Assume signUp() leaves us with an active session for the new user.
//      If this Supabase project requires email confirmation, signUp()
//      returns no session at all — redeeming immediately would run under
//      whatever was active before (see problem 1) or fail outright. We
//      check for a real session and, if there isn't one yet, defer
//      redemption until the user actually confirms and logs in.
export const Route = createFileRoute("/join/$code")({ component: JoinPage });

const inputClass = "h-12 rounded-xl text-base";

function JoinPage() {
  const { code } = Route.useParams();
  const { user, loading: authLoading, refreshRole } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // True from the moment redemption succeeds until the route swap to
  // /dashboard actually happens. navigate() doesn't unmount this component
  // synchronously — there's at least one more render in between. Without
  // this flag, that render would fall through to the `user` check below
  // (the new session is already active by then) and flash the "already
  // signed in, sign out to continue" screen for an instant right after a
  // successful join, which is confusing given the person didn't ask to
  // sign out of anything.
  const [redeemed, setRedeemed] = useState(false);
  // undefined = still loading; null = code is invalid/expired/used (shown
  // generically, same as an unrecognized code — see comment above).
  const [preview, setPreview] = useState<
    { company_name: string | null; role: string } | null | undefined
  >(undefined);

  useEffect(() => {
    let active = true;
    supabase
      .rpc("get_invite_preview", { invite_code: code })
      .then(({ data }) => {
        if (active) setPreview((data as typeof preview) ?? null);
      });
    return () => {
      active = false;
    };
  }, [code]);

  const toggleLanguage = () => {
    const next = i18n.language === "en" ? "de" : "en";
    setLanguage(next as "en" | "de");
  };

  async function handleSignOutAndContinue() {
    setSigningOut(true);
    await supabase.auth.signOut();
    setSigningOut(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const passwordError = validatePassword(password, t);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }
    setBusy(true);
    try {
      // Always start from a clean slate — guarantees the RPC below can
      // never run under a session that isn't the one we're about to create.
      await supabase.auth.signOut();

      // No emailRedirectTo confirmation flow assumed here on purpose — the
      // invite link itself is meant to be the proof of legitimacy for this
      // signup. Whether that actually skips confirmation depends on this
      // Supabase project's Auth settings, which is why we check for a
      // session explicitly below rather than assuming one exists.
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password,
        });
      if (signUpError) throw signUpError;

      if (!signUpData.session) {
        // Email confirmation is required project-wide. There's no session
        // to redeem under yet — stash the code and finish the job the
        // moment a real session appears (handled in auth-context.tsx on
        // the next SIGNED_IN event, i.e. right after they confirm + log in).
        try {
          localStorage.setItem(PENDING_INVITE_KEY, code);
        } catch {}
        setAwaitingConfirmation(true);
        setBusy(false);
        return;
      }

      const { error: redeemError } = await supabase.rpc("redeem_invite_code", {
        invite_code: code,
      });
      if (redeemError) throw redeemError;

      // Don't navigate on a stale/cached role — force a fresh lookup so the
      // very first screen the new site worker sees is theirs, not whatever
      // role briefly resolved before redemption committed.
      await refreshRole();

      // Flip this before navigating (see the comment on the state
      // declaration above) so any render that happens in the gap before
      // the route actually changes shows a spinner instead of a stale
      // screen.
      setRedeemed(true);
      toast.success(t("join.toast.joined"));
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error((err as Error).message || t("join.toast.invalidLink"));
      setBusy(false);
    }
  }

  const toggles = (
    <div className="flex items-center justify-center gap-2 pb-2">
      <button
        type="button"
        onClick={toggleTheme}
        className="p-2 hover:bg-muted rounded-xl transition-colors"
        aria-label={t("common.toggleDarkMode")}
      >
        {theme === "light" ? (
          <Moon size={18} className="text-slate-600" />
        ) : (
          <Sun size={18} className="text-yellow-400" />
        )}
      </button>
      <button
        type="button"
        onClick={toggleLanguage}
        className="p-2 hover:bg-muted rounded-xl transition-colors flex items-center gap-1.5"
        aria-label={t("common.toggleLanguage")}
      >
        <Globe size={18} className="text-slate-600 dark:text-slate-300" />
        <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">
          {i18n.language}
        </span>
      </button>
    </div>
  );

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Redemption succeeded and we're on our way to /dashboard — show a
  // spinner for this last stretch instead of falling through to the
  // `user` check below (see the state declaration for why that check
  // would otherwise misfire here).
  if (redeemed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Someone is already logged in on this device/browser. We never redeem
  // on their behalf automatically — that's exactly the bug that once let a
  // manager's own account get silently converted into the invited role.
  // Require an explicit sign-out first.
  //
  // `&& !busy` matters here: signUp() inside submit() creates a session
  // immediately, which flips `user` truthy while we're still mid-flow
  // (about to call redeem_invite_code and navigate away). Without this
  // guard, the person would see this "sign out to continue" screen flash
  // for a moment between their own signup and the redirect to /dashboard —
  // confusing since they never asked to sign out of anything.
  if (user && !busy) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          {toggles}
          <div className="mx-auto h-12 w-12 rounded-2xl bg-navy text-navy-foreground flex items-center justify-center">
            <HardHat className="h-6 w-6" />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("join.alreadySignedIn", { email: user.email })}
          </p>
          <Button
            onClick={handleSignOutAndContinue}
            disabled={signingOut}
            className="w-full h-12 text-base font-bold rounded-xl"
          >
            {signingOut ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              t("join.signOutAndContinue")
            )}
          </Button>
        </div>
      </div>
    );
  }

  if (awaitingConfirmation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          {toggles}
          <div className="mx-auto h-12 w-12 rounded-2xl bg-navy text-navy-foreground flex items-center justify-center">
            <Mail className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold">{t("join.checkEmail.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("join.checkEmail.body", { email })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4">
        {toggles}
        <div className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-navy text-navy-foreground flex items-center justify-center">
            <HardHat className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold">
            {preview?.company_name
              ? t("join.invitedTo", { company: preview.company_name })
              : t("join.invitedToGeneric")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {preview?.role === "subcontractor"
              ? t("join.roleSubcontractor")
              : preview?.role === "site_worker"
                ? t("join.roleSiteWorker")
                : t("join.subtitle")}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Input
            type="email"
            required
            placeholder={t("login.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            autoFocus
          />
          <div>
            <PasswordInput
              required
              placeholder={t("login.passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            <p className="text-xs mt-1.5 text-muted-foreground">
              {t("login.passwordHint")}
            </p>
          </div>
          <Button
            type="submit"
            disabled={busy}
            className="w-full h-12 text-base font-bold rounded-xl"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              t("join.cta")
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
