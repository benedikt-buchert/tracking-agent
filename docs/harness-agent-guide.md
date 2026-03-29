# Harness Agent Guide

This document defines how the agent should use the harness to improve `tracking-agent`.

It is not a runtime prompt for website exploration.

It is operational guidance for the improvement loop.

## Purpose

Use the harness to improve general agent capability in these areas:

- noisy site discovery
- dataLayer detection and extraction
- navigation recovery
- action-step efficiency
- token efficiency and context discipline

Do not treat the harness as a way to optimize one site-specific replay path and call that a product improvement.

## What Counts As Improvement

A change counts as an agent improvement when it improves behavior that should transfer across more than one case.

Prefer improvements in this order:

1. browser-tool ergonomics
2. state interpretation
3. event extraction robustness
4. prompt guidance for exploration and recovery
5. replay heuristics
6. site-specific playbook updates last

If a change only makes one site-specific playbook better, classify it as a site adaptation, not a general agent improvement.

## What The Agent Should Optimize

Optimize for:

- finding the tracking surface reliably
- extracting more useful tracking events
- making meaningful navigation progress
- reducing wasted action steps
- reducing wasted tokens
- keeping the working context compact
- avoiding loops and dead ends
- preserving performance on holdout cases

Do not optimize for:

- exact selector memorization for one site
- exact human path imitation
- passing one case by spending many more action steps
- passing one case by consuming far more tokens
- changing live-site expectations to make results look better

## Token Efficiency Rules

Token efficiency is a primary benchmark concern because excessive tool chatter and oversized observations can clog the context window and degrade later decisions.

Prefer changes that:

- reduce unnecessary agent turns
- reduce repeated page inspection without new information
- reduce verbose tool outputs when compact outputs are sufficient
- summarize observations into compact state rather than carrying raw page detail forward
- avoid asking the model to re-plan from scratch after every small action

Be skeptical of changes that:

- improve success by consuming materially more input or output tokens
- add long prompt appendices for narrow site-specific cases
- repeatedly inject raw DOM or repeated snapshots into context

## Allowed Evidence

Use these evidence sources when diagnosing a failure:

- the case definition
- the run result
- logs
- screenshots
- DOM snapshots
- extracted event lists
- human baseline if available

For live cases, remember that expectations are heuristic. Do not infer exact correctness where the case does not provide it.

## Result Storage

Do not commit raw timestamped files from `harness/results/`.

Treat `harness/results/` as disposable run output:

- use it for local diagnosis
- compare it against the checked-in baseline snapshot
- discard or regenerate it as needed

Commit only deliberate benchmark snapshots, for example:

- `harness/baselines/latest-scorecard.json`
- optional human baselines
- promoted repro cases

When benchmark expectations change on purpose, update the checked-in baseline in the same change as the agent improvement.

## Improvement Loop

Use this loop:

1. Run the smallest relevant case set.
2. Identify the dominant failure class.
3. Confirm whether the failure is:
   - discovery
   - extraction
   - navigation
   - loop or waste
   - tool gap
4. Choose the narrowest plausible fix.
5. Re-run the target case set.
6. Re-run guard and holdout cases.
7. Accept the change only if the target improves without material regression elsewhere.

## Case Selection Rules

Start narrow.

When working on a new issue, prefer:

1. one `discovery_known` or `discovery_promoted` case that clearly exhibits the problem
2. one related guard case
3. one holdout case if available

Do not start with the full corpus unless the change is already known to be broad and low risk.

## Human Baseline Rules

Human baselines are optional calibration data.

Use them to answer:

- how many action steps a competent human needed
- which milestones matter
- whether the agent is wasting motion

Do not use them to:

- force exact path replay
- hardcode the human sequence into the agent
- judge the agent by duration

The main human comparison metric is `action_steps_total`.

## Efficiency Rules

When evaluating improvement:

- compare `action_steps_total` against prior agent runs
- compare `human_action_steps_total` when available
- compare `token_input` and `token_output` against prior agent runs
- use `tool_calls_total` as a secondary debug metric

A patch should be viewed skeptically if:

- success improves only because the agent takes many more action steps
- success improves only because the agent consumes far more tokens
- tool calls fall but action steps worsen materially
- one case improves while the holdout gets worse

## Failure Classification Guidance

Use the simplest useful classification.

Recommended classes:

- `tracking_surface_not_found`
- `important_event_not_detected`
- `navigation_progress_failed`
- `loop_or_repeated_actions`
- `blocked_by_modal_or_overlay`
- `selector_discovery_failed`
- `iframe_or_nested_context_failed`
- `state_misread`
- `tool_gap`
- `context_bloat_or_token_waste`

Do not create many fine-grained categories in the first version.

## Acceptance Rules

Accept a change as an agent improvement only if:

- the target case or family improves
- guard cases do not regress materially
- holdout cases do not regress materially

For cases with human baselines:

- `action_steps_total` should improve or stay within an acceptable bound

For token usage:

- token usage should improve or stay within an acceptable bound
- a material token increase should be treated as a regression unless it brings a clear quality gain that also holds on guard and holdout cases

If only a site-specific playbook changes and no broader behavior improves, classify the result as a site adaptation.

## First-Version Restraint

Do not overengineer the first harness slice.

The first implementation only needs enough structure to:

- define one case
- run one case
- emit one normalized result
- count action steps consistently
- compare against an optional human baseline
- record token usage

Defer:

- automated failure clustering
- automatic repro generation
- patch generation
- broad workflow automation
- large corpus management

## Recommended Next Implementation

When picking this up later, start here:

1. create `harness/` directory structure
2. add JSON Schemas for the documented file types
3. add one example case
4. add one example optional human baseline
5. implement a loader or validator
6. implement a single-case runner
7. emit a `run-result`
8. add a minimal scorecard printer

## Related Docs

- [docs/harness-plan.md](/Users/bbuchert/Documents/tracking-agent/docs/harness-plan.md)
- [docs/harness-signal-cases.md](/Users/bbuchert/Documents/tracking-agent/docs/harness-signal-cases.md)
