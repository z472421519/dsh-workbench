# dsh-agent-board

A live Session board that occupies the sidebar's browsing region, modelled on
the local `agentbar` tmux sidebar: three sections, one compact row per Session
with a status glyph, the title, and how long ago it changed. Selecting a row
opens that Session.

## Where it appears

It fills `sidebar.workspaces` — the whole region between the panel rows and the
footer — so it is **always visible**, not a page you open. There is no extra
sidebar entry and no main-column page.

**Enabling it replaces the shipped workspace browser**, which also removes its
search box, drag reordering, workspace grouping controls, and Add-workspace
button. Disable the plugin to get that browser back.

## The board

| Section | Membership |
|---|---|
| Needs you | The Session has a pending interaction (approval, question, plan review) |
| Running | The Session has live work |
| Recent | Everything else: completed turns and idle Sessions, newest first, 12 shown until you ask for more |

| Element | Source |
|---|---|
| Glyph | `?` attention, pulsing `●` running, `✓` finished turn, `·` idle — shape carries the state, not only color |
| Title | The Session's display title |
| Time | Compact age of the last change (`3m`, `5h`, `3d`) |

Each section collapses independently and starts expanded. Blank Sessions and
subagent children are omitted. When the sidebar collapses to its 56px rail the
board degrades to one dot per active state, so a pending approval still shows.

## What it reads

`useSessions` (the Session list) and `useSessionStatus` (live running and
pending-interaction state), both already supplied to the seat. No Session is
opened or retained to draw a row, no log is read, and no model request is made.

## Limits

- **The workspace browser is gone while this is on.** That is the trade: the
  seat is single-occupancy, so both cannot share it.
- **Row order is fixed** by section and recency; there is no manual reordering.
- **`?` is generic.** Three shipped interaction kinds get their own tooltip
  sentence; any other kind falls back to the generic attention label.
