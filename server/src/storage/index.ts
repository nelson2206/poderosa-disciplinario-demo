// Factory: selecciona el backend de almacenamiento según las variables de entorno.
// - Si SUPABASE_URL + SUPABASE_SERVICE_KEY están definidos → backend Supabase (Postgres + Storage).
// - En cualquier otro caso → filesystem (default, ideal para desarrollo y demo).

import type { Storage } from "./types.js";
import { fsStorage, getFilesDir } from "./fs-storage.js";

let cached: Storage | null = null;
let cachedKind: "fs" | "supabase" = "fs";

export async function getStorage(): Promise<Storage> {
  if (cached) return cached;

  const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
  if (useSupabase) {
    const { supabaseStorage } = await import("./supabase-storage.js");
    cached = supabaseStorage;
    cachedKind = "supabase";
  } else {
    cached = fsStorage;
    cachedKind = "fs";
  }
  return cached;
}

export function getStorageKind(): "fs" | "supabase" {
  return cachedKind;
}

export { getFilesDir };
export * from "./types.js";
