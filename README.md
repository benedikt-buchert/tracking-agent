# tracking-agent

A browser-based agent that validates a website's `dataLayer` events against a JSON Schema.

## Installation

```bash
npm install
npm run build
agent-browser install   # installs Chrome for browser automation
```

## Usage

```
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

## Development

```bash
npm test          # run all tests
npm run test:watch  # watch mode
npm run lint      # lint
npm run build     # compile TypeScript → dist/
```
