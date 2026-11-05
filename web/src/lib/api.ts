export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details: Record<string, unknown> = {}, public correlationId?: string) { super(message); }
}

async function parse(res: Response) {
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(e?.code ?? "INTERNAL", e?.message ?? res.statusText, res.status, e?.details ?? {}, e?.correlation_id);
  }
  return data;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(`/api/v1${path}`, {
    method, credentials: "same-origin", cache: "no-store",
    headers: body && !isForm ? { "content-type": "application/json" } : undefined,
    body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
    window.location.href = "/login?expired=1";
  }
  return parse(res);
}
export const get = <T = any>(p: string) => api<T>("GET", p);
export const post = <T = any>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});
export const patch = <T = any>(p: string, b?: unknown) => api<T>("PATCH", p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => api<T>("PUT", p, b ?? {});
export const fetcher = (p: string) => get(p);
