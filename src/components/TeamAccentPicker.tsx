import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BRAND_PRESETS } from "@/lib/brand-presets";

/**
 * Small, unobtrusive personal color picker — only rendered by the parent
 * shell when the manager's Business plan has unlocked it. Lives next to
 * the dark/light toggle rather than as its own nav item or banner.
 */
export function TeamAccentPicker({
  accentColor,
  onSelect,
  saving,
}: {
  accentColor: string | null;
  onSelect: (primary: string) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="p-2 hover:bg-white/10 rounded-xl transition-colors"
          aria-label={t("team.accentPicker.label")}
          title={t("team.accentPicker.label")}
        >
          <Palette size={16} className="text-navy-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 rounded-2xl">
        <p className="text-xs font-semibold text-muted-foreground mb-2">
          {t("team.accentPicker.title")}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {BRAND_PRESETS.map((preset) => {
            const selected = preset.primary === accentColor;
            return (
              <button
                key={preset.name}
                type="button"
                disabled={saving}
                onClick={() => onSelect(preset.primary)}
                title={preset.name}
                className={`h-9 rounded-xl border-2 transition-colors flex items-center justify-center ${
                  selected
                    ? "border-foreground"
                    : "border-transparent hover:border-muted-foreground/40"
                }`}
                style={{ backgroundColor: preset.primary }}
              >
                {selected && (
                  <span className="h-2 w-2 rounded-full bg-white shadow" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
