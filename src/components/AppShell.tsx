import { Link, useLocation } from "@tanstack/react-router";
import {
  HardHat,
  LayoutDashboard,
  FolderOpen,
  BarChart3,
  Plus,
  UsersRound,
  Settings,
  LogOut,
  Globe,
  Sun,
  Moon,
  Bell,
} from "lucide-react";
import type { ReactNode, CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { setLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/use-theme";
import { useAuth } from "@/lib/auth-context";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { getLogoSignedUrl } from "@/lib/storage-url";
import { usePlanLimits } from "@/lib/usePlanLimits";
import { findBrandPreset } from "@/lib/brand-presets";
import { Button } from "@/components/ui/button";

function EnablePushBanner({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { supported, permission, subscribed, loading, subscribe } =
    usePushSubscription({
      table: "manager_push_subscriptions",
      idColumn: "user_id",
      id: userId,
    });

  // Nothing to show if: unsupported, already subscribed on this device, or
  // the user has explicitly denied — re-prompting a denial just annoys
  // people, they'd need to re-enable it in browser settings anyway.
  if (!supported || subscribed || permission === "denied") return null;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-3">
      <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <Bell className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs text-muted-foreground flex-1">
          {t("push.enableHintManager")}
        </p>
        <Button size="sm" disabled={loading} onClick={() => subscribe()}>
          {loading ? t("push.enabling") : t("push.enable")}
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();

  const { canUseCustomBranding } = usePlanLimits();

  // Separate query key from the Settings page's ["settings", user.id]
  // (which select("*")) so a partial select here can't clobber that cache
  // with a shape missing company_name/address/etc.
  const { data: navBranding } = useQuery({
    queryKey: ["nav-branding", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_settings")
        .select("logo_url, brand_color, brand_accent_color")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });
  const logoPath = navBranding?.logo_url ?? null;

  // Only actually themed while on Business plan — colors picked before a
  // downgrade stay saved in the DB, but the nav quietly reverts to the
  // default until they're back on Business, same as other gated features.
  const preset =
    canUseCustomBranding && navBranding
      ? findBrandPreset(navBranding.brand_color, navBranding.brand_accent_color)
      : undefined;
  const themeVars = preset
    ? ({
        "--primary": preset.primary,
        "--primary-foreground": preset.foreground,
      } as CSSProperties)
    : undefined;

  const [logoDisplayUrl, setLogoDisplayUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getLogoSignedUrl(logoPath).then((url) => {
      if (active) setLogoDisplayUrl(url);
    });
    return () => {
      active = false;
    };
  }, [logoPath]);

  const toggleLanguage = () => {
    const next = i18n.language === "en" ? "de" : "en";
    setLanguage(next as "en" | "de");
  };

  // Mobile bottom nav — Dashboard/Team/Insights swapped so Team and
  // Insights sit further right, and My Snags (previously only reachable
  // via the dashboard KPI strip, no bottom-nav entry at all) fills the
  // slot Team vacated. Settings moved out of this bar entirely and into
  // the mobile header (replacing sign-out there) since it needed a home
  // at the top instead.
  const navItems = [
    { to: "/dashboard", label: t("dashboard.title"), icon: LayoutDashboard },
    { to: "/my-snags", label: t("nav.mySnags"), icon: FolderOpen },
    { to: "/add", label: t("nav.add"), icon: Plus, primary: true },
    { to: "/team", label: t("nav.team"), icon: UsersRound },
    { to: "/insights", label: t("nav.insights"), icon: BarChart3 },
  ];

  const desktopNavItems = [
    { to: "/dashboard", label: t("dashboard.title"), icon: LayoutDashboard },
    { to: "/my-snags", label: t("nav.snags"), icon: FolderOpen },
    { to: "/team", label: t("nav.team"), icon: UsersRound },
    { to: "/insights", label: t("nav.insights"), icon: BarChart3 },
    { to: "/settings", label: t("nav.settings"), icon: Settings },
  ];

  return (
    <div
      style={themeVars}
      className="min-h-screen bg-background flex flex-col pb-[calc(80px+env(safe-area-inset-bottom))] md:pb-0 transition-colors duration-300"
    >
      {/* Desktop Header */}
      <header className="sticky top-0 z-40 bg-white dark:bg-slate-900 border-b-2 border-gray-200 dark:border-slate-800 transition-colors duration-300 shadow-sm">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/dashboard" className="flex items-center gap-2.5 group">
              <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20 group-active:scale-95 transition-transform overflow-hidden">
                {logoDisplayUrl ? (
                  <img
                    src={logoDisplayUrl}
                    alt={t("nav.companyLogoAlt")}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <HardHat className="h-5 w-5 text-primary-foreground" />
                )}
              </div>
              <div className="hidden sm:block">
                <span className="font-bold text-lg tracking-tight leading-none block text-slate-900 dark:text-white">
                  SnapSnag
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest leading-none font-bold">
                  {t("nav.tagline")}
                </span>
              </div>
            </Link>

            {/* Desktop horizontal nav */}
            <nav className="hidden md:flex items-center gap-1">
              {desktopNavItems.map(({ to, label, icon: Icon }) => {
                const active =
                  pathname === to || (to === "/dashboard" && pathname === "/");
                return (
                  <Link
                    key={to}
                    to={to}
                    className={`flex items-center gap-1.5 px-3 py-2 text-sm font-bold rounded-lg transition-colors relative ${
                      active
                        ? "text-primary"
                        : "text-muted-foreground hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                    {active && (
                      <div className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-primary" />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-bold uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              {t("nav.live")}
            </span>
            <button
              onClick={toggleTheme}
              className="p-2 hover:bg-muted rounded-xl transition-colors"
            >
              {theme === "light" ? (
                <Moon size={18} className="text-slate-600" />
              ) : (
                <Sun size={18} className="text-yellow-400" />
              )}
            </button>
            <button
              onClick={toggleLanguage}
              className="p-2 hover:bg-muted rounded-xl transition-colors flex items-center gap-1.5"
            >
              <Globe size={18} className="text-slate-600 dark:text-slate-300" />
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">
                {i18n.language}
              </span>
            </button>
            <div className="h-8 w-px bg-border mx-1 hidden md:block" />
            <button
              onClick={() => supabase.auth.signOut()}
              className="hidden md:inline-flex p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl text-muted-foreground hover:text-red-600 transition-colors"
            >
              <LogOut size={18} />
            </button>
            <Link
              to="/settings"
              className="md:hidden p-2 hover:bg-muted rounded-xl transition-colors flex items-center"
            >
              <Settings
                size={18}
                className="text-slate-600 dark:text-slate-300"
              />
            </Link>
          </div>
        </div>
      </header>

      {user && <EnablePushBanner userId={user.id} />}

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 md:py-8 soft-fade-in">
        {children}
      </main>

      {/* Bottom Nav (mobile only) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t-2 border-gray-200 dark:border-slate-800 z-40 pb-[env(safe-area-inset-bottom)] transition-colors duration-300">
        <div className="mx-auto max-w-3xl grid grid-cols-5 h-20">
          {navItems.map(({ to, label, icon: Icon, primary }) => {
            const active =
              pathname === to || (to === "/dashboard" && pathname === "/");
            return (
              <Link
                key={to}
                to={to}
                className="flex flex-col items-center justify-center gap-1 group relative"
              >
                {primary ? (
                  <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center -mt-10 shadow-xl shadow-primary/30 ring-4 ring-white dark:ring-slate-900 transition-all duration-200 group-hover:scale-110 group-active:scale-95">
                    <Icon className="h-7 w-7 text-primary-foreground" />
                  </div>
                ) : (
                  <div
                    className={`p-2 rounded-xl transition-all duration-200 ${active ? "text-primary" : "text-muted-foreground group-hover:text-slate-900 dark:group-hover:text-white"}`}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                )}
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
                >
                  {label}
                </span>
                {active && !primary && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-primary rounded-b-full" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
