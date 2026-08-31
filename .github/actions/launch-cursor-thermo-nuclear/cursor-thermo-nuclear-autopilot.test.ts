import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTOPILOT_BADGE_IMAGE,
  applyAgentMarker,
  autopilotTaskLine,
  hasCheckedAutopilotTask,
  hasOpenAutopilotTask,
  hasRunningAutopilotTask,
  markAutopilotRunning,
  parseAgentId,
} from "./cursor-thermo-nuclear-output";
import {
  inspectAutopilotEvent,
  runAutopilot,
} from "./cursor-thermo-nuclear-autopilot";
import type { CursorAgentClient } from "./cursor-agent-api";
import type { GitHubReviewClient } from "./github-review-api";

const openTask = autopilotTaskLine("open");
const reviewBody = `<!-- cursor-thermo-nuclear-review -->
<!-- cursor-thermo-nuclear-agent:bc-agent-1 -->
## Thermo-Nuclear Review

**REQUEST_CHANGES** for commit \`abc1234\`.

### Findings

- [ ] **High** src/a.ts:1 — fix me.

${openTask}
`;

const checkedBody = reviewBody.replace(openTask, openTask.replace("[ ]", "[x]"));

function baseEvent(
  overrides: Record<string, unknown> = {},
): Parameters<typeof inspectAutopilotEvent>[0] {
  return {
    action: "edited",
    sender: { login: "chroline", type: "User" },
    comment: { id: 88, body: checkedBody },
    changes: { body: { from: reviewBody } },
    issue: { number: 42, pull_request: { url: "https://api.github.com" } },
    repository: {
      full_name: "example/app",
      html_url: "https://github.com/example/app",
    },
    ...overrides,
  };
}

describe("inspectAutopilotEvent", () => {
  it("starts when a collaborator checks the Autopilot badge task", () => {
    const inspected = inspectAutopilotEvent(baseEvent());
    assert.deepEqual(inspected, {
      start: true,
      agentId: "bc-agent-1",
      commentId: 88,
      body: checkedBody,
      sender: "chroline",
      prNumber: 42,
      repository: "example/app",
      prUrl: "https://github.com/example/app/pull/42",
    });
  });

  it("ignores Autopilot that is already running", () => {
    const body = markAutopilotRunning(checkedBody);
    const inspected = inspectAutopilotEvent(
      baseEvent({
        comment: { id: 88, body },
        changes: { body: { from: checkedBody } },
      }),
    );
    assert.deepEqual(inspected, {
      start: false,
      reason: "Autopilot already running",
    });
  });

  it("ignores edits that did not newly check Autopilot", () => {
    const inspected = inspectAutopilotEvent(
      baseEvent({ changes: { body: { from: checkedBody } } }),
    );
    assert.equal(inspected.start, false);
  });
});

describe("runAutopilot", () => {
  it("sends a follow-up run and marks Autopilot running", async () => {
    const cursor = createFakeCursor();
    const github = createFakeGitHub();
    const outcome = await runAutopilot({
      event: baseEvent(),
      cursor,
      github,
    });

    assert.deepEqual(outcome, { sent: true });
    assert.equal(cursor.createRunCalls.length, 1);
    assert.equal(cursor.createRunCalls[0]?.agentId, "bc-agent-1");
    assert.equal(cursor.createRunCalls[0]?.request.mode, "agent");
    assert.match(
      cursor.createRunCalls[0]?.request.prompt.text ?? "",
      /review-only constraint from the first run is lifted/,
    );
    assert.match(github.patched[0] ?? "", /running/);
    assert.equal(hasRunningAutopilotTask(github.patched[0] ?? ""), true);
  });

  it("refuses senders without write permission", async () => {
    const outcome = await runAutopilot({
      event: baseEvent(),
      cursor: createFakeCursor(),
      github: createFakeGitHub({ permission: "read" }),
    });
    assert.deepEqual(outcome, {
      sent: false,
      reason: "chroline cannot write to example/app",
    });
  });

  it("refuses archived agents", async () => {
    const outcome = await runAutopilot({
      event: baseEvent(),
      cursor: createFakeCursor("ARCHIVED"),
      github: createFakeGitHub(),
    });
    assert.deepEqual(outcome, {
      sent: false,
      reason: "review agent has expired",
    });
  });
});

describe("Autopilot comment helpers", () => {
  it("stores and round-trips the agent id", () => {
    const body = applyAgentMarker(
      "<!-- cursor-thermo-nuclear-review -->\n## Thermo-Nuclear Review",
      "bc-agent-1",
    );
    assert.equal(parseAgentId(body), "bc-agent-1");
    assert.equal(
      parseAgentId(applyAgentMarker(body, "bc-agent-2")),
      "bc-agent-2",
    );
  });

  it("treats the shields.io Autopilot badge as the task label", () => {
    assert.equal(hasOpenAutopilotTask(openTask), true);
    assert.equal(hasCheckedAutopilotTask(openTask), false);
    assert.match(openTask, /!\[Autopilot\]/);
    assert.match(openTask, new RegExp(AUTOPILOT_BADGE_IMAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

function createFakeCursor(status: "IDLE" | "ACTIVE" | "ARCHIVED" = "IDLE") {
  const createRunCalls: Array<{
    agentId: string;
    request: Parameters<CursorAgentClient["createRun"]>[1];
  }> = [];
  const client: CursorAgentClient & { createRunCalls: typeof createRunCalls } =
    {
      createRunCalls,
      async createAgent() {
        throw new Error("unused");
      },
      async getAgent(id) {
        return { id, status };
      },
      async createRun(agentId, request) {
        createRunCalls.push({ agentId, request });
        return {
          run: { id: "run-2", agentId, status: "CREATING" },
        };
      },
    };
  return client;
}

function createFakeGitHub({
  permission = "write",
}: {
  permission?: "admin" | "maintain" | "write" | "triage" | "read" | "none";
} = {}) {
  const patched: string[] = [];
  const client: GitHubReviewClient & { patched: string[] } = {
    patched,
    async ensureComment() {},
    async upsertComment() {},
    async updateMarkedComment() {
      return false;
    },
    async patchComment(_id, body) {
      patched.push(body);
    },
    async getCollaboratorPermission() {
      return permission;
    },
    async createCommitStatus() {},
  };
  return client;
}
