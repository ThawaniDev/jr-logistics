import "@/server/api/routes";
import { dispatch } from "@/server/api/router";

export async function call(method: string, path: string, o: { token?: string; body?: unknown; headers?: Record<string, string>; form?: FormData } = {}) {
  const headers: Record<string, string> = { host: "localhost", ...(o.headers ?? {}) };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.body); }
  const res = await dispatch(new Request(`http://localhost/api/v1${path}`, { method, headers, body }));
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* binary/csv */ }
  return { status: res.status, json, text, headers: res.headers };
}

/** Full OTP login (demo mode returns the code). Creates the user if needed via register body. */
export async function loginWithOtp(phone: string, register?: Record<string, unknown>) {
  const sent = await call("POST", "/auth/otp/send", { body: { phone } });
  const v = await call("POST", "/auth/otp/verify", { body: { phone, code: sent.json.demoCode } });
  if (!v.json.isNew) return v.json as { token: string; user: any };
  const r = await call("POST", "/auth/register", { body: { registrationToken: v.json.registrationToken, termsAccepted: true, ...register } });
  if (r.status !== 201) throw new Error("register failed " + r.text);
  return r.json as { token: string; user: any };
}
export async function staffLogin(email: string, password = "Password123") {
  const r = await call("POST", "/auth/staff/login", { body: { email, password } });
  return r.json.token as string;
}
