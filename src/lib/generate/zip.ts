/*
  The download: every output in one zip, built in memory with fflate.
*/
import { strToU8, zipSync } from "fflate";

export interface ZipFile {
  name: string;
  data: string;
}

export function buildZip(files: ZipFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = strToU8(f.data);
  return zipSync(entries, { level: 6 });
}
