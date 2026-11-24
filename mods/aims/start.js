// "Start work" on an issue: AIMS assigns it, moves it to started and hands
// back a branch and a brief; Herdr then opens an agent with that brief, in a
// new worktree for the branch or in the space you are in.
//
// The shipped `worktree` mod cannot pass a first message to the agent, so the
// worktree is made here, following its convention and its setting:
// <worktrees.directory>/<repo>/<branch>, default ~/.herdr/worktrees.

import { exec, home, appHome, readTextFile, panes, spaces, run, setShared } from "herdr";
import { callTool } from "./client.js";
import { bumpRev, connectionFor, loadConfig } from "./config.js";

export const START_KEY = "aims.start"; // { mode, agent }: the last way work was started

const slashed = (path) => String(path ?? "").replace(/\\/g, "/");

async function git(cwd, args, timeout) {
  const r = await exec("git", args, { cwd, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

/** Where the shown space is now: its first terminal's folder, else where it was made. */
export function shownPlace() {
  const space = spaces().find((s) => s.active);
  if (!space) return null;
  const tabs = new Set((space.tabs ?? []).map((tab) => tab.id));
  const folder = panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder || null;
  return folder ? { folder, machine: space.machine ?? null } : null;
}

/** The repo a folder belongs to ({ top, main, name }), or null outside git. */
export async function repoOf(folder) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"]);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  const parts = main.split("/");
  return { top: top.out, main, name: parts.at(-1) === ".bare" ? parts.at(-2) : parts.at(-1) };
}

async function worktreeRoot() {
  const raw = await readTextFile(`${appHome()}/settings.json`);
  let directory = "~/.herdr/worktrees";
  try {
    directory = (raw === null ? {} : JSON.parse(raw))?.worktrees?.directory ?? directory;
  } catch {
    // An unreadable settings.json is the app's to report; use the default.
  }
  let path = slashed(directory);
  if (path === "~" || path.startsWith("~/")) path = slashed(home()).replace(/\/$/, "") + path.slice(1);
  if (!path.startsWith("/") && !/^[A-Za-z]:\//.test(path)) throw new Error("worktrees.directory must be an absolute path or start with ~/.");
  return path.replace(/\/+$/, "");
}

const folderName = (branch) => branch.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "branch";

/** The checkout for a branch: the one it already has, else a new worktree. */
async function ensureWorktree(repo, branch) {
  // The branch name comes from the server. git gets it as an argument, never
  // through a shell, but a name starting with "-" would read as an option.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes("..")) {
    throw new Error(`"${branch}" is not a branch name Herdr will create.`);
  }
  const list = await git(repo.main, ["worktree", "list", "--porcelain"]);
  if (list.ok) {
    for (const block of list.out.split(/\n\n+/)) {
      const lines = block.split("\n");
      const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
      if (path && lines.includes(`branch refs/heads/${branch}`)) return slashed(path);
    }
  }

  const path = `${await worktreeRoot()}/${repo.name}/${folderName(branch)}`;
  const exists = (await git(repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
  const add = exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"];
  const made = await git(repo.top, add, 600_000);
  if (!made.ok) throw new Error(made.err || "git worktree add failed.");
  return path;
}

/**
 * action: { identifier, url, workspace, mode: "worktree" | "here", agent, argv, folder, repo }
 */
export async function startWork(action) {
  const connection = connectionFor(await loadConfig(), action.url, action.workspace);
  if (!connection) throw new Error("No AIMS connection.");

  const started = await callTool(connection, "issues-start", { identifier: action.identifier });
  bumpRev();
  setShared(START_KEY, { mode: action.mode, agent: action.agent });

  if (action.mode === "worktree" && action.repo) {
    const path = await ensureWorktree(action.repo, started.branch);
    run("space.new", { folder: path, machine: "", argv: action.argv, task: started.brief });
  } else {
    run("tab.new", { name: started.identifier, folder: action.folder, argv: action.argv, task: started.brief });
  }
}
