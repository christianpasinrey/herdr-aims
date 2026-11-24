// The Connect dialog: the person's AIMS connections, and a form to add one.
// A connection is saved only after board-overview answers with its token.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, checking } from "herdr";
import { loadConfig, saveConfig, hostOf } from "./config.js";
import { callTool } from "./client.js";
import { button, ICON } from "./ui.js";

export class Connect {
  init(cx) {
    this.config = { raw: null, connections: [], active: 0 };
    this.error = "";
    this.busy = false;
    this.focused = "url";

    this.fields = {
      url: InputState.new({ placeholder: "https://aims.example.com" }),
      token: InputState.new({ placeholder: "Personal token from Settings → Developer" }),
      name: InputState.new({ placeholder: "Name (optional)" }),
    };
    this.fields.token.set_masked(true);
    for (const [key, input] of Object.entries(this.fields)) {
      input.on("focus", (_e, cx) => { this.focused = key; cx.notify(); });
      input.on("submit", (_e, cx) => this.submit(cx));
    }
    this.handle = cx.focus_handle();

    if (checking()) return;
    this.fields.url.focus();
    cx.spawn(async (cx) => {
      this.config = await loadConfig();
      cx.notify();
    });
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  submit(cx) {
    if (this.busy) return;
    const url = this.fields.url.value().trim().replace(/\/+$/, "");
    const token = this.fields.token.value().trim();
    const name = this.fields.name.value().trim();

    if (!/^https?:\/\/[^\s/]+/.test(url)) {
      this.error = "Enter the instance address, starting with https://";
      cx.notify();
      return;
    }
    if (!token) {
      this.error = "Paste a personal token.";
      cx.notify();
      return;
    }

    this.busy = true;
    this.error = "";
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        const connection = { name: name || hostOf(url), url, token, workspace: null };
        const overview = await callTool(connection, "board-overview");
        connection.workspace = overview?.workspace?.slug ?? null;

        // Read again: another copy may have saved since this dialog opened.
        const config = await loadConfig();
        const at = config.connections.findIndex((c) => c.url === url);
        if (at >= 0) config.connections[at] = connection;
        else config.connections.push(connection);
        config.active = at >= 0 ? at : config.connections.length - 1;
        await saveConfig(config);
        this.close();
      } catch (error) {
        this.error = error?.kind === "tool"
          ? `${error.message} Is this instance up to date?`
          : String(error?.message ?? error);
        this.busy = false;
        cx.notify();
      }
    });
  }

  remove(index, cx) {
    cx.spawn(async (cx) => {
      const config = await loadConfig();
      config.connections.splice(index, 1);
      config.active = Math.min(config.active, Math.max(0, config.connections.length - 1));
      await saveConfig(config);
      this.config = config;
      cx.notify();
    });
  }

  field(t, key, label) {
    return v_flex()
      .child(div().pt(12).pb(6).text_size(11.5).text_color(t.dim).child(label))
      .child(
        Input.new(this.fields[key])
          .h(34)
          .px(10)
          .rounded(8)
          .border_1()
          .border_color(this.focused === key ? t.accent : t.input)
          .bg(t.background)
          .text_size(12.5)
          .text_color(t.foreground),
      );
  }

  render() {
    const t = theme();
    const connections = this.config.connections;

    return v_flex()
      .id("aims-connect")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { this.close(); cx.stop_propagation(); }
      })
      .w_full()
      .min_h(0)
      .p(18)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .items_center()
          .child(div().flex_1().text_size(15).font_semibold().child("Connect to AIMS"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .when(connections.length > 0, (el) =>
        el.child(
          v_flex()
            .pt(12)
            .gap(2)
            .children(
              connections.map((c, i) =>
                h_flex()
                  .id(`aims-conn-${i}`)
                  .h(28)
                  .px(8)
                  .gap(8)
                  .rounded(7)
                  .items_center()
                  .bg(t.raised)
                  .child(svg(ICON("server")).size(13).flex_none().text_color(t.muted))
                  .child(div().text_size(12.5).child(c.name))
                  .child(div().flex_1().truncate().text_size(11.5).text_color(t.dim).child(hostOf(c.url)))
                  .child(
                    h_flex()
                      .id(`aims-conn-x-${i}`)
                      .size(20)
                      .flex_none()
                      .items_center()
                      .justify_center()
                      .rounded(5)
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover))
                      .on_click((_e, cx) => this.remove(i, cx))
                      .child(svg(ICON("x")).size(12).flex_none().text_color(t.muted)),
                  ),
              ),
            ),
        ),
      )
      .child(this.field(t, "url", "Instance address"))
      .child(this.field(t, "token", "Personal token"))
      .child(this.field(t, "name", "Name"))
      .child(
        div()
          .pt(8)
          .min_h(24)
          .text_size(11.5)
          .text_color(this.error ? t.blocked : t.dim)
          .child(this.error || "The token is stored in aims.json in your Herdr folder, on this computer only."),
      )
      .child(
        h_flex()
          .pt(12)
          .gap(8)
          .justify_end()
          .child(button(t, "aims-connect-cancel", "Close", false, () => this.close()))
          .child(button(t, "aims-connect-save", this.busy ? "Checking…" : "Connect", true, (_e, cx) => this.submit(cx), this.busy)),
      );
  }
}
