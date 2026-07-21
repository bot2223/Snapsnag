import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PhotoLightboxProps {
  src: string;
  alt?: string;
  open: boolean;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

/**
 * Full-screen photo viewer: tap/click a thumbnail elsewhere to open this,
 * then pinch (touch) or scroll-wheel (desktop) to zoom, drag to pan when
 * zoomed in, double-tap/double-click to toggle between 1x and 2.5x.
 */
export function PhotoLightbox({ src, alt, open, onClose }: PhotoLightboxProps) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(
    null,
  );
  const lastTapRef = useRef(0);
  const imgRef = useRef<HTMLImageElement>(null);

  // Reset zoom/pan whenever the lightbox is (re)opened
  useEffect(() => {
    if (open) {
      setScale(1);
      setPos({ x: 0, y: 0 });
    }
  }, [open, src]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const toggleZoom = (clientX: number, clientY: number) => {
    if (scale > 1) {
      setScale(1);
      setPos({ x: 0, y: 0 });
    } else {
      setScale(2.5);
      // Zoom roughly toward the tap point
      const rect = imgRef.current?.getBoundingClientRect();
      if (rect) {
        const offsetX = (clientX - (rect.left + rect.width / 2)) * -0.6;
        const offsetY = (clientY - (rect.top + rect.height / 2)) * -0.6;
        setPos({ x: offsetX, y: offsetY });
      }
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { startDist: dist, startScale: scale };
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapRef.current < 280) {
        toggleZoom(e.touches[0].clientX, e.touches[0].clientY);
      }
      lastTapRef.current = now;
      dragRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        origX: pos.x,
        origY: pos.y,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const next = clampScale(
        pinchRef.current.startScale * (dist / pinchRef.current.startDist),
      );
      setScale(next);
    } else if (e.touches.length === 1 && dragRef.current && scale > 1) {
      const dx = e.touches[0].clientX - dragRef.current.startX;
      const dy = e.touches[0].clientY - dragRef.current.startY;
      setPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
    }
  };

  const handleTouchEnd = () => {
    dragRef.current = null;
    pinchRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => clampScale(s - e.deltaY * 0.0015));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPos({
      x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
    });
  };
  const handleMouseUp = () => {
    dragRef.current = null;
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center select-none animate-in fade-in-0 duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-end gap-2 p-4 z-10">
        <button
          onClick={() => setScale((s) => clampScale(s === 1 ? 2.5 : 1))}
          className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          aria-label={scale > 1 ? t("lightbox.zoomOut") : t("lightbox.zoomIn")}
        >
          {scale > 1 ? (
            <ZoomOut className="h-5 w-5" />
          ) : (
            <ZoomIn className="h-5 w-5" />
          )}
        </button>
        <button
          onClick={onClose}
          className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          aria-label={t("lightbox.close")}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <img
        ref={imgRef}
        src={src}
        alt={alt ?? ""}
        onMouseDown={handleMouseDown}
        onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
        draggable={false}
        className="max-h-[90vh] max-w-[95vw] object-contain transition-transform duration-100"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          cursor: scale > 1 ? "grab" : "zoom-in",
          touchAction: "none",
        }}
        onClick={(e) => {
          if (scale === 1) toggleZoom(e.clientX, e.clientY);
        }}
      />

      <p className="absolute bottom-4 inset-x-0 text-center text-xs text-white/50">
        {t("lightbox.hint")}
      </p>
    </div>,
    document.body,
  );
}
