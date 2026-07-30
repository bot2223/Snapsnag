import { useEffect, useState } from "react";
import { X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSignedUrlCached } from "@/lib/storage-url";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { Zone } from "@/components/FloorPlanPinPicker";
import { useIsOnline } from "@/hooks/useIsOnline";

type Props = {
  floorPlan: { id: string; name: string; image_url: string; zones: Zone[] };
  onClose: () => void;
  onSaved: () => void;
};

type Draft = { x0: number; y0: number; x1: number; y1: number };

export function FloorPlanZoneEditor({ floorPlan, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const isOnline = useIsOnline();
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>(floorPlan.zones ?? []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftName, setDraftName] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSignedUrlCached("floor-plans", floorPlan.image_url).then(setImgUrl);
  }, [floorPlan.image_url]);

  const posFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const { x, y } = posFromEvent(e);
    setDrawing(true);
    setDraft({ x0: x, y0: y, x1: x, y1: y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawing || !draft) return;
    const { x, y } = posFromEvent(e);
    setDraft({ ...draft, x1: x, y1: y });
  };

  const handleMouseUp = () => {
    if (!draft) return;
    setDrawing(false);
    // Ignore accidental clicks/tiny drags rather than creating a near-zero-size zone.
    if (Math.abs(draft.x1 - draft.x0) < 0.02 || Math.abs(draft.y1 - draft.y0) < 0.02) {
      setDraft(null);
      return;
    }
    setDraftName("");
  };

  const confirmDraft = () => {
    if (!draft || !draftName.trim()) return;
    setZones((z) => [
      ...z,
      {
        id: crypto.randomUUID(),
        name: draftName.trim(),
        ...draft,
      },
    ]);
    setDraft(null);
    setDraftName("");
  };

  const removeZone = (id: string) => {
    setZones((z) => z.filter((zone) => zone.id !== id));
  };

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("floor_plans")
        .update({ zones: zones as unknown as never })
        .eq("id", floorPlan.id);
      if (error) throw error;
      toast.success(t("settings.floorPlans.zonesSaved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const rectStyle = (r: Draft | Zone) => ({
    left: `${Math.min(r.x0, r.x1) * 100}%`,
    top: `${Math.min(r.y0, r.y1) * 100}%`,
    width: `${Math.abs(r.x1 - r.x0) * 100}%`,
    height: `${Math.abs(r.y1 - r.y0) * 100}%`,
  });

  return (
    <div className="rounded-2xl border-2 border-primary/40 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">
            {t("settings.floorPlans.zonesTitle", { name: floorPlan.name })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("settings.floorPlans.zonesHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="relative w-full aspect-[4/3] rounded-xl border-2 border-dashed bg-muted/20 overflow-hidden select-none cursor-crosshair"
      >
        {imgUrl && (
          <img
            src={imgUrl}
            alt={floorPlan.name}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            draggable={false}
          />
        )}
        {zones.map((z) => (
          <div
            key={z.id}
            className="absolute border-2 border-primary bg-primary/10 flex items-start justify-start p-0.5"
            style={rectStyle(z)}
          >
            <span className="text-[10px] font-semibold bg-primary text-primary-foreground px-1 rounded">
              {z.name}
            </span>
          </div>
        ))}
        {draft && (
          <div
            className="absolute border-2 border-dashed border-primary bg-primary/20"
            style={rectStyle(draft)}
          />
        )}
      </div>

      {draft && !drawing && (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={t("settings.floorPlans.zoneNamePlaceholder")}
            className="h-10 rounded-xl flex-1"
            onKeyDown={(e) => e.key === "Enter" && confirmDraft()}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft(null)}
            className="h-10 rounded-xl"
          >
            {t("settings.cancel")}
          </Button>
          <Button
            type="button"
            onClick={confirmDraft}
            disabled={!draftName.trim()}
            className="h-10 rounded-xl font-semibold"
          >
            {t("settings.floorPlans.addZone")}
          </Button>
        </div>
      )}

      {zones.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {zones.map((z) => (
            <span
              key={z.id}
              className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2.5 py-1"
            >
              {z.name}
              <button
                type="button"
                onClick={() => removeZone(z.id)}
                className="hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Button
        type="button"
        onClick={save}
        disabled={saving || !isOnline}
        title={!isOnline ? t("offline.requiresInternet") : undefined}
        className="w-full h-11 rounded-2xl font-semibold"
      >
        {t("settings.floorPlans.saveZones")}
      </Button>
    </div>
  );
}
