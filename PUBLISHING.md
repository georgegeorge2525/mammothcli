# Publishing Mammoth CLI

Complete guide for publishing to GitHub, npm, GitHub Packages, and JSR.

---

## Pre-flight checklist

```powershell
cd C:\Users\george\StudioProjects\MammothMINICLI

# 1. Types must pass — enforced by prepublishOnly hook
bun run typecheck

# 2. Verify no leaked secrets
git status
# .env must NOT appear (it's in .gitignore)

# 3. Check what files ship to npm
npm pack --dry-run

# 4. Bump version if re-publishing
# Edit package.json "version": "1.0.0" → "1.0.1"
```

---

## 1. GitHub — create the repo

### 1a. Create repo on GitHub

1. Go to [github.com/new](https://github.com/new)
2. Name: `mammothcli`
3. Description: `Sovereign AI coding assistant CLI — multi-provider, agent-driven, runs in your terminal`
4. Public (or private if you prefer)
5. Do NOT initialize with README, .gitignore, or license — we already have them

### 1b. Push from local

```powershell
cd C:\Users\george\StudioProjects\MammothMINICLI

# Init git if not already
git init
git add .
git commit -m "Initial release: Mammoth CLI v1.0.0"

# Point at your GitHub repo
git remote add origin https://github.com/YOUR_USERNAME/mammothcli.git

# Push
git branch -M main
git push -u origin main
```

### 1c. Update package.json

After creating the repo, update the `repository` field:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/YOUR_USERNAME/mammothcli"
}
```

---

## 2. npm — publish to the public registry

### 2a. Create npm account

1. Go to [npmjs.com/signup](https://www.npmjs.com/signup)
2. Create account, verify email
3. Enable 2FA (required for publish)

### 2b. Login locally

```powershell
npm login
# Enter username, password, OTP
```

Verify you're logged in:

```powershell
npm whoami
```

### 2c. Check package name availability

```powershell
npm view mammothcli
# If 404 → name is available
# If shows a package → pick a different name (update package.json "name")
```

### 2d. Publish

```powershell
cd C:\Users\george\StudioProjects\MammothMINICLI
npm publish
```

What happens:
1. `prepublishOnly` hook runs `tsc --noEmit` — blocks if types fail
2. `files` field filters what's included (source only, no node_modules)
3. Package uploaded to npm registry
4. `mammothcli` command becomes installable globally

### 2e. Verify

```powershell
# Test install from npm
npm install -g mammothcli
mammothcli

# Or with Bun
bun install -g mammothcli
```

### 2f. Bump version for updates

```powershell
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0
npm publish
```

---

## 3. GitHub Packages — alternative registry

Publish to GitHub's npm-compatible registry alongside npm.

### 3a. Configure

Create `.npmrc` in the project root (don't worry, credentials go in the global one):

```ini
@YOUR_USERNAME:registry=https://npm.pkg.github.com
```

### 3b. Login

```powershell
npm login --registry=https://npm.pkg.github.com
# Username: YOUR_GITHUB_USERNAME
# Password: YOUR_GITHUB_TOKEN (generate at github.com/settings/tokens → write:packages)
```

### 3c. Publish

```powershell
npm publish --registry=https://npm.pkg.github.com
```

Install:

```bash
npm install -g @YOUR_USERNAME/mammothcli
```

---

## 4. JSR — JavaScript Registry (Bun-native)

JSR works natively with Bun and TypeScript. No build step needed.

### 4a. Install jsr CLI

```powershell
bun install -g jsr
```

### 4b. Add jsr config

Create `jsr.json` in project root:

```json
{
  "name": "@YOUR_USERNAME/mammothcli",
  "version": "1.0.0",
  "exports": "./main-tui.tsx",
  "publish": {
    "include": [
      "*.ts",
      "*.tsx",
      "*.txt",
      "services/**",
      "providers/**",
      "memory/**",
      "engine/**",
      "contexts/**",
      "types/**",
      "constants/**"
    ]
  }
}
```

### 4c. Publish

```powershell
jsr publish
```

Or from GitHub Actions (auto-publish on tag):

```yaml
- name: Publish to JSR
  run: bunx jsr publish
```

---

## 5. GitHub Releases — tagged versions

### 5a. Create a tag

```powershell
git tag v1.0.0
git push origin v1.0.0
```

### 5b. Create release on GitHub

Go to `github.com/YOUR_USERNAME/mammothcli/releases/new`

- Tag: `v1.0.0`
- Title: `v1.0.0 — Initial Release`
- Body:

```markdown
## Mammoth CLI v1.0.0

First public release.

### Features
- Multi-provider: DeepSeek, Claude, OpenAI, Groq, Ollama, OpenRouter
- 9 sub-agent types for code review, debugging, design, testing
- 4-tier memory system with SQLite + FTS5
- Claude Code-compatible slash commands
- MCP support for external tool servers

### Install
bun install -g mammothcli
```

This triggers:
- GitHub Actions CI (if configured)
- Any watchers/contributors get notified
- Tag is permanent and versioned

---

## 6. CI/CD — GitHub Actions

Create `.github/workflows/publish.yml`:

```yaml
name: Publish

on:
  push:
    tags: ['v*']

jobs:
  npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - run: bun install
      - run: bun run typecheck

      - uses: JS-DevTools/npm-publish@v3
        with:
          token: ${{ secrets.NPM_TOKEN }}
          registry: https://registry.npmjs.org/

  github-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

### Add secrets

Go to `github.com/YOUR_USERNAME/mammothcli/settings/secrets/actions`

- Add `NPM_TOKEN` — generate at `npmjs.com/settings/tokens` (Automation type)

Now pushing a `v*` tag auto-publishes to npm + creates a GitHub Release.

---

## Summary: one-time setup

| Step | Command | Registry |
|------|---------|----------|
| 1. GitHub repo | Create on github.com | github.com |
| 2. Push code | `git push -u origin main` | github.com |
| 3. npm login | `npm login` | npmjs.com |
| 4. Publish | `npm publish` | npmjs.com |
| 5. Tag release | `git tag v1.0.0 && git push origin v1.0.0` | github.com |
| 6. GitHub Release | Create at releases page | github.com |

## Every subsequent release

```powershell
# 1. Make changes, commit
git add . && git commit -m "your changes"

# 2. Bump version
npm version patch

# 3. Push + tag
git push && git push --tags

# 4. Publish
npm publish
```

GitHub Actions handles the rest if you set up CI/CD.
