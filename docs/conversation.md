# Conversation and replies

[Documentation](README.md) · [Project](../README.md)

- **Conversation view**: the agent's real transcript (Claude Code, Codex and omp), rendered as
  Markdown, with images (full-screen viewer with pinch / wheel zoom and pan), timestamps,
  search and infinite scroll back to the first message. Consecutive tool calls, thinking and
  background jobs are grouped into a compact expandable process summary. While working, the
  latest thought and current step appear together; recorded thoughts are labelled as latest,
  not live. With the optional local omp bridge (`wherdr install-omp-thinking`), streamed
  thinking is shown as it arrives; existing omp sessions need `/reload` when idle or a restart.
  The bridge writes owner-only snapshots for Herdr sessions on the same machine. It clears them
  at turn end; a crash can leave a stale file, which the reader ignores after five seconds.
  Other machines and omp profiles need their own installation. Without it, only completed
  transcript entries are shown.
  The same bridge exposes active or paused omp loops in the conversation and, when its
  coordinator pane can be resolved, in Scheduled. Expand the command to read it in full
  and copy it to restart the loop in a new session. Command capture requires an updated
  omp runtime and bridge; older sessions may report the command as unavailable.
  **Stop Loop** requests that future iterations stop without interrupting the current turn;
  failure is reported if the session does not acknowledge the request. The loop card is
  hidden when inactive or when its state is unavailable, including stale heartbeats,
  unidentified sessions, and remote or unreachable machines. Install or update the bridge on each machine and omp profile with
  `wherdr install-omp-thinking`, then reload idle sessions with `/reload` or restart
  them. Stopping during a turn also requires an omp runtime that supports loop exit
  while busy; older runtimes can reject the request.
  Expand the group to inspect activity; its bottom row shows the current step and collapses it.
  Punctuation-only check-ins fold into the same group. Tool images remain inline. User
  messages, substantive agent replies and important errors remain visible unless retired by
  a committed omp rewind. The live process summary animates while the agent works; status
  alone does not identify reasoning. The latest task list stays above the composer; completed
  tasks are grouped and collapsed by default, and
  can be expanded separately. When there is room, a
  read-only panel alongside the conversation shows process output from the same transcript
  tail and optional live thinking, polled about every 1.5 seconds without a terminal observer.
  Shell commands and matching background-job waits share a terminal-style panel. File reads
  start collapsed (the summary keeps the path); edits stay open so their diff is visible, and
  other tools open by default. Any entry can be toggled, and the choice survives updates.
  Committed omp rewinds show a bordered handoff and fold the proven retired history by
  default; expand it to inspect the original entries. An unchanged-context closure does not
  fold history. If the loaded source range cannot establish the boundary, available entries
  stay visible and the handoff says the history is partial. Retained code is a recorded
  snapshot, not a fresh file read.
  Every entry with recorded text output shows a token-estimate badge on its header line, so
  the count stays visible while the body is collapsed. It covers the entry's call (command,
  path, pattern) and its recorded output, using about four word characters, 1.6 symbols or
  twenty spaces per token, and one token per non-ASCII character; 4,000 or more estimated
  tokens is marked high output.
  This estimates the full recorded text before the display excerpt is clipped, not measured
  provider usage: images, provider formatting, compaction and model tokenization may differ.
  An animated activity indicator appears even before text is recorded. Without an explicit
  step it says “Thinking / working”: pane status alone cannot distinguish reasoning from work.
  The panel highlights recognized code, diffs and log status. An edit's diff is drawn as
  aligned rows: a sign, the line number of its side of the file, then highlighted code, with
  added and removed rows tinted and an added/removed count beside **Diff**. Tool output appears when recorded,
  not necessarily while the tool is running; each result displays at most its last 8,000
  characters and indicates truncation. It is not a raw terminal feed. At the latest
  bottom, new messages and streamed output stay in view. Scroll upward
  to read without being pulled back, even just above the bottom.
  While reading, new output below changes the fixed down-arrow control to **New messages**;
  select it or scroll down to the latest bottom to resume following and hide the control.
  On phones it sits above the terminal-key toggle in a right-aligned stack; both controls
  have 44 px touch targets with an 8 px gap, whether the keys are open or closed. History loading,
  image reflow and resizing preserve the passage being read without creating a new-message
  indication. Quick answers keep their operation position; sending returns to latest.
  Returning from another view restores the same source passage, loading its neighborhood
  when it is outside the latest tail. A missing interval is shown explicitly with
  **Load messages between this position and latest**. Failed restores keep available content
  and offer Retry; changed or deleted source positions are reported, not silently restored
  to unrelated text.
  A command the agent proposes (shell code block, or inline `! command`) can be copied without
  its prompt, or run in the agent's shell mode (`!`, Claude Code, Codex and omp) after you
  confirm the full command.
- **SVG diagrams**: complete code fences labelled `svg` render as isolated, theme-aware images. **Source / Preview**, beside **Copy** in the card header, switches the same card between the diagram and its original markup; **Copy** always copies that markup. Click or use Enter/Space on the image for the existing full-screen viewer; an SVG opens fitted to the screen (enlarged when its intrinsic size is small), while raster images stay at most at their pixel size. Static shapes, text, local definitions and `<style>` sheets are supported — a sheet is folded onto the elements it selects (type, `.class`, `#id`, descendant and child selectors; at-rules and other selectors refuse the diagram rather than half-apply it) — up to 150,000 source characters, 2,000 source elements, 256 rules and 10,000 expanded reference instances. Incomplete, unsupported or unsafe diagrams stay readable code. Scripts, foreign HTML, animation and external resources are rejected; raw inline SVG is not inserted into the page. Other fence languages and file-explorer document fences remain code.
- **Mermaid diagrams**: code fences labelled `mermaid` render as theme-aware, isolated images. Use **Source / Preview** and **Copy** as with SVG; invalid diagrams remain readable code. Rendering is lazy and uses Mermaid's strict security mode.
- **Math**: `$…$` and `\(…\)` render inline, `$$…$$` and `\[…\]` render as their own block, through KaTeX bundled with its fonts (no network, `trust` off, so `\href` stays inert). A price such as `$5` and a delimiter still arriving during streaming stay literal, as does math inside code; a malformed formula shows KaTeX's error instead of breaking the message. Memory text shown plain keeps the TeX source, since KaTeX lays formulas out with inline styles.
- **Interactive agent screens**: in a conversation, an uncertain menu or panel opens the
  pane's real terminal in a modal window, with arrows, Enter, Escape, Tab, digits and y/n.
  The rest of the app waits behind a scrim (the window fills the screen on a phone); in a
  split, only the cell in use opens it. It closes after the agent's message field returns.
  Close it yourself at any time with its button or a click on the scrim: that releases the
  terminal without pressing Escape, which goes to the agent, and the same interaction stays
  closed until you reopen it. Existing native questions, approvals, menus, waiting screens and
  Claude settings cards keep their controls. The window is a fallback after those
  recognizers, with two explicit exceptions: Codex's two-column `/usage` menu and
  its Agent Command Center. The slash menu still lists and sends commands. On a phone, the window
  temporarily fits the real pane to its width and restores its size on release, using
  the same lease as Terminal view; it does not shrink 120 columns into unreadable text.
  A pane already shown in Terminal keeps its existing live view. Try `/usage` on the
  Codex agent in the browser demo (scripted, no account data).
  In the compact list, native questions keep their preview and one-tap answers.
  Unrecognized blocking screens offer an **Open interactive terminal** button.
- **Message actions**: **Copy** under every agent reply copies its Markdown, and **Copy** beside a
  user message's time copies its text; both stay available in a read-only view. **Reply** remains
  under a reply that can be quoted and on the end-of-turn line for the last one.
- **Composer**: send messages while the agent works. omp steers the running turn at a
  safe execution boundary; if its input is hidden, wherdr holds the message until the
  input returns, even during that turn. Messages whose earlier delivery is uncertain
  wait until the turn ends before retrying. Other agents use their own queue or a
  wherdr hold until the turn ends. Messages are never left half-typed in the field.
  **Undo** returns a queued message to the input field, with its
  photos and files, while wherdr still holds it or while it is still in Claude's queue.
  omp's native queue has no safe recall, so it offers no Undo. A message pulled back out
  of Claude's queue before it read it, or not seen after an hour, is
  marked “Not sent” with Retry / Undo, and “Not sent” clears once the message shows in its transcript), attach or paste
  photos and the files the agent can read (Claude Code: PDFs, notebooks, text and code of any
  extension; Codex: notebooks, text and code), run slash commands (`/compact`, `/clear`, `/context`, `/usage`…) and see the output
  of local commands. Omp compaction shows **Compacting context…** with a spinner
  until its live terminal status clears, including automatic maintenance.
  After an accepted omp rollover checkpoint, including when compaction remains pending,
  the conversation shows the observed agent state until a reply or new user message arrives.
  An idle agent without a subsequent reply offers
  **Continue**; it sends only on request and never replaces a draft. Offline or stale state
  is labelled unknown. Ordinary manual compaction does not trigger this notice.
  At the end of a ready omp reply, **Compact** offers **Rewind**, **QA only** and **Relay**.
  Rewind sends `/compact rewind` for local interval folding; it does not use the QA estimate.
  QA only shows approximate context token counts, excluding unknown image savings;
  unavailable readings are identified without disabling Rewind.
  Relay puts `/compact relay` before the existing draft so its focus can be edited before sending.
  Stop button while the agent works. When Claude Code suggests a reply
  (grayed-out in the empty field), `Tab` takes it on a computer and **Use**, inside the field on
  its right, on a phone: the field gets the text, to edit or send. A long pasted text (log, output) becomes
  a "Pasted text · N lines" card, sent to the agent as it is and shown the same way in the
  conversation, where it opens in full with Copy; long typed messages fold with Show more.
  The draft (text, quotes, attachments) is kept per agent, across reloads: when Herdr closes a
  pane and opens a new one for the same agent (the same conversation, or the same herdr-projects
  coordinator or task, as after `coordinator restart`), the view moves to the new pane and the
  draft comes along. A pane closed for good keeps it under its banner, with **Copy draft**.
- **omp context**: the conversation header shows a thin bottom-border usage line split by
  structure (system prompt, tool schemas, long-term memory, day notes, the conversation;
  the free remainder stays empty), with estimated tokens in uppercase `K` on its existing
  status line, without a percentage label or extra header height. Every width is its share
  of the whole window. The fixed load is exact: omp records it in each assistant message of
  its session file. Select the token count on a computer, or open the pane/title sheet on a
  phone, for the window, six rows (system, tools, memory, day notes, work, free) whose
  shares add up to 100 %, and **Show loaded context** for the real chain: the branch of the
  session tree the next turn loads, one block per fragment in send order (fixed load first,
  nothing merged by layer; the free remainder sits outside the bar on its own thin track),
  then the same entries listed in that same order, each in full, with drill-down from a
  block. The screen's percentages divide by the used context, so the legend adds up to
  100 % without free. Special entries keep their fragment colour as a row background. System
  and tools show the local omp build's template, since a session keeps only a digest; the
  project-context block varies per pane. Embedded Board views
  without a header keep their context and model controls in the composer.
  Message tokens use omp's rounded percentage, not cumulative token consumption. Without
  a recorded load the bar shows the plain used share. Clipped
  terminal borders are supported when both percentage and window remain visible.
  Unknown readings stay hidden. Working panes refresh even when not selected; unviewed
  resting panes retain their reading. Failed or gauge-free reads are marked as last known.
  Context stays visible when the touch composer is collapsed. Escape closes details
  without stopping the agent.
- **Model and effort pickers** for Claude Code, Codex and omp: omp's current model is
  in the conversation title bar, including on phones and split panes; its effort control
  remains in the composer, as do both controls for Claude Code and Codex. Omp's menu
  immediately offers the same machine's cached Home models and Usage, while reading
  the live scrolling "Switch Model" options (`/switch` or `/model`) in the background.
  Additional session choices are added when the read completes; Retry is available on
  failure. Every selection is checked against the actual session menu before it is applied:
  omp's selector is searched for the chosen provider/model id, never for the readable name,
  and the option under its cursor must be that exact id, so two providers offering the same
  model stay distinct. A switch omp does not confirm is reported as a failure, and the model
  shown stays the one before it.
  Choices use the cached Usage recommendations; missing, stale or reset quota is not
  treated as fresh capacity.
  The compact dropdown shows one row per actual model option, with the provider
  icon in its own column. Model name and reset time share one line above a 2 px
  usage underline that never extends under the provider. Long names truncate
  without moving the countdown or bar.
  Shared quota may appear on multiple model rows.
  Provider names distinguish otherwise identical options. OpenRouter models
  are excluded; other session options remain in the list.
  Provider-qualified options retain their full selector. The thinking level uses omp's
  own ⇧⇥ cycle. Changes apply **to the current session only**;
  wherdr never changes your default model from this menu.
**Settings › Conversation › Reply style** chooses how an agent's reply offers to be quoted in
the field, question by question and point by point (a list item or a paragraph that asks
nothing), so that one message answers them all:

| Style | A question | A point |
| --- | --- | --- |
| **Icon** (default) | A small `↳` after it, in the middle or at the end of the message. | A grey `↳` at its end: on hover on a computer, always there and pale on a phone. |
| **Tap the text** | No button: the question is underlined, tap or click it. | Click it on a computer. On a phone, tap it, then **↳ Discuss**: a single tap never quotes, so reading, scrolling and selecting text stay as they are. |
| **List under the message** | A number after it, and the questions listed under the message. | **+ Quote a point** under the message, then the point. Offered when the reply has a list item to quote, or two points or more: not under one paragraph of prose. |

Every one of these is a button reachable with the keyboard (`Tab`, then `Enter`), and selecting a
passage still offers **Reply** on it. A quoted question or point shows `✓`.

**One syntax for every reference.** Whatever you reply to, the field gets one line that names it,
and your answer goes on the lines below:

```
↳ Quote message 11:37 ~k3f : I can merge the PR —
Go ahead.
↳ Quote point 11:37 ~k3f : Shall I tag the release today? —
Yes
↳ Quote decision 11:37 #3 ~k3f : Publish the release notes on the site? —
No
```

| Line | Written by |
| --- | --- |
| `↳ Quote message <time> ~<code> : <start of the message> —` | **Reply** under an agent message. |
| `↳ Quote point <time> ~<code> : <excerpt> —` | `↳` on a question or a point, **Reply** on a selected passage. |
| `↳ Quote decision <time> #<n> ~<code> : <question> —` | **Yes**, **No** or `↳` on a row of a decision table. |
| `↳ Quote decisions <time> #<rows> ~<code> : <questions> —` | **OK to all** on a decision table. |

- The time is the one shown on the agent's message, so an answer to an earlier message is never
  read as an answer to the last one. The types are the same words in every language.
- The code after `~` is three characters wherdr derives from the message (and the rank of the
  table, from the second table of a message on). It tells apart two messages of the same minute
  and two tables of one message, whatever the excerpt shows. The field draws it dimmed, like
  the words before the excerpt; the quote of a sent message leaves it out. The rows of **OK to
  all** are the numbers the table really has: `#1-4`, or `#1,4` when rows 2 and 3 do not exist.
- A reference is a whole line: it starts with `↳` in the first column and ends with ` —` at the
  end of the line, and only there, so an excerpt may hold dashes of its own. The excerpt is plain
  text on one line; a long one is cut with `…` (a message keeps its start, a passage its start
  and its end).
- Several references fit in one message, each followed by its answer.
- Anything else is your own text: a `>` at the start of a line, a `↳` line of an unknown type or
  with words after its dash. Text you paste never becomes a reference either: a pasted line that
  reads like one gets a `\` before its `↳`. A long paste, shown as a **Pasted text** card, is
  sent exactly as it was pasted.
- In the conversation, each reference of a sent message shows as a quote; tap it to see the
  message it names. Messages sent earlier with `> ` lines still show as quotes.

**Settings › Conversation › Quoted replies** chooses how the field shows these lines: **Tokens,
native field** (default) draws each one as a token in the usual field, **Plain text** shows the
same lines as text, a fallback if the tokens misbehave. The message sent is the same.

A **closed question**, one that yes or no answers in full, also gets **Yes** and **No** next to
its `↳` (at the end of its row in the list style). A tap refers to the question and writes the
answer under it (`Yes` or `No`), exactly as Reply and typing would; nothing is sent, so several questions can be
answered in a row before sending. On a computer a click hands the field the focus, the caret
right after the answer, so Enter sends it at once; the keyboard stays down on a phone, and a
button pressed with the keyboard keeps the focus. Tapping the other answer
replaces the first; words you typed under a quote are never replaced. The rule is cautious, and
in doubt only Reply is offered: a single sentence that opens like a yes/no question (`Shall I…`,
`Do you…`, `Is it…`, `Want me to…`, `Est-ce que…`, `Je lance… ?`, `On…`, `Dois-je…`) or ends
with `, OK?` / `, d'accord ?`, with no alternative (`or`, `ou`), no interrogative word (`which`,
`how`, `quel`, `comment`…) and no negation.

A **decision table**, a Markdown table whose rows are numbered questions as a coordinator writes
them, gets a panel right under it: **OK to all** refers to the whole table and writes `OK to all`
under it (a second tap takes it back), and each row has **Yes**, **No** and `↳`, which refer to
the row by its number and write `Yes` or `No` under it, or nothing for an answer in words; a row
that asks an open question has `↳` alone. Every answer names the message and the row, even for
the last message: the agent may write another one before you send. Here too everything is composed in the field and you send; on a computer the field takes the focus
after a click, so Enter sends. A table qualifies when it has a
number column (a header `#`, `N°`, `No`, `Num`, `ID` or `Q` over short numbers, each once) and a
question column, known by its header (`Question`, `Decision`, `Choix`…), by cells that all end
with `?`, or by an advice column next to it (`Avis`, `Recommendation`, `Suggestion`…). Any other
table is left as it is.

Above the field, **N questions unanswered** counts the questions of the agent's last message
(and the rows of its decision tables) that your draft does not answer yet; tap it to scroll to
the first one. A question counts once it is quoted, a row once it is answered, quoted or covered
by **OK to all**; when the message asks one thing only, any words you type answer it. The line
goes when everything is answered and when you send, and it never shows for earlier messages,
while the agent is working, or while it waits on a prompt. It hangs from the top edge of the
field, so nothing moves when it comes or goes.
