// A read-only look at one file, opened from a node of the knowledge base.

import { div } from "gpui-kit";
import { v_flex, h_flex, EditorState, Editor } from "gpui-base";
import { props, theme, settings, readTextFile, checking } from "herdr";

const LANGUAGE = {
  php: "php", js: "javascript", mjs: "javascript", ts: "typescript", vue: "html", json: "json",
  md: "markdown", css: "css", html: "html", py: "python", rs: "rust", go: "go", sh: "bash",
  yml: "yaml", yaml: "yaml", sql: "sql", toml: "toml",
};

export class FileView {
  init(cx) {
    this.path = String(props()?.path ?? "");
    this.state = null;
    this.error = "";
    if (checking() || !this.path) return;

    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(this.path);
        if (text === null) throw new Error("The file is not there any more.");
        const extension = this.path.split(".").pop()?.toLowerCase() ?? "";
        this.state = EditorState.new({
          language: LANGUAGE[extension] ?? "text",
          value: text,
          readonly: true,
          font_family: settings().font_family,
        });
      } catch (error) {
        this.error = String(error?.message ?? error);
      }
      cx.notify();
    });
  }

  close() {
    this.state?.release?.();
  }

  render() {
    const t = theme();
    const root = v_flex().id("aims-file").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(h_flex().h(30).px(12).flex_none().items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().truncate().text_size(11.5).text_color(t.muted).child(this.path)));
    if (this.error) return root.child(div().p(16).text_size(12.5).text_color(t.blocked).child(this.error));
    if (!this.state) return root.child(div().p(16).text_size(12.5).text_color(t.muted).child("Loading…"));
    return root.child(div().flex_1().min_h(0).child(Editor.new(this.state)));
  }
}
