# Stabilize conversation viewport

## Why
Reading long, growing conversations is interrupted by competing scroll writers and proximity-based following. A prior isolated Chromium probe at 390×844 reproduced an upward 60 CSS px user scroll followed by an append pulling the same connected message upward 304 CSS px. This is distinct from the previously fixed prepend DOM-key replacement.

## Changes
- Two persistent modes: following and reading. User intent, not proximity, selects the mode.
- Preserve semantic reading anchors across content/layout changes, history loading and navigation.
- One non-layout-shifting latest-content control, with a persistent new-content indication while reading.
- One application viewport owner, versioned navigation and append-stable source identities.
- Bounded source-position restore and explicit missing intervals between historical reading context and live tail.

## Non-goals
Cross-device read receipts, unread counts, notifications, replacing the rendering/virtualization library, or changing transcript content. Existing search, quote navigation, quick answers, offline cache and send behavior must remain usable.

## Evidence status
The prior probe is failure evidence, not verification of this implementation. Mind-Test is design evidence only. Runtime evidence and remaining physical-device limits belong in tasks.md. This change is not archived until affected scenarios pass.
