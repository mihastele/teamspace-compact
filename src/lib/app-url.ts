/**
 * Normalizes an app URL or domain name string.
 * Strips surrounding whitespace and trailing slashes.
 * Automatically adds https:// (or http:// for localhost/127.0.0.1) if the protocol was omitted.
 */
export function normalizeAppUrl(input?: string | null): string {
  if (!input) return "";
  let value = input.trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) {
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value)) {
      value = `http://${value}`;
    } else {
      value = `https://${value}`;
    }
  }
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname}`;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

/**
 * Resolves the base URL for public app links (e.g. invite links).
 * Priority:
 * 1. Explicit environment variable: APP_URL, SITE_URL, NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SITE_URL
 * 2. Incoming Request headers (x-forwarded-proto + x-forwarded-host, host, or request.url)
 * 3. Browser location.origin (if running client-side)
 * 4. Empty string if unresolvable.
 */
export function resolveAppBaseUrl(request?: Request): string {
  const envUrl =
    (typeof process !== "undefined" && process.env
      ? process.env.APP_URL ||
        process.env.SITE_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.NEXT_PUBLIC_SITE_URL
      : undefined);

  if (envUrl) {
    const normalized = normalizeAppUrl(envUrl);
    if (normalized) return normalized;
  }

  if (request) {
    const forwardedHost = request.headers.get("x-forwarded-host");
    const host = forwardedHost || request.headers.get("host");
    if (host) {
      const forwardedProto = request.headers.get("x-forwarded-proto");
      const proto = forwardedProto
        ? forwardedProto.split(",")[0].trim()
        : (request.url.startsWith("https://") ? "https" : "http");
      return normalizeAppUrl(`${proto}://${host}`);
    }
    try {
      return normalizeAppUrl(new URL(request.url).origin);
    } catch {
      // ignore invalid request URL
    }
  }

  if (typeof location !== "undefined" && location.origin) {
    return normalizeAppUrl(location.origin);
  }

  return "";
}

/**
 * Constructs a full invite link from a token and an optional base URL.
 */
export function buildInviteUrl(token: string, baseUrl?: string): string {
  const base = baseUrl || resolveAppBaseUrl();
  const encoded = encodeURIComponent(token);
  return base ? `${base}/?invite=${encoded}` : `/?invite=${encoded}`;
}
