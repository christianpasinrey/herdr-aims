// AIMS for Herdr: issues from an AIMS instance, beside your terminals.
// One mod, several faces; `props().view` picks the one this copy draws.
// Opened without props (the palette's "AIMS: connect") it is the Connect dialog.

import { View } from "gpui-kit";
import { props } from "herdr";
import { Sidebar } from "./sidebar.js";
import { Connect } from "./connect.js";
import { Menu } from "./menu.js";
import { IssuePane } from "./issue.js";

const VIEWS = { sidebar: Sidebar, connect: Connect, menu: Menu, issue: IssuePane };

export default class Aims extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const name = p.view ?? (p.overlay ? "connect" : "sidebar");
    this.view = new (VIEWS[name] ?? Sidebar)();
    this.view.init(cx);
  }

  render(cx) {
    return this.view.render(cx);
  }

  async close(cx) {
    this.view.close?.(cx);
  }
}
