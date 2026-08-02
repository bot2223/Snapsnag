import { HardHat, LogOut, Bell, Sun, Moon, Globe } from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/use-theme";
import { setLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useTeamAccentColor } from "@/hooks/useTeamAccentColor";
import { TeamAccentPicker } from "@/components/TeamAccentPicker";

function EnablePushBanner({ subcontractorId }: { subcontractorId: string }) {
  const { t } = useTranslation();
  const { supported, permission, subscribed, loading, subscribe } =
    usePushSubscription({
      table: "push_subscriptions",
      idColumn: "subcontractor_id",
      id: subcontractorId,
    });

  // Nothing to show if: unsupported, already subscribed on this device, or
  // the user has explicitly denied — re-prompting a denial just annoys
  // people, they'd need to re-enable it in browser settings anyway.
  if (!supported || subscribed || permission === "denied") return null;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-3">
      <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <Bell className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs text-muted-foreground flex-1">
          {t("push.enableHint")}
        </p>
        <Button size="sm" disabled={loading} onClick={() => subscribe()}>
          {loading ? t("push.enabling") : t("push.enable")}
        </Button>
      </div>
    </div>
  );
}

export function SubcontractorShell({ children }: { children: ReactNode }) {
  const { subcontractorName, subcontractorId } = useAuth();
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { unlocked, accentColor, setAccentColor, saving, themeVars } =
    useTeamAccentColor(true);

  const toggleLanguage = () => {
    const next = i18n.language === "en" ? "de" : "en";
    setLanguage(next as "en" | "de");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col" style={themeVars}>
      <header className="bg-navy text-navy-foreground sticky top-0 z-40 shadow-lg">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center shadow-md shadow-primary/30">
              <HardHat className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight block leading-tight">
                SnapSnag
              </span>
              {subcontractorName && (
                <span className="text-xs text-navy-foreground/60">
                  {subcontractorName}
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
              size="icon"
              className="h-9 w-9 text-navy-foreground/70 hover:text-navy-foreground hover:bg-white/10 transition-all duration-150 active:scale-95"
              onClick={() => supabase.auth.signOut()}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      {subcontractorId && (
        <EnablePushBanner subcontractorId={subcontractorId} />
      )}
      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
        {children}
      </main>
    </div>
  );
}
