# Harness Signal-Backed Cases

This document defines the benchmark contract for the agent-improvement harness.

The goal is to improve:

- non-deterministic site discovery
- dataLayer detection and extraction
- navigation recovery on noisy real sites
- action efficiency measured in normalized steps

This harness is separate from deterministic replay and schema-backed regression tests. Those remain covered by unit tests and integration tests in the main product suite.

## Scope

Use this contract for:

- live noisy sites without a JSON Schema
- promoted repro cases derived from live-site failures
- local discovery fixtures that exercise the same behavior classes

Do not use this contract for:

- exact schema validation of events
- site-specific replay correctness
- deterministic playbook-only scoring

## Case Types

There are two case types:

1. `signal-backed-case`
   Defines a benchmark target with loose or heuristic expectations.

2. `human-baseline`
   Optional sparse calibration data for action-step efficiency on a subset of cases.

## Signal-Backed Case JSON

```json
{
  "$schema": "./schemas/signal-backed-case.schema.json",
  "case_id": "live-shop-checkout-01",
  "site_id": "live-shop",
  "family_id": "checkout-discovery",
  "kind": "live",
  "entry_url": "https://example.com/",
  "journey_hint": "Reach a checkout or payment step and extract tracking events from the site's dataLayer or equivalent surface.",
  "tags": ["live", "checkout", "datalayer", "noisy"],
  "difficulty": "medium",
  "allowed_actions": ["navigate", "click", "fill", "dismiss-consent"],
  "expected_signals": {
    "tracking_surfaces": ["dataLayer"],
    "event_names_any_of": ["page_view", "view_item", "add_to_cart", "begin_checkout", "purchase"],
    "event_name_prefixes_any_of": [],
    "event_property_keys_any_of": ["event", "ecommerce", "page_type"],
    "min_events_total": 3,
    "min_unique_event_names": 2,
    "important_event_names_any_of": ["begin_checkout", "purchase"]
  },
  "negative_signals": {
    "forbidden_event_names": [],
    "forbidden_domains": [],
    "disallowed_url_patterns": []
  },
  "journey_expectations": {
    "target_url_patterns_any_of": ["/cart", "/checkout", "/payment", "/confirmation"],
    "min_navigation_progress_score": 2,
    "must_reach_high_value_state": false
  },
  "budgets": {
    "max_action_steps": 40,
    "max_tool_calls": 120,
    "max_no_progress_actions": 8
  },
  "grader": {
    "type": "heuristic",
    "strictness": "medium"
  },
  "human_baseline_id": null,
  "notes": "Live discovery case. No exact schema or playbook required."
}
```

## Human Baseline JSON

Human baselines are optional and should be sparse. They exist to calibrate action-step efficiency, not to become the agent's target path for every site.

```json
{
  "$schema": "./schemas/human-baseline.schema.json",
  "human_baseline_id": "live-shop-checkout-01-human-v1",
  "case_id": "live-shop-checkout-01",
  "source": "manual-recording",
  "action_steps_total": 12,
  "milestones": [
    "dismissed consent",
    "reached product detail",
    "reached cart",
    "reached checkout",
    "observed begin_checkout"
  ],
  "playbook_path": "harness/human-playbooks/live-shop-checkout-01.json",
  "notes": "Reference baseline from a competent human. Used only for step calibration."
}
```

## Run Result JSON

Each execution should emit one normalized result object.

```json
{
  "$schema": "./schemas/run-result.schema.json",
  "run_id": "2026-03-27T12:00:00Z-live-shop-checkout-01",
  "timestamp": "2026-03-27T12:00:00Z",
  "git_commit": "abc123",
  "case_id": "live-shop-checkout-01",
  "site_id": "live-shop",
  "family_id": "checkout-discovery",
  "lane": "discovery_live_target",
  "outcome": {
    "status": "passed",
    "tracking_surface_found": true,
    "journey_completed": false,
    "important_event_detected": true,
    "human_intervention_needed": false,
    "failure_class": null,
    "failure_summary": null
  },
  "metrics": {
    "action_steps_total": 16,
    "tool_calls_total": 49,
    "navigation_count": 5,
    "unique_pages_visited": 4,
    "events_extracted_total": 8,
    "unique_event_names": 4,
    "important_events_found": 1,
    "navigation_progress_score": 3,
    "stuck_loops_detected": 0,
    "repeated_action_count": 2,
    "no_progress_action_streak_max": 3,
    "token_input": 18000,
    "token_output": 2100,
    "estimated_cost_usd": 0.41
  },
  "human_comparison": {
    "human_baseline_available": true,
    "human_action_steps_total": 12,
    "step_ratio_vs_human": 1.33,
    "extra_steps_vs_human": 4,
    "milestone_recall_vs_human": 0.8
  },
  "artifacts": {
    "log_path": "tracking-reports/2026-03-27T12-00-00/live-shop-checkout-01.log",
    "report_path": "tracking-reports/2026-03-27T12-00-00/live-shop-checkout-01.report.json",
    "session_path": "tracking-reports/2026-03-27T12-00-00/live-shop-checkout-01.session.json",
    "playbook_path": null,
    "trace_path": null,
    "screenshots_dir": "tracking-reports/2026-03-27T12-00-00/screenshots",
    "dom_snapshot_dir": "tracking-reports/2026-03-27T12-00-00/dom"
  }
}
```

## Lane Definitions

Use these lanes for the agent-improvement harness:

- `discovery_known`
  Local noisy fixtures built to exercise discovery and extraction behavior.

- `discovery_promoted`
  Stable repro cases promoted from real live-site failures.

- `discovery_live_target`
  Live sites used for discovery and re-testing of known failure classes.

- `discovery_live_holdout`
  Live sites not used to drive fixes. This lane protects against overfitting.

## Grading Model

### Strict Grader

Use for local fixtures and promoted repros when expected outcomes are well understood.

Inputs may include:

- exact important event names
- required milestones
- expected tracking surface
- action-step budget

### Heuristic Grader

Use for live sites without exact schema knowledge.

Suggested heuristics:

- tracking surface was found
- at least `min_events_total` events were extracted
- at least `min_unique_event_names` unique event names were extracted
- at least one important event candidate was detected when expected
- navigation progress reached the configured threshold
- action-step budget was respected
- no excessive no-progress loop occurred

### Comparative Grader

Use when exact correctness is unknown but historical comparison is still useful.

Suggested checks:

- more events extracted than the baseline agent version
- fewer normalized action steps than before
- fewer no-progress loops than before
- no regression on holdout cases

## Step Counting

Human comparison must use normalized action steps, not raw tool calls.

The machine is allowed to be faster than a human. The benchmark should compare decision efficiency, not duration.

### Counted As One Action Step

Count exactly one action step for each meaningful external interaction:

- click or tap on a control intended to progress the journey
- fill a field with a value
- select an option from a dropdown, radio, or similar control
- submit a form
- dismiss a consent modal or overlay when it blocks progress
- navigate to a new meaningful page or state as a direct action outcome

### Not Counted As Action Steps

Do not count:

- snapshots
- DOM reads
- browser inspection
- event inspection
- passive waits
- polling retries
- internal reasoning turns
- tool calls that only gather information

These still count toward `tool_calls_total`, but not `action_steps_total`.

### Grouping Rules

Use these normalization rules so human and agent runs are scored consistently:

1. A fill action counts once per field.
2. A click that causes navigation still counts as one action step.
3. Automatic redirects count toward navigation metrics, not action steps.
4. Repeated clicks on the same ineffective element count as separate action steps.
5. A modal dismissal counts only if it was necessary to unblock progress.
6. A combined human macro action should be split into the same units the agent is expected to perform.

## Human Comparison Metrics

Only compute these when a human baseline is available.

- `human_baseline_available`
- `human_action_steps_total`
- `step_ratio_vs_human = action_steps_total / human_action_steps_total`
- `extra_steps_vs_human = action_steps_total - human_action_steps_total`
- `milestone_recall_vs_human = matched_milestones / human_milestones_total`

These metrics are for calibration. They should not force the agent to copy the exact human path.

## Acceptance Policy

A change counts as an agent improvement only if:

- `discovery_promoted` improves on the target failure family
- `discovery_known` does not regress materially
- `discovery_live_holdout` does not regress materially

For cases with human baselines:

- action-step efficiency should improve or remain within an acceptable bound
- success should not improve only by taking many more action steps

## Recommended File Layout

```text
harness/
  cases/
    *.json
  human-baselines/
    *.json
  human-playbooks/
    *.json
  results/
  schemas/
    signal-backed-case.schema.json
    human-baseline.schema.json
    run-result.schema.json
```

## Practical Guidance

- Keep human baselines sparse. Use them only on representative cases.
- Use live sites for discovery, not as the only source of truth.
- Promote worthwhile live failures into stable repro families.
- Prefer improving general discovery heuristics, tool ergonomics, and event extraction over site-specific path tuning.
