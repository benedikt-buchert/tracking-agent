# Harness Plan

This document records the current plan for the agent-improvement harness so future work can start from a stable baseline.

It is intentionally biased toward a small first version.

## Goal

Build a harness for improving `tracking-agent` itself, not for adding self-healing logic inside one agent run.

The harness should help improve:

- noisy site discovery
- dataLayer detection and extraction
- navigation recovery on messy real sites
- action efficiency measured in normalized steps

The harness should not be optimized around:

- exact schema validation for live sites
- deterministic replay correctness
- site-specific playbook quality as the main success signal

Those stay primarily covered by the existing product test suite.

## What We Decided

### 1. Separate product testing from agent-improvement benchmarking

The repo already has deterministic coverage:

- unit tests
- integration tests
- a controlled demo fixture
- replay and playbook workflows

That deterministic layer should continue catching:

- schema-validation regressions
- replay regressions
- local fixture regressions
- tool/runtime regressions that are easy to specify exactly

The new harness exists for the messier problem:

- real noisy sites
- loose expectations
- discovery and extraction behavior
- generalization under uncertainty

### 2. Live sites matter, but they are not the only evaluation surface

The agent is intended for noisy real sites, so the harness must include live sites.

But raw live-site failures are too unstable to be the only optimization target. They are valuable mainly as:

- discovery input
- regression signals
- sources of new failure patterns

When a live-site failure teaches something durable, it should eventually be turned into a stable promoted repro case.

### 3. We do not need a big handcrafted Tier 2 upfront

We already have a controlled local site in the repo.

So the practical structure is:

- local controlled fixture(s) for baseline coverage
- live sites for discovery
- promoted repro cases created only when a live failure is worth preserving

That means Tier 2 is on-demand, not a large up-front investment.

### 4. Promoted repro cases should reproduce failure mechanisms, not clone full sites

We explicitly do not want to copy whole real checkout sites.

A promoted repro should capture the minimal behavior needed to preserve the failure mechanism, such as:

- selector drift
- delayed mount
- blocking modal
- redirect timing
- iframe input
- SPA route changes
- ephemeral event timing

The repro preserves the bug class, not the entire site.

### 5. Overfitting risk is real, so the harness must optimize for pattern families

A fix should not be accepted just because one captured example now passes.

The durable unit of improvement should be a failure family, with:

- one seed case
- several small variants
- shared success invariants

This is how the harness avoids rewarding one-off site-specific tuning.

### 6. Playbooks are intentionally overfitted, but that is not the same as agent improvement

This distinction matters:

- playbook overfitting is intentional and useful for token savings
- agent capability overfitting is the real risk

So the harness must evaluate general discovery and recovery separately from site-specific replay data.

### 7. For live sites, do not require JSON Schemas or playbooks

The core improvement target is not exact schema-backed validation on live sites.

For live cases, the harness should use lighter expectations such as:

- did the agent find the tracking surface
- did it extract events
- did it detect likely important events
- did it make meaningful navigation progress
- did it stay within action budgets

### 8. Human baselines should be optional and sparse

Human baselines are useful for step-efficiency calibration.

They should not be required for every site.

They should be used for:

- a few representative live sites
- a few promoted repro families
- selected local fixtures

Their role is:

- compare action efficiency
- define reasonable milestones
- optionally seed a replay path on a few sites

Their role is not:

- forcing the agent to copy an exact path
- becoming mandatory coverage on the whole corpus

### 9. Duration is not a primary comparison metric against humans

We explicitly decided that wall-clock time is not the main comparison metric.

The machine may be faster than a human for reasons unrelated to agent quality.

Human comparison should use normalized action steps, not duration.

### 10. Action steps must be normalized

The harness must distinguish:

- `action_steps_total`
  Human-comparable, meaningful external interactions

- `tool_calls_total`
  Useful internal efficiency/debug signal, but not a human-comparable metric

This prevents unfair comparisons where the agent is penalized for having observability tools that humans do not have.

## Current Harness Model

The current planned benchmark lanes are:

- `discovery_known`
- `discovery_promoted`
- `discovery_live_target`
- `discovery_live_holdout`

The live-site contract and step-counting rules are documented in:

- [docs/harness-signal-cases.md](/Users/bbuchert/Documents/tracking-agent/docs/harness-signal-cases.md)

## Non-Goals For The First Version

Do not overengineer the first case.

The first version should not try to build:

- automatic repro generation from arbitrary live DOM captures
- a large promoted repro corpus
- full PR automation
- automatic code patch generation and merge workflows
- a complete holdout management system
- a large schema library for live sites

Those can come later.

## Minimal First Implementation

The first useful harness version should be small and explicit.

### First slice

Build only these pieces:

1. A file format for `signal-backed-case`
2. A file format for optional `human-baseline`
3. A runner that executes one case and writes one `run-result`
4. A step normalizer that computes `action_steps_total`
5. A simple grader for heuristic live-site scoring
6. A summary command that prints a compact scorecard across a small set of cases

### Initial corpus

Start with a tiny corpus:

- 1 local known discovery case
- 1 live target case
- 0 or 1 live holdout case
- optional 1 human baseline on one of those cases

That is enough to prove the harness architecture without prematurely building a large system.

### Explicitly defer

Defer these until the basic loop exists:

- promoted repro family generation
- variant generation
- comparative graders
- automated failure clustering
- patch suggestion logic
- branch/PR automation

## Suggested Next Build Steps

Next implementation work should happen in this order:

1. Add `harness/` directory structure.
2. Add JSON Schemas for:
   - `signal-backed-case`
   - `human-baseline`
   - `run-result`
3. Add one example case file.
4. Add one example human baseline file.
5. Add a TypeScript loader/validator for those files.
6. Add a single-case runner that produces a `run-result`.
7. Add normalized action-step counting to the runner output.
8. Add a small scorecard command for a handful of runs.

## Acceptance Criteria For The First Version

The first version is good enough if:

- one case can be described declaratively
- the harness can run it
- a normalized result file is written
- action steps are counted consistently
- optional human comparison works when provided
- the output is simple enough to extend later without rework

## Practical Reminder

The first case should stay simple.

It should prove:

- the contract is viable
- the step-counting rules are usable
- the agent can be benchmarked on discovery/extraction separately from deterministic replay

It does not need to solve the whole self-improvement loop yet.
