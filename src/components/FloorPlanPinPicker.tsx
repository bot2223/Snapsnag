import { useEffect, useRef, useState } from "react";
import { MapPin, X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
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

const MIN_SCALE = 1;
const MAX_SCALE = 5;
// A tap that moves less than this (px) is a tap-to-place; more than this is
// a drag-to-pan. Needed because zooming in is exactly *for* being able to
// pan around and place a pin precisely, so both gestures start the same way.
const TAP_MOVE_THRESHOLD = 6;

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

  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(
    null,
  );

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

  // Reset zoom/pan whenever the plan changes so a leftover zoom from a
  // previous plan doesn't carry over and look broken.
  useEffect(() => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  }, [selectedPlan?.id]);

  if (floorPlans.length === 0) return null;

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const clampPos = (p: { x: number; y: number }, s: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return p;
    // Don't let the image pan so far that empty space shows inside the frame.
    const maxX = (rect.width * (s - 1)) / 2;
    const maxY = (rect.height * (s - 1)) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, p.x)),
      y: Math.min(maxY, Math.max(-maxY, p.y)),
    };
  };

  /** Maps a screen point to a 0..1 fraction of the (unzoomed) plan image.
   *  Inverts the stage's `translate(pos) scale(scale)` transform, which
   *  (with the default center transform-origin) maps a local stage point p
   *  to screen space as: screen = center + pos + scale * (p - center). */
  const pointToFraction = (clientX: number, clientY: number) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    const vx = clientX - rect.left;
    const vy = clientY - rect.top;
    const localX = (vx - rect.width / 2 - pos.x) / scale + rect.width / 2;
    const localY = (vy - rect.height / 2 - pos.y) / scale + rect.height / 2;
    return {
      x: Math.min(1, Math.max(0, localX / rect.width)),
      y: Math.min(1, Math.max(0, localY / rect.height)),
    };
  };

  const placePin = (clientX: number, clientY: number) => {
    if (!selectedPlan) return;
    const { x, y } = pointToFraction(clientX, clientY);
    onChange({ floorPlanId: selectedPlan.id, x, y });
    onZoneMatch?.(findZone(selectedPlan.zones, x, y)?.name ?? null);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive) return;
    // Touch taps are handled by the touch handlers below (which also decide
    // tap-vs-pan); this click handler covers mouse/desktop only.
    if (dragRef.current?.moved) return;
    placePin(e.clientX, e.clientY);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!interactive) return;
    e.preventDefault();
    setScale((s) => {
      const next = clampScale(s - e.deltaY * 0.0015);
      setPos((p) => clampPos(p, next));
      return next;
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!interactive || scale <= 1) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      moved: false,
    };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD) dragRef.current.moved = true;
    setPos(
      clampPos(
        { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy },
        scale,
      ),
    );
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!interactive) return;
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { startDist: dist, startScale: scale };
      dragRef.current = null;
    } else if (e.touches.length === 1) {
      dragRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        origX: pos.x,
        origY: pos.y,
        moved: false,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!interactive) return;
    if (e.touches.length === 2 && pinchRef.current) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const next = clampScale(
        pinchRef.current.startScale * (dist / pinchRef.current.startDist),
      );
      setScale(next);
      setPos((p) => clampPos(p, next));
    } else if (e.touches.length === 1 && dragRef.current) {
      const dx = e.touches[0].clientX - dragRef.current.startX;
      const dy = e.touches[0].clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD) dragRef.current.moved = true;
      if (scale > 1) {
        setPos(
          clampPos(
            { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy },
            scale,
          ),
        );
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!interactive) return;
    pinchRef.current = null;
    if (dragRef.current && !dragRef.current.moved) {
      const touch = e.changedTouches[0];
      if (touch) placePin(touch.clientX, touch.clientY);
    }
    dragRef.current = null;
  };

  const zoomBy = (factor: number) => {
    setScale((s) => {
      const next = clampScale(s * factor);
      setPos((p) => clampPos(p, next));
      return next;
    });
  };

  const resetZoom = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  const hasPin =
    value.floorPlanId === selectedPlan?.id &&
    value.x != null &&
    value.y != null;
  const isZoomed = scale > 1;

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
        ref={viewportRef}
        onClick={handleClick}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`relative w-full aspect-[4/3] rounded-2xl border-2 bg-card overflow-hidden ${
          interactive
            ? `border-dashed border-border hover:border-primary/50 ${
                isZoomed
                  ? "cursor-grab active:cursor-grabbing"
                  : "cursor-crosshair"
              }`
            : "border-border"
        }`}
        style={{ touchAction: interactive ? "none" : undefined }}
      >
        {/* Stage: everything that should zoom/pan together lives in here,
            transformed as one unit. Left at the default (center)
            transform-origin; pointToFraction() accounts for that origin. */}
        <div
          className="absolute inset-0 transition-transform duration-75"
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          }}
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
        </div>

        {!hasPin && interactive && !isZoomed && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] font-medium bg-black/60 text-white px-2.5 py-1 rounded-full pointer-events-none">
            {t("floorPlan.tapToPlace")}
          </div>
        )}

        {interactive && imgUrl && (
          <div className="absolute top-2 right-2 flex flex-col gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                zoomBy(1.6);
              }}
              className="h-8 w-8 rounded-full bg-black/60 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
              aria-label={t("lightbox.zoomIn")}
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                zoomBy(1 / 1.6);
              }}
              className="h-8 w-8 rounded-full bg-black/60 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
              aria-label={t("lightbox.zoomOut")}
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            {isZoomed && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  resetZoom();
                }}
                className="h-8 w-8 rounded-full bg-black/60 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
                aria-label={t("floorPlan.resetZoom")}
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
      {interactive && (
        <p className="text-[11px] text-muted-foreground text-center">
          {t("floorPlan.zoomHint")}
        </p>
      )}
    </div>
  );
}
