import { Link } from "@tanstack/react-router";
import {
  HardHat,
  AlertTriangle,
  CreditCard,
  Sun,
  Moon,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/use-theme";
import { setLanguage } from "@/lib/i18n";

const hazardStripe =
  "repeating-linear-gradient(135deg, var(--color-primary) 0px, var(--color-primary) 10px, var(--color-navy) 10px, var(--color-navy) 20px)";

type Props = { status: "canceled" | "past_due" };

export function TrialExpiredWall({ status }: Props) {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const isPastDue = status === "past_due";

  const toggleLanguage = () => {
    const next = i18n.language === "en" ? "de" : "en";
    setLanguage(next);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div
        className="h-3 w-full shrink-0"
        style={{ background: hazardStripe }}
      />

      <div className="flex justify-end gap-2 px-6 pt-4">
        <button
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

      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center -mt-12">
        <div className="relative mb-6">
          <div className="h-24 w-24 rounded-3xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center">
            <HardHat className="h-12 w-12 text-primary" />
          </div>
          <div className="absolute -top-2 -right-2 h-8 w-8 rounded-full bg-destructive flex items-center justify-center shadow-md">
            <AlertTriangle className="h-4 w-4 text-white" />
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight mb-2">
          {isPastDue
            ? t("trialWall.pastDueTitle")
            : t("trialWall.trialEndedTitle")}
        </h1>

        <p className="text-muted-foreground text-sm max-w-xs leading-relaxed mb-2">
          {isPastDue
            ? t("trialWall.pastDueBody")
            : t("trialWall.trialEndedBody")}
        </p>

        {!isPastDue && (
          <div className="flex gap-2 mb-8 mt-2">
            {["Starter €29.99", "Pro €59.99", "Business €99.99"].map((p) => (
              <span
                key={p}
                className="text-xs font-semibold bg-muted px-2.5 py-1 rounded-full text-muted-foreground"
              >
                {p}
              </span>
            ))}
          </div>
        )}

        <Link to="/billing" className={!isPastDue ? "" : "mt-8"}>
          <Button className="h-14 px-8 text-base font-bold rounded-2xl gap-2 shadow-lg shadow-primary/20">
            <CreditCard className="h-5 w-5" />
            {isPastDue
              ? t("trialWall.updatePayment")
              : t("trialWall.choosePlan")}
          </Button>
        </Link>

        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-6 text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          {t("trialWall.signOut")}
        </button>
      </div>

      <div
        className="h-3 w-full shrink-0"
        style={{ background: hazardStripe }}
      />
    </div>
  );
}
