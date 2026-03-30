# tracking-agent

A Stagehand-based agent that validates a website's `dataLayer` events against a JSON Schema.

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

Install from npm:

```bash
npm install -g tracking-agent
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
| `--credentials` | Path to a JSON credentials file for sensitive form fields (see [Credentials](#credentials)) |
| `--headless` | Run the browser in the background (no visible window) |
| `--quiet` | Suppress all progress output — only errors and the final report are shown |
| `--verbose` | Show detailed step-by-step progress |
| `--help` | Show the help message |

Validation runs locally using [AJV](https://ajv.js.org/). No external validator service is required. Schemas are fetched directly from the `--schema` URL (HTTP or local file) and validated in-process. Cross-referenced `$ref` schemas are resolved the same way.

## Credentials

Some checkout flows require sensitive payment or login details. Pass these via a JSON credentials file so the agent can fill them without the values appearing in prompts, logs, or conversation history.

```bash
tracking-agent \
  --schema https://example.com/schema.json \
  --url    https://example.com \
  --credentials ./creds.json
```

### File format

```json
{
  "fields": {
    "card_number": {
      "description": "Payment card number",
      "value": "4242424242424242"
    },
    "card_cvc": {
      "description": "Card security code",
      "value": "123"
    }
  }
}
```

Each entry under `"fields"` is a **credential field**:

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `description` | string | yes | Human-readable label shown to the agent (no value is revealed) |
| `value` | string | yes | The actual secret value filled into the form element |

### What to put in credentials

Only put **sensitive fields** here — things that should never appear in logs:

- Payment card numbers and CVCs
- Passwords and PINs
- API keys or tokens used as form inputs

Non-sensitive form data (email addresses, postal codes, names) should be left in the site flow and handled directly by the Stagehand journey.

### Security

- Credential values are loaded once at startup and held in memory.
- The `fill_credential` agent tool receives only a `field_name` and CSS selector — the value is looked up internally and passed directly to the browser fill command.
- Values never appear in system prompts, tool descriptions, agent messages, or replay files.
- The `fieldSummary()` API — used in the system prompt — lists field names and descriptions only.

## Output modes

| Flag | Behaviour |
|------|-----------|
| *(default)* | Shows the startup banner and key milestones |
| `--quiet` | Suppresses all progress output; only errors and the final JSON report are written |
| `--verbose` | Shows detailed step-by-step progress including intermediate validation messages |

## Environment variables

| Variable | Description |
|----------|-------------|
| `STAGEHAND_MODEL` | Primary Stagehand model, for example `vertex/gemini-2.5-pro` |
| `STAGEHAND_PROJECT` | GCP project for Vertex-backed Stagehand models |
| `STAGEHAND_LOCATION` | Vertex location for `STAGEHAND_MODEL` |
| `STAGEHAND_AGENT_MODEL` | Optional hybrid agent model override |
| `STAGEHAND_EXECUTION_MODEL` | Optional hybrid execution model override |
| `STAGEHAND_AGENT_LOCATION` | Vertex location for `STAGEHAND_AGENT_MODEL` |
| `STAGEHAND_EXECUTION_LOCATION` | Vertex location for `STAGEHAND_EXECUTION_MODEL` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Required when using `google/...` Stagehand models |
| `OPENAI_API_KEY` | Required when using `openai/...` Stagehand models |

For Vertex auth: `gcloud auth application-default login`

## Publishing

The npm publish workflow lives in [`.github/workflows/publish.yml`](.github/workflows/publish.yml).

Before publishing:

- set the package version in `package.json`
- configure npm trusted publishing for `benedikt-buchert/tracking-agent` and this workflow
- create a GitHub release, or run the workflow manually

This workflow uses GitHub OIDC trusted publishing, so no npm token secret is required.

## Quick start

```bash
# Run with a direct Stagehand Google model
GOOGLE_GENERATIVE_AI_API_KEY=... \
STAGEHAND_MODEL=google/gemini-3-flash-preview \
tracking-agent \
  --schema https://example.com/schema.json \
  --url    https://example.com

# Run with Vertex
STAGEHAND_MODEL=vertex/gemini-2.5-pro \
STAGEHAND_PROJECT=my-gcp-project \
STAGEHAND_LOCATION=europe-west4 \
tracking-agent \
  --schema https://example.com/schema.json \
  --url    https://example.com \
  --headless

# Resume a previous session
tracking-agent --resume
```

## Demo commands

Deterministic demo run:

```bash
tracking-agent \
  --schema https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json \
  --url    https://benedikt-buchert.github.io/tracking-agent/deterministic/ \
  --headless
```

Mutated demo run:

```bash
tracking-agent \
  --schema https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json \
  --url    https://benedikt-buchert.github.io/tracking-agent/mutated/ \
  --headless
```

The mutated run is the better demo for recovery and exploration across page changes.

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
- integration tests against the demo fixture

## Development

All non-trivial changes follow red-green-refactor: write the smallest failing test first, then the smallest passing code, then refactor. See [AGENTS.md](AGENTS.md) for the full contribution rules.

```bash
npm test             # run all unit tests
npm run test:watch   # watch mode
npm run test:integration  # run integration tests against the fixture
npm run verify:local  # full local pre-merge verification (forces headless integration)
npm run verify:local:headed  # same flow, but with a visible browser for debugging
npm run demo:serve   # serve the demo fixture locally
npm run lint         # lint
npm run build        # compile TypeScript -> dist/
```
