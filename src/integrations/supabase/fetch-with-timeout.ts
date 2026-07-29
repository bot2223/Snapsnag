// A real "internet off" test can hang far longer than you'd expect before a
// fetch() actually rejects — depends on OS network stack, DNS resolver
// behavior, captive portal detection, etc. Individually guarding each query
// with retry:false and error checks (which this app now does) only helps
// once the underlying fetch actually settles; if it just hangs, every one
// of those queries sits there waiting, and since several run one after
// another rather than all in parallel, the waits stack up — which is
// exactly what a ~50s "offline" load is: not one slow request, several
// unbounded ones in a row.
//
// Fixing this per-call-site would mean remembering to do it forever, on
// every future query anyone adds. Fixing it once here means every Supabase
// request the app makes — present and future — fails fast and
// consistently, which is what lets the offline fallbacks (cached data,
// error states) actually kick in promptly instead of eventually.
const TIMEOUT_MS = 8_000;

export const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Respect an explicit signal a caller already passed in (none of this
  // app's own code does today, but a future call-site or a library
  // internal might) — first one to fire wins.
  init?.signal?.addEventListener("abort", () => controller.abort());
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
};
