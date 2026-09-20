# Publishing — context-shifter (CLI)

How the npm package ships, why the first release is manual, and the checklist
for every release after. The automation is
[`.github/workflows/cli-release.yml`](../.github/workflows/cli-release.yml),
triggered by pushing a `cli-v*` tag.

The model in one paragraph: **npm publish happens only from `cli/`** (the
package root — never the repo root). Versions are independent of the macOS
app: CLI tags are `cli-vX.Y.Z`, app tags are `vX.Y.Z`, and the shared card
format has its own `CARD_SPEC_VERSION`. CI publishes with **OIDC trusted
publishing** — there is no `NPM_TOKEN` secret. Tag namespaces don't cross-fire:
`cli-v*` doesn't match the app's `v*` workflows and vice versa.

---

## One-time bootstrap

npm only lets you attach a trusted publisher to a package that **already
exists**, so v0.1.0 must be published manually once — that also reserves the
name. Every later release goes through CI.

- [ ] **0. Prerequisites.** npm account with **2FA enabled** (Account
      settings → Security). You are a member of `Shivala-08/context-shifter`
      with write access so Actions can create the GitHub Release.
- [ ] **1. Log in locally.** `npm login` (completes in the browser with 2FA).
- [ ] **2. Sanity-check locally.**
      ```bash
      cd cli
      npm test                 # full suite green
      npm pack --dry-run       # unpacked < ~150 kB (PRD metric);
                               # files = dist/, prompts/, README, CHANGELOG, LICENSE
      grep '"dependencies": {}' package.json   # zero runtime deps
      ```
- [ ] **3. Publish v0.1.0 manually to reserve the name.**
      ```bash
      npm publish --no-provenance --otp=XXXXXX   # from cli/; prepack auto-runs sync-prompt + build
      ```
      Both flags matter for the manual publish:
      - `--no-provenance` — `package.json` sets `publishConfig.provenance: true`,
        but provenance requires GitHub Actions' OIDC and fails locally with
        `EUSAGE: Automatic provenance generation not supported for provider: null`.
        The bootstrap version simply ships without a provenance badge; every
        CI-published version after it has one.
      - `--otp=XXXXXX` — npm requires a 2FA code to publish. Run this in a
        terminal where you can read your authenticator app and paste the code
        within its ~30 s window. Without it npm answers
        `403 … Two-factor authentication … required to publish packages`.
      Success looks like `+ context-shifter@0.1.0` — verify before moving on.
- [ ] **4. Verify the reservation.**
      ```bash
      npm view context-shifter version        # → 0.1.0
      npx context-shifter@latest --version    # → context-shifter 0.1.0 (card spec 1)
      ```
- [ ] **5. Attach the trusted publisher** on npmjs.com → package →
      **Settings → Trusted Publisher → GitHub Actions**:
      - Repository owner/name: `Shivala-08/context-shifter`
      - Workflow filename: `cli-release.yml`
      - Environment name: `npm` (optional on npm's side, but the workflow
        declares `environment: npm`, so keep them identical)
- [ ] **6. (Optional) Choose a publish mode.** Repo variable
      `NPM_PUBLISH_MODE` (Settings → Secrets and variables → Actions →
      Variables): `publish` (default) publishes directly; `stage` holds the
      version in npm's staging area for review — see below.
- [ ] **7. Tag v0.1.0 to wire everything up.**
      ```bash
      git tag cli-v0.1.0 && git push origin cli-v0.1.0
      ```
      The workflow runs, sees `context-shifter@0.1.0` is already on npm, skips
      the (impossible) re-publish, and still creates the **GitHub Release**
      with the changelog section as notes.
- [ ] **8. Verify the release page** at
      `github.com/Shivala-08/context-shifter/releases/tag/cli-v0.1.0`.

---

## Every release after that

The workflow asserts tag == `cli/package.json` version, runs the test suite,
publishes with `--provenance`, and builds the GitHub Release from the
changelog. Your job is to keep **tag, package version, and CHANGELOG** in
agreement — all three gates fail loudly if you don't.

- [ ] **1. CHANGELOG.** Add a section under `[Unreleased]`:
      `## [X.Y.Z] - YYYY-MM-DD`, plus the footer link reference
      (`[X.Y.Z]: https://github.com/Shivala-08/context-shifter/releases/tag/cli-vX.Y.Z`).
      `scripts/release-notes.mjs` extracts exactly this section and **exits 1
      if it's missing** — no section, no release.
- [ ] **2. Bump the version.**
      ```bash
      cd cli && npm version X.Y.Z --no-git-tag-version
      ```
      ⚠️ Never plain `npm version X.Y.Z`: it would create a `vX.Y.Z` tag —
      the **app's** namespace — which the CLI workflow doesn't match.
- [ ] **3. Commit and push.** e.g. `chore(cli): release X.Y.Z`, push to `main`.
- [ ] **4. Wait for green CI.** `CLI CI` must pass the full matrix
      (Ubuntu/macOS/Windows × Node 20/22/24, prompt-drift check, pack +
      global-install smoke test) — the PRD requires matrix green for every
      release.
- [ ] **5. Tag and push the tag.**
      ```bash
      git tag cli-vX.Y.Z && git push origin cli-vX.Y.Z
      ```
- [ ] **6. Watch the run** (Actions → CLI Release): version assert → install →
      test → publish (`--provenance`) → GitHub Release.
- [ ] **7. Verify.**
      ```bash
      npm view context-shifter version              # → X.Y.Z
      npx context-shifter@X.Y.Z --version           # smoke
      ```
      Check the npm page shows the **provenance** badge, and the GitHub
      Release body matches the changelog section.

---

## Staged publishing (optional mode)

With `NPM_PUBLISH_MODE=stage`, the CI step runs `npm stage publish`: the
version lands in npm's staging area and goes live only after a maintainer
approves it — **approval needs interactive 2FA, CI cannot do it**:

```bash
npm stage list context-shifter     # find the stage-id
npm stage approve <stage-id>       # 2FA prompt; or the Staged Packages tab
```

Until approved, the version is not public.

---

## When something fails

| Symptom | Cause → fix |
|---|---|
| Workflow fails at "Assert the tag matches" | Tag ≠ `package.json` version. Re-tag correctly (`git tag -d`, re-create); never edit a pushed tag's commit. |
| `release-notes: no CHANGELOG.md section for X.Y.Z` | Changelog section missing or heading malformed — must be `## [X.Y.Z]` with the exact version. |
| Publish 403 | Trusted publisher not attached, workflow filename/environment mismatch, or the version already exists (the workflow skips existing versions — a 403 on a *new* version means setup). |
| npm rejects the name at bootstrap | Name too similar to an existing package. Pick an alternative and update `package.json` (`name`, `bin`), README, and the landing page together. |
| CI red on one OS | Don't tag. Fix and re-push `main`; the tag triggers a fresh full run anyway. |

Bad version escaped? `npm unpublish context-shifter@X.Y.Z` works within 72
hours; after that, deprecate (`npm deprecate`) and ship a fixed version.
Prefer fix-forward: semver means the next patch is cheap.

---

## House rules (from TRD-CLI §12/§14)

- Publish **only from `cli/`** — `package.json` at the repo root does not exist for this.
- 2FA on the npm account, always.
- Provenance on every CI publish; the bootstrap version is the only exception.
- **Zero runtime dependencies.** Adding any is a design change — update TRD and the PRD metric, not just `package.json`.
- `cli-v*` tags never fire the app's workflows (`ci.yml`, `dmg-release.yml` on `v*`), and app tags never fire the CLI release.
