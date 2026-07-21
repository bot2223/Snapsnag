import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { Camera, Loader2, Sparkles, X, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateSnagDescription } from "@/lib/ai.functions";
import { validateImageFile } from "@/lib/file-validation";
import { compressImage } from "@/lib/image-compress";
import { usePlanLimits } from "@/lib/usePlanLimits";
import { LimitDialog } from "@/components/LimitDialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/add")({
  component: AddSnag,
});

const CATEGORIES = [
  "Structural",
  "Electrical",
  "Plumbing",
  "Finishing",
  "Safety",
] as const;
const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;

const PRIORITY_COLORS: Record<string, string> = {
  Low: "text-green-600",
  Medium: "text-yellow-600",
  High: "text-orange-600",
  Critical: "text-red-600",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function AddSnag() {
  const { user, role } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const { canAddSnag, snagLimit, snagCount } = usePlanLimits();
  const [showLimit, setShowLimit] = useState(false);

  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState<string>("");
  const [subId, setSubId] = useState<string>("");
  const [priority, setPriority] = useState<string>("Medium");
  const [notes, setNotes] = useState("");
  const [aiDesc, setAiDesc] = useState("");
  const [aiDescEn, setAiDescEn] = useState<string | null>(null);
  const [aiDescDe, setAiDescDe] = useState<string | null>(null);
  const [aiRan, setAiRan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);

  const { data: subs } = useQuery({
    queryKey: ["subs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subcontractors")
        .select("id, name, trade")
        .order("name");
      if (error) throw error;
      return data;
    },
    // Only managers can assign subcontractors — skip the fetch entirely for
    // everyone else instead of pulling data that'll never render.
    enabled: role === "manager",
  });

  const onPhoto = async (file: File | null) => {
    if (!file) {
      setPhoto(null);
      setPhotoPreview(null);
      return;
    }
    const result = await validateImageFile(file);
    if (!result.valid) {
      toast.error(result.error);
      return;
    }
    const compressed = await compressImage(file);
    setPhoto(compressed);
    setPhotoPreview(URL.createObjectURL(compressed));
  };

  const generateAI = async () => {
    if (!location) {
      toast.error(t("add.toast.addLocation"));
      return;
    }
    if (!photo) {
      toast.error(t("add.toast.addPhoto"));
      return;
    }
    setGenBusy(true);
    try {
      const photoBase64 = await fileToBase64(photo);
      const res = await generateSnagDescription({
        location,
        category,
        notes,
        photoBase64,
        photoMimeType: photo.type || "image/jpeg",
      });
      setAiDescEn(res.description_en);
      setAiDescDe(res.description_de);
      setAiDesc(
        i18n.language === "de" ? res.description_de : res.description_en,
      );
      setPriority(res.priority);
      if (!category) setCategory(res.category);
      setAiRan(true);
      toast.success(t("add.toast.aiComplete"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!canAddSnag) {
      setShowLimit(true);
      return;
    }
    if (!category) {
      toast.error(t("add.toast.selectCategory"));
      return;
    }
    setBusy(true);
    try {
      let photoUrl: string | null = null;
      if (photo) {
        const ext = photo.name.split(".").pop() || "jpg";
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("snag-photos")
          .upload(path, photo);
        if (upErr) {
          console.warn("Photo upload failed:", upErr.message);
          toast.error(t("add.toast.photoFailed"));
        } else {
          // snag-photos is a private bucket — store the path, not a public
          // URL. Readers resolve it to a short-lived signed URL at render time.
          photoUrl = path;
        }
      }
      const description =
        aiDesc ||
        `${category} issue at ${location}.${notes ? " " + notes : ""}`;
      // If the AI ran and the person didn't touch the text, keep both
      // original language versions so each viewer reads it in their own
      // language. If they edited it, that's now their intended wording —
      // save it as-is for BOTH languages rather than showing a German
      // viewer text an English speaker never actually approved.
      const currentLang = i18n.language === "de" ? "de" : "en";
      const originalForCurrentLang = currentLang === "de" ? aiDescDe : aiDescEn;
      const wasEdited = aiRan && aiDesc !== originalForCurrentLang;
      const description_en = !aiRan ? null : wasEdited ? aiDesc : aiDescEn;
      const description_de = !aiRan ? null : wasEdited ? aiDesc : aiDescDe;
      const { error } = await supabase.from("snags").insert({
        user_id: user.id,
        photo_url: photoUrl,
        description,
        description_en,
        description_de,
        location,
        category: category as (typeof CATEGORIES)[number],
        subcontractor_id: subId || null,
        priority: priority as (typeof PRIORITIES)[number],
        notes: notes || null,
      });
      if (error) throw error;
      toast.success(t("add.toast.logged"));
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form
        onSubmit={submit}
        className="space-y-5 pb-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("add.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("add.subtitle")}</p>
        </div>

        <div>
          <Label className="text-sm font-medium mb-2 block">
            {t("add.photo")}
          </Label>
          {/* FIX: no capture attribute — lets user choose camera OR gallery on mobile */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void onPhoto(e.target.files?.[0] ?? null);
            }}
          />
          {photoPreview ? (
            <div className="relative rounded-2xl overflow-hidden bg-muted aspect-video shadow-md">
              <img
                src={photoPreview}
                alt=""
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => onPhoto(null)}
                className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors active:scale-95"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full aspect-video rounded-2xl border-2 border-dashed border-border bg-card flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/50 hover:bg-primary/5 active:scale-[0.99] transition-all cursor-pointer"
            >
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-1">
                <Camera className="h-7 w-7 text-primary" />
              </div>
              <span className="font-semibold text-foreground">
                {t("add.takePhoto")}
              </span>
              <span className="text-xs text-muted-foreground/70">
                {t("add.aiWillAnalyse")}
              </span>
            </button>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="loc" className="text-sm font-medium">
            {t("add.location")}
          </Label>
          <Input
            id="loc"
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t("add.locationPlaceholder")}
            className="h-12 rounded-2xl"
          />
        </div>

        <div className="rounded-2xl border-2 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">{t("add.aiAnalysis")}</p>
                <p className="text-xs text-muted-foreground">
                  {aiRan ? t("add.aiSuggested") : t("add.aiHint")}
                </p>
              </div>
            </div>
            {aiRan && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-100 px-2 py-1 rounded-full shrink-0">
                <CheckCircle2 className="h-3 w-3" />
                {t("add.aiComplete")}
              </span>
            )}
          </div>
          <Button
            type="button"
            onClick={generateAI}
            disabled={genBusy}
            variant="outline"
            className={`w-full h-11 rounded-2xl font-semibold transition-all ${genBusy ? "animate-pulse" : ""}`}
          >
            {genBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t("add.analysing")}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                {aiRan ? t("add.reanalyse") : t("add.generate")}
              </>
            )}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              {t("add.category")}
              {aiRan && category && (
                <span className="text-xs text-primary font-normal">
                  {t("add.aiSet")}
                </span>
              )}
            </Label>
            <Select value={category} onValueChange={setCategory} required>
              <SelectTrigger className="h-12 rounded-2xl">
                <SelectValue placeholder={t("add.selectCategory")} />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`add.categories.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              {t("add.priority")}
              {aiRan && (
                <span
                  className={`text-xs font-semibold ${PRIORITY_COLORS[priority]}`}
                >
                  {t("add.aiSet")}
                </span>
              )}
            </Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger
                className={`h-12 rounded-2xl font-medium ${PRIORITY_COLORS[priority]}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p} className={PRIORITY_COLORS[p]}>
                    {t(`add.priorities.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Assigning a subcontractor is a manager decision — a site worker
            logging a snag has no subcontractors of their own to assign it
            to (subs is scoped to a manager's own contacts), and letting
            them see this field just prompts a confusing empty dropdown. */}
        {role === "manager" && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("add.assignSub")}</Label>
            <Select value={subId} onValueChange={setSubId}>
              <SelectTrigger className="h-12 rounded-2xl">
                <SelectValue
                  placeholder={
                    subs?.length ? t("add.selectSub") : t("add.noSubs")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {subs?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} - {s.trade}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {subs?.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No subcontractors yet.{" "}
                <Link
                  to="/team"
                  className="text-primary font-medium underline underline-offset-2"
                >
                  Add one in Team →
                </Link>
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="notes" className="text-sm font-medium">
            {t("add.notes")}
          </Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("add.notesPlaceholder")}
            rows={3}
            className="rounded-2xl resize-none"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-2">
            {t("add.description")}
            {aiRan && (
              <span className="text-xs text-muted-foreground font-normal">
                {t("add.aiGenerated")}
              </span>
            )}
          </Label>
          <Textarea
            value={aiDesc}
            onChange={(e) => setAiDesc(e.target.value)}
            placeholder={t("add.descPlaceholder")}
            rows={3}
            className="rounded-2xl resize-none"
          />
        </div>

        <Button
          type="submit"
          disabled={busy}
          className="w-full h-14 text-base font-bold rounded-2xl bg-primary hover:bg-primary/90 transition-all active:scale-[0.98]"
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            t("add.logSnag")
          )}
        </Button>
      </form>

      {showLimit && (
        <LimitDialog
          type="snag"
          used={snagCount}
          limit={snagLimit}
          onClose={() => setShowLimit(false)}
        />
      )}
    </>
  );
}
