# Working on VOTE/TRACK

- Read README.md for current behavior; docs/change-history.md is historical, not a specification.
- For a new voting link, follow docs/new-vote.md. Discover the public response and official aggregation rules, write the configuration and use scripts/new-tracker.cjs. Do the investigation for the user; do not require them to supply API paths or IDs.
- Never copy a prior contest's observations or forecast ledger into a new project. Never delete or refit an issued forecast during cleanup. collector/legacy is immutable restoration evidence, not dead code.
- Keep current MMA behavior in its detailed shell; share pure data/calculation modules with the multi-source shell. No invented Berriz endpoint or implicit name/rank-based identity matching.
- Keep tracker.config.json authoritative; run npm run config after edits. Do not hand-edit dist/config.js.
- Run npm test for calculation/collector changes. UI changes must pass the repository's desktop/mobile CI tests. Skip local browser installation in environments that do not support it; use the existing CI gate.
- Use a branch and PR for code publication. Preserve concurrent collector changes; source refactors must not rewrite dist/data. Merge and verify Pages when the user's request authorizes updating the site.
