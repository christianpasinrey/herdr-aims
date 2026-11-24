// The person's AIMS connections, kept in ~/.config/herdr-app/aims.json:
// outside this mod's folder, so a token can never be published with it.
// Every copy of the mod (sidebar, issue pane, dialogs, link handler) reads
// the same file; a counter in shared() tells open copies to read it again.

import { appHome, readTextFile, writeTextFile, shared, setShared } from "herdr";

const REV = "aims.rev";

export const configPath = () => `${appHome().replace(/[\\/]+$/, "")}/aims.json`;

/** What open copies compare to know the file changed. */
export const configRev = () => shared(REV) ?? 0;

const empty = () => ({ raw: null, connections: [], active: 0 });

function clean(c) {
  if (!c || typeof c !== "object") return null;
  const url = typeof c.url === "string" ? c.url.trim().replace(/\/+$/, "") : "";
  const token = typeof c.token === "string" ? c.token.trim() : "";
  if (!url || !token) return null;
  return {
    name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : hostOf(url),
    url,
    token,
    workspace: typeof c.workspace === "string" && c.workspace ? c.workspace : null,
  };
}

export function hostOf(url) {
  return String(url).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

/** Reads the file. A missing or broken file is an empty config, never an error. */
export async function loadConfig() {
  let raw = null;
  try {
    raw = await readTextFile(configPath());
  } catch {
    return empty();
  }
  if (raw === null) return empty();
  try {
    const data = JSON.parse(raw);
    const connections = (Array.isArray(data?.connections) ? data.connections : []).map(clean).filter(Boolean);
    const active = Number.isInteger(data?.active) && data.active >= 0 && data.active < connections.length ? data.active : 0;
    return { raw, connections, active };
  } catch {
    // Keep `raw` so the next save replaces the broken file instead of failing.
    return { ...empty(), raw };
  }
}

/** Writes the file and wakes every open copy. */
export async function saveConfig(config) {
  const text = `${JSON.stringify({ connections: config.connections, active: config.active }, null, 2)}\n`;
  await writeTextFile(configPath(), text, config.raw);
  config.raw = text;
  setShared(REV, Date.now());
}

export const activeConnection = (config) => config.connections[config.active] ?? null;
