/**
 * Wraps a Supabase query with a timeout so it never hangs forever.
 * Usage: const { data, error } = await withTimeout(supabase.from(...).select(...))
 */
export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms = 8000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Query timed out")), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer!);
    return result;
  } catch (e) {
    clearTimeout(timer!);
    throw e;
  }
}
