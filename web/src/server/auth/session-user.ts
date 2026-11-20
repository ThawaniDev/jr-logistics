import type { User } from "@/db/schema";
import { publicUser } from "../views";

/** The signed-in user as clients see it: the public fields plus the sign-in username (returned by login, register, `/auth/me`, `/profile`). */
export const sessionUser = (u: User) => ({ ...publicUser(u), username: u.username });
