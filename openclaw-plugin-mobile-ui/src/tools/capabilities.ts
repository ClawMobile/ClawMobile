import fs from "fs";
import path from "path";
import { truncateString, DEFAULT_MAX_OUTPUT_BYTES } from "./workspace";

const DEFAULT_PATH = path.resolve(__dirname, "..", "..", "..", "installer", "workspace-seed", "CAPABILITIES.mobile.md");

export async function mobile_capabilities(input?: { query?: string }) {
  const query = (input?.query || "").toLowerCase().trim();
  let text = "";
  try {
    text = fs.readFileSync(DEFAULT_PATH, "utf8");
  } catch (e: any) {
    return { ok: false, error: "capabilities_not_found", path: DEFAULT_PATH, message: String(e?.message || e) };
  }

  if (query) {
    const lines = text.split(/\r?\n/);
    const filtered = lines.filter((l) => l.toLowerCase().includes(query));
    text = filtered.join("\n");
  }

  text = truncateString(text, DEFAULT_MAX_OUTPUT_BYTES);
  return { ok: true, path: DEFAULT_PATH, content: text, truncated: text.length >= DEFAULT_MAX_OUTPUT_BYTES };
}
