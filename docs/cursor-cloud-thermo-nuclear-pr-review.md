# Cursor Cloud Thermo-Nuclear PR Review

Spawns Cursor Cloud Agents to run thermo-nuclear review on pull requests.
Callers pin `.github/workflows/cursor-cloud-thermo-nuclear-pr-review.yml` at a full
40-character commit SHA. Do not use a branch or tag pin.

This repository is public so any GitHub repo can call the reusable workflow.
Secrets stay on the caller.

`review_forks` input (ENG-1204) is documented below.
