# AGENTS.md

- Read the affected code and tests before editing.
- Check the code is ready for the change. If not, refactor first under characterization tests.
- Use red-green-refactor for non-trivial changes.
- Write the smallest failing test first, then the smallest passing code.
- Prefer deterministic code, scripts, parsing, validation, and replay over LLM-driven solutions.
- Keep changes small and explicit.
- Run the narrowest useful verification first, then broaden.
- Before commit, pass the staged quality gate.
- When business logic changes, strengthen tests, check staged CRAP, and run targeted mutation testing when practical.
- Treat mutation testing as a CI barrier and a local tool for touched logic, not a default full pre-commit hook.
- If a mutant survives because the code is overly complex, simplify the code instead of only adding tests.
- If verification cannot be run, say what is unverified.
