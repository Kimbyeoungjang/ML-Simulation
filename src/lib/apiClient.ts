const configuredApiBase = process.env.NEXT_PUBLIC_TILEFORGE_API_BASE_URL ?? "";

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/g, "");
}

function normalizePath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

export function apiBaseUrl(): string {
  return normalizeBaseUrl(configuredApiBase);
}

export function apiUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;
  const base = apiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (typeof input === "string") return fetch(apiUrl(input), init);
  if (input instanceof URL) return fetch(input, init);
  return fetch(input, init);
}
