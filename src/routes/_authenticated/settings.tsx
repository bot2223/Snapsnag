import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Building2,
  Loader2,
  Upload,
  Pencil,
  HardHat,
  Settings2,
  Paintbrush,
  UserCircle,
  KeyRound,
  CreditCard,
  Lock,
  Zap,
  MapPin,
  Trash2,
  Plus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { withTimeout } from "@/lib/query-utils";
import { toast } from "sonner";
import { validateImageFile } from "@/lib/file-validation";
import { compressImage } from "@/lib/image-compress";
import { validatePassword } from "@/lib/password-policy";
import { getLogoSignedUrl, getSignedUrl } from "@/lib/storage-url";
import { useTranslation } from "react-i18next";
import { PlanCards } from "@/components/PlanCards";
import { usePlanLimits } from "@/lib/usePlanLimits";
import { BRAND_PRESETS, findBrandPreset } from "@/lib/brand-presets";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

type SettingsTab = "company" | "branding" | "billing" | "account";

function SettingsPage() {
  const { user, profile, role, refreshProfile } = useAuth();
  const { canUseCustomBranding, canUseFloorPlans } = usePlanLimits();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<SettingsTab>("company");
  const [editing, setEditing] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null); // stored path
  const [logoDisplayUrl, setLogoDisplayUrl] = useState<string | null>(null); // signed URL for <img>
  const [brandColor, setBrandColor] = useState("#F38D31");
  const [secondaryColor, setSecondaryColor] = useState("#0F172A");
  const [pushNotif, setPushNotif] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");
  const [planUploadBusy, setPlanUploadBusy] = useState(false);
  const planFileRef = useRef<HTMLInputElement>(null);

  // Account tab — full name + password
  const [fullName, setFullName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
  }, [profile]);

  useEffect(() => {
    let active = true;
    getLogoSignedUrl(logoUrl).then((url) => {
      if (active) setLogoDisplayUrl(url);
    });
    return () => {
      active = false;
    };
  }, [logoUrl]);

  const { data, isLoading: settingsLoading } = useQuery({
    queryKey: ["settings", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase
          .from("company_settings")
          .select("*")
          .eq("user_id", user!.id)
          .maybeSingle(),
      );
      if (error) {
        console.warn("settings query:", error.message);
        return null;
      }
      return data;
    },
  });

  useEffect(() => {
    if (data) {
      setCompanyName(data.company_name ?? "");
      setCompanyAddress(data.company_address ?? "");
      setCompanyPhone(data.company_phone ?? "");
      setLogoUrl(data.logo_url ?? null);
      setBrandColor(data.brand_color ?? "#F38D31");
      setSecondaryColor(data.brand_accent_color ?? "#0F172A");
      setPushNotif(data.push_notifications ?? true);
      setEditing(false);
    } else if (!settingsLoading) {
      setEditing(true);
    }
  }, [data, settingsLoading]);

  const uploadLogo = async (file: File) => {
    if (!user) return;
    const result = await validateImageFile(file);
    if (!result.valid) {
      toast.error(result.error);
      return;
    }
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      const path = `${user.id}/logo-${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from("company-assets")
        .upload(path, compressed, { upsert: true });
      if (error) throw error;
      // company-assets is private — keep the path in state/DB and resolve
      // it to a signed URL for display.
      setLogoUrl(path);
      toast.success(t("settings.toast.logoUploaded"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const { data: floorPlans } = useQuery({
    queryKey: ["floor-plans", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_plans")
        .select("id, name, image_url")
        .order("created_at");
      if (error) throw error;
      const withThumbs = await Promise.all(
        data.map(async (p) => ({
          ...p,
          thumbUrl: await getSignedUrl("floor-plans", p.image_url),
        })),
      );
      return withThumbs;
    },
  });

  const uploadFloorPlan = async (file: File) => {
    if (!user) return;
    const result = await validateImageFile(file);
    if (!result.valid) {
      toast.error(result.error);
      return;
    }
    setPlanUploadBusy(true);
    try {
      const compressed = await compressImage(file);
      const path = `${user.id}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("floor-plans")
        .upload(path, compressed);
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("floor_plans").insert({
        user_id: user.id,
        name: newPlanName.trim() || t("settings.floorPlans.namePlaceholder"),
        image_url: path,
      });
      if (insErr) throw insErr;
      setNewPlanName("");
      qc.invalidateQueries({ queryKey: ["floor-plans"] });
      toast.success(t("settings.floorPlans.uploaded"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPlanUploadBusy(false);
    }
  };

  const deleteFloorPlan = async (planId: string) => {
    if (!confirm(t("settings.floorPlans.deleteConfirm"))) return;
    const { error } = await supabase
      .from("floor_plans")
      .delete()
      .eq("id", planId);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["floor-plans"] });
    toast.success(t("settings.floorPlans.deleted"));
  };

  const save = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("company_settings").upsert(
        {
          user_id: user.id,
          company_name: companyName || null,
          company_address: companyAddress || null,
          company_phone: companyPhone || null,
          logo_url: logoUrl,
          brand_color: brandColor || null,
          brand_accent_color: secondaryColor || null,
          email_notifications: false,
          push_notifications: pushNotif,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["settings"] });
      // AppShell's header/nav badge reads brand colors from its own
      // ["nav-branding", user.id] query (kept separate deliberately — see
      // that query's comment) — without invalidating it too, a newly
      // picked palette saves correctly but the header keeps showing the
      // old cached color until its 60s staleTime expires or the page reloads.
      qc.invalidateQueries({ queryKey: ["nav-branding", user.id] });
      setEditing(false);
      toast.success(t("settings.toast.saved"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleLogoDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) uploadLogo(f);
  };

  const updateAccount = async () => {
    if (!user) return;
    setAccountBusy(true);
    try {
      if (fullName.trim() && fullName.trim() !== (profile?.full_name ?? "")) {
        const { error } = await supabase
          .from("profiles")
          .update({ full_name: fullName.trim() })
          .eq("id", user.id);
        if (error) throw error;
      }
      if (newPassword.trim()) {
        const passwordError = validatePassword(newPassword.trim(), t);
        if (passwordError) {
          toast.error(passwordError);
          setAccountBusy(false);
          return;
        }
        const { error } = await supabase.auth.updateUser({
          password: newPassword.trim(),
        });
        if (error) throw error;
        setNewPassword("");
      }
      await refreshProfile();
      toast.success(t("settings.toast.accountUpdated"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAccountBusy(false);
    }
  };

  return (
    <div className="space-y-6 pb-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {/* ── Page header ── */}
      <div className="rounded-2xl overflow-hidden border shadow-sm">
        <div
          className="h-[3px] w-full"
          style={{
            background:
              "repeating-linear-gradient(90deg, var(--color-primary) 0px, var(--color-primary) 14px, var(--color-navy) 14px, var(--color-navy) 22px)",
          }}
        />
        <div className="bg-card px-5 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Settings2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {t("settings.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("settings.subtitle")}
              </p>
            </div>
          </div>
          {tab !== "billing" &&
            tab !== "account" &&
            !editing &&
            !settingsLoading && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
                className="rounded-2xl"
              >
                <Pencil className="h-4 w-4 mr-1" /> {t("settings.edit")}
              </Button>
            )}
        </div>
      </div>

      {/* ── Tabs ── */}
      {/* Mobile: flex-1 forced all 4 tabs to share the visible width exactly,
          so "Account" was clipped entirely with no hint it existed — you had
          to already know to swipe. Natural-width tabs let the next tab peek
          in at the edge as a visible affordance, plus a fade gradient backs
          that up; desktop keeps the original even flex-1 row, unchanged. */}
      <div className="relative">
        <div className="flex rounded-2xl bg-muted p-1 gap-1 overflow-x-auto scrollbar-hide">
          {[
            {
              id: "company" as const,
              label: t("settings.tabs.company"),
              icon: Building2,
            },
            {
              id: "branding" as const,
              label: t("settings.tabs.branding"),
              icon: Paintbrush,
            },
            {
              id: "billing" as const,
              label: t("settings.tabs.billing"),
              icon: CreditCard,
            },
            {
              id: "account" as const,
              label: t("settings.tabs.account"),
              icon: UserCircle,
            },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                setTab(id);
                setEditing(false);
              }}
              className={`shrink-0 md:flex-1 min-w-fit flex items-center justify-center gap-1.5 py-2.5 px-2.5 md:px-3 text-sm font-semibold rounded-xl transition-all whitespace-nowrap ${
                tab === id
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        {/* Fade hint — mobile only, signals more tabs sit off the right edge */}
        <div className="md:hidden pointer-events-none absolute right-0 top-0 bottom-0 w-8 rounded-r-2xl bg-gradient-to-l from-background to-transparent" />
      </div>

      {/* ── Loading skeleton (company/branding tabs) ── */}
      {settingsLoading && (tab === "company" || tab === "branding") && (
        <section className="rounded-2xl border-2 bg-card p-5 space-y-5 shadow-sm">
          <Skeleton className="h-6 w-32" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-24 w-24 rounded-2xl shrink-0" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-48" />
          </div>
        </section>
      )}

      {/* ── Company tab ── */}
      {!settingsLoading && tab === "company" && (
        <>
          <section className="rounded-2xl border-2 bg-card p-5 space-y-5 shadow-sm card-machined">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              {t("settings.company")}
            </h2>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("settings.companyName")}
              </Label>
              {editing ? (
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={t("settings.companyNamePlaceholder")}
                  className="h-12 rounded-2xl"
                />
              ) : (
                <p className="text-base font-medium py-3 px-1">
                  {companyName || t("settings.notSet")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("settings.companyAddress")}
              </Label>
              {editing ? (
                <Input
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  placeholder={t("settings.companyAddressPlaceholder")}
                  className="h-12 rounded-2xl"
                />
              ) : (
                <p className="text-base font-medium py-3 px-1">
                  {companyAddress || t("settings.notSet")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("settings.companyPhone")}
              </Label>
              {editing ? (
                <Input
                  type="tel"
                  value={companyPhone}
                  onChange={(e) => setCompanyPhone(e.target.value)}
                  placeholder={t("settings.companyPhonePlaceholder")}
                  className="h-12 rounded-2xl"
                />
              ) : (
                <p className="text-base font-medium py-3 px-1">
                  {companyPhone || t("settings.notSet")}
                </p>
              )}
            </div>
          </section>
          {editing && (
            <div className="flex gap-3">
              {data && (
                <Button
                  variant="outline"
                  className="flex-1 h-12 rounded-2xl font-medium"
                  onClick={() => {
                    setEditing(false);
                    setCompanyName(data.company_name ?? "");
                    setCompanyAddress(data.company_address ?? "");
                    setCompanyPhone(data.company_phone ?? "");
                  }}
                >
                  {t("settings.cancel")}
                </Button>
              )}
              <Button
                onClick={save}
                disabled={busy}
                className="flex-1 h-12 font-semibold rounded-2xl"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  t("settings.saveChanges")
                )}
              </Button>
            </div>
          )}

          {role === "manager" && (
            <section className="rounded-2xl border-2 bg-card p-5 space-y-4 shadow-sm card-machined">
              <div>
                <h2 className="font-semibold text-lg flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  {t("settings.floorPlans.title")}
                  {!canUseFloorPlans && (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("settings.floorPlans.subtitle")}
                </p>
              </div>

              {!canUseFloorPlans ? (
                <div className="rounded-2xl border-2 border-dashed bg-muted/30 p-4 flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {t("settings.floorPlans.lockedHint")}
                  </p>
                  <Button
                    asChild
                    size="sm"
                    className="rounded-xl font-bold shrink-0"
                  >
                    <Link to="/billing">
                      <Zap className="h-3.5 w-3.5 mr-1" />
                      {t("settings.upgrade")}
                    </Link>
                  </Button>
                </div>
              ) : (
                <>
                  {floorPlans && floorPlans.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      {floorPlans.map((p) => (
                        <div
                          key={p.id}
                          className="relative rounded-2xl border-2 border-border overflow-hidden bg-muted/30 group"
                        >
                          <div className="aspect-[4/3] w-full">
                            {p.thumbUrl ? (
                              <img
                                src={p.thumbUrl}
                                alt={p.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex items-center justify-between">
                            <span className="text-xs font-semibold text-white truncate">
                              {p.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => deleteFloorPlan(p.id)}
                              className="h-7 w-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-red-600/80 transition-colors shrink-0"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(!floorPlans || floorPlans.length === 0) && (
                    <p className="text-sm text-muted-foreground py-2">
                      {t("settings.floorPlans.empty")}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Input
                      value={newPlanName}
                      onChange={(e) => setNewPlanName(e.target.value)}
                      placeholder={t("settings.floorPlans.namePlaceholder")}
                      className="h-11 rounded-2xl flex-1"
                    />
                    <input
                      ref={planFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadFloorPlan(file);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={planUploadBusy}
                      onClick={() => planFileRef.current?.click()}
                      className="h-11 rounded-2xl font-medium shrink-0"
                    >
                      {planUploadBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-1" />
                          {t("settings.floorPlans.uploadCta")}
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}

      {/* ── Branding tab ── */}
      {!settingsLoading && tab === "branding" && (
        <>
          <section className="rounded-2xl border-2 bg-card p-5 space-y-5 shadow-sm card-machined">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Paintbrush className="h-4 w-4 text-primary" />
              {t("settings.branding")}
            </h2>

            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("settings.logo")}
              </Label>
              {editing ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleLogoDrop}
                  onClick={() => fileRef.current?.click()}
                  className={`rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 py-10 cursor-pointer transition-colors ${
                    dragOver
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/30 hover:border-primary/50"
                  }`}
                >
                  {logoDisplayUrl ? (
                    <img
                      src={logoDisplayUrl}
                      alt="Company logo"
                      className="h-20 w-20 rounded-xl object-cover"
                    />
                  ) : (
                    <HardHat className="h-8 w-8 text-muted-foreground/40" />
                  )}
                  <p className="text-sm text-muted-foreground">
                    {t("settings.dragDropLogo")}
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadLogo(f);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileRef.current?.click();
                    }}
                    disabled={busy}
                    className="rounded-2xl"
                  >
                    <Upload className="h-4 w-4 mr-1" />{" "}
                    {t("settings.uploadLogo")}
                  </Button>
                </div>
              ) : (
                <div className="h-24 w-24 rounded-2xl bg-muted flex items-center justify-center overflow-hidden shrink-0 border">
                  {logoDisplayUrl ? (
                    <img
                      src={logoDisplayUrl}
                      alt="Company logo"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <HardHat className="h-8 w-8 text-muted-foreground/50" />
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                {t("settings.brandTheme")}
                {!canUseCustomBranding && (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </Label>
              {!canUseCustomBranding ? (
                <div className="rounded-2xl border-2 border-dashed bg-muted/30 p-4 flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {t("settings.brandThemeLockedHint")}
                  </p>
                  <Button
                    asChild
                    size="sm"
                    className="rounded-xl font-bold shrink-0"
                  >
                    <Link to="/billing">
                      <Zap className="h-3.5 w-3.5 mr-1" />
                      {t("settings.upgrade")}
                    </Link>
                  </Button>
                </div>
              ) : editing ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {BRAND_PRESETS.map((preset) => {
                    const selected =
                      preset.primary === brandColor &&
                      preset.accent === secondaryColor;
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => {
                          setBrandColor(preset.primary);
                          setSecondaryColor(preset.accent);
                        }}
                        className={`flex items-center gap-2 rounded-2xl border-2 px-3 py-3 text-left transition-colors ${
                          selected
                            ? "border-foreground bg-muted/40"
                            : "border-muted-foreground/20 hover:border-muted-foreground/40"
                        }`}
                      >
                        <span className="flex -space-x-1.5 shrink-0">
                          <span
                            className="h-6 w-6 rounded-full border-2 border-background"
                            style={{ backgroundColor: preset.primary }}
                          />
                          <span
                            className="h-6 w-6 rounded-full border-2 border-background"
                            style={{ backgroundColor: preset.accent }}
                          />
                        </span>
                        <span className="text-sm font-medium truncate">
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-2 py-1 px-1">
                  <span className="flex -space-x-1.5">
                    <span
                      className="h-6 w-6 rounded-full border-2 border-background"
                      style={{ backgroundColor: brandColor }}
                    />
                    <span
                      className="h-6 w-6 rounded-full border-2 border-background"
                      style={{ backgroundColor: secondaryColor }}
                    />
                  </span>
                  <p className="text-base font-medium">
                    {findBrandPreset(brandColor, secondaryColor)?.name ??
                      t("settings.notSet")}
                  </p>
                </div>
              )}
            </div>
          </section>
          {editing && (
            <div className="flex gap-3">
              {data && (
                <Button
                  variant="outline"
                  className="flex-1 h-12 rounded-2xl font-medium"
                  onClick={() => {
                    setEditing(false);
                    setLogoUrl(data.logo_url ?? null);
                    setBrandColor(data.brand_color ?? "#F38D31");
                    setSecondaryColor(data.brand_accent_color ?? "#0F172A");
                  }}
                >
                  {t("settings.cancel")}
                </Button>
              )}
              <Button
                onClick={save}
                disabled={busy}
                className="flex-1 h-12 font-semibold rounded-2xl"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  t("settings.saveBranding")
                )}
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── Billing tab (shares PlanCards with /billing) ── */}
      {tab === "billing" && (
        <div className="space-y-6">
          <h2 className="text-xl font-bold tracking-tight">
            {t("settings.billingTitle")}
          </h2>
          <PlanCards />
        </div>
      )}

      {/* ── Account tab ── */}
      {tab === "account" && (
        <>
          <section className="rounded-2xl border-2 bg-card p-5 space-y-5 shadow-sm card-machined">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <UserCircle className="h-4 w-4 text-primary" />
              {t("settings.accountSettings")}
            </h2>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("settings.fullName")}
              </Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t("settings.fullNamePlaceholder")}
                className="h-12 rounded-2xl"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" />{" "}
                {t("settings.changePassword")}
              </Label>
              <PasswordInput
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("settings.newPasswordPlaceholder")}
                className="h-12 rounded-2xl"
              />
              <p className="text-xs text-muted-foreground">
                {t("login.passwordHint")}
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={updateAccount}
                disabled={accountBusy}
                className="flex-1 h-12 font-semibold rounded-2xl"
              >
                {accountBusy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  t("settings.updateAccount")
                )}
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-12 rounded-2xl font-semibold border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive"
                onClick={() => supabase.auth.signOut()}
              >
                {t("settings.signOut")}
              </Button>
            </div>
          </section>

          {/* Notifications */}
          <section className="rounded-2xl border-2 bg-card p-5 space-y-5 shadow-sm card-machined">
            <h2 className="font-semibold text-lg">
              {t("settings.notifications")}
            </h2>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-sm">
                  {t("settings.pushAlerts")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.pushAlertsHint")}
                </p>
              </div>
              <Switch
                checked={pushNotif}
                onCheckedChange={(checked) => {
                  setPushNotif(checked);
                }}
              />
            </div>
            <Button
              onClick={save}
              disabled={busy}
              className="w-full h-11 font-semibold rounded-2xl"
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                t("settings.saveChanges")
              )}
            </Button>
          </section>
        </>
      )}
    </div>
  );
}
