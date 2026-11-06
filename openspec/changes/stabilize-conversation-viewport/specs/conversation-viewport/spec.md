## ADDED Requirements

### Requirement: Follow latest content
The view SHALL remain at the latest bottom while following as messages, streaming output and layout change. An upward user scroll SHALL immediately enter reading, without a near-bottom attraction zone. A deliberate manual arrival at the latest bottom or activation of the latest control SHALL resume following. Sending successfully SHALL request latest; draft edits, draft clearing and quick answers SHALL NOT resume following.

#### Scenario: Output while following
- **WHEN** output arrives while following
- **THEN** the latest bottom remains visible and no new-content indication remains

#### Scenario: A small upward scroll
- **WHEN** the user scrolls upward by 60 CSS px and more output arrives
- **THEN** the view remains reading and the visible content does not jump to latest

### Requirement: Preserve reading content
The view SHALL preserve the same content location and viewport-relative offset while reading during append, prepend, reveal, media reflow and viewport/composer resizing, where the content and geometry permit. Long-message anchors SHALL identify an internal content position, not just the message top. User movement SHALL supersede any older compensation.

#### Scenario: History arrives after further scrolling
- **WHEN** an older-page response arrives after the user has moved again
- **THEN** the latest reading position is preserved, not the position at request start

#### Scenario: A long reply grows below the reader
- **WHEN** output is appended to a long reply below the visible passage
- **THEN** the visible passage stays in place

#### Scenario: Geometry temporarily makes an offset impossible
- **WHEN** resizing clamps a reading view to the physical bottom and later live output adds space
- **THEN** reading remains selected, the clamped reading context is preserved and old compensation debt is not replayed
- **AND** new output below is indicated rather than silently resuming following

### Requirement: Indicate new content below
While reading, new output below the visible reading context SHALL set a persistent new-content indication. New output includes streamed text and live tool output without an increased item count. Repeated responses, historical prepends, media decoding, user expansion and geometry-only changes SHALL NOT independently set it. The indicator SHALL NOT affect message layout or repeatedly announce each token. It SHALL NOT display an inferred unread count.

#### Scenario: New output versus repeated data
- **WHEN** new output arrives below the reader and its response is repeated
- **THEN** one persistent indication is shown and reading position is unchanged

### Requirement: Respect navigation precedence
Only the viewport owner SHALL move the application conversation viewport. Explicit search, quote and unanswered targets SHALL locate once and enter reading. Subsequent refreshes SHALL NOT recenter the target. Newer user input and view lifetime SHALL invalidate old positioning plans without discarding valid data. Native gesture and inertia SHALL NOT be interrupted by automatic positioning.

#### Scenario: Latest navigation is interrupted
- **WHEN** the user interrupts a latest navigation before reaching bottom
- **THEN** old callbacks cannot move the viewport and the new-content indication remains

#### Scenario: Another conversation opens
- **WHEN** an old view callback completes after a conversation switch
- **THEN** it cannot move or change the indication of the new view

### Requirement: Restore reading context
Returning to a conversation SHALL restore following or the same validated reading context. A reading anchor outside the current tail SHALL be loaded with a bounded source-position request. Noncontiguous ranges SHALL display a missing interval rather than imply adjacency. Continuous tail-window movement SHALL NOT discard valid reading content.

#### Scenario: New content arrives while away
- **WHEN** the user returns after leaving in reading mode and output was added
- **THEN** the previous context is restored and new output below is indicated

### Requirement: Handle invalid reading anchors
Missing content, changed source and unavailable reads SHALL have distinct outcomes. A transient failure SHALL retain available content and provide retry. An invalid anchor SHALL be reported and use an explicit nearest-surviving-content fallback where available, not silently masquerade as successful restoration or clear the new-content indication.

#### Scenario: Restore fails temporarily
- **WHEN** loading the saved anchor fails
- **THEN** available content remains, retry is available and latest is not silently claimed

### Requirement: Accessible latest control
Reading mode SHALL expose a fixed, non-layout-shifting latest control above the composer with a minimum 44 CSS px touch target, keyboard activation, translated English labels and reduced-motion support. It SHALL show “New messages” when new content below exists and “Jump to latest” otherwise. Activation SHALL clear the indication only upon reaching the latest bottom; manual arrival SHALL do the same.

#### Scenario: Latest is reached manually
- **WHEN** the user scrolls down to the current latest bottom
- **THEN** following resumes and the indication clears

#### Scenario: Native scrolling arrives after the idle fallback
- **WHEN** a downward gesture's idle fallback runs before its final scroll reaches the latest bottom
- **THEN** the final downward arrival still resumes following and hides the latest control without clicking it
- **AND** subsequent output remains followed

### Requirement: Consistent phone controls
On phones, latest and terminal-key controls SHALL share a right edge, with latest above the key toggle, matching square surfaces, at least 44 CSS px touch targets and at least 8 CSS px separation, with keys open or closed.

#### Scenario: Phone controls remain aligned when keys expand
- **WHEN** the latest control is visible and the terminal-key strip is opened or closed
- **THEN** both controls remain right-aligned and vertically separated without overlapping touch targets
