# Development and tests

[Documentation](README.md) · [Project](../README.md)

### From source

For development, or to run a checkout of your own. With Herdr running, Git and a supported Node.js release on the same machine. The current locked development toolchain requires Node.js **22.22.2+** on the 22.x line or **24.15.0+** on the 24.x LTS line; older Node.js 22 releases are not sufficient.

```sh
git clone https://github.com/afloury/wherdr.git
cd wherdr
npm ci
npm run build
npm start                  # listens on 127.0.0.1:7683
```

Open `http://localhost:7683` in a browser on that computer: the desktop layout, passkeys and the
installable app work there, since browsers treat `localhost` as secure. There is no phone access
and no push notification in this setup; for that, use the [recommended setup](networks.md#recommended-always-on-server--tailscale) (or publish this
instance with `tailscale serve` as described there and start it with
`APP_URL=https://server.example.ts.net:7683/ npm start`).

Run it as the user who runs Herdr. It uses `$HOME` and `$HOME/.local/bin/herdr`, or `herdr` from
the `PATH` (Homebrew); set `HERDR_BIN` otherwise. `DATA_DIR` holds passkeys, push data and recent
folders (default `./data`). `npm start` listens on `127.0.0.1` (`HOST`) and port `7683` (`PORT`).
The first-passkey bootstrap token is printed in its output. Keep the process running with your
usual service manager (systemd user unit, launchd, tmux…).

With `APP_URL` empty or `http://localhost:7683/`, wherdr starts normally but disables Web Push
and logs a warning.

For an actual local Bots/Graph browser check, use the build/start procedure above, optionally
with `HOST=127.0.0.1 PORT=7684 npm start`, then open `http://localhost:7684/#/bots` or
`http://localhost:7684/#/graphs`. Keep one Nuxt process per checkout: development, preparation
and builds share `.nuxt`; stop a running development server before building.

The current Nitro development worker normally receives requests over a Unix socket, which
has no TCP `remoteAddress`. wherdr's network guard deliberately refuses requests without a
verified IP peer, so `npm run dev -- --host 127.0.0.1 --port 7684` can return network 403 even
to a real local browser. Do not trust a forwarded header or assume a missing peer is loopback
to bypass that refusal. Nitro's `NITRO_NO_UNIX_SOCKET=1` switch uses a random TCP worker port,
but the installed worker does not bind that port explicitly to loopback; the built Node
server with an explicit `HOST=127.0.0.1` is the loopback-only browser-check path.

Keep the direct `vue-router` dependency on the major required by Nuxt (currently Vue Router 5).
Nuxt generates the `vue-router/volar/sfc-route-blocks` language plugin in `.nuxt/tsconfig.app.json`;
Vue Router 4 does not export that path and can make `nuxt typecheck` print
`ERR_PACKAGE_PATH_NOT_EXPORTED` even when the command exits successfully.

The Bots and Graph pages still require their ordinary passkey authentication and explicitly
configured local sources for protected data. Follow [Bot workspace](bots.md); the fictional
`/#/bots?sample=1` interface is not evidence of authenticated access or Graph execution.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md), including the [agent test rule](../CONTRIBUTING.md#agent-test-rule)
and `npm run test:affected -- --base origin/develop --dry-run`. Changes are listed in [CHANGELOG.md](../CHANGELOG.md).

Every commit is public: a leak check (gitleaks plus your own forbidden patterns) covers the files
and the commits about to be pushed; see [Leak check](../CONTRIBUTING.md#leak-check).
