// The knowledge base: the workspace's code graph, as AIMS merges it from every
// issue, milestone and project. Start from the most referenced nodes, look one
// up by file or class, and walk: what a node contains, what it touches, and
// which work referenced it. A graph attached to an issue opens here too.
//
// It reads the existing graphs-map / graphs-get tools as they are. They look
// nodes up by file, class or key, not by free text, so typing filters the
// list on screen and Enter asks the server for that exact file or class.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, shared, setShared, focused, checking, run, readTextFile } from "herdr";
import { loadConfig, connectionFor } from "./config.js";
import { callTool } from "./client.js";
import { ISSUE_KEY, ISSUE_PANE_KEY } from "./menu.js";
import { ICON } from "./ui.js";
import { shownPlace, repoOf } from "./start.js";

export const KNOWLEDGE_KEY = "aims.knowledge"; // { url, workspace, graph?, key?, at }
export const KNOWLEDGE_PANE_KEY = "aims.knowledgePane"; // { tab }

const KINDS = [["", "All"], ["file", "Files"], ["class", "Classes"], ["function", "Functions"], ["resource", "Resources"]];
const KIND_COLOR = { file: "ansi4", class: "ansi5", function: "ansi2", resource: "ansi3" };
const STAGE_COLOR = { planned: "working", implemented: "done", observed: "muted" };

/** Shows a node or a graph in the knowledge tab, opening the tab if there is none. */
export function openKnowledge(target) {
  setShared(KNOWLEDGE_KEY, { ...target, at: Date.now() });
  const open = shared(KNOWLEDGE_PANE_KEY);
  if (open?.tab) run("tab.select", { id: open.tab });
  else run("tab.new", { name: "Knowledge", mod: "aims", props: { view: "knowledge", ...target } });
}

export class Knowledge {
  init(cx) {
    this.target = null; // what the pane was last told to show
    this.page = { type: "home" }; // home | node | list | graph
    this.history = [];
    this.kind = "";
    this.hotspots = [];
    this.loading = false;
    this.error = "";
    this.localFile = null; // absolute path of the shown node's file, if it is in the shown repo
    this.tab = focused()?.tab ?? null;

    this.search = InputState.new({ placeholder: "Filter, or type a file path or class name and press Enter" });
    this.searchText = "";
    this.searchFocused = false;
    this.search.on("change", (_e, cx) => { this.searchText = this.search.value(); cx.notify(); });
    this.search.on("submit", (_e, cx) => this.lookup(cx));
    this.search.on("focus", (_e, cx) => { this.searchFocused = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.searchFocused = false; cx.notify(); });

    if (checking()) return;
    setShared(KNOWLEDGE_PANE_KEY, { tab: this.tab });
    this.follow(cx, false);
  }

  close() {
    if (shared(KNOWLEDGE_PANE_KEY)?.tab === this.tab) setShared(KNOWLEDGE_PANE_KEY, null);
  }

  selection() {
    const picked = shared(KNOWLEDGE_KEY);
    return picked?.url ? picked : (props() ?? {});
  }

  /** Goes where the latest request points: a graph, a node, or the home list. */
  follow(cx, rendering) {
    const target = this.selection();
    this.target = target;
    this.history = [];
    if (target.graph) this.go(cx, { type: "graph", id: target.graph }, rendering, false);
    else if (target.key) this.go(cx, { type: "node", args: { key: target.key } }, rendering, false);
    else this.go(cx, { type: "home" }, rendering, false);
  }

  async call(tool, args) {
    const connection = connectionFor(await loadConfig(), this.target?.url, this.target?.workspace);
    if (!connection) throw new Error("Connect to AIMS first.");
    return callTool(connection, tool, args);
  }

  go(cx, page, rendering = false, remember = true) {
    if (remember) this.history.push(this.page);
    this.page = page;
    this.error = "";
    this.loading = true;
    this.localFile = null;
    if (!rendering) cx.notify();

    cx.spawn(async (cx) => {
      try {
        if (page.type === "home") {
          const answer = await this.call("graphs-map", { mode: "hotspots", limit: 100, ...(this.kind ? { kind: this.kind } : {}) });
          this.hotspots = answer.hotspots ?? [];
        } else if (page.type === "graph") {
          page.graph = await this.call("graphs-get", { id: page.id });
        } else if (page.type === "node") {
          const answer = await this.call("graphs-map", { mode: "node", ...page.args });
          if (answer.nodes) {
            // Several nodes match (a class name in two files): let the person pick.
            this.page = { type: "list", nodes: answer.nodes, title: Object.values(page.args).join(" ") };
          } else {
            page.data = answer;
            const around = await this.call("graphs-map", { mode: "neighbors", key: answer.node.key, depth: 1 }).catch(() => null);
            page.neighbors = around?.neighbors ?? [];
            page.edges = around?.edges ?? [];
            if (this.page === page) this.localFile = await this.findLocal(answer.node.file);
          }
        }
      } catch (error) {
        if (this.page === page) this.error = String(error?.message ?? error);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  back(cx) {
    const previous = this.history.pop();
    if (!previous) return;
    this.page = previous;
    this.error = "";
    this.localFile = null;
    cx.notify();
    if (previous.type === "node" && previous.data?.node?.file) {
      cx.spawn(async (cx) => {
        this.localFile = await this.findLocal(previous.data.node.file);
        cx.notify();
      });
    }
  }

  /** The node's file inside the repo of the space on screen, when it is there. */
  async findLocal(file) {
    if (!file) return null;
    try {
      const place = shownPlace();
      if (!place || place.machine !== null) return null;
      const repo = await repoOf(place.folder);
      if (!repo) return null;
      const path = `${repo.top}/${file}`;
      return (await readTextFile(path)) === null ? null : path;
    } catch {
      return null;
    }
  }

  lookup(cx) {
    const text = this.searchText.trim();
    if (!text) return;
    const isFile = text.includes("/") || /\.\w{1,6}$/.test(text);
    this.go(cx, { type: "node", args: isFile ? { file: text.replace(/\\/g, "/") } : { class: text } });
  }

  openOwner(owner) {
    if (owner?.type !== "issue" || !owner.identifier) return;
    setShared(ISSUE_KEY, { identifier: owner.identifier, url: this.target?.url, workspace: this.target?.workspace });
    if (shared(ISSUE_PANE_KEY)?.tab !== focused()?.tab) {
      run("pane.split", { direction: "right", mod: "aims", props: { view: "issue", identifier: owner.identifier, url: this.target?.url, workspace: this.target?.workspace } });
    }
  }

  // ------------------------------------------------------------------ drawing

  badge(t, kind) {
    return div()
      .flex_none()
      .w(58)
      .text_size(10.5)
      .text_color(t[KIND_COLOR[kind]] ?? t.dim)
      .child(kind ?? "");
  }

  nodeRow(t, id, node, right, cx) {
    return h_flex()
      .id(id)
      .h(27)
      .px(8)
      .gap(8)
      .flex_none()
      .rounded(7)
      .items_center()
      .text_size(12.5)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.go(cx, { type: "node", args: { key: node.key } }))
      .child(this.badge(t, node.kind))
      .child(div().flex_none().text_color(t.foreground).child(node.label ?? node.function ?? node.class ?? node.resource_name ?? node.file ?? node.key ?? ""))
      .child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(String(node.key ?? "").replace(/^[^:]*:/, "")))
      .when(Boolean(right), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(right)));
  }

  section(t, title, count) {
    return div().pt(14).pb(4).px(8).text_size(11).font_medium().text_color(t.muted).child(count === undefined ? title : `${title} · ${count}`);
  }

  home(t) {
    const filter = this.searchText.trim().toLowerCase();
    const shown = this.hotspots.filter((n) => !filter || `${n.label} ${n.key}`.toLowerCase().includes(filter));
    const list = v_flex().id("aims-kb-list").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar();

    if (!this.loading && !this.hotspots.length) {
      return list.child(div().p(16).text_size(12.5).text_color(t.muted).child("This workspace has no code graphs yet. Agents attach them to issues with graphs-attach."));
    }
    if (!shown.length && this.hotspots.length) {
      return list.child(div().p(16).text_size(12.5).text_color(t.muted).child("Nothing in the list matches. Press Enter to look that file or class up."));
    }
    list.child(this.section(t, "Most referenced", shown.length));
    shown.forEach((node, i) => list.child(this.nodeRow(t, `aims-kb-hot-${i}`, node, node.graphs > 1 ? `${node.graphs} graphs` : "")));
    return list;
  }

  listPage(t, page) {
    const list = v_flex().id("aims-kb-matches").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar();
    list.child(this.section(t, `Matches for ${page.title}`, page.nodes.length));
    page.nodes.forEach((node, i) => list.child(this.nodeRow(t, `aims-kb-match-${i}`, node)));
    return list;
  }

  graphPage(t, page) {
    const graph = page.graph;
    const list = v_flex().id("aims-kb-graph").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar();
    if (!graph) return list;
    list.child(
      v_flex().px(8).pt(6).gap(6)
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(15).font_semibold().child(graph.title))
          .child(div().text_size(11).text_color(t[STAGE_COLOR[graph.stage]] ?? t.muted).child(graph.stage)))
        .when(Boolean(graph.owner?.name), (el) => el.child(
          h_flex().id("aims-kb-graph-owner").gap(6).text_size(11.5).text_color(t.muted)
            .when(graph.owner.type === "issue", (row) => row.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => this.openOwner(graph.owner)))
            .child(`${graph.owner.identifier ?? ""} ${graph.owner.name}`)))
        .when(Boolean(graph.summary), (el) => el.child(div().text_size(12.5).text_color(t.muted).child(graph.summary))));
    const refs = graph.references ?? [];
    list.child(this.section(t, "References", refs.length));
    refs.forEach((ref, i) => list.child(this.nodeRow(t, `aims-kb-ref-${i}`, ref, ref.change)));
    return list;
  }

  nodePage(t, page) {
    const list = v_flex().id("aims-kb-node").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar();
    const data = page.data;
    if (!data) return list;
    const node = data.node;
    const fact = (label, value) => h_flex().gap(8).text_size(12)
      .child(div().w(70).flex_none().text_color(t.dim).child(label))
      .child(div().flex_1().text_color(t.foreground).child(String(value)));

    list.child(
      v_flex().px(8).pt(6).gap(8)
        .child(h_flex().gap(8).items_center()
          .child(this.badge(t, node.kind).w(54))
          .child(div().flex_1().text_size(15).font_semibold().child(node.label ?? node.key)))
        .child(div().text_size(11).text_color(t.dim).child(node.key))
        .when(Boolean(node.signature), (el) => el.child(div().text_size(12).text_color(t.muted).child(node.signature)))
        .child(
          h_flex().gap(6)
            .when(Boolean(this.localFile), (el) => el.child(
              h_flex().id("aims-kb-open").h(24).px(9).rounded(6).items_center().bg(t.solid).text_color(t.solid_foreground)
                .text_size(11.5).font_medium().cursor_pointer().hover((s) => s.opacity(0.88))
                .on_click(() => run("pane.split", { direction: "right", mod: "aims", props: { view: "file", path: this.localFile } }))
                .child("Open file")))
            .child(
              h_flex().id("aims-kb-copy").h(24).px(9).rounded(6).items_center().border_1().border_color(t.border)
                .text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => cx.write_to_clipboard(node.file ?? node.key))
                .child(node.file ? "Copy path" : "Copy key")))
        .when(Boolean(node.description), (el) => el.child(fact("What", node.description)))
        .when(Boolean(node.purpose), (el) => el.child(fact("Why", node.purpose)))
        .when(Boolean(node.summary), (el) => el.child(fact("Summary", node.summary)))
        .when(Boolean(node.context), (el) => el.child(fact("Context", `${node.context}${node.role ? ` · ${node.role}` : ""}`))));

    const contains = data.contains ?? [];
    if (contains.length) {
      list.child(this.section(t, "Contains", contains.length));
      contains.forEach((child, i) => list.child(this.nodeRow(t, `aims-kb-in-${i}`, child)));
    }

    const neighbors = page.neighbors ?? [];
    if (neighbors.length) {
      const relationOf = (key) => {
        const edge = (page.edges ?? []).find((e) => (e.from === node.key && e.to === key) || (e.to === node.key && e.from === key));
        return edge ? (edge.from === node.key ? `${edge.relation} →` : `← ${edge.relation}`) : "";
      };
      list.child(this.section(t, "Connected to", neighbors.length));
      neighbors.forEach((other, i) => list.child(this.nodeRow(t, `aims-kb-nb-${i}`, other, relationOf(other.key))));
    }

    const referenced = data.referenced_by ?? [];
    list.child(this.section(t, "Referenced by", referenced.length));
    referenced.forEach((ref, i) => list.child(
      h_flex()
        .id(`aims-kb-by-${i}`)
        .h(27).px(8).gap(8).flex_none().rounded(7).items_center().text_size(12.5)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => (ref.owner?.type === "issue" ? this.openOwner(ref.owner) : this.go(cx, { type: "graph", id: ref.graph_id })))
        .child(div().flex_none().w(58).text_size(10.5).text_color(t[STAGE_COLOR[ref.stage]] ?? t.muted).child(ref.stage ?? ""))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ref.owner?.identifier ?? ref.owner?.type ?? ""))
        .child(div().flex_1().truncate().child(ref.owner?.name ?? ref.graph ?? ""))
        .child(div().flex_none().text_size(11).text_color(t.muted).child(ref.change ?? ""))));
    return list;
  }

  render(cx) {
    const t = theme();

    // The issue pane or the sidebar asked for another node, graph or workspace.
    const wanted = this.selection();
    if (!this.loading && (wanted.at ?? 0) !== (this.target?.at ?? 0)) this.follow(cx, true);

    const page = this.page;
    const bar = h_flex()
      .h(40).px(10).gap(8).flex_none().items_center().border_b(1).border_color(t.border)
      .when(this.history.length > 0, (el) => el.child(
        h_flex().id("aims-kb-back").size(24).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.back(cx))
          .child(svg(ICON("chevron-left")).size(13).flex_none().text_color(t.muted))))
      .child(
        h_flex().id("aims-kb-home").flex_none().h(24).px(6).rounded(6).items_center().cursor_pointer().text_size(12.5).font_semibold()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.history = []; this.go(cx, { type: "home" }, false, false); })
          .child("Knowledge"))
      .child(
        Input.new(this.search).flex_1().h(28).px(9).rounded(7).border_1()
          .border_color(this.searchFocused ? t.accent : t.input).bg(t.background).text_size(12).text_color(t.foreground))
      .when(this.loading, (el) => el.child(svg(ICON("spinner")).size(12).flex_none().text_color(t.working).spin(900)));

    const chips = h_flex().h(32).px(14).gap(4).flex_none().items_center().children(
      KINDS.map(([kind, label]) =>
        h_flex()
          .id(`aims-kb-kind-${kind || "all"}`)
          .h(22).px(8).rounded(6).items_center().text_size(11.5).cursor_pointer()
          .text_color(this.kind === kind ? t.foreground : t.muted)
          .when(this.kind === kind, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.kind = kind; this.go(cx, { type: "home" }, false, false); })
          .child(label)));

    const root = v_flex().id("aims-knowledge").size_full().min_h(0).bg(t.background).text_color(t.foreground).child(bar);
    if (this.error) {
      return root.child(div().p(16).text_size(12.5).text_color(t.blocked).child(this.error));
    }
    if (page.type === "node") return root.child(this.nodePage(t, page));
    if (page.type === "graph") return root.child(this.graphPage(t, page));
    if (page.type === "list") return root.child(this.listPage(t, page));
    return root.child(chips).child(this.home(t));
  }
}
