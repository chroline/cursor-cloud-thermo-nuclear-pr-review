# Cursor Cloud Thermo-Nuclear PR Review

Spawns Cursor Cloud Agents to run thermo-nuclear review on pull requests.
Callers pin `.github/workflows/cursor-cloud-thermo-nuclear-pr-review.yml` at a full
40-character commit SHA. Do not use a branch or tag pin.

This repository is public so any GitHub repo can call the reusable workflow.
Secrets stay on the caller.

## Consumer caller

```yaml
name: Cursor Cloud Thermo-Nuclear PR Review

on:
  pull_request_target:
    types: [opened, reopened, synchronize, ready_for_review]

permissions: {}

concurrency:
  group: cursor-cloud-thermo-nuclear-pr-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    name: Spawn Cloud Agent
    permissions:
      contents: read
    uses: chroline/cursor-cloud-thermo-nuclear-pr-review/.github/workflows/cursor-cloud-thermo-nuclear-pr-review.yml@<FULL_40_CHARACTER_REVIEWED_COMMIT_SHA>
    with:
      review_forks: true
    secrets:
      cursor_api_key: ${{ secrets.CURSOR_API_KEY }}
      publisher_client_id: ${{ secrets.PUBLISHER_CLIENT_ID }}
      publisher_private_key: ${{ secrets.PUBLISHER_PRIVATE_KEY }}
```

`review_forks` defaults to `false` (same-repository branches only). Pass
`true` on public repos that accept fork PRs. Omit it on private callers.

Do not add `secrets: inherit`, local `steps`, `runs-on`, or eligibility `if:`
in the caller. Draft, fork, and same-repository checks live in the shared
workflow. Keep `concurrency` on the caller only — the same group on this
reusable workflow deadlocks the run. The spawn job must not check out
`pull_request.head`; it mints a token and launches with `PR_HEAD_SHA` only.

## Required secrets

- `CURSOR_API_KEY`: Cursor user or service-account API key with access to the
  caller repository.
- A repository-scoped publisher GitHub App client ID and private key. The
  launcher mints a one-hour installation token, skips revoke-on-job-end so the
  token survives after the launcher exits, and gives only that token to Cursor.
  The private key never enters the agent.

After the workflow has run once, require the `Thermo-Nuclear Review` commit
status in `main` branch protection. Do not require the short-lived
`Spawn Cloud Agent` Actions job as the merge gate.

The launcher pins one `<!-- cursor-thermo-nuclear-review -->` issue comment
per PR, passes that comment ID to the Cloud Agent, and deletes extra marked
publisher comments from earlier runs. The agent PATCHes that ID. It must not
POST another marked comment.

## Changing the review

Edit the launcher, skill, or reusable workflow in this repository, merge, then
bump the SHA pin in each caller.
