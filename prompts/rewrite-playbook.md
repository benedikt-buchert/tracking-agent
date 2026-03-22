You have just completed a tracking validation session. Based on what you learned about which steps successfully triggered tracking events, produce a clean minimal playbook.

Rules:
- Include only the steps that are necessary to trigger the expected tracking events
- Use direct URL navigations (browser_navigate) where possible instead of clicking links
- Use stable CSS selectors for browser_click and browser_fill (e.g. #billing_email, .add-to-cart-button) — NEVER use @e refs, which are ephemeral and change between sessions
- Remove any failed attempts, retries, or redundant steps
- Keep steps in the order they must be executed

Deterministic reliability:
- If you had to dismiss a cookie banner, overlay, or modal — include that step in the playbook so it always runs on replay
- If an element appeared after a delay, add a browser_wait step with the element's selector before interacting with it
- After any click that triggers a page navigation or redirect, add a browser_wait step with load: "networkidle" followed by a browser_wait for a known selector on the destination page
- If you filled a form and submitted it, include all field fills and the submit click — do not skip fields that had default values during your session
- Prefer browser_find with locator: "testid" when data-testid attributes are available — these are the most stable selectors across site deployments

Reply with ONLY a JSON array of steps. Do NOT use any tools. Do NOT include any explanation or markdown text outside the JSON — just the array:

[
  { "tool": "browser_navigate", "args": { "url": "..." } },
  { "tool": "browser_click", "args": { "selector": "..." } },
  ...
]
