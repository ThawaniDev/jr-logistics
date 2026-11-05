"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { SessionUser } from "@/server/auth/current";

const Ctx = createContext<SessionUser | null>(null);
export const AuthProvider = ({ user, children }: { user: SessionUser; children: ReactNode }) => <Ctx.Provider value={user}>{children}</Ctx.Provider>;
export function useUser() { const u = useContext(Ctx); if (!u) throw new Error("useUser outside AuthProvider"); return u; }
export const hasPerm = (u: SessionUser, p?: string) => !p || u.role === "admin" || u.permissions.includes(p);
