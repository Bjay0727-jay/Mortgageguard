# Stacked PRs & Confirming the Deploy Reached Production

MortgageGuard is developed as a chain of **stacked PRs** — each prompt/feature
branches off the previous one. This is efficient, but it created a real
production incident worth documenting so it does not happen again.

---

## The incident: "merged, but production didn't include it"

**PR #54** was reviewed and merged — but its base was a **stack branch**, not
`main`. Merging it only updated the intermediate branch. Because production is
deployed exclusively from pushes to `main` (`.github/workflows/ci.yml`), the
change never reached production. The PR looked "done" (merged ✅) while the
running production Worker did not contain the code.

**Root cause:** a stacked PR was merged into its parent branch and never
re-merged (or retargeted) to `main`. "PR merged" ≠ "deployed to production"
when the PR's base is not `main`.

---

## The rule

**A change is only in production once it is merged into `main` and CI has
deployed that `main` commit.** Confirm all of the following after merging the
final PR in a stack:

1. **Final merge to `main`.** The last PR in the stack must have base `main` and
   be merged (GitHub auto-retargets a child PR to `main` when its parent merges —
   verify it actually retargeted, don't assume). Check the PR's *base* branch.
2. **The GitHub Actions run says `Branch: main`.** Open Actions → the `CI/CD`
   run for your merge and confirm it ran on `main` (not on a stack branch), and
   that `deploy-api` / `deploy-web` ran (they are gated on
   `github.ref == 'refs/heads/main' && push`).
3. **Cloudflare deployed the `main` run.** Confirm the deploy jobs succeeded
   (not skipped due to missing `CLOUDFLARE_API_TOKEN`). A skipped deploy means
   the code is on `main` but not live.
4. **Verify key files on the default branch.** Spot-check that the expected
   files/lines exist on `main` (e.g. `git show origin/main:<path>` or the GitHub
   file view on the `main` branch), not just on the feature branch.
5. **Smoke test production.** Run `docs/production-smoke-test.md` against the live
   URL to confirm the new behavior is actually serving.

---

## Practical checklist when finishing a stack

- [ ] Final PR base is `main` (verify retarget happened after parent merged)
- [ ] Final PR is **merged** into `main`
- [ ] Actions `CI/CD` run for the merge commit shows **Branch: main**
- [ ] `test` job green; `deploy-api` and `deploy-web` **ran and succeeded** (not skipped)
- [ ] `migrate` job ran if schema changed
- [ ] Key changed files confirmed present on `origin/main`
- [ ] Production smoke test passed

---

## Avoiding the trap

- Prefer retargeting each PR's base to `main` once its parent merges, and confirm
  the retarget on the PR page.
- Treat the **Cloudflare deploy job on a `main` run** — not the PR merge — as the
  definition of "shipped."
- When in doubt, `git log origin/main` and confirm the commit is there, then
  smoke test the live site.
