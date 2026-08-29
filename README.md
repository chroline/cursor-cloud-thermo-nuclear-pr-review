# Cursor Cloud Thermo-Nuclear PR Review

Spawns Cursor Cloud Agents to run thermo-nuclear review on pull requests.

Callers pin `.github/workflows/cursor-cloud-thermo-nuclear-pr-review.yml` at a full
commit SHA. This repository is public so GitHub Actions can load it from
public or private callers. Secrets stay on the caller.

## Development

```bash
cd .github/actions/launch-cursor-thermo-nuclear
npm ci
npm test
```
