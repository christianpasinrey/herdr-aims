// A popup of choices for the sidebar. The popup is its own copy of the mod,
// so it cannot call back: a choice is written where the sidebar looks for it
// (the shared view, or the connections file) and the sidebar follows.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, theme, setShared } from "herdr";
import { loadConfig, saveConfig } from "./config.js";
import { ICON } from "./ui.js";

export const VIEW_KEY = "aims.view";

export function openConnect() {
  openOverlay({ mod: "aims", kind: "dialog", width: 460, height: 470, props: { view: "connect" } });
}

export class Menu {
  init(cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  items() {
    return (props()?.items ?? []).filter((item) => item && typeof item.label === "string");
  }

  choose(index, cx) {
    const item = this.items()[index];
    if (!item || item.heading) return;
    closeOverlay(props()?.overlay);

    const action = item.action ?? {};
    if (action.type === "view") {
      setShared(VIEW_KEY, action.value);
    } else if (action.type === "connect") {
      openConnect();
    } else if (action.type === "workspace" || action.type === "connection") {
      cx.spawn(async () => {
        const config = await loadConfig();
        if (action.type === "connection") {
          if (action.index >= 0 && action.index < config.connections.length) config.active = action.index;
        } else {
          const connection = config.connections[config.active];
          if (connection) connection.workspace = action.slug;
        }
        await saveConfig(config);
      });
    }
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
                .when(Boolean(item.checked), (el) => el.child(svg(ICON("check")).size(13).flex_none().text_color(t.foreground))),
        ),
      );
  }
}
