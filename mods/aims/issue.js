// One issue beside the terminal: what it is, where it stands, the discussion,
// and the two things you do most from here: change its status and comment.
// It follows the issue picked in the sidebar (a shared selection), so a tab
// keeps one issue pane however many issues you look at.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, TextView, TextareaState, Textarea } from "gpui-base";
import { props, theme, shared, setShared, openOverlay, focused, checking, notify, knownAgents } from "herdr";
import { loadConfig, configRev, connectionFor, bumpRev } from "./config.js";
import { callTool } from "./client.js";
import { ISSUE_KEY, ISSUE_PANE_KEY } from "./menu.js";
import { ICON, button, stateDot } from "./ui.js";
import { START_KEY, shownPlace, repoOf } from "./start.js";

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export class IssuePane {
  init(cx) {
    this.issue = null;
    this.error = "";
    this.loading = false;
    this.sending = false;
    this.starting = false;
    this.rev = configRev();
    this.shown = null; // the selection this pane last asked for
    this.tab = focused()?.tab ?? null;

    this.comment = TextareaState.new({ placeholder: "Leave a comment…", rows: 3 });
    this.commentFocused = false;
    this.comment.on("focus", (_e, cx) => { this.commentFocused = true; cx.notify(); });
    this.comment.on("blur", (_e, cx) => { this.commentFocused = false; cx.notify(); });

    if (checking()) return;
    // The sidebar asks this before splitting a second pane into the same tab.
    setShared(ISSUE_PANE_KEY, { tab: this.tab, at: Date.now() });
    this.load(cx);
  }

  close() {
    if (shared(ISSUE_PANE_KEY)?.tab === this.tab) setShared(ISSUE_PANE_KEY, null);
  }

  /** The issue to show: the sidebar's pick, else what this pane was opened with. */
  selection() {
    const picked = shared(ISSUE_KEY);
    const fallback = props() ?? {};
    const s = picked?.identifier ? picked : fallback;
    return s?.identifier ? { identifier: s.identifier, url: s.url, workspace: s.workspace ?? null } : null;
  }

  async connection() {
    const s = this.shown;
    return connectionFor(await loadConfig(), s?.url, s?.workspace);
  }

  load(cx, rendering = false) {
    const selection = this.selection();
    this.shown = selection;
    if (!selection) return;
    this.loading = true;
    // render() may not ask for another render; it is already drawing this state.
    if (!rendering) cx.notify();

    cx.spawn(async (cx) => {
      try {
        const connection = await this.connection();
        if (!connection) throw new Error("Connect to AIMS first.");
        const issue = await callTool(connection, "board-issue", { identifier: selection.identifier });
        // A slower answer for an issue the person already left must not win.
        if (this.shown === selection) {
          this.issue = issue;
          this.error = "";
        }
      } catch (error) {
        if (this.shown === selection) this.error = String(error?.message ?? error);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  send(cx) {
    const body = this.comment.value().trim();
    if (!body || this.sending || !this.issue) return;
    this.sending = true;
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        const connection = await this.connection();
        await callTool(connection, "issues-comment", { identifier: this.issue.identifier, body });
        this.comment.set_value("");
        bumpRev();
      } catch (error) {
        notify({ title: "Comment not sent", body: String(error?.message ?? error), level: "error" });
      } finally {
        this.sending = false;
        cx.notify();
      }
    });
  }

  openStatusMenu() {
    const issue = this.issue;
    if (!issue) return;
    const items = (issue.states ?? []).map((state) => ({
      label: state.name,
      checked: state.id === issue.state?.id,
      action: state.id === issue.state?.id ? {} : {
        type: "tool",
        tool: "issues-transition",
        args: { identifier: issue.identifier, to: state.name },
        url: this.shown?.url,
        workspace: issue.workspace_slug,
      },
    }));
    openOverlay({ mod: "aims", kind: "popup", width: 220, height: Math.min(420, 14 + items.length * 30), props: { view: "menu", items } });
  }

  /** Offers the installed agents, in a new worktree (inside a repo) or here. */
  openStartMenu(cx) {
    const issue = this.issue;
    if (!issue || this.starting) return;
    this.starting = true;
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        const place = shownPlace();
        const local = place && place.machine === null;
        const agents = (await knownAgents({ on: place?.machine ?? null })).filter((a) => a.installed);
        const repo = local ? await repoOf(place.folder).catch(() => null) : null;
        const last = shared(START_KEY) ?? {};
        const base = { type: "start", identifier: issue.identifier, url: this.shown?.url, workspace: issue.workspace_slug, folder: place?.folder ?? null };

        const items = [];
        const offer = (mode, heading) => {
          items.push({ label: heading, heading: true });
          for (const agent of agents) {
            items.push({
              label: agent.name,
              checked: last.mode === mode && last.agent === agent.key,
              action: { ...base, mode, agent: agent.key, argv: agent.run, repo },
            });
          }
        };
        if (!agents.length) items.push({ label: "No coding agent is installed here.", heading: true });
        else {
          if (repo) offer("worktree", `New worktree in ${repo.name} · ${issue.branch}`);
          offer("here", "Here, in a new tab");
        }
        openOverlay({ mod: "aims", kind: "popup", width: 340, height: Math.min(440, 14 + items.length * 30), props: { view: "menu", items } });
      } catch (error) {
        notify({ title: "AIMS", body: String(error?.message ?? error), level: "error" });
      } finally {
        this.starting = false;
        cx.notify();
      }
    });
  }

  chip(t, id, children, action) {
    return h_flex()
      .id(id)
      .h(24)
      .px(8)
      .gap(6)
      .flex_none()
      .rounded(6)
      .border_1()
      .border_color(t.border)
      .items_center()
      .text_size(11.5)
      .text_color(t.muted)
      .when(Boolean(action), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(action))
      .children(children);
  }

  render(cx) {
    const t = theme();

    // Another issue was picked, or something changed on the server.
    const selection = this.selection();
    const rev = configRev();
    const moved = selection?.identifier !== this.shown?.identifier || selection?.url !== this.shown?.url;
    if (!this.loading && (moved || rev !== this.rev)) {
      this.rev = rev;
      if (moved) this.issue = null;
      this.load(cx, true);
    }

    const root = v_flex().id("aims-issue").size_full().min_h(0).bg(t.background).text_color(t.foreground);
    const centered = (text) => root.child(
      v_flex().flex_1().items_center().justify_center().p(16)
        .child(div().text_size(12.5).text_color(t.muted).child(text)));

    if (!selection) return centered("Pick an issue in the AIMS panel.");
    if (this.error && !this.issue) return centered(this.error);
    if (!this.issue) return centered("Loading…");

    const issue = this.issue;
    const comments = issue.comments ?? [];

    const header = v_flex()
      .flex_none()
      .px(16)
      .pt(14)
      .pb(12)
      .gap(10)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().flex_none().text_size(11.5).text_color(t.dim).child(issue.identifier))
          .when(Boolean(issue.parent), (el) => el.child(
            div().flex_1().truncate().text_size(11.5).text_color(t.dim).child(`in ${issue.parent.identifier} ${issue.parent.title}`)))
          .when(!issue.parent, (el) => el.child(div().flex_1()))
          .when(this.loading, (el) => el.child(svg(ICON("spinner")).size(12).flex_none().text_color(t.working).spin(900)))
          .child(
            h_flex()
              .id("aims-issue-browser")
              .h(22)
              .px(7)
              .flex_none()
              .rounded(6)
              .items_center()
              .text_size(11.5)
              .text_color(t.muted)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => cx.open_url(issue.url))
              .child("Open in browser"),
          )
          .child(
            h_flex()
              .id("aims-issue-start")
              .h(22)
              .px(8)
              .flex_none()
              .rounded(6)
              .items_center()
              .bg(t.solid)
              .text_size(11.5)
              .font_medium()
              .text_color(t.solid_foreground)
              .cursor_pointer()
              .hover((s) => s.opacity(0.88))
              .on_click((_e, cx) => this.openStartMenu(cx))
              .child(this.starting ? "…" : "Start work"),
          ),
      )
      .child(div().text_size(16).font_semibold().child(issue.title))
      .child(
        h_flex()
          .gap(6)
          .flex_wrap()
          .items_center()
          .child(this.chip(t, "aims-issue-state", [
            stateDot(t, issue.state),
            div().text_color(t.foreground).child(issue.state?.name ?? "No state"),
            svg(ICON("chevron-down")).size(10).flex_none().text_color(t.dim),
          ], () => this.openStatusMenu()))
          .child(this.chip(t, "aims-issue-assignee", [div().child(issue.assignee?.name ?? "Unassigned")]))
          .when(Boolean(issue.priority?.value), (el) => el.child(this.chip(t, "aims-issue-priority", [div().child(issue.priority.label)])))
          .when(Boolean(issue.project), (el) => el.child(this.chip(t, "aims-issue-project", [div().child(issue.project.name)])))
          .children((issue.labels ?? []).map((label, i) => this.chip(t, `aims-issue-label-${i}`, [
            div().size(7).flex_none().rounded(4).bg(label.color || t.dim),
            div().child(label.name),
          ]))),
      );

    const body = v_flex()
      .id("aims-issue-body")
      .flex_1()
      .min_h(0)
      .px(16)
      .py(14)
      .gap(18)
      .overflow_y_scrollbar()
      .child(
        issue.description?.trim()
          ? div().text_size(13).child(TextView.markdown(`aims-desc-${issue.identifier}`, issue.description).selectable(true))
          : div().text_size(12.5).text_color(t.dim).child("No description."),
      )
      .when((issue.children ?? []).length > 0, (el) => el.child(
        v_flex()
          .gap(4)
          .child(div().text_size(11).font_medium().text_color(t.muted).child("Sub-issues"))
          .children(issue.children.map((child) =>
            h_flex()
              .id(`aims-child-${child.identifier}`)
              .h(26)
              .px(6)
              .gap(7)
              .rounded(6)
              .items_center()
              .text_size(12.5)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .on_click(() => setShared(ISSUE_KEY, { identifier: child.identifier, url: this.shown?.url, workspace: issue.workspace_slug }))
              .child(stateDot(t, child.state))
              .child(div().flex_none().text_size(11).text_color(t.dim).child(child.identifier))
              .child(div().flex_1().truncate().child(child.title)))),
      ))
      .child(
        v_flex()
          .gap(10)
          .child(div().text_size(11).font_medium().text_color(t.muted).child(comments.length ? `Comments · ${comments.length}` : "Comments"))
          .children(comments.map((comment) =>
            v_flex()
              .gap(4)
              .p(10)
              .rounded(8)
              .bg(t.surface)
              .child(
                h_flex()
                  .gap(8)
                  .child(div().text_size(12).font_medium().child(comment.author?.name ?? "Someone"))
                  .child(div().text_size(11).text_color(t.dim).child(when(comment.created_at))))
              .child(div().text_size(12.5).child(TextView.markdown(`aims-comment-${comment.id}`, comment.body ?? "").selectable(true)))))
          .child(
            Textarea.new(this.comment)
              .h(84)
              .p(8)
              .rounded(8)
              .border_1()
              .border_color(this.commentFocused ? t.accent : t.input)
              .bg(t.background)
              .text_size(12.5)
              .text_color(t.foreground))
          .child(
            h_flex().justify_end().child(
              button(t, "aims-comment-send", this.sending ? "Sending…" : "Comment", true, (_e, cx) => this.send(cx), this.sending))),
      );

    return root.child(header).child(body);
  }
}
