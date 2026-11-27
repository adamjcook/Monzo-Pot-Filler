# Notes for Claude

## Deploying
- Cloudflare Workers Builds is connected to this GitHub repo: **every push to `main` builds and deploys the live app**. There's no manual `npm run deploy` step and no GitHub Actions workflow.
- Cloudflare's production branch is set to `main` in the Workers Builds settings. If a push to `main` doesn't deploy, check that setting first (it once pointed at an old session branch).
- So a merge or push to `main` is a release. Run `npm run check` (typecheck + tests) before pushing there.

## Branches
- Work on `develop`; merge into `main` only when asked.

## Checking UI changes
- `?mock=1` runs the whole flow on made-up data (see README → Develop). Serving `public/` statically is enough for the mock flow.
