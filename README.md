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

```bash
npm install
npm run build
agent-browser install   # installs Chrome for browser automation
```

## Usage

```text
tracking-agent --schema <url> --url <url> [options]
```

| Option | Description |
|--------|-------------|
| `--schema` | URL of the JSON Schema to validate against |
| `--url` | URL of the website to test |
| `--resume` | Resume a previous session from `.tracking-agent-session.json` |
| `--replay` | Replay recorded steps from `.tracking-agent-playbook.json` (LLM fallback on failure) |
| `--headless` | Run the browser in the background (no visible window) |
| `--help` | Show the help message |

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
