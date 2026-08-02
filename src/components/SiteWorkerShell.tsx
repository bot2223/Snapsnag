import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  HardHat,
  LogOut,
  Plus,
  List,
  LayoutDashboard,
  Sun,
  Moon,
  Globe,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/use-theme";
import { setLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useTeamAccentColor } from "@/hooks/useTeamAccentColor";
import { TeamAccentPicker } from "@/components/TeamAccentPicker";

export function SiteWorkerShell({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { unlocked, accentColor, setAccentColor, saving, themeVars } =
    useTeamAccentColor(true);

  const toggleLanguage = () => {
    const next = i18n.language === "en" ? "de" : "en";
    setLanguage(next as "en" | "de");
  };

  // Same three destinations a manager has, minus the manager-only ones
  // (Team, Insights, Settings/billing) — a site worker has no team to
  // manage and no subscription to view.
  const nav = [
    { to: "/dashboard", label: t("dashboard.title"), icon: LayoutDashboard },
    { to: "/my-snags", label: t("nav.snags"), icon: List },
    { to: "/add", label: t("nav.logSnag"), icon: Plus },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col" style={themeVars}>
      <header className="bg-navy text-navy-foreground sticky top-0 z-40 shadow-sm">
        <div className="px-4 py-3 flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <HardHat className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <span className="font-bold text-base tracking-tight block leading-none">
                SnapSnag
              </span>
              {profile?.full_name && (
                <span className="text-xs text-navy-foreground/60 leading-none">
                  {profile.full_name}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {unlocked && (
              <TeamAccentPicker
                accentColor={accentColor}
                onSelect={setAccentColor}
                saving={saving}
              />
            )}
            <button
              onClick={toggleTheme}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors"
              aria-label={t("common.toggleDarkMode")}
            >
              {theme === "light" ? (
                <Moon size={16} className="text-navy-foreground" />
              ) : (
                <Sun size={16} className="text-yellow-400" />
              )}
            </button>
            <button
              onClick={toggleLanguage}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors flex items-center gap-1"
              aria-label={t("common.toggleLanguage")}
            >
              <Globe size={16} className="text-navy-foreground" />
              <span className="text-xs font-bold text-navy-foreground uppercase">
                {i18n.language}
              </span>
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="text-navy-foreground hover:bg-white/10"
              onClick={() => supabase.auth.signOut()}
            >
              <LogOut className="h-4 w-4 mr-1" /> {t("nav.signOut")}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-5 md:py-8">
        {children}
      </main>

      <nav className="sticky bottom-0 bg-background border-t z-40">
        <div className="flex max-w-lg mx-auto">
          {nav.map(({ to, label, icon: Icon }) => {
            const active =
              location.pathname === to ||
              (to === "/dashboard" && location.pathname === "/");
            return (
              <Link
                key={to}
                to={to}
                className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
