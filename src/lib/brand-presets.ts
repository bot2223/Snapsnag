// Curated primary/accent/foreground triples — each pre-checked to stay
// legible on both light and dark backgrounds, so nobody can land on a
// combo that disappears in dark mode (or has unreadable white-on-yellow
// text) the way a free color input could.
export type BrandPreset = {
  name: string;
  primary: string;
  accent: string;
  /** Text color to use on top of `primary` (e.g. nav icons/labels). */
  foreground: string;
};

export const BRAND_PRESETS: BrandPreset[] = [
  {
    name: "Site Orange",
    primary: "#F38D31",
    accent: "#0F172A",
    foreground: "#FFFFFF",
  },
  {
    name: "Safety Yellow",
    primary: "#F5B700",
    accent: "#1E293B",
    foreground: "#1E293B",
  },
  {
    name: "Steel Blue",
    primary: "#3B82F6",
    accent: "#0F172A",
    foreground: "#FFFFFF",
  },
  {
    name: "Forest Green",
    primary: "#22C55E",
    accent: "#14532D",
    foreground: "#FFFFFF",
  },
  {
    name: "Concrete Red",
    primary: "#EF4444",
    accent: "#1F2937",
    foreground: "#FFFFFF",
  },
  {
    name: "Slate",
    primary: "#94A3B8",
    accent: "#0F172A",
    foreground: "#0F172A",
  },
];

export function findBrandPreset(
  primary?: string | null,
  accent?: string | null,
) {
  return BRAND_PRESETS.find(
    (p) => p.primary === primary && p.accent === accent,
  );
}

/** Looks up a preset by its primary color alone (used for the personal
 * accent-color picker, which only stores one color, not a primary+accent
 * pair) — just to borrow that preset's legible foreground color. */
export function findPresetByPrimary(primary?: string | null) {
  return BRAND_PRESETS.find((p) => p.primary === primary);
}
