import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Plus,
  Mail,
  Phone,
  ChevronRight,
  Loader2,
  UsersRound,
  X,
  Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { getEdgeFunctionErrorMessage } from "@/lib/edge-function-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { usePlanLimits } from "@/lib/usePlanLimits";
import { LimitDialog } from "@/components/LimitDialog";

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPage,
});

// ─── Types ───────────────────────────────────────────────────────────────────
type TeamMember =
  | {
      kind: "manager";
      id: string;
      name: string;
      email: string;
      initials: string;
    }
  | {
      kind: "subcontractor";
      id: string;
      authUserId: string | null;
      name: string;
      email: string | null;
      phone: string | null;
      trade: string;
      initials: string;
    }
  | {
      kind: "site_worker";
      id: string;
      name: string;
      email: string;
      initials: string;
    };

type ActivityItem = { id: string; label: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function AvatarCircle({
  initials,
  className = "",
}: {
  initials: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-full bg-navy text-navy-foreground flex items-center justify-center font-bold text-sm shrink-0 ${className}`}
    >
      {initials}
    </div>
  );
}

// ─── Manage Sheet ─────────────────────────────────────────────────────────────
function ManageSheet({
  member,
  onClose,
  onRemoved,
}: {
  member: TeamMember;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: activity } = useQuery({
    queryKey: ["team-activity", member.id, member.kind],
    retry: false,
    queryFn: async (): Promise<ActivityItem[]> => {
      if (member.kind === "subcontractor") {
        // Step 1: get snag IDs assigned to this subcontractor
        const { data: snagRows, error: snagRowsError } = await supabase
          .from("snags")
          .select("id, location")
          .eq("subcontractor_id", member.id);
        if (snagRowsError) throw snagRowsError;
        const snagIds = (snagRows ?? []).map((s) => s.id);
        const locationMap: Record<string, string> = {};
        (snagRows ?? []).forEach((s) => {
          locationMap[s.id] = s.location;
        });

        if (snagIds.length === 0) return [];

        // Step 2: query activity for those snag IDs
        const { data, error } = await supabase
          .from("snag_activity")
          .select("id, action, to_status, snag_id")
          .in("snag_id", snagIds)
          .order("created_at", { ascending: false })
          .limit(3);
        if (error) throw error;
        return (data ?? []).map((a) => ({
          id: a.id,
          label:
            a.action === "status_changed"
              ? t("team.activityStatusChanged", {
                  location: locationMap[a.snag_id] ?? "–",
                  status: a.to_status
                    ? t(`snagDetail.statuses.${a.to_status}`, a.to_status)
                    : "",
                })
              : t("team.activitySnagCreated", {
                  location: locationMap[a.snag_id] ?? "–",
                }),
        }));
      }
      if (member.kind === "site_worker") {
        // Site-worker-created snags always have user_id rewritten to the
        // billing manager by a server-side trigger — manager_id is where
        // the actual creator's id ends up instead, so that's what "this
        // site worker's activity" needs to filter on.
        const { data } = await supabase
          .from("snags")
          .select("id, location")
          .eq("manager_id", member.id)
          .order("created_at", { ascending: false })
          .limit(3);
        return (data ?? []).map((s) => ({
          id: s.id,
          label: t("team.activitySnagCreated", { location: s.location }),
        }));
      }
      return [];
    },
  });

  const remove = async () => {
    setBusy(true);
    try {
      if (member.kind === "subcontractor") {
        // Delete subcontractor record
        const { error } = await supabase
          .from("subcontractors")
          .delete()
          .eq("id", member.id);
        if (error) throw error;
        // Revoke auth if they have an account
        if (member.authUserId) {
          await supabase.functions.invoke("delete-user", {
            body: { user_id: member.authUserId },
          });
        }
      } else if (member.kind === "site_worker") {
        // Delete profile + auth account
        await supabase.functions.invoke("delete-user", {
          body: { user_id: member.id },
        });
      }
      toast.success(t("team.toast.removed", { name: member.name }));
      onRemoved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const roleLabel =
    member.kind === "subcontractor"
      ? `${t("team.roles.subcontractor")} · ${member.trade}`
      : t(`team.roles.${member.kind}`);

  const roleColor =
    member.kind === "manager"
      ? "bg-orange-500/10 text-orange-500"
      : member.kind === "subcontractor"
        ? "bg-orange-100 text-orange-700"
        : "bg-blue-100 text-blue-700";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-in fade-in-0 duration-150">
      <div className="w-full max-w-lg bg-background rounded-t-3xl p-6 space-y-5 animate-in slide-in-from-bottom-4 duration-200 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <AvatarCircle
              initials={member.initials}
              className="h-14 w-14 text-base"
            />
            <div>
              <h2 className="font-bold text-lg leading-tight">{member.name}</h2>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleColor}`}
              >
                {roleLabel}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-muted flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Contact info */}
        <div className="space-y-2">
          {member.email && (
            <a
              href={`mailto:${member.email}`}
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <Mail className="h-4 w-4 shrink-0" />
              {member.email}
            </a>
          )}
          {member.kind === "subcontractor" && !member.authUserId && (
            <p className="text-sm text-muted-foreground italic">
              {t("team.inviteNotYetAccepted")}
            </p>
          )}
          {member.kind === "subcontractor" && member.phone && (
            <a
              href={`tel:${member.phone}`}
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <Phone className="h-4 w-4 shrink-0" />
              {member.phone}
            </a>
          )}
        </div>

        {/* Recent activity */}
        {member.kind !== "manager" && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {t("team.recentActivity")}
            </p>
            {!activity || activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("team.noActivity")}
              </p>
            ) : (
              <ul className="space-y-2">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary mt-2 shrink-0" />
                    {a.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Actions */}
        {member.kind !== "manager" && (
          <div className="space-y-3 pt-2">
            {!showConfirm ? (
              <>
                <Button
                  variant="destructive"
                  className="w-full h-12 rounded-2xl font-semibold"
                  onClick={() => setShowConfirm(true)}
                >
                  {t("team.removePerson")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-12 rounded-2xl"
                  onClick={onClose}
                >
                  {t("team.close")}
                </Button>
              </>
            ) : (
              <div className="rounded-2xl border-2 border-destructive/30 bg-destructive/5 p-4 space-y-3">
                <p className="font-semibold text-sm">
                  {t("team.confirmRemove", { name: member.name })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("team.confirmRemoveHint")}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 h-11 rounded-2xl"
                    onClick={() => setShowConfirm(false)}
                    disabled={busy}
                  >
                    {t("team.cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1 h-11 rounded-2xl font-semibold"
                    onClick={remove}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t("team.confirm")
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {member.kind === "manager" && (
          <Button
            variant="outline"
            className="w-full h-12 rounded-2xl"
            onClick={onClose}
          >
            {t("team.close")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Add Person Dialog ─────────────────────────────────────────────────────────
function AddPersonDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [tab, setTab] = useState<"subcontractor" | "site_worker">(
    "subcontractor",
  );
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", trade: "" });
  // Both roles now join via a shareable link instead of the manager typing
  // the person's email (see create-invite-link edge function + the
  // 20260710130000_invite_link_subcontractors.sql migration). Once
  // generated, we show the link here instead of closing the dialog
  // immediately, so the manager has something to copy/share.
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const submit = async () => {
    if (!user) return;
    if (!form.name.trim() || (tab === "subcontractor" && !form.trade.trim())) {
      toast.error(
        tab === "subcontractor"
          ? "Name and trade are required"
          : "Name is required",
      );
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        url: string;
        error?: string;
      }>("create-invite-link", {
        body:
          tab === "subcontractor"
            ? {
                role: "subcontractor",
                name: form.name.trim(),
                trade: form.trade.trim(),
              }
            : { role: "site_worker", name: form.name.trim() },
      });
      if (error) throw error;
      if (!data?.url)
        throw new Error(data?.error ?? "Failed to create invite link");
      setInviteLink(data.url);
      onAdded(); // refresh team list / pending-invite state in background; dialog stays open to show the link
    } catch (e) {
      toast.error(
        await getEdgeFunctionErrorMessage(e, "Failed to create invite link"),
      );
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success(t("team.toast.linkCopied"));
    } catch {
      toast.error(t("team.toast.copyFailed"));
    }
  };

  const shareLink = async () => {
    if (!inviteLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          url: inviteLink,
          title:
            tab === "subcontractor"
              ? t("team.addDialog.addSubcontractor")
              : t("team.addDialog.inviteSiteWorker"),
        });
      } catch {
        // user cancelled the share sheet — not an error
      }
    } else {
      copyLink();
    }
  };

  if (inviteLink) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-in fade-in-0 duration-150">
        <div className="w-full max-w-lg bg-background rounded-t-3xl p-6 space-y-5 animate-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-xl">{t("team.inviteLink.title")}</h2>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-full bg-muted flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("team.inviteLink.hint")}
          </p>
          <div className="rounded-2xl bg-muted px-4 py-3 text-sm font-mono break-all select-all">
            {inviteLink}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={copyLink}
              variant="outline"
              className="flex-1 h-12 rounded-2xl font-semibold"
            >
              {t("team.inviteLink.copy")}
            </Button>
            <Button
              onClick={shareLink}
              className="flex-1 h-12 rounded-2xl font-semibold"
            >
              {t("team.inviteLink.share")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            {t("team.inviteLink.expiry")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-in fade-in-0 duration-150">
      <div className="w-full max-w-lg bg-background rounded-t-3xl p-6 space-y-5 animate-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-xl">{t("team.addDialog.title")}</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-muted flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Segmented control */}
        <div className="flex rounded-2xl bg-muted p-1 gap-1">
          {(["subcontractor", "site_worker"] as const).map((t_) => (
            <button
              key={t_}
              onClick={() => setTab(t_)}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                tab === t_
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {t_ === "subcontractor"
                ? t("team.addDialog.subcontractor")
                : t("team.addDialog.siteWorker")}
            </button>
          ))}
        </div>

        {/* Form fields — same shape for both roles now: the manager only
            enters what they already know (name, plus trade for
            subcontractors); the person filling in the rest (email,
            password) happens on their end when they open the invite
            link. */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              {t("team.addDialog.name")}
            </Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("team.addDialog.namePlaceholder")}
              className="h-11 rounded-2xl"
            />
          </div>
          {tab === "subcontractor" && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                {t("team.addDialog.trade")}
              </Label>
              <Input
                value={form.trade}
                onChange={(e) => setForm({ ...form, trade: e.target.value })}
                placeholder={t("team.addDialog.tradePlaceholder")}
                className="h-11 rounded-2xl"
              />
            </div>
          )}
        </div>

        <Button
          onClick={submit}
          disabled={busy}
          className="w-full h-12 font-semibold rounded-2xl"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : tab === "subcontractor" ? (
            t("team.addDialog.addSubcontractor")
          ) : (
            t("team.addDialog.inviteSiteWorker")
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Team Page ─────────────────────────────────────────────────────────────────
function TeamPage() {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<TeamMember | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showMemberLimit, setShowMemberLimit] = useState(false);

  const { canAddMember, memberLimit, memberCount } = usePlanLimits();
  const [search, setSearch] = useState("");

  const { data: members, isLoading } = useQuery({
    queryKey: ["team", user?.id],
    enabled: !!user,
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<TeamMember[]> => {
      // Fetch subcontractors
      const { data: subs, error: subsError } = await supabase
        .from("subcontractors")
        .select("id, name, email, phone, trade, auth_user_id")
        .order("name");
      if (subsError) throw subsError;

      // Fetch site workers from profiles
      const { data: workers, error: workersError } = await supabase
        .from("profiles")
        .select("id, full_name, role, email")
        .eq("role", "site_worker")
        .order("full_name");
      if (workersError) throw workersError;

      const result: TeamMember[] = [];

      // Manager first
      if (user && profile) {
        result.push({
          kind: "manager",
          id: user.id,
          name:
            profile.full_name && profile.full_name.trim()
              ? profile.full_name
              : "Manager",
          email: user.email ?? "",
          initials:
            profile.avatar_initials ??
            getInitials(profile.full_name ?? user.email ?? "M"),
        });
      }

      // Subcontractors alphabetically
      for (const s of subs ?? []) {
        result.push({
          kind: "subcontractor",
          id: s.id,
          authUserId: s.auth_user_id ?? null,
          name: s.name,
          email: s.email,
          phone: s.phone,
          trade: s.trade,
          initials: getInitials(s.name),
        });
      }

      // Site workers alphabetically
      for (const w of workers ?? []) {
        result.push({
          kind: "site_worker",
          id: w.id,
          name: w.full_name ?? "Site Worker",
          email: w.email ?? "",
          initials: w.full_name ? getInitials(w.full_name) : "SW",
        });
      }

      return result;
    },
  });

  // Active snag counts per member — one batched query, counted client-side
  const { data: activeCounts } = useQuery({
    queryKey: ["team-active-counts", user?.id],
    enabled: !!user,
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<{
      subcontractorCounts: Record<string, number>;
      workerCounts: Record<string, number>;
    }> => {
      const { data, error } = await supabase
        .from("snags")
        .select("subcontractor_id, user_id, manager_id")
        .neq("status", "Fixed");
      if (error) throw error;

      const subcontractorCounts: Record<string, number> = {};
      const workerCounts: Record<string, number> = {};
      for (const row of data ?? []) {
        if (row.subcontractor_id) {
          subcontractorCounts[row.subcontractor_id] =
            (subcontractorCounts[row.subcontractor_id] ?? 0) + 1;
        } else if (row.manager_id) {
          // Site-worker-created snag — user_id has been rewritten to the
          // billing manager, so manager_id is where the actual creator's
          // id lives.
          workerCounts[row.manager_id] =
            (workerCounts[row.manager_id] ?? 0) + 1;
        }
      }
      return { subcontractorCounts, workerCounts };
    },
  });

  const activeCountFor = (m: TeamMember): number => {
    if (m.kind === "subcontractor")
      return activeCounts?.subcontractorCounts[m.id] ?? 0;
    if (m.kind === "site_worker") return activeCounts?.workerCounts[m.id] ?? 0;
    return 0;
  };

  const filteredMembers = members?.filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      (m.email ?? "").toLowerCase().includes(q)
    );
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["team"] });
    qc.invalidateQueries({ queryKey: ["member-count"] });
  };

  const roleColor = (kind: string) => {
    if (kind === "manager") return "bg-orange-500/10 text-orange-500";
    if (kind === "subcontractor") return "bg-orange-100 text-orange-700";
    return "bg-blue-100 text-blue-700";
  };

  const roleLabel = (m: TeamMember) => {
    if (m.kind === "manager") return t("team.roles.manager");
    if (m.kind === "subcontractor")
      return `${t("team.roles.subcontractor")} · ${m.trade}`;
    return t("team.roles.site_worker");
  };

  return (
    <div className="space-y-5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("team.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("team.subtitle", { count: members?.length ?? 0 })}
          </p>
        </div>
        <Button
          onClick={() =>
            canAddMember ? setShowAdd(true) : setShowMemberLimit(true)
          }
          className="h-11 font-semibold rounded-2xl"
        >
          <Plus className="h-4 w-4 mr-1" /> {t("team.addPerson")}
        </Button>
      </div>

      {/* Search bar — was desktop-only despite being fully responsive
          markup; team lists grow long enough on mobile (managers with 10+
          subcontractors/site workers) that filtering matters there too. */}
      {!isLoading && members && members.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("team.searchPlaceholder")}
            className="w-full pl-9 pr-3 h-11 md:h-10 rounded-xl border-2 bg-card text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {isLoading && (
        <div className="space-y-3 md:grid md:grid-cols-3 md:gap-4 md:space-y-0">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-2xl border-2 bg-card p-4 flex items-center gap-3"
            >
              <Skeleton className="h-14 w-14 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && members?.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed bg-card py-12 text-center">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <UsersRound className="h-7 w-7 text-primary" />
          </div>
          <p className="font-semibold text-lg mb-1">{t("team.noTeam")}</p>
          <p className="text-sm text-muted-foreground">
            {t("team.noTeamHint")}
          </p>
        </div>
      )}

      {/* Mobile list */}
      {!isLoading && filteredMembers && filteredMembers.length > 0 && (
        <div className="md:hidden space-y-3">
          {filteredMembers.map((m) => {
            const isMe = m.id === user?.id;
            return (
              <div
                key={`${m.kind}-${m.id}`}
                className="rounded-2xl border-2 bg-card p-4 flex items-center gap-3 hover:shadow-sm transition-shadow duration-150"
              >
                <AvatarCircle
                  initials={m.initials}
                  className="h-14 w-14 text-base"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">
                    {m.name}
                    {isMe && (
                      <span className="ml-1.5 text-muted-foreground font-normal text-sm">
                        {t("team.you")}
                      </span>
                    )}
                  </p>
                  <span
                    className={`block w-fit max-w-full truncate text-xs font-semibold px-2 py-0.5 rounded-full ${roleColor(m.kind)}`}
                  >
                    {roleLabel(m)}
                  </span>
                </div>
                {!isMe && (
                  <button
                    onClick={() => setSelected(m)}
                    className="flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary/80 transition-colors shrink-0"
                  >
                    {t("team.manage")} <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Desktop card grid */}
      {!isLoading && filteredMembers && filteredMembers.length > 0 && (
        <div className="hidden md:grid md:grid-cols-3 gap-4">
          {filteredMembers.map((m) => {
            const isMe = m.id === user?.id;
            return (
              <div
                key={`${m.kind}-${m.id}`}
                className="rounded-2xl border-2 bg-card p-4 card-machined hover:shadow-md transition-shadow duration-150 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <AvatarCircle
                      initials={m.initials}
                      className="h-11 w-11 text-sm"
                    />
                    <div className="min-w-0">
                      <p className="font-semibold truncate text-sm">
                        {m.name}
                        {isMe && (
                          <span className="ml-1 text-muted-foreground font-normal text-xs">
                            {t("team.you")}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {m.email ??
                          (m.kind === "subcontractor"
                            ? t("team.inviteNotYetAccepted")
                            : "")}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${roleColor(m.kind)}`}
                  >
                    {m.kind === "manager"
                      ? t("team.roles.manager")
                      : m.kind === "subcontractor"
                        ? t("team.roles.subcontractor")
                        : t("team.roles.site_worker")}
                  </span>
                </div>

                <div className="border-t pt-3">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    {t("team.activeSnags")}
                  </p>
                  <p className="text-2xl font-bold mt-0.5">
                    {m.kind === "manager" ? "—" : activeCountFor(m)}
                  </p>
                </div>

                {!isMe && (
                  <div className="flex gap-2 mt-auto pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 rounded-xl"
                      onClick={() => setSelected(m)}
                    >
                      {t("team.edit")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive"
                      onClick={() => setSelected(m)}
                    >
                      {t("team.removePerson")}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showMemberLimit && (
        <LimitDialog
          type="member"
          used={memberCount}
          limit={memberLimit}
          onClose={() => setShowMemberLimit(false)}
        />
      )}

      {selected && (
        <ManageSheet
          member={selected}
          onClose={() => setSelected(null)}
          onRemoved={invalidate}
        />
      )}

      {showAdd && (
        <AddPersonDialog
          onClose={() => setShowAdd(false)}
          onAdded={invalidate}
        />
      )}
    </div>
  );
}
