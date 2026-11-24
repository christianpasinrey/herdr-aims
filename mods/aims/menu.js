// A popup of choices for the sidebar. The popup is its own copy of the mod,
// so it cannot call back: a choice is written where the sidebar looks for it
// (the shared view, or the connections file) and the sidebar follows.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, theme, shared, setShared, notify, run } from "herdr";
import { loadConfig, saveConfig, connectionFor, bumpRev } from "./config.js";
import { callTool } from "./client.js";
import { startWork } from "./start.js";
import { ICON } from "./ui.js";

export const VIEW_KEY = "aims.view";

export const ISSUE_KEY = "aims.issue";
export const ISSUE_PANE_KEY = "aims.issuePane";

export function openConnect() {
  openOverlay({ mod: "aims", kind: "dialog", width: 460, height: 470, props: { view: "connect" } });
}

export class Menu {
  init(cx) {
    this.at = 0;
    this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  items() {
    return (props()?.items ?? []).filter((item) => item && typeof item.label === "string");
  }

  /**
   * A popup that closes takes its unfinished work with it, so anything that
   * waits (a file write, a call to the server) finishes first and the popup
   * closes after.
   */
  choose(index, cx) {
    const item = this.items()[index];
    if (!item || item.heading || this.busy) return;
    const overlay = props()?.overlay;
    const action = item.action ?? {};

    if (action.type === "view") {
      setShared(VIEW_KEY, action.value);
      closeOverlay(overlay);
      return;
    }
    if (action.type === "knowledge") {
      closeOverlay(overlay);
      // The same shared request openKnowledge() in knowledge.js makes; written
      // here so the menu does not import the view it is opening.
      setShared("aims.knowledge", { url: action.url, workspace: action.workspace, at: Date.now() });
      const open = shared("aims.knowledgePane");
      if (open?.tab) run("tab.select", { id: open.tab });
      else run("tab.new", { name: "Knowledge", mod: "aims", props: { view: "knowledge", url: action.url, workspace: action.workspace } });
      return;
    }
    if (action.type === "connect") {
      closeOverlay(overlay);
      openConnect();
      return;
    }
    if (!["tool", "workspace", "connection", "start"].includes(action.type)) {
      closeOverlay(overlay);
      return;
    }

    this.busy = true;
    this.at = index;
    cx.notify();
    cx.spawn(async () => {
      try {
        const config = await loadConfig();
        if (action.type === "start") {
          await startWork(action);
        } else if (action.type === "tool") {
          // A write on the server (a status change); every copy reloads after.
          const connection = connectionFor(config, action.url, action.workspace);
          if (!connection) throw new Error("No AIMS connection.");
          await callTool(connection, action.tool, action.args ?? {});
          bumpRev();
        } else {
          if (action.type === "connection") {
            if (action.index >= 0 && action.index < config.connections.length) config.active = action.index;
          } else {
            const connection = config.connections[config.active];
            if (connection) connection.workspace = action.slug;
          }
          await saveConfig(config);
        }
      } catch (error) {
        notify({ title: "AIMS", body: String(error?.message ?? error), level: "error" });
      }
      closeOverlay(overlay);
    });
  }

  render() {
    const t = theme();
    const list = this.items();
    const step = (from, by) => {
      let i = from;
      for (let n = 0; n < list.length; n++) {
        i = (i + by + list.length) % list.length;
        if (!list[i].heading) return i;
      }
      return from;
    };

    return v_flex()
      .id("aims-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = step(this.at, 1);
        else if (e.key === "up") this.at = step(this.at, -1);
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((item, i) =>
          item.heading
            ? div().px(8).pt(i === 0 ? 4 : 9).pb(4).text_size(11).text_color(t.dim).child(item.label)
            : h_flex()
                .id(`aims-mi-${i}`)
                .h(29)
                .px(8)
                .gap(9)
                .rounded(7)
                .items_center()
                .text_color(t.foreground)
                .cursor_pointer()
                .when(i === this.at, (el) => el.bg(t.selected))
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => this.choose(i, cx))
                .child(div().flex_1().truncate().child(item.label))
                .when(this.busy && i === this.at, (el) => el.child(svg(ICON("spinner")).size(12).flex_none().text_color(t.working).spin(900)))
                .when(Boolean(item.checked) && !(this.busy && i === this.at), (el) => el.child(svg(ICON("check")).size(13).flex_none().text_color(t.foreground))),
        ),
      );
  }
}
