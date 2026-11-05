import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { err } from "@/lib/errors";

/** Object storage boundary. Production must configure a durable adapter; local disk is dev/test only. */
export interface StorageAdapter { name: string; put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; remove(key: string): Promise<void> }

class LocalDisk implements StorageAdapter {
  name = "local";
  private root = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
  private p(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root))) throw err("VALIDATION", "Invalid key");
    return full;
  }
  async put(key: string, data: Buffer) { const f = this.p(key); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, data); }
  async get(key: string) { try { return await readFile(this.p(key)); } catch { throw err("NOT_FOUND", "File not found"); } }
  async remove(key: string) { await rm(this.p(key), { force: true }); }
}

let adapter: StorageAdapter | null = null;
export const setStorage = (a: StorageAdapter | null) => { adapter = a; };
export function storage(): StorageAdapter {
  if (adapter) return adapter;
  if (process.env.NODE_ENV === "production" && process.env.STORAGE_DRIVER !== "local") throw err("DEPENDENCY_UNAVAILABLE", "Object storage is not configured");
  return (adapter = new LocalDisk());
}
