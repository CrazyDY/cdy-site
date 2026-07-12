# Repository Guidelines

## Project Structure & Module Organization

This is a zero-dependency static personal site. `index.html` contains the page structure and resume content, `styles.css` owns responsive and print styling, and `app.js` implements navigation, resume exports, editing, and local blog management. `README.md` documents local usage. Keep assets in `assets/` if images or fonts are added.

## Build, Test, and Development Commands

No build step or dependency installation is required. Useful commands are:

- `python -m http.server 8080` - serve the site locally.
- `node --check app.js` - validate JavaScript syntax.

Open `http://localhost:8080` after starting the server. Directly opening `index.html` is also supported.

## Coding Style & Naming Conventions

Use two-space indentation in HTML and JavaScript. Prefer `camelCase` for JavaScript variables/functions and `kebab-case` for CSS classes. Reuse CSS custom properties from `:root`, keep browser storage keys versioned, and use semantic HTML where practical.

## Testing Guidelines

No automated test framework is configured. Before submitting, run `node --check app.js` and manually verify navigation, resume save/cancel, all three exports, blog CRUD, search, mobile layout, and print preview. If tests are introduced, place them in `tests/` and name them `*.test.js`.

## Commit & Pull Request Guidelines

No Git history is available to establish an existing commit convention. Use concise, imperative subjects, optionally following Conventional Commits (for example, `feat: add account sign-in` or `fix: reject expired sessions`). Keep commits focused.

Pull requests should explain the change and its motivation, list verification performed, and link relevant issues. Include screenshots or recordings for visible UI changes. Call out configuration changes, migrations, and follow-up work explicitly.

## Security & Configuration

Never commit credentials, API keys, or local environment files. Provide sanitized examples such as `.env.example`, document required variables, and review dependency and configuration changes carefully.
