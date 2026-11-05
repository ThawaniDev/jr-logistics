import "@/server/api/routes";
import { dispatch } from "@/server/api/router";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const h = (req: Request) => dispatch(req);
export { h as GET, h as POST, h as PATCH, h as PUT, h as DELETE };
