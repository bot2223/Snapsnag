// Matches the password policy enforced in Supabase Auth dashboard settings
// (min length + required character types). Checking it here too means
// users see a clear error immediately, instead of just a generic failure
// from the server.
export function validatePassword(
  password: string,
  t: (key: string) => string,
): string | null {
  if (password.length < 12) return t("login.passwordTooShort");
  if (!/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\/~`';]/.test(password))
    return t("login.passwordNeedsSpecial");
  return null;
}
