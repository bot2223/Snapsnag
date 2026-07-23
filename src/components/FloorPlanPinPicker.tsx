import { useEffect, useState } from "react";
import { MapPin, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getSignedUrl } from "@/lib/storage-url";
import { useTranslation } from "react-i18next";

export type Zone = {
  id: string;
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type FloorPlan = {
  id: string;
  name: string;
  image_url: string;
  zones?: Zone[];
};

type Pin = { floorPlanId: string | null; x: number | null; y: number | null };

function findZone(zones: Zone[] | undefined, x: number, y: number) {
  if (!zones) return null;
  return (
    zones.find(
      (z) =>
        x >= Math.min(z.x0, z.x1) &&
        x <= Math.max(z.x0, z.x1) &&
        y >= Math.min(z.y0, z.y1) &&
        y <= Math.max(z.y0, z.y1),
    ) ?? null
  );
}

type Props = {
  floorPlans: FloorPlan[];
  value: Pin;
  onChange: (next: Pin) => void;
  /** Read-only preview (snag detail) vs interactive tap-to-place (log a snag). */
  interactive?: boolean;
  /** Called with the matched zone's name (or null) whenever the pin moves. */
  onZoneMatch?: (name: string | null) => void;
};

export function FloorPlanPinPicker({
  floorPlans,
  value,
  onChange,
  interactive = true,
  onZoneMatch,
}: Props) {
  const { t } = useTranslation();
  const selectedPlan =
    floorPlans.find((p) => p.id === value.floorPlanId) ?? floorPlans[0];
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!selectedPlan) {
      setImgUrl(null);
      return;
    }
    getSignedUrl("floor-plans", selectedPlan.image_url).then((url) => {
      if (active) setImgUrl(url);
    });
    return () => {
      active = false;
    };
  }, [selectedPlan]);

  if (floorPlans.length === 0) return null;

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive || !selectedPlan) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onChange({ floorPlanId: selectedPlan.id, x, y });
    onZoneMatch?.(findZone(selectedPlan.zones, x, y)?.name ?? null);
  };

  const hasPin =
    value.floorPlanId === selectedPlan?.id &&
    value.x != null &&
    value.y != null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium">
          {t("floorPlan.pinLocation")}
        </label>
        {hasPin && interactive && (
          <button
            type="button"
            onClick={() => {
              onChange({ floorPlanId: null, x: null, y: null });
              onZoneMatch?.(null);
            }}
            className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <X className="h-3 w-3" />
            {t("floorPlan.clearPin")}
          </button>
        )}
      </div>

      {floorPlans.length > 1 && (
        <Select
          value={selectedPlan?.id}
          onValueChange={(id) =>
            onChange({ floorPlanId: id, x: null, y: null })
          }
        >
          <SelectTrigger className="h-11 rounded-2xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {floorPlans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div
        onClick={handleTap}
        className={`relative w-full aspect-[4/3] rounded-2xl border-2 bg-card overflow-hidden ${
          interactive
            ? "cursor-crosshair border-dashed border-border hover:border-primary/50"
            : "border-border"
        }`}
      >
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={selectedPlan?.name}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {t("floorPlan.loading")}
          </div>
        )}
        {hasPin && (
          <div
            className="absolute -translate-x-1/2 -translate-y-full drop-shadow-md"
            style={{ left: `${value.x! * 100}%`, top: `${value.y! * 100}%` }}
          >
            <MapPin className="h-7 w-7 text-primary fill-primary/20" />
          </div>
        )}
        {!hasPin && interactive && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] font-medium bg-black/60 text-white px-2.5 py-1 rounded-full">
            {t("floorPlan.tapToPlace")}
          </div>
        )}
      </div>
    </div>
  );
}
