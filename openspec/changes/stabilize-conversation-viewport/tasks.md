# Implementation and evidence

- [x] Define two-mode requirements, owners, contracts and MT01–MT14 (design reasoning only).
- [x] Emit stable source identities and bounded restore/forward-range responses (R5/R6; transcriptPositions/chatRangeRoute/chatDelta checks).
- [x] Unify viewport ownership and intent precedence (R1/R2/R4; real Chromium wheel, WebKit touch-list simulation and native desktop keyboard smoke).
- [x] Preserve internal reading anchors and restore per-conversation context (R2/R5/R6; browser prepend/reveal/return/out-of-tail retry/gap journeys).
- [x] Add fixed accessible latest/new-content control (R3/R7; append/stream/repeat/manual latest journey; >=44px target and keybar non-overlap).
- [x] Migrate search/origin/unanswered/send and disable competing library writers (R4; search refresh browser proof; origin/unanswered/send route through the same owner).
- [x] Run focused source/unit/type checks and isolated Chromium/WebKit browser scenarios; record exact results below.
- [x] Update user documentation, commit only relevant changes and deploy local main.

## Evidence
- Prior-session Chromium failure: 390×844; upward 60 CSS px; append moved same connected reading node −304 CSS px. Not rerun this session.
- Physical iPhone/PWA inertia, keyboard and touch feel: not run; desktop emulation is not equivalent.
- 2026-11-06, isolated fake transcripts only: final focused Chromium/WebKit phone run passed all 20 cases with retries disabled. Covers following, upward intent, streaming/repeated data, manual latest, history/reveal, navigation restore, out-of-tail retry/gap fill, internal long-message passage, resizing/search refresh, and layout-clamp followed by live shell output. Separate phone/desktop latest-control journeys passed all 3 profiles, including >=44px targets and non-overlap with the keybar toggle.
- Stable source/range/reading-position and existing parser checks: 99 unit cases passed; affected conversation components: 19 passed. Documentation links and OpenSpec strict validation passed. Typecheck and production build passed with existing vue-router/volar, duplicated-import, CSS and ES-target warnings.
- Real interactive Chromium smoke: native upward wheel by 60 CSS px, append, same content displacement 0px, persistent New messages control, click returns to latest. Native PageUp/End resumed/left following correctly; a 120px above-content reflow preserved content with 0px displacement and did not create a new-content indication.
- Initial extended checks exposed MT13 (restore/reveal transaction ordering), corrected with synchronous post-commit compensation. Visual inspection exposed overlap with the existing phone keybar toggle, corrected by reserving its hit area and adding a geometry assertion.
- MT14 was reproduced as a 60px displacement after a viewport clamp followed by live output. Rebase geometrically impossible offsets at the clamp; both phone engines now pass without replaying compensation debt.
- Screenshots: `.shots/conversation-new-content-{chromium-phone,webkit-phone,chromium-desktop}.png` (local ignored evidence).
- Physical iPhone/PWA acceptance remains outstanding; this change stays active, not archived. WebKit mobile uses synthetic touch lists and real engine layout because Playwright provides neither a mobile WebKit wheel nor swipe API.
- Deployment: implementation commit `64642df`, `bash deploy.sh` completed; staged verification and active `dev.wherdr` health checks passed. Initial connection refusals occurred before readiness; the script completed successfully. The package includes the checkout's unrelated uncommitted work, as disclosed; the commit excludes those changes, including the quota hunks in shared/types.ts.
- Final source/component check: 118 passed, 0 failed. Gitleaks staged scan passed; `.leak-patterns` is absent, so custom forbidden-pattern checks were not available.
- Focused browser command: `CI= E2E_PORT=7697 E2E_TMP_DIR=/tmp/wherdr-viewport-execution npx playwright test tests/e2e/conversation-viewport.spec.ts tests/e2e/fast-open.spec.ts --grep 'layout clamp|conversation follows output|returning from settings|out-of-tail|internal passage|revealing earlier blocks|loading an older page|opening a short tail|shorter refreshed tail|long conversation shows its end' --project=chromium-phone --project=webkit-phone` — 20 passed, 0 failed, retries disabled.
