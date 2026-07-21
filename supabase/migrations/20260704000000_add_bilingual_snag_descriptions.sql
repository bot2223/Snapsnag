-- Store both an English and German version of the AI-generated description
-- so every viewer sees the snag in their own app language, regardless of
-- which language the person who logged it was using.
-- `description` remains the canonical/legacy field (used for manual entries
-- and as a fallback when a localized version isn't available).
alter table public.snags
  add column if not exists description_en text,
  add column if not exists description_de text;

comment on column public.snags.description_en is 'AI-generated English description (or manual description if no German counterpart exists).';
comment on column public.snags.description_de is 'AI-generated German description. Null for manually-typed descriptions or snags created before this feature.';
