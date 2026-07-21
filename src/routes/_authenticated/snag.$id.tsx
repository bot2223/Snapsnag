import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ImageIcon,
  Loader2,
  Send,
  X,
  Lock,
  Expand,
} from "lucide-react";
import { formatDistanceToNow, formatDistanceStrict, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { Pagination } from "@/components/Pagination";
import { useAuth } from "@/lib/auth-context";
import { usePlanLimits } from "@/lib/usePlanLimits";
import { toast } from "sonner";
import { validateImageFile } from "@/lib/file-validation";
import { compressImage } from "@/lib/image-compress";
import { getSignedUrl } from "@/lib/storage-url";
import { useTranslation } from "react-i18next";
import { getLocalizedDescription } from "@/lib/snag-i18n";

export const Route = createFileRoute("/_authenticated/snag/$id")({
  component: SnagDetail,
});

// Radix Select doesn't allow an empty-string item value (that's reserved
// internally for "no selection"), so the "Unassigned" option needs its own
// sentinel we translate to/from null at the call site.
const UNASSIGNED_VALUE = "__unassigned__";

// snag_comments and snag_activity both carry a denormalized actor_name
// column (set at write time), so we read names from that directly instead
// of embedding profiles — the profiles FK isn't declared in the generated
// types (both point independently at auth.users.id) and PostgREST can't
// infer the embed, so `profiles(...)` silently comes back null.

function DetailSkeleton() {
  return (
    <div className="space-y-0 pb-10 animate-in fade-in-0 duration-200">
      <Skeleton className="h-5 w-16 mb-3" />
      <Skeleton className="aspect-video w-full rounded-xl mb-4" />
      <Skeleton className="h-10 w-full rounded-md mb-4" />
      <div className="flex gap-2 mb-5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}

function SnagDetail() {
  const { id } = Route.useParams();
  const { user, role } = useAuth();
  const { t, i18n } = useTranslation();
  const {
    canUseResolutionPhotos,
    canUseActivityLog,
    canUseNamedComments,
    canUseSlaCountdowns,
  } = usePlanLimits();

  // Role helpers — explicit, never ambiguous
  const isManager = role === "manager";
  const isSubcontractor = role === "subcontractor";
  // site_worker is neither manager nor subcontractor

  // Back destination depends on who's viewing
  const backTo = role === "site_worker" ? "/my-snags" : "/dashboard";

  const STATUSES = [
    { v: "Open", label: t("snagDetail.statuses.Open") },
    { v: "Fixed", label: t("snagDetail.statuses.Fixed") },
  ] as const;

  // Activity rows store the status as plain text ("Open"/"Fixed") rather
  // than a translated label — this is what was showing raw English words
  // in the German UI. Route every rendered status through this.
  const statusLabel = (v: string | null) =>
    v ? t(`snagDetail.statuses.${v}`, v) : "";

  const ACTIVITY_PAGE_SIZE = 5;
  const [activityPage, setActivityPage] = useState(0);

  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [showFixModal, setShowFixModal] = useState(false);
  const [resPhoto, setResPhoto] = useState<File | null>(null);
  const [resPhotoPreview, setResPhotoPreview] = useState<string | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const resFileRef = useRef<HTMLInputElement>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const { data: snag, isLoading } = useQuery({
    queryKey: ["snag", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("snags")
        .select("*, subcontractors(name, trade)")
        .eq("id", id)
        .single();
      if (error) throw error;
      // snag-photos is a private bucket — columns store the object path,
      // resolve to short-lived signed URLs before handing data to the UI.
      const [photo_url, resolution_photo_url] = await Promise.all([
        getSignedUrl("snag-photos", data.photo_url),
        getSignedUrl("snag-photos", data.resolution_photo_url),
      ]);
      return { ...data, photo_url, resolution_photo_url };
    },
  });

  const { data: comments } = useQuery({
    queryKey: ["snag-comments", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("snag_comments")
        .select("id, content, created_at, user_id, actor_name")
        .eq("snag_id", id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  // Manager's subcontractor list, for the assignment dropdown below — same
  // query add.tsx uses when first logging a snag. Only managers can
  // (re)assign, so skip the fetch for everyone else.
  const { data: subs } = useQuery({
    queryKey: ["subs", user?.id],
    enabled: isManager,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subcontractors")
        .select("id, name, trade")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Role labels ("· manager" / "· subcontractor") are a Pro/Business-only
  // nicety, so only bother fetching them when the plan allows it. Looked up
  // separately by user_id rather than embedded on the comments query above,
  // since profiles.id -> auth.users.id and snag_comments.user_id -> auth.users.id
  // aren't declared as a joinable FK pair in the generated types.
  const commentAuthorIds = Array.from(
    new Set((comments ?? []).map((c) => c.user_id)),
  );
  const { data: commentAuthorRoles } = useQuery({
    queryKey: ["snag-comment-author-roles", id, commentAuthorIds],
    enabled: canUseNamedComments && commentAuthorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role")
        .in("id", commentAuthorIds);
      if (error) throw error;
      return new Map(data.map((p) => [p.id, p.role]));
    },
  });

  const { data: activityCount } = useQuery({
    queryKey: ["snag-activity-count", id],
    enabled: isManager && canUseActivityLog,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("snag_activity")
        .select("*", { count: "exact", head: true })
        .eq("snag_id", id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: activity } = useQuery({
    queryKey: ["snag-activity", id, activityPage],
    // Only managers on Pro/Business can see the activity log
    enabled: isManager && canUseActivityLog,
    queryFn: async () => {
      const from = activityPage * ACTIVITY_PAGE_SIZE;
      const { data, error } = await supabase
        .from("snag_activity")
        .select("*")
        .eq("snag_id", id)
        .order("created_at", { ascending: false })
        .range(from, from + ACTIVITY_PAGE_SIZE - 1);
      if (error) throw error;
      return data;
    },
  });

  const activityTotalPages = Math.max(
    1,
    Math.ceil((activityCount ?? 0) / ACTIVITY_PAGE_SIZE),
  );
  useEffect(() => {
    if (activityPage > activityTotalPages - 1)
      setActivityPage(activityTotalPages - 1);
  }, [activityTotalPages, activityPage]);

  const updateStatus = async (status: "Open" | "Fixed") => {
    if (statusBusy) return;
    setStatusBusy(true);
    try {
      const { error } = await supabase
        .from("snags")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["snag", id] });
      qc.invalidateQueries({ queryKey: ["snag-activity", id] });
      qc.invalidateQueries({ queryKey: ["snag-activity-count", id] });
      qc.invalidateQueries({ queryKey: ["snags"] });
      qc.invalidateQueries({ queryKey: ["sub-snags"] });
      if (status === "Fixed") toast.success(t("snagDetail.toast.markedFixed"));
      else toast.success(t("snagDetail.toast.statusUpdated"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStatusBusy(false);
    }
  };

  const [assignBusy, setAssignBusy] = useState(false);
  const reassignSub = async (subcontractorId: string | null) => {
    if (assignBusy) return;
    setAssignBusy(true);
    try {
      const { error } = await supabase
        .from("snags")
        .update({ subcontractor_id: subcontractorId })
        .eq("id", id);
      if (error) throw error;
      // subcontractors(name, trade) is embedded on the snag query — refetch
      // rather than patch the cache by hand so that embed comes back
      // correct for whichever sub (or none) is now assigned.
      qc.invalidateQueries({ queryKey: ["snag", id] });
      qc.invalidateQueries({ queryKey: ["snags"] });
      qc.invalidateQueries({ queryKey: ["sub-snags"] });
      toast.success(t("snagDetail.toast.assignmentUpdated"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAssignBusy(false);
    }
  };

  const markAsFixed = async (skip: boolean) => {
    if (fixBusy) return;
    setFixBusy(true);
    try {
      let resPhotoUrl: string | null = null;
      if (!skip && resPhoto && user) {
        try {
          const ext = resPhoto.name.split(".").pop() || "jpg";
          const path = `${user.id}/resolution-${id}-${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("snag-photos")
            .upload(path, resPhoto);
          if (upErr) {
            console.warn("Photo upload failed:", upErr.message);
            toast.error(t("snagDetail.toast.photoUploadWarning"));
          } else {
            resPhotoUrl = path;
          }
        } catch (uploadErr) {
          console.warn("Photo upload exception:", uploadErr);
          toast.error(t("snagDetail.toast.photoUploadWarning"));
        }
      }
      const update: {
        status: "Fixed";
        resolution_photo_url?: string | null;
      } = {
        status: "Fixed",
      };
      if (resPhotoUrl) update.resolution_photo_url = resPhotoUrl;
      const { error } = await supabase
        .from("snags")
        .update(update)
        .eq("id", id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["snag", id] });
      qc.invalidateQueries({ queryKey: ["snag-activity", id] });
      qc.invalidateQueries({ queryKey: ["snag-activity-count", id] });
      qc.invalidateQueries({ queryKey: ["snags"] });
      qc.invalidateQueries({ queryKey: ["sub-snags"] });
      setShowFixModal(false);
      toast.success(t("snagDetail.toast.markedFixed"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFixBusy(false);
    }
  };

  const addComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim() || !user || commentBusy) return;
    setCommentBusy(true);
    try {
      const { error } = await supabase.from("snag_comments").insert({
        snag_id: id,
        user_id: user.id,
        content: comment.trim(),
      });
      if (error) throw error;
      setComment("");
      qc.invalidateQueries({ queryKey: ["snag-comments", id] });
      toast.success(t("snagDetail.toast.commentAdded"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCommentBusy(false);
    }
  };

  if (isLoading || !snag) return <DetailSkeleton />;

  const isOverdue =
    !!snag.deadline_at && new Date(snag.deadline_at) < new Date();
  const deadlineDuration = snag.deadline_at
    ? formatDistanceStrict(new Date(snag.deadline_at), new Date())
    : null;

  return (
    <div className="space-y-0 pb-10 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {/* Back */}
      <Link
        to={backTo}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 mb-3"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> {t("snagDetail.back")}
      </Link>

      {/* Photo — the canvas. Pins mark the fields annotated below; positions
          are fixed percentages so the connector strip below always lines up,
          regardless of photo content or aspect ratio quirks. */}
      {snag.resolution_photo_url ? (
        <div className="grid grid-cols-2 gap-2 mb-1">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pl-1">
              {t("snagDetail.before")}
            </p>
            <button
              type="button"
              onClick={() => snag.photo_url && setLightboxSrc(snag.photo_url)}
              className="relative w-full rounded-xl overflow-hidden bg-muted aspect-video group"
            >
              {snag.photo_url ? (
                <img
                  src={snag.photo_url}
                  alt={t("snagDetail.before")}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                </div>
              )}
              {snag.photo_url && (
                <span className="absolute bottom-1.5 right-1.5 h-7 w-7 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity">
                  <Expand className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-green-600 uppercase tracking-wide pl-1">
              {t("snagDetail.after")}
            </p>
            <button
              type="button"
              onClick={() => setLightboxSrc(snag.resolution_photo_url!)}
              className="relative w-full rounded-xl overflow-hidden bg-muted aspect-video group"
            >
              <img
                src={snag.resolution_photo_url}
                alt={t("snagDetail.after")}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1.5 right-1.5 h-7 w-7 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity">
                <Expand className="h-3.5 w-3.5" />
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden bg-muted aspect-video shadow-md mb-1">
          <button
            type="button"
            onClick={() => snag.photo_url && setLightboxSrc(snag.photo_url)}
            disabled={!snag.photo_url}
            className="absolute inset-0 flex items-center justify-center group disabled:cursor-default"
          >
            {snag.photo_url ? (
              <img
                src={snag.photo_url}
                alt=""
                className="w-full h-full object-contain"
              />
            ) : (
              <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
            )}
            {snag.photo_url && (
              <span className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity">
                <Expand className="h-4 w-4" />
              </span>
            )}
          </button>
        </div>
      )}

      <PhotoLightbox
        src={lightboxSrc ?? ""}
        open={!!lightboxSrc}
        onClose={() => setLightboxSrc(null)}
      />

      {/* Title block — drafting-stamp strip for category / priority / location.
          Tighter padding/type on mobile only (sm: restores desktop sizing)
          so three columns fit 360–390px phones without "Location" wrapping
          to two lines as often; desktop spacing is unchanged. */}
      <div className="title-block title-block-tight mb-4 mt-1">
        <div>
          <span className="tb-label">{t("snagDetail.tbCategory")}</span>
          <span className="font-semibold text-sm truncate block">
            {snag.category}
          </span>
        </div>
        <div>
          <span className="tb-label">{t("snagDetail.tbPriority")}</span>
          <span
            className={`status-pill ${
              snag.priority === "Critical"
                ? "status-critical"
                : snag.priority === "High"
                  ? "status-high"
                  : snag.priority === "Medium"
                    ? "status-medium"
                    : "status-low"
            }`}
          >
            {snag.priority}
          </span>
        </div>
        <div>
          <span className="tb-label">{t("snagDetail.tbLocation")}</span>
          <span className="font-semibold text-sm truncate block">
            {snag.location || "—"}
          </span>
        </div>
      </div>

      {/* Description */}
      <div className="mb-5">
        <p className="text-base leading-relaxed">
          {getLocalizedDescription(snag, i18n.language) ||
            t("snagDetail.noDescription")}
        </p>
        {snag.notes && (
          <p className="text-sm text-muted-foreground mt-2 italic border-l-2 border-muted pl-3">
            {`"${snag.notes}"`}
          </p>
        )}
      </div>

      {/* Assigned / Deadline / Status — one plain card at every width. The
          earlier version numbered these to match pins drawn on the photo
          above; the photo pins are gone (they cropped the photo oddly and
          read as clutter rather than a helpful system), so the numbers on
          these rows no longer point at anything and are dropped too. */}
      <div className="rounded-xl border-2 bg-card px-4 card-machined shadow-sm mb-5">
        <div className="detail-field">
          <span className="text-sm text-muted-foreground field-label-col">
            {t("snagDetail.assignedTo")}
          </span>
          {isManager ? (
            <Select
              value={snag.subcontractor_id ?? UNASSIGNED_VALUE}
              onValueChange={(v) =>
                reassignSub(v === UNASSIGNED_VALUE ? null : v)
              }
              disabled={assignBusy}
            >
              <SelectTrigger className="w-40 h-9 rounded-xl">
                {assignBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SelectValue />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED_VALUE}>
                  {t("snagDetail.unassigned")}
                </SelectItem>
                {subs?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} - {s.trade}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="font-semibold text-right truncate field-value-col">
              {snag.subcontractors?.name ?? t("snagDetail.unassigned")}
            </span>
          )}
        </div>

        {canUseSlaCountdowns && snag.deadline_at && snag.status !== "Fixed" && (
          <div className="detail-field">
            <span className="text-sm text-muted-foreground field-label-col">
              {t("snagDetail.deadline")}
            </span>
            <span className="text-right field-value-col">
              <span
                className={`block font-semibold data-field whitespace-nowrap sm:whitespace-normal ${isOverdue ? "text-red-600" : ""}`}
              >
                {format(new Date(snag.deadline_at), "dd MMM yyyy HH:mm")}
              </span>
              {deadlineDuration && (
                <span
                  className={`block text-xs font-bold uppercase tracking-wide ${
                    isOverdue ? "text-red-600" : "text-muted-foreground"
                  }`}
                >
                  {isOverdue
                    ? t("snagDetail.overdueBy", { duration: deadlineDuration })
                    : t("snagDetail.dueIn", { duration: deadlineDuration })}
                </span>
              )}
            </span>
          </div>
        )}

        <div className="detail-field">
          <span className="text-sm text-muted-foreground field-label-col">
            {t("snagDetail.status")}
          </span>
          {isManager ? (
            <Select
              value={snag.status ?? ""}
              onValueChange={(v) => updateStatus(v as "Open" | "Fixed")}
              disabled={statusBusy}
            >
              <SelectTrigger className="w-40 h-9 rounded-xl">
                {statusBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SelectValue />
                )}
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.v} value={s.v}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="font-semibold capitalize">
              {statusLabel(snag.status)}
            </span>
          )}
        </div>
      </div>

      {/* Mark as Fixed — managers only, and only for Pro/Business (with upgrade nudge for Starter) */}
      {snag.status !== "Fixed" &&
        isManager &&
        (canUseResolutionPhotos ? (
          <Button
            onClick={() => setShowFixModal(true)}
            disabled={statusBusy}
            className="w-full h-14 text-base font-bold bg-green-600 hover:bg-green-700 text-white rounded-2xl transition-all duration-150 active:scale-[0.98] mb-5"
          >
            <CheckCircle2 className="h-5 w-5 mr-2" />
            {t("snagDetail.markFixed")}
          </Button>
        ) : (
          // Starter — still let them mark fixed via status dropdown, just no photo proof
          <Button
            onClick={() => updateStatus("Fixed")}
            disabled={statusBusy}
            className="w-full h-14 text-base font-bold bg-green-600 hover:bg-green-700 text-white rounded-2xl transition-all duration-150 active:scale-[0.98] mb-5"
          >
            <CheckCircle2 className="h-5 w-5 mr-2" />
            {t("snagDetail.markFixed")}
          </Button>
        ))}

      {/* Subcontractors mark their own snags fixed with photo */}
      {snag.status !== "Fixed" && isSubcontractor && (
        <Button
          onClick={() => setShowFixModal(true)}
          disabled={statusBusy}
          className="w-full h-14 text-base font-bold bg-green-600 hover:bg-green-700 text-white rounded-2xl transition-all duration-150 active:scale-[0.98] mb-5"
        >
          <CheckCircle2 className="h-5 w-5 mr-2" />
          {t("snagDetail.markFixed")}
        </Button>
      )}

      {/* Resolution photo modal */}
      {showFixModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-in fade-in-0 duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowFixModal(false);
              setResPhoto(null);
              setResPhotoPreview(null);
            }
          }}
        >
          <div className="w-full max-w-lg bg-background rounded-t-3xl p-6 space-y-4 animate-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">
                {t("snagDetail.resolutionModal.title")}
              </h2>
              <button
                onClick={() => {
                  setShowFixModal(false);
                  setResPhoto(null);
                  setResPhotoPreview(null);
                }}
              >
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("snagDetail.resolutionModal.hint")}
            </p>

            {/* FIX: no capture attribute — lets user choose camera OR gallery on mobile */}
            <input
              ref={resFileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0] ?? null;
                if (!file) {
                  setResPhoto(null);
                  setResPhotoPreview(null);
                  return;
                }
                const result = await validateImageFile(file);
                if (!result.valid) {
                  toast.error(result.error);
                  return;
                }
                const compressed = await compressImage(file);
                setResPhoto(compressed);
                setResPhotoPreview(URL.createObjectURL(compressed));
              }}
            />

            {resPhotoPreview ? (
              <div className="relative rounded-2xl overflow-hidden aspect-video bg-muted">
                <img
                  src={resPhotoPreview}
                  alt=""
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => {
                    setResPhoto(null);
                    setResPhotoPreview(null);
                  }}
                  className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => resFileRef.current?.click()}
                className="w-full aspect-video rounded-2xl border-2 border-dashed border-border bg-card flex flex-col items-center justify-center gap-2 text-muted-foreground"
              >
                <Camera className="h-8 w-8 text-primary" />
                <span className="font-medium text-sm">
                  {t("snagDetail.resolutionModal.takePhoto")}
                </span>
              </button>
            )}

            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1 h-12 rounded-2xl"
                onClick={() => markAsFixed(true)}
                disabled={fixBusy}
              >
                {fixBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("snagDetail.resolutionModal.skip")
                )}
              </Button>
              <Button
                className="flex-1 h-12 rounded-2xl bg-green-600 hover:bg-green-700 text-white font-bold"
                onClick={() => markAsFixed(false)}
                disabled={fixBusy}
              >
                {fixBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("snagDetail.resolutionModal.confirm")
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Fixed banner */}
      {snag.status === "Fixed" && (
        <div className="rounded-2xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 flex items-center gap-3 mb-5">
          <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
          <div>
            <p className="font-bold text-green-800 dark:text-green-400">
              {t("snagDetail.snagFixed")}
            </p>
            <p className="text-sm text-green-600 dark:text-green-500">
              {t("snagDetail.snagFixedHint")}
            </p>
          </div>
        </div>
      )}

      {/* Comments */}
      <section className="mb-5">
        <h2 className="font-bold text-base mb-3">{t("snagDetail.comments")}</h2>
        <div className="space-y-3 mb-4">
          {comments?.length ? (
            comments.map((c) => {
              const name = c.actor_name ?? t("snagDetail.unknownAuthor");
              const firstName = name.split(" ")[0];
              const lastInitial = name.split(" ")[1]?.[0];
              const shortName = lastInitial
                ? `${firstName} ${lastInitial}.`
                : firstName;
              const initials = name
                .split(" ")
                .map((p) => p[0])
                .filter(Boolean)
                .slice(0, 2)
                .join("")
                .toUpperCase();
              const roleLabel =
                canUseNamedComments && commentAuthorRoles?.get(c.user_id)
                  ? commentAuthorRoles.get(c.user_id)!.replace("_", " ")
                  : null;
              return (
                <div
                  key={c.id}
                  className="rounded-2xl bg-card border p-4 shadow-sm"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                      {initials || "?"}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {shortName}
                      </span>
                      {roleLabel && (
                        <>
                          {" "}
                          · <span className="capitalize">{roleLabel}</span>
                        </>
                      )}
                      {" · "}
                      {c.created_at
                        ? formatDistanceToNow(new Date(c.created_at), {
                            addSuffix: true,
                          })
                        : ""}
                    </p>
                  </div>
                  <p className="text-sm leading-relaxed">{c.content}</p>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground py-4">
              {t("snagDetail.noComments")}
            </p>
          )}
        </div>
        <form onSubmit={addComment} className="flex gap-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              isSubcontractor
                ? t("snagDetail.addUpdate")
                : t("snagDetail.addNote")
            }
            rows={2}
            className="resize-none rounded-2xl flex-1"
          />
          <Button
            type="submit"
            disabled={commentBusy || !comment.trim()}
            size="icon"
            className="h-auto w-12 shrink-0 rounded-2xl"
          >
            {commentBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </section>

      {/* Activity log — managers on Pro/Business only */}
      {isManager && canUseActivityLog && (
        <section>
          <h2 className="font-bold text-base mb-3">
            {t("snagDetail.activity")}
          </h2>
          <ol className="space-y-3">
            {activity?.map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="h-2.5 w-2.5 mt-1.5 rounded-full bg-primary shrink-0 ring-4 ring-primary/20" />
                <div className="flex-1">
                  <p>
                    {a.action === "created" && (
                      <>
                        {t("snagDetail.activity_created")}{" "}
                        <span className="font-semibold">
                          {statusLabel(a.to_status)}
                        </span>
                      </>
                    )}
                    {a.action === "status_changed" && (
                      <>
                        {t("snagDetail.activity_status_changed")}{" "}
                        <span className="font-semibold">
                          {statusLabel(a.from_status)}
                        </span>{" "}
                        {t("snagDetail.activity_to")}{" "}
                        <span className="font-semibold">
                          {statusLabel(a.to_status)}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {a.actor_name ? `${a.actor_name} · ` : ""}
                    {a.created_at
                      ? formatDistanceToNow(new Date(a.created_at), {
                          addSuffix: true,
                        })
                      : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <Pagination
            page={activityPage}
            totalPages={activityTotalPages}
            onPageChange={setActivityPage}
          />
        </section>
      )}

      {/* Upgrade nudge — Starter managers see a locked activity log prompt */}
      {isManager && !canUseActivityLog && (
        <section className="rounded-2xl border-2 border-dashed p-4 flex items-center gap-3 text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" />
          <p className="text-sm">
            {t("snagDetail.activityLogLocked")}{" "}
            <Link
              to="/billing"
              className="text-primary font-medium underline underline-offset-2"
            >
              {t("snagDetail.upgradeToPro")}
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
