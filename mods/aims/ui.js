// Small pieces every view of the mod draws the same way.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";

export const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
export const OWN = (name) => `mods/aims/${name}.svg`;

/** A dialog button; `primary` is the one Enter would press. */
export function button(t, id, text, primary, action, disabled = false) {
  return h_flex()
    .id(id)
    .h(32)
    .px(14)
    .items_center()
    .rounded(8)
    .border_1()
    .border_color(primary ? t.solid : t.input)
    .bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground)
    .text_size(12.5)
    .font_medium()
    .when(disabled, (el) => el.opacity(0.5))
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action))
    .child(text);
}

/** A square icon button for a panel header. */
export function iconButton(t, id, icon, action) {
  return h_flex()
    .id(id)
    .size(22)
    .flex_none()
    .items_center()
    .justify_center()
    .rounded(6)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(action)
    .child(svg(icon).size(13).flex_none().text_color(t.muted));
}

/** The coloured dot of a workflow state: a ring until started, filled after. */
export function stateDot(t, state) {
  const color = state?.color || t.dim;
  const open = !state || state.type === "triage" || state.type === "backlog" || state.type === "unstarted";
  return div()
    .size(9)
    .flex_none()
    .rounded(5)
    .when(open, (el) => el.border(1.5).border_color(color))
    .when(!open, (el) => el.bg(color));
}

const PRIORITY = { 1: ["!", "blocked"], 2: ["↑", "foreground"], 3: ["–", "muted"], 4: ["↓", "dim"] };

/** Urgent, high, medium, low as one glyph; nothing for "no priority". */
export function priorityMark(t, priority) {
  const mark = PRIORITY[priority?.value];
  return div()
    .w(10)
    .flex_none()
    .text_size(11)
    .font_semibold()
    .text_color(mark ? t[mark[1]] : t.dim)
    .child(mark ? mark[0] : "");
}

/** Lifecycle order of state types, for grouping lists the way a board reads. */
export const TYPE_ORDER = { started: 0, unstarted: 1, backlog: 2, triage: 3, completed: 4, canceled: 5 };
