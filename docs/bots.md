# Bot workspace

[Documentation](README.md) · [Project](../README.md)

Open **Bots** from the home header, collapsed rail or Options menu. The workspace is separate from terminal agents and the herdr-projects Board. A Bot is a fixed named role; a Job is one piece of work with its own context. Reading or closing this view never stops a Job.

## Try the interface

Open `/#/bots?sample=1`, or choose **Explore sample**. The visible sample banner identifies fictional data; answering, following up and inspecting controls changes that sample only. Reload resets it. Sample mode makes no production Bot API requests; wherdr's ordinary shell/auth/Herdr activity may still run.

The sample has an explicit writer → reviewer → publisher workflow. Inspect a node, answer its question, then **Observe sample outcome** to distinguish admission from application. **Select none** is an explicit valid multi-select answer. A reply does not automatically publish or deliver anything downstream.

## Connect real local Bots

1. Install an OMP version advertising typed questions, execution ownership, immutable identity guards and Job-scoped references. Configure its model credentials as the same operating-system user running wherdr.
2. Register a passkey in **Settings → Security** and unlock this device. Bot access requires a valid passkey session even when the ordinary app lock is off. Private-network reachability alone does not grant access. Remote browser use still requires private HTTPS.
3. Put a trusted `bot-sources.json` in wherdr's stable `DATA_DIR`. Use an absolute executable path; JSON paths do not expand `~`:

```json
{
  "sources": [
    {
      "id": "local",
      "label": "Local OMP",
      "command": ["/home/user/.local/bin/omp"],
      "profile": "automation"
    }
  ]
}
```

`profile` is optional; omit it to use that executable's default profile. `command` may be a trusted argv prefix, for example an absolute Bun executable followed by an absolute source CLI path. It is not a shell command. Keep this file owner-only (mode 600), protect `DATA_DIR`, and preserve `bot-intents/` across restarts: it contains private input and operation receipts. No browser form can set executable paths, profiles, environments or arbitrary command arguments.

4. Create and submit work through OMP's CLI using the same configured profile, then open `/#/bots` and refresh. OMP's own CLI help describes creation and submission. This workspace does not create Bots, submit new Jobs, schedule Graphs or upgrade OMP for you.

Configuration is read by the server; no wherdr restart is required after a valid source-file change. A running observation may finish using its captured configuration. An existing operation cannot be replayed against a different source configuration: restore the original configuration to reconcile it.

## Observe and act

Operation cards and their original keys currently live only in the mounted page. The server retains the durable intent, but a full reload does not automatically rediscover those cards. Keep the page open to reconcile an uncertain request; do not submit a replacement just because a card disappeared. Full cross-reload operation recovery belongs to the streaming-bridge acceptance below.

- Select a named Bot, then an exact Job. On desktop the roster, work area and inspector sit together; on a phone the inspector fills the screen. **Back to Jobs** restores the list and selection.
- **Attention** loads the exact current question. Single choice, multi-select, custom choice and text fields follow the runtime schema. **Separate follow-up** appends a new message; it does not answer the current question.
- **Messages**, **Artifacts** and **Timeline** load protected details on demand. References may be unavailable or expired. An output reference is not evidence that the business task passed review.
- **Usage** preserves reported costs and unknown/partial values. Measured task progress is not an invented overall completion percentage. Worker connectivity is separate from source reachability; an offline worker does not prevent an admissible resume/send from starting it.
- **Job controls** offers interrupt, resume, `qaonly` compact, model change and stop as permitted by the current projection. Stop confirmation names the exact Job and leaves other Jobs alone. A pending model is distinct from the model currently in use.
- A receipt means **Admitted**, not finished. **Check actual outcome** reads OMP's retained request result. For an uncertain transmission, **Retry original request** reuses the original intent/key; do not manufacture a replacement request. A rejected revision requires refreshing and deliberately issuing a new intent.
- Live observations refresh every 15 seconds while visible, with a shared three-second server observation cache. Errors, offline state and stale observations disable new mutations. There is no offline command queue. Authentication failure clears protected workspace state and drafts. A draft is local to the mounted workspace, not durable storage.

The local listing is bounded: up to eight sources, 32 Bots per source and five 100-Job pages per Bot, with overall CLI-call/time/output limits. Incomplete results are labelled; displayed Jobs are not silently claimed to be the complete inventory. Source errors are not replaced with sample data. `auth_required` and the existing `locked` response both require authentication; unsupported OMP capabilities require an upgrade, not terminal-input fallback.

## Graph and deployment boundary

The **Graph** view shows only Graph-correlated Jobs already returned by the Bot source. It displays their actual Graph, Run, node, invocation, attempt and upstream edge IDs, but does not infer topology or treat Job state as Graph Run state. The connected node diagram remains an explicitly fictional sample.

**Graph definitions** opens a separate authoring page. To grant access, create `graph-sources.json` in `DATA_DIR`, using the same trusted source-file format shown above; it is deliberately separate from `bot-sources.json` because Graph authoring is a distinct privilege. Only configure executables and profiles whose local Graph definitions the passkey-authenticated user may read and modify. Protect this file and the profile as owner-only. The browser cannot configure executables, profiles or command arguments.

The page can create or import Graph Markdown, read a definition by ID, and edit a loaded revision. Successful create, import and save operations automatically load the committed definition and its canvas; creating an empty Graph needs only its name. Request keys are generated automatically unless explicitly supplied. The server uses the local OMP authoring CLI's internal `--format=json` boundary, not human-readable output: one bounded version-1 response is checked for its exact kind, fields, request key, Graph identity, revision and content digest. Rejected mutations retain their CLI error class and remain reconcilable; located validation failures stop the read without exposing private source paths. Export is stdout-only, with validation before and after export to reject mixed revisions. Markdown/YAML remains the human authoring format; this adapter grants no execution permission and is not a streaming protocol.

Every mutation's original source ID, executable argv, profile, full business payload, revision, request key and prepared stdin/argv are durably retained in owner-only `DATA_DIR/graph-intents/` before dispatch. Preserve this private directory across restarts. A key belongs to exactly one mutation in this workspace: changing its content, action, target or revision is rejected, and switching source ID, command or profile blocks both replay and receipt reconciliation even with a refreshed source token. Restore the original source configuration before proceeding. A display-label change alone does not change source identity.

Reconcile an uncertain operation with **Get receipt**, which only reads the source's retained receipt and never redispatches. While mounted, **Retry exact request** can resend the original in-memory command with the same key and payload. Before sending a mutation, the page saves only its source ID, source configuration fingerprint and request key in this tab's `sessionStorage`; task text, Graph Markdown and credentials are not saved there. Reloading or returning to the page restores that locator after authentication, blocks replacement mutations and offers receipt reconciliation, not automatic resubmission or a reconstructed retry. A changed source remains bound to the original fingerprint. An inaccessible or malformed recovery store blocks new mutations; a storage write failure prevents dispatch. Keep the tab until reconciliation finishes: closing the tab or clearing its storage loses this client locator, although the server's private intent remains. Authentication failure clears visible protected content but preserves the locator for reconciliation after unlock. Other Bot operation cards remain mounted-page-only.

A retry after a server restart uses the server's retained invocation and original revision; a completed or rejected retained receipt is returned without another mutation. If automatic definition loading fails after a completed receipt, the receipt remains completed: recover with **Read definition**, not another creation. A completed authoring receipt does not mean a Run was started. Source errors never fall back to sample data.

Pre-upgrade operations, deleted intent files and externally issued keys have no retained bridge source binding. **Get receipt** then returns `unknown_request` without invoking any configured source; this does **not** mean that external work did not occur. Manually inspect `graph request get <original-key> --format=json` with the original trusted executable and profile. Do not choose a different source, submit a replacement mutation, or infer success/failure from the missing local intent.

The definition canvas displays nodes, orchestration edges and separate member communication permissions. It can add and edit members, Bot/Human/Program/Queue/Subgraph tasks, edges and communication permissions; advanced node fields remain in the Markdown editor and are preserved by canvas edits. Program and Queue tasks name a trusted registered executor, never an executable or shell command. Subgraph tasks select a member, permitted non-subgraph child kinds and positive node/concurrency limits; this policy cannot grant execution or isolation. Enter text when introducing a new task or role heading, or leave it empty to reuse an existing heading. Canvas changes update only the local Markdown draft: use **Save at loaded revision** to submit them. A fresh request key and the newly loaded revision are used for the next operation. Bot references do not register executables, and the canvas neither starts nor simulates a Run.

Canvas mutations expand YAML aliases into independent values before editing, so changing one node or member's permissions cannot change another shared value. This may rewrite alias syntax; unedited values and Markdown body remain intact. Recursive or over-limit alias expansion is rejected without replacing the draft. Removing an item never removes its references automatically; the service validates them on save.

Run observation is a separate opt-in, read-only policy. Create `graph-observation-sources.json` in `DATA_DIR` as an owner-only file (mode `0600`). Each source has `id`, `label`, a trusted executable `command` argv array and `runs`, the exact Run IDs the passkey-authenticated owner may inspect. For a source checkout, the command can be the absolute path to Bun followed by the absolute path to `packages/coding-agent/src/graph/wherdr-observer.ts` and the trusted Graph profile root. The process and profile must be accessible to the wherdr server. Never let an untrusted user edit this configuration: the configured command executes with the server's privileges. For example, using installation-specific paths:

```json
{"sources":[{"id":"local","label":"Local","command":["/trusted/bin/bun","/trusted/omp/packages/coding-agent/src/graph/wherdr-observer.ts","/trusted/graph-profile"],"runs":["run-id"]}]}
```

On **Graph definitions**, select an authorized source and Run and read a committed snapshot. The node roster, orchestration edges, member communication permissions and invocation details come from the frozen Run definition and persisted scheduler state, not Bot Job correlations. Auxiliary consultation executions are listed separately after their durable conversation and message identities are checked; they are not orchestration nodes or edges. The snapshot expires after one minute and is cleared when the page is hidden; refresh sources and read again. Source and Run authorization are checked before and after each read. Local profile access and Bot `graph_context` do not grant observation permissions.

**Read history** lists retained committed views through the captured snapshot cursor; select one to inspect it, use **Next history page** and **Previous history page** to navigate within that same captured watermark, or return to the captured snapshot. Historical views are labeled and do not represent current state. Missing retained replacements and pages that cannot advance fail closed, including for older Runs. History shares the snapshot's one-minute expiry and is cleared on a failed read or authorization change. This captured adapter supplies no live stream, start, recovery or lifecycle control and does not advertise `graph.execution.v1`.

Captured views show observed Bot token/cost subtotals, completeness, measurement time and observed Job count when available. Zero is distinct from unknown; these observations are not a complete bill or a spending ceiling. Invocation details show selected outcomes separately from execution state (for example, successful review execution can select `revise`). Historical views use their captured values only: older records without usage or outcomes show unavailable rather than later facts. The server projects only validated fields and pins source, Run and history boundaries across asynchronous reads.

The authenticated `graph-observation` POST endpoint also accepts `history: {after?, watermark?, limit?}` alongside the same source token and Run ID. It returns paginated local view replacements from the host journal, not `omp.graph.v1` records; retain the returned watermark and pass `next_cursor` as `after` for the next page. It fails closed if the retained replacements are incomplete.

The same authenticated endpoint accepts an `extensions` array with the source token and Run ID to check the captured adapter's capabilities. **Check captured adapter capability** uses this request; the current adapter returns an empty intersection and keeps execution controls disabled. A failed or unsupported capability response clears captured observations and requires refreshing authorized sources; a legacy observer that cannot answer never enables a control. This local check is not an `omp.graph.v1` hello and does not determine the separate live stream's negotiated read capability.

### Optional live read-only observation

`/ws/graphs` provides a separate read-only `omp.graph.v1` WebSocket relay. The Graph page offers **Observe live** for sources with streaming configured; captured snapshots/history remain separate. It retains the existing protected owner-session, network/Host and same-Origin checks; configuring a source does not bypass Passkey admission.

To opt in, add `wire_command` to a source in the same owner-only observation file. Supply a complete trusted argv, for example Bun, the OMP CLI entrypoint, `__omp_worker_graph_wire_read`, the profile root, the source ID and the exact authorized Run IDs. Insert `--execution-records` immediately after the worker selector to additionally offer execution-record reads. For direct `graph/wire-observer.ts` launch, place the flag immediately after that script. These arguments are installation configuration, never browser-provided commands. `command` remains the separate one-shot observer. Sources without `wire_command` continue to support captured reads only.

The browser uses the same `@oh-my-pi/pi-wire/graph` consumer as OMP, not a second state machine. It renders frozen topology, actual Bot bindings, dependency and transfer records only when provided. When both source and client negotiate `graph.execution.v1`, it also shows execution Run state/revision, members, invocations, attempts, conversation summaries and scoped budgets. Non-Bot attempts have no invented Job. **Read consultation text** loads a published message reference on demand while live; content is displayed as inert text, never HTML, and is not cached. Only `consultation-message:` references are supported here; arbitrary files, other protected artifacts and execution controls remain unavailable. Legacy sources retain base-only rendering, with filtered execution events advancing the cursor but not inventing execution state. A topology record revision is not the scheduler's Run revision.

Disconnect clears the live projection and any consultation text. **Observe live** establishes a new authorized snapshot, without importing a previous connection's checkpoint. Source/Run changes, page hiding, session lock, denial, protocol failure or expired authorization clear data. Transport silence is visibly stale before lease expiry clears the projection; protected text is cleared immediately when stale and cannot be requested until live again. Removing a selected conversation/reference also clears its detail. Only one detail is open at a time; reads time out after ten seconds, and a late or mismatched response closes observation rather than exposing unbound content. Source-policy invalidation clears both live and captured results and requires refreshing sources.

After authenticating, the client first sends `{type:"open",source_id,source_token,run_id}`, then native hello/subscribe/unsubscribe, `graph.history.get`, or negotiated `graph.artifact.get` for consultation text. Hello offers the read extension; the server returns only the supported intersection and the browser creates its consumer for that result. Each connection is fixed to the exact source and Run: no roster, execution commands, authoring or general protected-artifact reads. Consultation responses must match an outstanding message ID and exact source/Run/ref, pass the shared bounded-text validator and current authorization; unsolicited or duplicate content closes the connection. The complete content limit is 1 MiB UTF-8 within the existing 2 MiB frame ceiling, with no truncation or pagination. At most 16 unanswered reads and 4096 lifetime message IDs are retained before closure. Source listing exposes a `streaming` flag, not argv. Changing configuration invalidates its token. Refresh authorization and establish a new snapshot after reconnecting; an old connection checkpoint alone is insufficient.

Session invalidation and configuration changes fence delivery and close the connection; idle authorization checks provide a bounded fallback. Payloads, queues, output backpressure and connection lifetime are bounded. The server terminates only its owned direct source process: this is not a sandbox for untrusted executables or a guarantee that their descendants/external effects stop. Never configure untrusted commands.

The captured HTTP adapter and native live records remain distinct. Only an explicitly opted-in live source can negotiate `graph.execution.v1` read records; this is not execution authorization. Remote SSH Bot sources, scoped multi-user permissions, full protected-detail/transfer support, large-workload acceptance and Mac mini deployment remain separate work. Herdr continues terminal transport; real Bot snapshots and controls use OMP's structured CLI directly. No Herdr fork or OMP HTTP server is required.

#### Shared protocol dependency

Source checkouts install with `npm ci` without a sibling OMP checkout. The dependency is the fixed npm archive `vendor/pi-wire/oh-my-pi-pi-wire-18.15.0.tgz`, not a directory link. It retains the upstream package's `@oh-my-pi/pi-wire/graph` export and MIT `LICENSE` (copyright Can Bölük and Stencil Labs, Inc.); protocol modules are packaged unchanged, not copied into application code. Its runtime has no agent/provider/Bun dependencies. npm does not install a dependency's development dependencies, so the upstream manifest's `@types/bun: catalog:` development entry does not require the OMP workspace when consuming this archive. Developing the upstream package itself still requires its workspace.

This is an **unpublished local source snapshot**, not the npm release of version 18.15.0. The manifest's existing version is retained without inventing a release. Published `@oh-my-pi/pi-wire@18.18.0` also lacks the Graph entry and cannot replace this snapshot. No registry publication or deployment has been performed.

Archive provenance:

- Origin: [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi), `packages/wire`, checkout based on commit `78ef86a34c156d69dd5c4740eead8dffe4f61eec`, captured on 2026-11-07.
- The source was dirty: modified `README.md` and `CHANGELOG.md`, and untracked `src/canonical-json.ts`, `src/graph.ts`, `src/graph/` and `test/`. npm's upstream `files` list includes the source modules and package documentation, but not tests. The commit alone cannot reproduce these unpublished additions; the checked-in archive is the authoritative snapshot.
- Packaging: npm 10.9.2, `npm pack <wire-source-directory> --ignore-scripts --json --pack-destination vendor/pi-wire`; 20 entries, 46,064 compressed bytes, 167,200 unpacked bytes, no bundled dependencies.
- SHA-256: `b2dbf408cf087218113f343ccb9e34bbc36c2e632dc0af0288e1f427b5be24a7`.
- npm integrity (also pinned in `package-lock.json`): `sha512-P4Du4Cq6xeg+R0S2V2t8L+Vrfm8rmb71P/O+zHYPsArtrTuUUilIEZgzWjwBdOvbHMoQWvaBDKwxG/tNu7jjUw==`.

Treat the captured archive as immutable. To refresh from a deliberately selected OMP source snapshot, run the following from the wherdr checkout with `WIRE_SOURCE` pointing to its `packages/wire` directory. This uses npm's package file selection and license handling, skips lifecycle scripts, and gives a changed archive a content-addressed filename:

```sh
stage="$(mktemp -d)"
npm pack "$WIRE_SOURCE" --ignore-scripts --json --pack-destination "$stage"
digest="$(shasum -a 256 "$stage"/*.tgz | cut -d ' ' -f 1)"
cp "$stage"/*.tgz "vendor/pi-wire/pi-wire-$digest.tgz"
npm install --save-dev --package-lock-only --ignore-scripts --no-audit --no-fund \
  "@oh-my-pi/pi-wire@file:vendor/pi-wire/pi-wire-$digest.tgz"
rm -r "$stage"
```

Record the new source revision and dirty additions, archive metadata and digests here, remove the superseded archive, and commit the archive, manifest and lockfile together. A refresh requires checking the Graph imports against the selected snapshot; replacing this dependency with a registry version is only possible once that release actually includes the required Graph protocol.

