import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  createCursorAgentClient,
  type CursorAgentClient,
} from "./cursor-agent-api";
import {
  THERMO_REVIEW_MARKER,
  buildAutopilotFollowUpPrompt,
  hasCheckedAutopilotTask,
  hasOpenAutopilotTask,
  hasRunningAutopilotTask,
  markAutopilotRunning,
  parseAgentId,
} from "./cursor-thermo-nuclear-output";
import {
  createGitHubReviewClient,
  type GitHubReviewClient,
} from "./github-review-api";

const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

export type IssueCommentAutopilotEvent = {
  action?: string;
  sender?: { login?: string; type?: string };
  comment?: { id?: number; body?: string };
  changes?: { body?: { from?: string } };
  issue?: { number?: number; pull_request?: unknown };
  repository?: { full_name?: string; html_url?: string };
};

export type AutopilotStart = {
  start: true;
  agentId: string;
  commentId: number;
  body: string;
  sender: string;
  prNumber: number;
  repository: string;
  prUrl: string;
};

export type AutopilotSkip = { start: false; reason: string };

export function inspectAutopilotEvent(
  event: IssueCommentAutopilotEvent,
): AutopilotStart | AutopilotSkip {
  if (event.action !== "edited") {
    return { start: false, reason: "not a comment edit" };
  }
  if (!event.issue?.pull_request) {
    return { start: false, reason: "not a pull request comment" };
  }
  const body = event.comment?.body ?? "";
  if (!body.includes(THERMO_REVIEW_MARKER)) {
    return { start: false, reason: "not the thermo-nuclear review comment" };
  }
  if (hasRunningAutopilotTask(body)) {
    return { start: false, reason: "Autopilot already running" };
  }
  if (!hasCheckedAutopilotTask(body)) {
    return { start: false, reason: "Autopilot is not checked" };
  }
  const previous = event.changes?.body?.from ?? "";
  if (!hasOpenAutopilotTask(previous) || hasCheckedAutopilotTask(previous)) {
    return { start: false, reason: "Autopilot was not newly checked" };
  }
  const agentId = parseAgentId(body);
  if (!agentId) {
    return { start: false, reason: "review comment is missing the agent id" };
  }
  const commentId = event.comment?.id;
  const sender = event.sender?.login?.trim();
  const prNumber = event.issue.number;
  const repository = event.repository?.full_name;
  if (
    event.sender?.type &&
    event.sender.type !== "User"
  ) {
    return { start: false, reason: "sender is not a user" };
  }
  if (
    !commentId ||
    !sender ||
    !prNumber ||
    !repository ||
    !Number.isInteger(prNumber)
  ) {
    return { start: false, reason: "comment event is missing fields" };
  }
  const repoUrl =
    event.repository?.html_url ?? `https://github.com/${repository}`;
  return {
    start: true,
    agentId,
    commentId,
    body,
    sender,
    prNumber,
    repository,
    prUrl: `${repoUrl}/pull/${prNumber}`,
  };
}

export async function runAutopilot({
  event,
  cursor,
  github,
}: {
  event: IssueCommentAutopilotEvent;
  cursor: CursorAgentClient;
  github: GitHubReviewClient;
}): Promise<{ sent: boolean; reason?: string }> {
  const inspected = inspectAutopilotEvent(event);
  if (!inspected.start) {
    return { sent: false, reason: inspected.reason };
  }

  const permission = await github.getCollaboratorPermission(inspected.sender);
  if (!WRITE_PERMISSIONS.has(permission)) {
    return {
      sent: false,
      reason: `${inspected.sender} cannot write to ${inspected.repository}`,
    };
  }

  const agent = await cursor.getAgent(inspected.agentId).catch((error) => {
    throw new Error(
      `Could not load review agent: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (agent.status === "ARCHIVED") {
    return { sent: false, reason: "review agent has expired" };
  }

  try {
    await cursor.createRun(inspected.agentId, {
      prompt: { text: buildAutopilotFollowUpPrompt(inspected.prUrl) },
      mode: "agent",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { sent: false, reason };
  }

  await github
    .patchComment(inspected.commentId, markAutopilotRunning(inspected.body))
    .catch((commentError) => {
      console.error("Failed to mark Autopilot running:", commentError);
    });

  return { sent: true };
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readEvent(): IssueCommentAutopilotEvent {
  const path = requireEnv("GITHUB_EVENT_PATH");
  return JSON.parse(readFileSync(path, "utf8")) as IssueCommentAutopilotEvent;
}

async function main() {
  const event = readEvent();
  const inspected = inspectAutopilotEvent(event);
  const repository =
    inspected.start
      ? inspected.repository
      : requireEnv("GITHUB_REPOSITORY");
  const prNumber = inspected.start
    ? inspected.prNumber
    : Number.parseInt(process.env.PR_NUMBER ?? "0", 10);

  const github = createGitHubReviewClient({
    token: requireEnv("CURSOR_VALIDATION_STATUS_TOKEN"),
    repository,
    prNumber: Number.isInteger(prNumber) && prNumber > 0 ? prNumber : 1,
    marker: THERMO_REVIEW_MARKER,
    commentAuthor: process.env.PUBLISHER_BOT_LOGIN,
  });

  const outcome = await runAutopilot({
    event,
    cursor: createCursorAgentClient({
      apiKey: requireEnv("CURSOR_API_KEY"),
    }),
    github,
  });

  if (!outcome.sent) {
    console.log(outcome.reason ?? "Autopilot skipped");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
