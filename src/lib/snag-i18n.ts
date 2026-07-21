/**
 * Snags can carry a bilingual AI-generated description (description_en /
 * description_de) plus the legacy single `description` column used for
 * manually-typed entries and snags created before bilingual support existed.
 *
 * This picks whichever version matches the current viewer's app language,
 * so a snag logged by a German-speaking site worker still reads naturally
 * in English for an English-speaking manager, and vice versa.
 */
export type LocalizedSnag = {
  description: string | null;
  description_en?: string | null;
  description_de?: string | null;
};

export function getLocalizedDescription(
  snag: LocalizedSnag,
  lang: string,
): string {
  if (lang === "de" && snag.description_de) return snag.description_de;
  if (lang !== "de" && snag.description_en) return snag.description_en;
  // Fall back to whichever localized version exists, then the legacy field.
  return snag.description_en || snag.description_de || snag.description || "";
}
