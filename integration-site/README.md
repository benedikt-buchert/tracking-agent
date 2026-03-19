# Demo Fixture

This static site is the public demo and integration-test fixture for `tracking-agent`.

Hosted pages:

- `/deterministic/`
- `/mutated/`

Schema used by both flows:

- `https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json`

## Covered Scenarios

The demo currently covers these concrete cases:

- Multi-page checkout journey: landing -> checkout -> payment -> profile
- Redirect hops between pages via `transit.html`
- Delayed rendering of actionable elements after page load
- Deterministic replay against stable selectors and layout
- Selector drift and layout drift in the mutated flow
- Correct form filling required before progression
- Test payment credentials required before purchase completion
- Persisted event journal across navigations
- Page-local JavaScript reboots on every navigation
- Valid events, invalid events, and expected-but-missing events

## Expected Event Outcomes

Expected valid events:

- `purchase`
- `address_submitted`

Expected invalid events:

- `add_to_cart`
- `user_update`

Expected missing events:

- `checkout_complete`
- `option_a`
- `option_b`
- `choice_event`
- `nested_choice`

## Deterministic Flow

The deterministic flow keeps selectors stable and is meant to succeed with pure replay.

Key selectors:

- `[data-testid="start-checkout"]`
- `[data-testid="broken-cart"]`
- `[data-testid="email"]`
- `[data-testid="postal-code"]`
- `[data-testid="state"]`
- `[data-testid="continue-to-payment"]`
- `[data-testid="card-number"]`
- `[data-testid="card-cvc"]`
- `[data-testid="card-name"]`
- `[data-testid="place-order"]`
- `[data-testid="profile-update"]`

Required test values:

- email: `buyer@example.com`
- postal code: `90210`
- state: `CA`
- card number: `4242424242424242`
- CVC: `123`
- cardholder: `Test Buyer`

## Mutated Flow

The mutated flow keeps the same business intent but changes selectors, structure, labels, and layout so the deterministic replay should get stuck.

Key selectors:

- `[data-testid="launch-journey"]`
- `[data-testid="cart-warning"]`
- `[data-testid="contact-email"]`
- `[data-testid="zip-entry"]`
- `[data-testid="region-entry"]`
- `[data-testid="payment-step"]`
- `[data-testid="pan-field"]`
- `[data-testid="security-code"]`
- `[data-testid="cardholder"]`
- `[data-testid="submit-order"]`
- `[data-testid="account-pulse"]`

Required test values:

- email: `buyer@example.com`
- ZIP: `90210`
- region: `CA`
- PAN: `4242424242424242`
- security code: `123`
- full name: `Test Buyer`

## Notes For New Scenarios

When adding another scenario:

- add a new scenario entry in `src/integration/site-fixture.ts`
- define its page inventory and `dataLayerMode`
- reuse `integration-site/shared/fixture-store.js` for persistence and delayed mounts
- keep expected valid, invalid, and missing events explicit
- prefer adding a new flow directory over overloading the existing two flows
