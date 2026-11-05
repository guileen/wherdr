# Contributor instructions

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making changes, and follow its
language, testing and leak-check conventions.

For every interface change, follow [docs/design.md](docs/design.md), the single
design reference. Check the existing components before introducing a new pattern.

The interface is English only. Always pass interface text through `t()` / `tl()`;
French translations are optional and the existing French dictionary stays inactive.

## Local Mac mini deployment

Use the existing local `bash deploy-macmini.sh` (`--check` validates without replacing
the service; `WHERDR_SSH_HOST` overrides the default SSH host). Do not reinvent deployment.
The script builds its own directory, including uncommitted changes. For "merge to main,
deploy mini", merge only the requested changes and run it from the clean main worktree.
If the untracked local script is absent there, copy it from the working checkout first.
Keep staged smoke checks on isolated data and Herdr sessions. The script verifies health,
restarts only `dev.wherdr`, and rolls back on failure; leave live agents and user data alone.
Do not repeat already-passed checks unless integration changes their inputs.
