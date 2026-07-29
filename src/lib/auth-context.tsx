import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type UserRole = "manager" | "subcontractor" | "site_worker" | null;

export type Profile = {
  id: string;
  full_name: string | null;
  role: string;
  avatar_initials: string | null;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profileLoading: boolean;
  role: UserRole;
  profile: Profile | null;
  subcontractorId: string | null;
  subcontractorName: string | null;
  refreshProfile: () => Promise<void>;
  /** Forces a fresh (non-cached) role lookup for the current user and waits
   * for it to land in state. Used right after an action that changes the
   * user's role server-side (e.g. redeeming an invite code) so the UI never
   * shows a stale cached role before navigating. */
  refreshRole: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  profileLoading: true,
  role: null,
  profile: null,
  subcontractorId: null,
  subcontractorName: null,
  refreshProfile: async () => {},
  refreshRole: async () => {},
});

// Key used to remember an invite code across the email-confirmation gap: if
// the Supabase project requires confirming your email before a session is
// issued, we can't redeem the code at signup time (there's no session yet
// for the new user). Instead we stash the code here and redeem it the
// moment a real, confirmed session for that account shows up via SIGNED_IN.
export const PENDING_INVITE_KEY = "snapsnag_pending_invite";

const ROLE_CACHE_KEY = "snapsnag_role_cache";
const PROFILE_CACHE_KEY = "snapsnag_profile_cache";

function readProfileCache(userId: string): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const cache: Profile & { userId: string } = JSON.parse(raw);
    if (cache.userId !== userId) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeProfileCache(userId: string, profile: Profile) {
  try {
    localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ ...profile, userId }),
    );
  } catch {}
}

type RoleCache = {
  email: string;
  role: UserRole;
  subcontractorId: string | null;
  subcontractorName: string | null;
};

function readRoleCache(email: string): RoleCache | null {
  try {
    const raw = localStorage.getItem(ROLE_CACHE_KEY);
    if (!raw) return null;
    const cache: RoleCache = JSON.parse(raw);
    if (cache.email !== email) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeRoleCache(cache: RoleCache) {
  try {
    localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function clearRoleCache() {
  try {
    localStorage.removeItem(ROLE_CACHE_KEY);
  } catch {}
}

function clearProfileCache() {
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [role, setRole] = useState<UserRole>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subcontractorId, setSubcontractorId] = useState<string | null>(null);
  const [subcontractorName, setSubcontractorName] = useState<string | null>(
    null,
  );

  function applyRole(r: UserRole, id: string | null, name: string | null) {
    setRole(r);
    setSubcontractorId(id);
    setSubcontractorName(name);
  }

  async function fetchProfile(user: User) {
    setProfileLoading(true);
    // Show the last known profile immediately rather than a blank state —
    // matters most right after a full-document reload (e.g. the offline
    // shell fallback), where in-memory state starts fresh and the network
    // fetch below may not be able to complete at all.
    const cached = readProfileCache(user.id);
    if (cached) setProfile(cached);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role, avatar_initials")
        .eq("id", user.id)
        .maybeSingle();
      if (error) {
        // supabase-js resolves rather than rejects on a network failure —
        // this branch is what actually catches "offline," not the catch
        // block below. Keep showing the cached profile set above instead
        // of treating "couldn't reach the server" the same as "confirmed
        // no profile row," which is what kept wiping the cache out.
        console.warn("fetchProfile failed:", error.message);
      } else if (data) {
        setProfile(data as Profile);
        writeProfileCache(user.id, data as Profile);
      } else {
        // A genuine, error-free "no row" — trust it. Clears any stale
        // cache from a since-deleted profile too.
        setProfile(null);
        clearProfileCache();
      }
    } catch (err) {
      // Belt-and-braces for the rarer case where the client does throw
      // (e.g. an aborted request) — same reasoning as the error branch
      // above: keep the cached profile rather than clearing it.
      console.warn("fetchProfile failed:", err);
    } finally {
      setProfileLoading(false);
    }
  }

  const refreshProfile = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await fetchProfile(user);
  };

  // Bypasses the role cache entirely — always hits the DB fresh. Used after
  // redeem_invite_code so we never show a dashboard for the role the user
  // had (or defaulted to) a moment ago instead of the role they just became.
  const refreshRole = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    clearRoleCache();
    await resolveRole(user);
  };

  // If we have a code stashed from a signup that required email confirmation,
  // redeem it now that a real session exists. Safe to call unconditionally:
  // redeem_invite_code is a no-op-with-generic-error for anything that isn't
  // a currently-valid, unused code, and we always clear the key after one
  // attempt so a bad/expired code can't retry-loop on every future login.
  async function redeemPendingInviteIfAny() {
    let pending: string | null = null;
    try {
      pending = localStorage.getItem(PENDING_INVITE_KEY);
    } catch {}
    if (!pending) return;
    try {
      localStorage.removeItem(PENDING_INVITE_KEY);
    } catch {}
    try {
      await supabase.rpc("redeem_invite_code", { invite_code: pending });
    } catch (err) {
      console.warn("Pending invite redemption failed:", err);
    }
  }

  async function resolveRole(user: User | null) {
    if (!user) {
      clearRoleCache();
      clearProfileCache();
      applyRole(null, null, null);
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    // Fetch profile (for full_name, role badge etc.) — non-blocking
    fetchProfile(user);

    const cached = readRoleCache(user.email ?? "");
    if (cached) {
      applyRole(cached.role, cached.subcontractorId, cached.subcontractorName);
      refreshRoleInBackground(user);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      // Check profiles table first for site_worker role
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profErr) throw profErr; // network failure — let the catch below handle it, don't fall through

      if (prof?.role === "site_worker") {
        clearTimeout(timeout);
        applyRole("site_worker", null, null);
        writeRoleCache({
          email: user.email ?? "",
          role: "site_worker",
          subcontractorId: null,
          subcontractorName: null,
        });
        return;
      }

      // Check subcontractors table
      const { data: sub, error: subErr } = await supabase
        .from("subcontractors")
        .select("id, name")
        .eq("email", user.email as string)
        .maybeSingle();
      if (subErr) throw subErr;

      clearTimeout(timeout);
      const r: UserRole = sub ? "subcontractor" : "manager";
      const id = sub?.id ?? null;
      const name = sub?.name ?? null;
      applyRole(r, id, name);
      writeRoleCache({
        email: user.email ?? "",
        role: r,
        subcontractorId: id,
        subcontractorName: name,
      });
    } catch (err) {
      console.warn("Role resolution failed, defaulting to manager:", err);
      clearTimeout(timeout);
      applyRole("manager", null, null);
    }
  }

  async function refreshRoleInBackground(user: User) {
    try {
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profErr) return; // e.g. offline — keep the cached role already applied, don't touch it

      if (prof?.role === "site_worker") {
        applyRole("site_worker", null, null);
        writeRoleCache({
          email: user.email ?? "",
          role: "site_worker",
          subcontractorId: null,
          subcontractorName: null,
        });
        return;
      }
      const { data: sub, error: subErr } = await supabase
        .from("subcontractors")
        .select("id, name")
        .eq("email", user.email as string)
        .maybeSingle();
      if (subErr) return;

      const r: UserRole = sub ? "subcontractor" : "manager";
      applyRole(r, sub?.id ?? null, sub?.name ?? null);
      writeRoleCache({
        email: user.email ?? "",
        role: r,
        subcontractorId: sub?.id ?? null,
        subcontractorName: sub?.name ?? null,
      });
    } catch {
      // Same reasoning — a thrown network error should leave the already-
      // applied cached role alone, not fall through to a "manager" default.
    }
  }

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted) return;
        setSession(data.session ?? null);
        await resolveRole(data.session?.user ?? null);
        if (mounted) setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 5000);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (!mounted) return;
      setSession(s);
      if (event === "SIGNED_OUT") {
        clearRoleCache();
        clearProfileCache();
        applyRole(null, null, null);
        setProfile(null);
        setProfileLoading(false);
        if (mounted) setLoading(false);
        return;
      }
      if (event === "SIGNED_IN" && s?.user) {
        await redeemPendingInviteIfAny();
      }
      await resolveRole(s?.user ?? null);
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        profileLoading,
        role,
        profile,
        subcontractorId,
        subcontractorName,
        refreshProfile,
        refreshRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
