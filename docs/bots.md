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

The page can create or import Graph Markdown, read a definition by ID, and edit a loaded revision. It uses the local OMP authoring CLI, validates its bounded responses, checks the revision before and after export, and requires a request key for every mutation. Reconcile an uncertain operation with **Get receipt**, or retry its exact original request with the same key; do not reuse that key for a different payload. The page keeps the pending request only while mounted; record the key before leaving. A completed authoring receipt does not mean a Run was started. Source errors never fall back to sample data.

After reading a definition, the definition canvas displays its nodes, orchestration edges and separate member communication permissions. It can add Bot or Human nodes and edit the task heading and Bot member of existing nodes; other node fields remain in the Markdown editor. Enter text when introducing a new task heading, or leave it empty to reuse an existing heading. Canvas changes update only the local Markdown draft: use **Save at loaded revision** with a new request key to submit them, and read again after a receipt before making another guarded edit. Existing member definitions are selected, not registered as executables. The canvas neither starts nor simulates a Run.

Run observation is a separate opt-in, read-only policy. Create `graph-observation-sources.json` in `DATA_DIR` as an owner-only file (mode `0600`). Each source has `id`, `label`, a trusted executable `command` argv array and `runs`, the exact Run IDs the passkey-authenticated owner may inspect. For a source checkout, the command can be the absolute path to Bun followed by the absolute path to `packages/coding-agent/src/graph/wherdr-observer.ts` and the trusted Graph profile root. The process and profile must be accessible to the wherdr server. Never let an untrusted user edit this configuration: the configured command executes with the server's privileges. For example, using installation-specific paths:

```json
{"sources":[{"id":"local","label":"Local","command":["/trusted/bin/bun","/trusted/omp/packages/coding-agent/src/graph/wherdr-observer.ts","/trusted/graph-profile"],"runs":["run-id"]}]}
```

On **Graph definitions**, select an authorized source and Run and read a committed snapshot. The node roster, orchestration edges, member communication permissions and invocation details come from the frozen Run definition and persisted scheduler state, not Bot Job correlations. Auxiliary consultation executions are listed separately after their durable conversation and message identities are checked; they are not orchestration nodes or edges. The snapshot expires after one minute and is cleared when the page is hidden; refresh sources and read again. Source and Run authorization are checked before and after each read. Local profile access and Bot `graph_context` do not grant observation permissions.

**Read history** lists retained committed views through the captured snapshot cursor; select one to inspect it, use **Next history page** and **Previous history page** to navigate within that same captured watermark, or return to the captured snapshot. Historical views are labeled and do not represent current state. Missing retained replacements and pages that cannot advance fail closed, including for older Runs. History shares the snapshot's one-minute expiry and is cleared on a failed read or authorization change. There is no live stream, start, recovery or lifecycle control. This adapter is not the proposed typed `omp.graph.v1` streaming bridge and does not advertise `graph.execution.v1`.

The authenticated `graph-observation` POST endpoint also accepts `history: {after?, watermark?, limit?}` alongside the same source token and Run ID. It returns paginated local view replacements from the host journal, not `omp.graph.v1` records; retain the returned watermark and pass `next_cursor` as `after` for the next page. It fails closed if the retained replacements are incomplete.

The same authenticated endpoint accepts an `extensions` array with the source token and Run ID to check the local adapter's capabilities. **Check execution capability** uses this request; the current adapter returns an empty intersection and keeps execution controls disabled. A failed or unsupported capability response clears captured observations and requires refreshing authorized sources; a legacy observer that cannot answer never enables a control. This local check is not an `omp.graph.v1` hello and does not provide a streaming wire bridge.

This local HTTP adapter is not the full proposed `omp.graph.v1` streaming bridge. Remote SSH Bot sources, scoped multi-user permissions, durable Graph history, live replay barriers, large-workload acceptance and Mac mini deployment are separate work. Herdr continues terminal transport; real Bot snapshots and controls use OMP's structured CLI directly. No Herdr fork or OMP HTTP server is required.
