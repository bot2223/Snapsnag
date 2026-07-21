import { useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function NameGate({ children }: { children: React.ReactNode }) {
  const { user, role, profile, profileLoading, refreshProfile } = useAuth();
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // Subcontractors get their name from the subcontractors table — skip gate
  // Don't show gate while profile is still loading (avoids the flash)
  const needsName =
    !!user &&
    role !== "subcontractor" &&
    !profileLoading &&
    !profile?.full_name;

  const save = async () => {
    if (!name.trim() || !user) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({ id: user.id, full_name: name.trim() }, { onConflict: "id" });
      if (error) throw error;
      await refreshProfile();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!needsName) return <>{children}</>;

  return (
    <>
      {children}
      {/* Full-screen blocking overlay — no close/skip */}
      <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-lg bg-background rounded-t-3xl p-6 space-y-5 animate-in slide-in-from-bottom-4 duration-300">
          <div className="mx-auto w-10 h-1 bg-border rounded-full mb-2" />
          <div>
            <h2 className="font-bold text-xl mb-1">{t("nameGate.title")}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("nameGate.hint")}
            </p>
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("nameGate.placeholder")}
            className="h-12 rounded-xl text-base"
            onKeyDown={(e) => e.key === "Enter" && name.trim() && save()}
            autoFocus
          />
          <Button
            onClick={save}
            disabled={busy || !name.trim()}
            className="w-full h-12 text-base font-bold rounded-xl"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              t("nameGate.save")
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
