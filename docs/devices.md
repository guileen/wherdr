# Computer, phone and iPad

[Documentation](README.md) · [Project](../README.md)

### On a computer

- **Process output**: when the conversation has enough room, a read-only panel beside
  it shows process activity from the conversation transcript; the composer stays under
  the conversation. It uses the transcript's existing polling cadence, with no separate
  terminal observer. Narrow windows and phones keep one view.

- **Split panes, live**: a tab with several panes is drawn with Herdr's real layout; every pane
  shows its conversation or terminal live. Every visible terminal fills its cell and follows
  window and divider resizing, keeping its instance and connection when focus changes.
  Click a cell to give it the keyboard. Leaving the tab restores each terminal's original size,
  unless a Herdr client has resized it meanwhile.
- **Rearrange the layout**: drag a pane onto another to move it, drag a divider to resize
  (arrow keys work on a focused divider); changes go to Herdr itself.
- **Spaces and tabs**: the sidebar uses the unified conversation list with machine tabs,
  activity sort, card badges and task topics, matching the phone layout. Tabs stay at the
  top, active tab remembered per space. The sidebar can be resized, or collapsed to a narrow
  rail (search, new agent, settings and state counters) with the button next to Settings; the
  choice is kept on the device.
- **Keyboard shortcuts** (`Mod` is ⌘ on macOS, Ctrl elsewhere; `Mod+/` or `?` lists them all,
  also in Settings › Computer):
  - `Ctrl/⌘+K` global search across agents and conversations, `Alt+↑/↓` previous / next agent
    in the list, `Mod+,` settings, `H` the [Board](board.md#works-great-with-herdr-projects) (outside a
    text field and the terminal).
  - `Mod+Alt+N` new agent in a new space, `Mod+Alt+T` new tab in the current space,
    `Mod+Alt+W` close the current pane (after confirmation). They work from the terminal too.
  - In an agent: `Mod+F` searches the conversation, ``Ctrl+` `` switches between conversation
    and terminal, and `Esc` stops a working agent when the message field is empty.
  - `Alt+Shift+arrows` swaps the current pane with its neighbour, `Ctrl/⌘+Alt+arrows` moves
    focus to the neighbouring pane in a side-by-side tab, `Esc` closes dialogs, `Enter` sends
    and `Shift+Enter` adds a new line. On a "Your turn" card, `1`–`9` pick an option (on AZERTY
    without Shift too, outside the message field); on the `/resume` card, `Ctrl+A` switches
    between every project and the current one (`⌘A` still selects all on macOS).
- In the message field, `↑` on the first line recalls previous messages and slash commands;
  `↓` on the last line returns to newer entries, then restores your draft. History keeps the
  last 100 texts sent from this device per agent, without attachments or quoted references.
- At the end of a ready agent's latest reply, shortcuts close that pane (with the usual
  confirmation). For omp, **Compact** offers QA only with an estimated context size
  and Relay, which puts `/compact relay` in the composer for an optional focus.
  The shortcuts are hidden while the agent is working, waiting for input, or disconnected.
- **Board** for [herdr-projects](board.md#works-great-with-herdr-projects) 1.2.1 or later: every machine's
  tasks in four columns (needs you, ready to approve, working, to do), done one tap away, each
  task with its pull request, review, reply and approval.
- **Settings** in a sidebar, with desktop-only options such as the content width.

### On a phone

- **Home**: machine tabs filter a single conversation list. Recent activity puts working
  agents first, then sorts each group by the latest observed agent state change. Cards
  show its elapsed time, or `—` if none was observed. Working time survives server restarts,
  state-sequence resets and short link gaps for the same session; only an observed non-working
  status clears it, so time spent down is counted with the running episode. Ordinary output
  without a state change does not update the time. Name
  sorting remains available. On All, Home's Models cards show **This machine** and
  choose its default for **new omp sessions only**; existing conversations never switch.
  A successful save moves the check mark and records the manual preference. A machine
  tab shows that machine's models and usage; remote defaults are read-only. Usage and
  recommendation order share a machine-keyed cache with the conversation picker.
  Compact two-column cards group subscription models and quota-only pools by provider;
  a separate Experts card ranks expert routes. Each row uses the same compact quota
  tube and rounded-up reset time. Shared Codex quota appears once; its sheet keeps
  model choices. Codex reset passes highlight expiry within 24 hours. OpenRouter
  API routes are excluded; DeepSeek remains.
  Quota windows show weekly first; when weekly usage is over pace, an under-pace
  five-hour window is hidden in the details. Each detailed window has a reset countdown/period and
  a narrow SVG tube. Remaining quota occupies the right side in translucent gray; the elapsed-time line
  advances inside the same frame. The countdown ticks while visible without extra
  quota requests. Unknown, stale and reset readings never invent a fresh quota.
  Percentages and provider names remain available through accessible labels and
  tooltips. DeepSeek spending remains dashes until observed. The separate Account
  limits rail scrolls horizontally and expands, including X pools and machine/account
  labels, without model-switch controls. Cards and model choices have 44 px hit targets.
  Standalone agent cards keep their existing name and show a meaningful agent title
  beneath it instead of the latest reply: up to two lines, or one in compact mode.
  Without a distinct title, the usual preview is retained. Waiting questions and
  answers, Board cards and multi-pane Space cards are unchanged.

- **Compact agent header**: a 44 px bar holds Back, one two-line identity, Terminal and Options.
  The identity shows the pane name, then its square state indicator, state label and agent kind.
  Tap it (always available, even for a lone pane) for the machine/space context and everything
  that manages panes and tabs: switching (listed only when there are several; a lone pane shows its
  full name and state instead), then the current
  pane (rename, split, move, swap, copy ID, then **Close this conversation** or **Close this
  terminal**: only that pane, from either view) and the current tab (rename, new tab, tab
  overview). **Close entire space…** stands apart, and only when the space holds other panes: a
  lone pane has a single close, whose confirmation says the space closes too. A tab closes from its
  overview, which says how many panes go. Every close confirmation names what stops, how many tabs
  and panes go and what stays open; if the structure changes while it is open and the close would
  now take more, the updated confirmation is shown again. Long names ellipsize; multiple panes
  show their position, never 1/1.
  For omp, the title bar shows the current model and opens the session model selector;
  effort remains in the composer. Usage ordering comes from the pane's machine, not
  another machine's account. Both controls affect only this conversation.
  Options keeps the conversation, the agent and its tools: Terminal/Conversation, search,
  notifications, changes, files, plugin actions, take control, restart, reconnect and settings.
- **Terminal function keys** start closed. The square chevron button above Send shows or hides
  one horizontally scrolling row in both Conversation and Terminal. It holds Ctrl, Esc, Tab,
  arrows, Enter, Ctrl+C, Backspace and the remaining modifiers and function keys. The phone-keyboard
  toggle comes first, and Home, End, PgUp, PgDn, Insert and Delete are available in both modes.
  In Conversation the keyboard toggle focuses the message field, and navigation uses the
  named-key API without opening a terminal connection.
  Select Shift then Tab for Shift+Tab. Closing the bar clears any armed modifier.
  The input stays on one row at rest and expands while editing. Desktop and tablet layouts
  keep their existing controls.
- **Installable app (PWA)** on iPhone and Android, with safe-area and keyboard handling.
- **Web Push notifications** when an agent finishes or needs you (with its question), and for
  `herdr notification show` (plugins, scripts).
- **Quick replies**: answer permissions and questions in one tap from the agent list.
- **Split tabs on a small screen**: a plan of the tab's panes in Herdr's proportions, then each
  pane full screen with a mini-map and swipe to its neighbours.
- **Terminal key bar** (Esc, Enter, arrows, Shift+Tab, Ctrl+C…) and touch scrolling.
  On iPhone and iPad a tap on the terminal does not open the on-screen keyboard: type in the
  message field, or tap the key bar's keyboard button to type in the terminal.
  Terminal links back to this app stay in the current window on a phone; external
  links still open separately.
- **Offline reading** of the last known state and of recently opened conversations.

### On an iPad

- **Computer layout in both orientations**: in portrait the agent list folds to a narrow column
  and slides over the conversation; in landscape it stays docked. Buttons are 44 px, and the
  layout does not change when the on-screen keyboard opens.
- **Side by side by touch**: finger-sized pane buttons, grip and dividers; the active terminal
  pane has the key bar; with the keyboard open the tab fits the visible area above it.
- **Hardware keyboard**: Enter sends (Shift+Enter adds a line) once a key only a hardware
  keyboard sends (arrows, Esc, a ⌘ chord) has been typed.

The terminal key bar also has **Ctrl**, **Alt** and **Shift** toggles. Select one or
several, then tap a key or type one ASCII character on the phone keyboard. The
modifiers reset after that key; tapping a selected modifier cancels it. Pasting
or entering composed text clears the selection and keeps the text unchanged.
