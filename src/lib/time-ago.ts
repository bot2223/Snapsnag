type Translate = (key: string, opts?: { count: number }) => string;

/** "Just now" / "5m ago" / "3h ago" / "2d ago" — never stalls at "0d ago". */
export function timeAgo(iso: string, t: Translate) {
  const mins = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 60000),
  );
  if (mins < 1) return t("dashboard.justNow");
  if (mins < 60) return t("dashboard.minsAgo", { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("dashboard.hoursAgo", { count: hrs });
  return t("dashboard.daysAgoShort", { count: Math.floor(hrs / 24) });
}
