import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(
  new URL("../../workflows/cursor-cloud-thermo-nuclear-pr-review.yml", import.meta.url),
  "utf8",
);

const ACTION_PIN =
  "chroline/cursor-cloud-thermo-nuclear-pr-review/.github/actions/launch-cursor-thermo-nuclear@e9380c0d67ee55dbf53b8d7e1b2f3fa7212bd8bf";

describe("shared Cursor Cloud thermo-nuclear PR review workflow", () => {
  it("is a reusable workflow with publisher secrets and no secret inheritance", () => {
    assert.match(workflow, /^name: Cursor Cloud Thermo-Nuclear PR Review$/m);
    assert.match(workflow, /^on:\n  workflow_call:/m);
    assert.match(
      workflow,
      /cursor_api_key:\n        description: Cursor API key with access to the caller repository\n        required: true/,
    );
    assert.match(
      workflow,
      /publisher_client_id:\n        description: Client ID for the repository-scoped publisher GitHub App\n        required: true/,
    );
    assert.doesNotMatch(workflow, /secrets:\s*inherit/);
    assert.doesNotMatch(workflow, /^concurrency:/m);
  });

  it("owns draft and fork eligibility instead of the consumer caller", () => {
    assert.match(
      workflow,
      /github\.event\.pull_request\.draft == false &&\n      github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
    );
  });

  it("mints a publisher App token and never gives Cursor the private key", () => {
    assert.match(
      workflow,
      /actions\/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1/,
    );
    assert.match(workflow, /skip-token-revoke: true/);
    const launchBlock = workflow.slice(
      workflow.indexOf("name: Spawn thermo-nuclear Cloud Agent"),
    );
    assert.doesNotMatch(launchBlock, /publisher_private_key|PUBLISHER_PRIVATE_KEY/);
    assert.match(launchBlock, /CURSOR_VALIDATION_STATUS_TOKEN: \$\{\{ steps\.publisher\.outputs\.token \}\}/);
    assert.match(launchBlock, /PUBLISHER_BOT_LOGIN:/);
  });

  it("loads the launcher action from this public repo, not the caller checkout", () => {
    assert.match(workflow, new RegExp(ACTION_PIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(workflow, /uses: \.\/\.github\/actions\/launch-cursor-thermo-nuclear/);
  });

  it("keeps legacy environment inputs available to older launchers", () => {
    assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(
      workflow,
      /PR_HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/,
    );
    assert.match(
      workflow,
      /PR_TITLE: \$\{\{ github\.event\.pull_request\.title \}\}/,
    );
  });
});
