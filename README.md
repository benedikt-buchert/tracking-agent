# tracking-agent

A browser-based agent that validates a website's `dataLayer` events against a JSON Schema.

## Demo

Hosted demo fixture:

- Deterministic: `https://benedikt-buchert.github.io/tracking-agent/deterministic/`
- Mutated: `https://benedikt-buchert.github.io/tracking-agent/mutated/`

These pages are meant to demonstrate:

- deterministic replay against a stable checkout flow
- selector drift against a structurally changed flow
- delayed rendering and redirect hops between pages
- valid, invalid, and missing schema events

Demo schema:

- `https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json`

## Installation

Prerequisites:

- Node.js 20+
- npm
- Chrome installed via `tracking-agent-install-browser`

Install from npm:

```bash
npm install -g tracking-agent
tracking-agent-install-browser
```

That installs the `tracking-agent` CLI globally so you can run it from any directory.

Verify the install:

```bash
tracking-agent --help
```

## Usage

```text
tracking-agent --schema <url> --url <url> [options]
```

| Option | Description |
|--------|-------------|
| `--schema` | HTTP URL or local file path of the JSON Schema to validate against |
| `--url` | URL of the website to test |
| `--schemas-dir` | Local directory of schema files — used instead of remote fetches when available |
| `--resume` | Resume a previous session from `.tracking-agent-session.json` |
| `--replay` | Replay recorded steps from `.tracking-agent-playbook.json` (LLM fallback on failure) |
| `--headless` | Run the browser in the background (no visible window) |
| `--help` | Show the help message |

Validation runs locally using [AJV](https://ajv.js.org/). No external validator service is required. Schemas are fetched directly from the `--schema` URL (HTTP or local file) and validated in-process. Cross-referenced `$ref` schemas are resolved the same way.

## Environment variables

| Variable | Description |
|----------|-------------|
| `MODEL_PROVIDER` | AI provider — `anthropic` (default), `openai`, or `google-vertex` |
| `MODEL_ID` | Model ID (default: `claude-opus-4-6`) |
| `ANTHROPIC_API_KEY` | Required for `anthropic` provider |
| `OPENAI_API_KEY` | Required for `openai` provider |
| `GOOGLE_CLOUD_PROJECT` | Required for `google-vertex` provider |
| `GOOGLE_CLOUD_LOCATION` | Required for `google-vertex` provider |

For Google Vertex auth: `gcloud auth application-default login`

## Publishing

The npm publish workflow lives in [`.github/workflows/publish.yml`](.github/workflows/publish.yml).

Before publishing:

- set the package version in `package.json`
- configure npm trusted publishing for `benedikt-buchert/tracking-agent` and this workflow
- create a GitHub release, or run the workflow manually

This workflow uses GitHub OIDC trusted publishing, so no npm token secret is required.

## Quick start

```bash
# Run with an Anthropic key
ANTHROPIC_API_KEY=sk-... tracking-agent \
  --schema https://example.com/schema.json \
  --url    https://example.com

# Headless (CI / no display)
ANTHROPIC_API_KEY=sk-... tracking-agent \
  --schema https://example.com/schema.json \
  --url    https://example.com \
  --headless

# Resume a previous session
tracking-agent --resume

# Replay a saved playbook
tracking-agent \
  --schema https://example.com/schema.json \
  --url    https://example.com \
  --replay
```

## Demo commands

Deterministic replay without relying on LLM recovery:

```bash
cp demo-playbooks/deterministic.json .tracking-agent-playbook.json

tracking-agent \
  --schema https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json \
  --url    https://benedikt-buchert.github.io/tracking-agent/deterministic/ \
  --replay \
  --headless
```

Mutated demo run to show where deterministic replay breaks:

```bash
cp demo-playbooks/deterministic.json .tracking-agent-playbook.json

tracking-agent \
  --schema https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json \
  --url    https://benedikt-buchert.github.io/tracking-agent/mutated/ \
  --replay \
  --headless
```

If model credentials are configured, the mutated run is the better demo for recovery and exploration after replay gets stuck. If no model credentials are configured, the deterministic run is the better demo because it can complete via replay alone.

## Local pre-merge verification

CI intentionally does not run the integration suite right now.

Use this locally before merging to `main`:

```bash
npm run verify:local
```

That runs:

- lint
- unit tests
- typecheck
- browser integration tests against the demo fixture
- gated LLM-assisted integration smoke tests

The LLM-assisted integration test only runs when both conditions are true:

- `RUN_LLM_INTEGRATION=1`
- model credentials are configured

Example:

```bash
RUN_LLM_INTEGRATION=1 ANTHROPIC_API_KEY=sk-... npm run verify:local
```

## Development

All non-trivial changes follow red-green-refactor: write the smallest failing test first, then the smallest passing code, then refactor. See [AGENTS.md](AGENTS.md) for the full contribution rules.

```bash
npm test             # run all unit tests
npm run test:watch   # watch mode
npm run test:integration  # run integration tests against the fixture
npm run test:integration:llm  # run the gated LLM-assisted integration test
npm run verify:local  # full local pre-merge verification (forces headless integration)
npm run verify:local:headed  # same flow, but with a visible browser for debugging
npm run demo:serve   # serve the demo fixture locally
npm run lint         # lint
npm run build        # compile TypeScript -> dist/
```
