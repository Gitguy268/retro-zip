# Contributing

Setup: `npm install`, `npm run vendor`, `npm start`, then open http://127.0.0.1:8642.

Before opening a pull request, run `npm test`. Browser tests need Playwright from outside the repo:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node test/e2e-app.mjs
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node test/e2e-boot.mjs
```

## Adding a game to the catalogue

The catalogue only takes games that are clearly free to share. A pull request needs a link showing the licence or the author's permission. Commercial ROMs, and sites that host them, won't be accepted, even for old or hard-to-find games.

Add the source to `data/catalog-sources.json`, run `node scripts/pin-catalog.mjs`, and boot the game with `test/e2e-boot.mjs <id>`. Look at the picture: a game that fails to load can still show a moving menu.

Contributions are licensed under GPL-3.0.
