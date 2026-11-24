# Issue tracker: GitHub

Issues and specs live on `Skalahq/draw`. Use `gh` from this repo; verify the target with `gh repo view --json nameWithOwner` before filing.

- Publish: `gh issue create --title "..." --body "..."`.
- Fetch: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open` with relevant label filters.
- Comment, label, and close: `gh issue comment`, `gh issue edit`, and `gh issue close`. Post the reason before closing.
- Use GitHub sub-issues for parent/child relationships and native issue dependencies for blockers. An issue is unblocked when all blockers are closed.

**PRs as a request surface: no.**

For `/wayfinder`, use a `wayfinder:map` issue with sub-issues labeled `wayfinder:<type>`. The frontier is the first open, unassigned child with no open blockers. Claim by assigning yourself; resolve with a comment, close the child, and link the decision from the map.
