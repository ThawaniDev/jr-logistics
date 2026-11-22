/**
 * Security audit helper: lists every API route (`defineRoutes([...])` in server/api/routes/*.ts) with its auth spec,
 * whether it has a zod body/query, and which permission / role guards are reachable from the handler (call graph followed
 * through imports, depth 6, via the TypeScript checker).
 *
 *   npx tsx scripts/route-inventory.ts            # one line per route
 *   npx tsx scripts/route-inventory.ts --json     # machine readable
 *   npx tsx scripts/route-inventory.ts --flags    # only rows that need a human look
 *
 * It is a static scan: it tells which `requirePerm("x")` calls are reachable from a handler, not that they are right.
 * `tests/unit/route-guards.test.ts` pins the invariant "no backoffice route is reachable without a permission check" so a new route
 * that forgets one is caught.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface RouteRow {
  file: string; method: string; path: string; auth: string; body: boolean; query: boolean; idParams: string[];
  perms: string[]; guards: string[]; scoped: boolean; flags: string[];
}

const root = path.join(__dirname, "..");
const dir = path.join(root, "src/server/api/routes");
const ALIAS: Record<string, string> = { bo: "backoffice", drv: "driver", biz: "business", off: "office" };
const PERM_FNS = new Set(["requirePerm", "can"]);
const GUARD_FNS = new Set(["requirePerm", "can", "requireRole", "assertCanManage", "isBackoffice"]);

export function scan(): RouteRow[] {
  const files = fs.readdirSync(dir).filter((x) => x.endsWith(".ts") && x !== "index.ts").sort().map((f) => path.join(dir, f));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true,
    baseUrl: root, paths: { "@/*": ["./src/*"] }, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, types: [],
  });
  const checker = program.getTypeChecker();

  type Info = { perms: Set<string>; guards: Set<string>; scoped: boolean };
  const memo = new Map<ts.Node, Info>();
  const analyse = (node: ts.Node, depth: number, stack: Set<ts.Node>): Info => {
    const cached = memo.get(node);
    if (cached) return cached;
    const info: Info = { perms: new Set(), guards: new Set(), scoped: false };
    if (stack.has(node) || depth > 6) return info;
    stack.add(node);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        let name: string | undefined;
        const e = n.expression;
        if (ts.isIdentifier(e)) name = e.text; else if (ts.isPropertyAccessExpression(e)) name = e.name.text;
        if (name && GUARD_FNS.has(name)) {
          info.guards.add(name);
          if (PERM_FNS.has(name)) for (const a of n.arguments.slice(1)) if (ts.isStringLiteralLike(a)) info.perms.add(a.text);
        }
        let sym = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(e) ? e.name : e);
        if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
        for (const d of sym?.declarations ?? []) {
          const sf = d.getSourceFile();
          if (sf.isDeclarationFile || sf.fileName.includes("node_modules")) continue;
          let body: ts.Node | undefined;
          if (ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d)) body = d.body;
          else if (ts.isVariableDeclaration(d) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) body = d.initializer.body;
          if (body) {
            const sub = analyse(body, depth + 1, stack);
            sub.perms.forEach((p) => info.perms.add(p)); sub.guards.forEach((g) => info.guards.add(g)); if (sub.scoped) info.scoped = true;
          }
        }
      }
      if (ts.isPropertyAccessExpression(n) && /^(businessId|driverId|officeId|ownerId|userId)$/.test(n.name.text)) info.scoped = true;
      if (ts.isPropertyAccessExpression(n) && n.name.text === "id" && /^(user|u|actor|me)$/.test(n.expression.getText())) info.scoped = true;
      if (ts.isBinaryExpression(n) && /role\b/.test(n.left.getText()) && /"admin"|"staff"/.test(n.right.getText())) info.guards.add("role-check");
      ts.forEachChild(n, visit);
    };
    visit(node);
    stack.delete(node);
    memo.set(node, info);
    return info;
  };

  const rows: RouteRow[] = [];
  for (const file of files) {
    const sf = program.getSourceFile(file)!;
    const f = path.basename(file);
    const visit = (n: ts.Node) => {
      if (ts.isObjectLiteralExpression(n)) {
        const props = new Map<string, ts.ObjectLiteralElementLike>();
        for (const p of n.properties) if (p.name) props.set(p.name.getText(sf), p);
        const m = props.get("method"), p = props.get("path"), a = props.get("auth"), h = props.get("handler");
        if (m && p && a && h) {
          const val = (x: ts.Node) => (ts.isPropertyAssignment(x) ? x.initializer.getText(sf) : ts.isShorthandPropertyAssignment(x) ? x.name.getText(sf) : x.getText(sf));
          const pathText = val(p).replace(/^["'`]|["'`]$/g, "");
          let auth = val(a).replace(/\s+/g, " ").replace(/\s+as const$/, "");
          const bare = auth.replace(/^\[?\.\.\./, "").replace(/\]$/, "");
          auth = ALIAS[bare] ?? auth.replace(/["']/g, "");
          const info = analyse(ts.isPropertyAssignment(h) ? h.initializer : h, 0, new Set());
          const bodyProp = props.get("body");
          const row: RouteRow = {
            file: f, method: val(m).replace(/["']/g, ""), path: pathText, auth, body: !!bodyProp, query: props.has("query"),
            idParams: [...pathText.matchAll(/:([A-Za-z]+)/g)].map((x) => x[1]),
            perms: [...info.perms].sort(), guards: [...info.guards].sort(), scoped: info.scoped, flags: [],
          };
          const handlerText = h.getText(sf);
          if (auth === "public") { row.flags.push("public"); if (row.method !== "GET" && !row.body) row.flags.push("public-no-body"); }
          if (auth === "backoffice" && !row.guards.some((g) => ["requirePerm", "can", "role-check", "requireRole"].includes(g))) row.flags.push("backoffice-no-guard");
          if (auth !== "public" && row.idParams.length && !row.scoped && auth !== "backoffice") row.flags.push("id-not-scoped");
          if (row.method !== "GET" && !row.body && auth !== "public") row.flags.push("mutation-no-body-schema");
          if (row.method === "GET" && /audit\(|\.insert\(|\.update\(|\.delete\(/.test(handlerText)) row.flags.push("get-writes");
          const LOOSE = /z\.record|z\.any\(|z\.unknown\(/;
          if (LOOSE.test(handlerText) || (bodyProp && LOOSE.test(bodyProp.getText(sf)))) row.flags.push("loose-schema");
          if (/sql\.raw|\.raw\(/.test(handlerText)) row.flags.push("sql.raw");
          rows.push(row);
          return;
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return rows;
}

if (process.argv[1]?.endsWith("route-inventory.ts")) {
  const rows = scan();
  const args = process.argv.slice(2);
  if (args.includes("--json")) console.log(JSON.stringify(rows, null, 1));
  else {
    const list = args.includes("--flags") ? rows.filter((r) => r.flags.length) : rows;
    console.log(`routes: ${rows.length}`);
    for (const r of list) console.log(`${r.file.replace(".ts", "").padEnd(22)} ${r.method.padEnd(6)} ${r.path.padEnd(50)} ${r.auth.padEnd(26)} body=${r.body ? "y" : "-"} perms=[${r.perms.join(",")}] guards=[${r.guards.join(",")}] scoped=${r.scoped ? "y" : "-"} ${r.flags.join(" ")}`);
  }
}
