# dsh-agent-board

A live Session board that occupies the sidebar's browsing region, modelled on
the local `agentbar` tmux sidebar: four sections, one compact row per Session
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
| Recent | Quiet Sessions updated within the last 12 hours, newest first |
| Sleeping | Quiet Sessions with no update for 12 hours or more |

The four sections are evaluated in that order, so **state outranks age**: an
approval left pending for two days stays in *Needs you*, and a long-running turn
stays in *Running*. Only a Session with nothing pending and no live work can
fall asleep.

Both long sections show 12 rows and offer a "show N more" row.

| Element | Source |
|---|---|
| Glyph | `?` attention (amber), pulsing `●` running (green), `✓` finished turn (green), `·` idle (gray), `○` sleeping (gray, fainter) — shape carries the state, not only color |
| Title | The Session's display title |
| Time | Compact age of the last change (`3m`, `5h`, `3d`) |

Each section collapses independently and starts expanded. Blank Sessions and
subagent children are omitted. When the sidebar collapses to its 56px rail the
board degrades to one dot per active state, so a pending approval still shows.

## What it reads

`useSessions` (the Session list) and `useSessionStatus` (live running and
pending-interaction state), both already supplied to the seat. No Session is
opened or retained to draw a row, no log is read, and no model request is made.

## Colors

Every state maps to one Harness theme token in the `COLORS` table at the top of
`client.js`:

```js
const COLORS = {
  attention: 'var(--dsw-alias-state-warn-primary)',    // amber
  running:   'var(--dsw-alias-state-success-primary)', // green
  done:      'var(--dsw-alias-state-success-primary)', // green
  idle:      'var(--dsw-alias-label-caption)',         // gray
  sleeping:  'var(--dsw-alias-label-caption)',         // gray, drawn fainter
}
```

Edit that table to re-map a state. Because these are theme tokens, the board
follows light/dark and any brand override the deployment applies — literal hex
values would not. The glyph shape stays the same whatever the color, so a state
is never carried by color alone.

`done` and `running` intentionally share green: both mean "nothing is waiting on
you". The check glyph separates them. To split them, point `done` at another
token, for example `--dsw-alias-label-secondary` for a neutral, or
`--dsw-alias-state-business-primary` for the shipped blue.

## Changing the sleep threshold

`sleeping` is one constant in `client.js`:

```js
const SLEEP_AFTER_MS = 12 * 60 * 60 * 1000
```

Raise it to keep more history in *Recent*, lower it to clear the panel sooner.
Because the board reuses the Session's `updatedAt`, any prompt, steer, or turn
end resets that Session's clock — there is no separate "wake" action.

## Limits

- **The workspace browser is gone while this is on.** That is the trade: the
  seat is single-occupancy, so both cannot share it.
- **Row order is fixed** by section and recency; there is no manual reordering.
- **Sleep is purely a time threshold.** A Session you are actively reading but
  have not prompted does not count as activity, so it can sleep 12 hours after
  its last turn even if you keep opening it.
- **`?` is generic.** Three shipped interaction kinds get their own tooltip
  sentence; any other kind falls back to the generic attention label.
