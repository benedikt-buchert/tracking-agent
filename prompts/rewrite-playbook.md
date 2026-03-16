You have just completed a tracking validation session. Based on what you learned about which steps successfully triggered tracking events, produce a clean minimal playbook.

Rules:
- Include only the steps that are necessary to trigger the expected tracking events
- Use direct URL navigations (browser_navigate) where possible instead of clicking links
- Use stable CSS selectors for browser_click and browser_fill (e.g. #billing_email, .add-to-cart-button) — NEVER use @e refs, which are ephemeral and change between sessions
- Remove any failed attempts, retries, or redundant steps
- Keep steps in the order they must be executed

Reply with ONLY a JSON array of steps. Do NOT use any tools. Do NOT include any explanation or markdown text outside the JSON — just the array:

[
  { "tool": "browser_navigate", "args": { "url": "..." } },
  { "tool": "browser_click", "args": { "selector": "..." } },
  ...
]
