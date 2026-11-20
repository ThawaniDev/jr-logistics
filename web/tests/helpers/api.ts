import "@/server/api/routes";
import { dispatch } from "@/server/api/router";
import { TEST_PASSWORD, STAFF_PASSWORD, usernameOfPhone } from "./factories";

export { TEST_PASSWORD, STAFF_PASSWORD, usernameOfPhone };

export async function call(method: string, path: string, o: { token?: string; body?: unknown; headers?: Record<string, string>; form?: FormData } = {}) {
  const headers: Record<string, string> = { host: "localhost", ...(o.headers ?? {}) };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.body); }
  const res = await dispatch(new Request(`http://localhost/api/v1${path}`, { method, headers, body }));
  // decode the bytes ourselves: Response.text() strips a leading UTF-8 BOM, and the CSV exports must be proven to start with one (Excel needs it for Arabic)
  const text = Buffer.from(await res.arrayBuffer()).toString("utf8");
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* binary/csv */ }
  return { status: res.status, json, text, headers: res.headers };
}

/** `POST /auth/login` → the response (check `.status` yourself). */
export const login = (username: string, password = TEST_PASSWORD, o: { headers?: Record<string, string> } = {}) => call("POST", "/auth/login", { body: { username, password }, headers: o.headers });

/** Signs in as a factory user (or any `{ username }`) and returns the session token; throws when the sign-in is refused. */
export async function tokenOf(u: { username: string | null }, password = TEST_PASSWORD) {
  const r = await login(u.username!, password);
  if (r.status !== 200) throw new Error(`login failed for ${u.username}: ${r.status} ${r.text}`);
  return r.json.token as string;
}

/** Signs in as the person with this phone number (username `u` + digits). With `register`, an unknown phone is registered first (what a new person does on the register screen). */
export async function loginWithPhone(phone: string, register?: Record<string, unknown>) {
  const username = usernameOfPhone(phone);
  const r = await login(username);
  if (r.status === 200) return r.json as { token: string; user: any };
  if (!register) throw new Error(`login failed for ${username}: ${r.status} ${r.text}`);
  const reg = await call("POST", "/auth/register", { body: { username, password: TEST_PASSWORD, phone, termsAccepted: true, ...register } });
  if (reg.status !== 201) throw new Error("register failed " + reg.text);
  return reg.json as { token: string; user: any };
}
/** Staff / admin sign-in by e-mail address (or username); returns the token. */
export async function staffLogin(email: string, password = STAFF_PASSWORD) {
  const r = await call("POST", "/auth/login", { body: { username: email, password } });
  return r.json.token as string;
}
