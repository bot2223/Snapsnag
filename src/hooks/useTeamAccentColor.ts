import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { findPresetByPrimary } from "@/lib/brand-presets";
import type { CSSProperties } from "react";

/**
 * Personal (not company-wide) accent color for a subcontractor or site
 * worker, unlocked only while the manager who owns them is on the
 * Business plan. Reads/writes go through get_my_team_theme /
 * set_my_accent_color — RLS only lets the *manager* write these rows, so
 * a narrow SECURITY DEFINER function does the validated self-write
 * instead of loosening table grants.
 */
export function useTeamAccentColor(enabled: boolean) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["team-theme"],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_team_theme");
      if (error) throw error;
      return data as { unlocked: boolean; accent_color: string | null };
    },
  });

  const setAccentColor = async (primary: string) => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("set_my_accent_color", {
        p_color: primary,
      });
      if (error) throw error;
      qc.setQueryData(["team-theme"], (prev: typeof data) => ({
        unlocked: prev?.unlocked ?? true,
        accent_color: primary,
      }));
    } finally {
      setSaving(false);
    }
  };

  // accent_color only stores the primary hex (it's a personal pick, not a
  // primary+accent pair), so match against presets on primary alone just
  // to borrow a legible foreground for that color.
  const preset = data?.accent_color
    ? findPresetByPrimary(data.accent_color)
    : undefined;
  const activePreset = data?.accent_color
    ? {
        primary: data.accent_color,
        foreground: preset?.foreground ?? "#FFFFFF",
      }
    : null;

  const themeVars: CSSProperties | undefined = activePreset
    ? ({
        "--primary": activePreset.primary,
        "--primary-foreground": activePreset.foreground,
      } as CSSProperties)
    : undefined;

  return {
    unlocked: !!data?.unlocked,
    isLoading,
    saving,
    accentColor: data?.accent_color ?? null,
    setAccentColor,
    themeVars,
  };
}
