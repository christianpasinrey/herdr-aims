// The AIMS panel: the active connection's workspace and its issues, grouped
// by workflow state. Views: my issues, everything, the active cycle, a project.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, openOverlay, window, checking, run, focused } from "herdr";
import { loadConfig, configRev, activeConnection } from "./config.js";
import { callTool } from "./client.js";
import { VIEW_KEY, ISSUE_KEY, ISSUE_PANE_KEY, openConnect } from "./menu.js";
import { ICON, OWN, iconButton, stateDot, priorityMark, TYPE_ORDER } from "./ui.js";

const REFRESH_MS = 60_000;

export class Sidebar {
  init(cx) {
    this.config = null; // null until the file was read once
    this.overview = null;
    this.issues = [];
    this.loading = false;
    this.error = null; // { kind, message }
    this.stale = false;
    this.rev = configRev();
    this.shownView = this.view();
    this.size = { width: 268, height: 400 };
    this.folded = new Set();

    if (checking()) return;
    this.reload(cx, true);
    cx.timer.every(REFRESH_MS, (cx) => {
      if (window()?.visible) this.reload(cx, false);
    });
  }

  /** "mine" | "all" | "cycle" | "project:<slug>" */
  view() {
    const value = shared(VIEW_KEY);
    return typeof value === "string" && value ? value : "mine";
  }

  filters() {
    const view = this.view();
    if (view === "all") return {};
    if (view === "cycle") {
      const team = (this.overview?.teams ?? []).find((t) => t.active_cycle);
      return team ? { team: team.key, cycle_number: team.active_cycle.number } : null;
    }
    if (view.startsWith("project:")) return { project: view.slice(8) };
    return { view: "mine" };
  }

  viewLabel() {
    const view = this.view();
    if (view === "all") return "All issues";
    if (view === "cycle") return "Active cycle";
    if (view.startsWith("project:")) {
      return (this.overview?.projects ?? []).find((p) => p.slug === view.slice(8))?.name ?? "Project";
    }
    return "My issues";
  }

  /** Reads the connections file when asked, then the overview and the list. */
  reload(cx, readConfig, rendering = false) {
    if (this.loading) return;
    this.loading = true;
    // render() may not ask for another render; it is already drawing this state.
    if (!rendering) cx.notify();

    cx.spawn(async (cx) => {
      try {
        if (readConfig || this.config === null) this.config = await loadConfig();
        const connection = activeConnection(this.config);
        if (!connection) {
          this.overview = null;
          this.issues = [];
          this.error = null;
          return;
        }

        this.overview = await callTool(connection, "board-overview");
        const filters = this.filters();
        this.issues = filters === null ? [] : (await callTool(connection, "board-issues", { ...filters, limit: 200 })).issues ?? [];
        this.error = null;
        this.stale = false;
      } catch (error) {
        this.error = { kind: error?.kind ?? "network", message: String(error?.message ?? error) };
        // Keep what is on screen; a dead token has nothing worth keeping.
        this.stale = this.error.kind !== "auth" && this.overview !== null;
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  /** Issues bucketed by state, in the order a board reads: started first. */
  groups() {
    const byState = new Map();
    for (const issue of this.issues) {
      const key = `${issue.state?.type ?? ""}|${issue.state?.name ?? "No state"}`;
      if (!byState.has(key)) byState.set(key, { key, state: issue.state, issues: [] });
      byState.get(key).issues.push(issue);
    }
    const positions = new Map();
    for (const team of this.overview?.teams ?? []) {
      for (const s of team.states ?? []) if (!positions.has(s.id)) positions.set(s.id, s.position);
    }
    return [...byState.values()].sort((a, b) =>
      (TYPE_ORDER[a.state?.type] ?? 9) - (TYPE_ORDER[b.state?.type] ?? 9)
      || (positions.get(a.state?.id) ?? 0) - (positions.get(b.state?.id) ?? 0)
      || String(a.state?.name).localeCompare(String(b.state?.name)));
  }

  openWorkspaceMenu() {
    const items = [];
    const config = this.config ?? { connections: [], active: 0 };
    if (config.connections.length > 1) {
      items.push({ label: "Connection", heading: true });
      config.connections.forEach((c, i) =>
        items.push({ label: c.name, checked: i === config.active, action: { type: "connection", index: i } }));
    }
    const workspaces = this.overview?.workspaces ?? [];
    if (workspaces.length > 1) {
      items.push({ label: "Workspace", heading: true });
      for (const w of workspaces) {
        items.push({ label: w.name, checked: w.is_active, action: { type: "workspace", slug: w.slug } });
      }
    }
    items.push({ label: "Connections…", action: { type: "connect" } });
    openOverlay({ mod: "aims", kind: "popup", width: 240, height: Math.min(420, 14 + items.length * 30), props: { view: "menu", items } });
  }

  openViewMenu() {
    const view = this.view();
    const items = [
      { label: "My issues", checked: view === "mine", action: { type: "view", value: "mine" } },
      { label: "All issues", checked: view === "all", action: { type: "view", value: "all" } },
    ];
    if ((this.overview?.teams ?? []).some((t) => t.active_cycle)) {
      items.push({ label: "Active cycle", checked: view === "cycle", action: { type: "view", value: "cycle" } });
    }
    const projects = this.overview?.projects ?? [];
    if (projects.length) {
      items.push({ label: "Projects", heading: true });
      for (const p of projects) {
        items.push({ label: `${p.name}  ·  ${p.progress_percent}%`, checked: view === `project:${p.slug}`, action: { type: "view", value: `project:${p.slug}` } });
      }
    }
    openOverlay({ mod: "aims", kind: "popup", width: 260, height: Math.min(440, 14 + items.length * 30), props: { view: "menu", items } });
  }

  message(t, text, action) {
    return v_flex()
      .flex_1()
      .items_center()
      .justify_center()
      .gap(10)
      .p(16)
      .child(div().text_size(12.5).text_color(t.muted).child(text))
      .when(Boolean(action), (el) =>
        el.child(
          h_flex()
            .id("aims-message-action")
            .h(28)
            .px(12)
            .items_center()
            .rounded(7)
            .bg(t.solid)
            .text_color(t.solid_foreground)
            .text_size(12)
            .font_medium()
            .cursor_pointer()
            .hover((s) => s.opacity(0.88))
            .on_click(action[1])
            .child(action[0]),
        ));
  }

  /** Shows the issue beside the terminal: in the tab's issue pane, or a new one. */
  openIssue(issue) {
    const connection = activeConnection(this.config);
    if (!connection) return;
    const selection = { identifier: issue.identifier, url: connection.url, workspace: connection.workspace };
    setShared(ISSUE_KEY, selection);
    if (shared(ISSUE_PANE_KEY)?.tab !== focused()?.tab) {
      run("pane.split", { direction: "right", mod: "aims", props: { view: "issue", ...selection } });
    }
  }

  row(t, issue) {
    return h_flex()
      .id(`aims-issue-${issue.identifier}`)
      .h(27)
      .px(8)
      .gap(7)
      .rounded(7)
      .flex_none()
      .items_center()
      .text_size(12.5)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.openIssue(issue))
      .child(stateDot(t, issue.state))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(issue.identifier))
      .child(div().flex_1().truncate().text_color(t.foreground).child(issue.title))
      .child(priorityMark(t, issue.priority));
  }

  rail(t) {
    return v_flex()
      .id("aims-rail")
      .size_full()
      .items_center()
      .pt(8)
      .gap(6)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(svg(OWN("aims")).size(16).flex_none().text_color(this.error ? t.blocked : t.muted))
      .child(div().text_size(11).text_color(t.dim).child(String(this.issues.length)));
  }

  render(cx) {
    const t = theme();

    // Another copy saved the connections, or a menu picked another view.
    const rev = configRev();
    const view = this.view();
    if (rev !== this.rev || view !== this.shownView) {
      const readConfig = rev !== this.rev;
      this.rev = rev;
      this.shownView = view;
      this.reload(cx, readConfig, true);
    }

    if (this.size.width < 160) return this.rail(t);

    const connection = this.config ? activeConnection(this.config) : null;
    const root = v_flex()
      .id("aims-sidebar")
      .size_full()
      .min_h(0)
      .text_color(t.foreground)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); });

    if (this.config === null) return root.child(this.message(t, "Loading…"));
    if (!connection) return root.child(this.message(t, "See your AIMS issues here.", ["Connect to AIMS", () => openConnect()]));

    const header = h_flex()
      .h(30)
      .px(8)
      .gap(4)
      .flex_none()
      .items_center()
      .child(
        h_flex()
          .id("aims-workspace")
          .flex_1()
          .min_w(0)
          .h(22)
          .px(5)
          .gap(5)
          .rounded(6)
          .items_center()
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.openWorkspaceMenu())
          .child(svg(OWN("aims")).size(13).flex_none().text_color(t.muted))
          .child(div().truncate().text_size(12).font_semibold().child(this.overview?.workspace?.name ?? connection.name))
          .child(svg(ICON("chevron-down")).size(11).flex_none().text_color(t.dim)),
      )
      .when(this.stale, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.blocked).child("offline")))
      .child(
        this.loading
          ? h_flex().size(22).flex_none().items_center().justify_center()
              .child(svg(ICON("spinner")).size(12).flex_none().text_color(t.working).spin(900))
          : iconButton(t, "aims-refresh", OWN("refresh"), (_e, cx) => this.reload(cx, true)),
      );

    if (this.error?.kind === "auth") {
      return root.child(header).child(this.message(t, this.error.message, ["Reconnect", () => openConnect()]));
    }
    if (this.error && !this.overview) {
      return root.child(header).child(this.message(t, this.error.message, ["Retry", (_e, cx) => this.reload(cx, true)]));
    }

    const viewBar = h_flex()
      .id("aims-view")
      .h(26)
      .mx(8)
      .px(6)
      .gap(5)
      .flex_none()
      .rounded(6)
      .items_center()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.openViewMenu())
      .child(div().flex_1().truncate().text_size(11.5).text_color(t.muted).child(this.viewLabel()))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(String(this.issues.length)))
      .child(svg(ICON("chevron-down")).size(11).flex_none().text_color(t.dim));

    const groups = this.groups();
    const list = v_flex()
      .id("aims-list")
      .flex_1()
      .min_h(0)
      .px(4)
      .pb(6)
      .overflow_y_scrollbar();

    if (!groups.length) {
      const empty = this.view() === "cycle" && this.filters() === null ? "No team has an active cycle." : "No issues here.";
      return root.child(header).child(viewBar).child(this.message(t, this.loading ? "Loading…" : empty));
    }

    for (const group of groups) {
      const folded = this.folded.has(group.key);
      list.child(
        h_flex()
          .id(`aims-group-${group.key}`)
          .h(24)
          .px(8)
          .mt(4)
          .gap(6)
          .flex_none()
          .items_center()
          .cursor_pointer()
          .on_click((_e, cx) => {
            if (folded) this.folded.delete(group.key);
            else this.folded.add(group.key);
            cx.notify();
          })
          .child(svg(ICON(folded ? "chevron-right" : "chevron-down")).size(10).flex_none().text_color(t.dim))
          .child(div().text_size(11).font_medium().text_color(t.muted).child(group.state?.name ?? "No state"))
          .child(div().text_size(11).text_color(t.dim).child(String(group.issues.length))),
      );
      if (!folded) for (const issue of group.issues) list.child(this.row(t, issue));
    }

    return root.child(header).child(viewBar).child(list);
  }
}
