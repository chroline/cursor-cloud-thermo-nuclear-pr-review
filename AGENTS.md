# Cursor Cloud Thermo-Nuclear PR Review

Spawns Cursor Cloud Agents to run thermo-nuclear review on pull requests.
Callers pin `.github/workflows/cursor-cloud-thermo-nuclear-pr-review.yml` to a full
commit SHA.

## Verification

```bash
cd .github/actions/launch-cursor-thermo-nuclear
npm ci
npm test
```
