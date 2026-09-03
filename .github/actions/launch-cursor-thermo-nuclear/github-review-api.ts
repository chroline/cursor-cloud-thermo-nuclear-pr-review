import { parseJsonResponse } from "./cursor-agent-api";

type GitHubIssueComment = {
  id: number;
  body?: string;
  user?: { login?: string };
};

export type EnsuredComment = {
  id: number;
};

function isMarkedComment(
  comment: GitHubIssueComment,
  marker: string,
  authorLogin?: string,
) {
  if (!comment.body?.includes(marker)) return false;
  if (!authorLogin) return true;
  return comment.user?.login === authorLogin;
}

async function findMarkedCommentsAcrossPages(
  listCommentsPage: (page: number) => Promise<GitHubIssueComment[]>,
  marker: string,
  authorLogin?: string,
): Promise<GitHubIssueComment[]> {
  const found: GitHubIssueComment[] = [];
  let page = 1;

  while (true) {
    const comments = await listCommentsPage(page);
    found.push(
      ...comments.filter((comment) =>
        isMarkedComment(comment, marker, authorLogin),
      ),
    );

    if (comments.length < 100) {
      return found;
    }

    page += 1;
  }
}

async function findMarkedCommentAcrossPages(
  listCommentsPage: (page: number) => Promise<GitHubIssueComment[]>,
  marker: string,
  authorLogin?: string,
): Promise<GitHubIssueComment | undefined> {
  const comments = await findMarkedCommentsAcrossPages(
    listCommentsPage,
    marker,
    authorLogin,
  );
  return [...comments].sort((left, right) => left.id - right.id)[0];
}

async function upsertMarkedPrComment({
  body,
  marker,
  authorLogin,
  listCommentsPage,
  patchComment,
  postComment,
}: {
  body: string;
  marker: string;
  authorLogin?: string;
  listCommentsPage: (page: number) => Promise<GitHubIssueComment[]>;
  patchComment: (commentId: number, body: string) => Promise<void>;
  postComment: (body: string) => Promise<GitHubIssueComment>;
}): Promise<"patched" | "posted"> {
  const existingComment = await findMarkedCommentAcrossPages(
    listCommentsPage,
    marker,
    authorLogin,
  );

  if (existingComment) {
    await patchComment(existingComment.id, body);
    return "patched";
  }

  await postComment(body);
  return "posted";
}

async function upsertWithRetry<T>(
  operation: () => Promise<T>,
  {
    retries = 1,
    delayMs = 1000,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: {
    retries?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

export type GitHubReviewClient = {
  ensureComment(body: string): Promise<EnsuredComment>;
  upsertComment(body: string): Promise<void>;
  createCommitStatus(input: {
    sha: string;
    state: "pending" | "success" | "failure" | "error";
    targetUrl: string;
    description: string;
    context: string;
  }): Promise<void>;
};

export function createGitHubReviewClient({
  token,
  repository,
  prNumber,
  marker,
  commentAuthor,
  fetchImpl = fetch,
}: {
  token: string;
  repository: string;
  prNumber: number;
  marker: string;
  commentAuthor?: string;
  fetchImpl?: typeof fetch;
}): GitHubReviewClient {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY value: ${repository}`);
  }

  async function request<T>(
    pathname: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetchImpl(`https://api.github.com${pathname}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
    });
    return parseJsonResponse<T>(response, `GitHub API ${pathname}`);
  }

  const listCommentsPage = (page: number) =>
    request<GitHubIssueComment[]>(
      `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
    );
  const postComment = (body: string) =>
    request<GitHubIssueComment>(
      `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      },
    );
  const deleteComment = async (commentId: number) => {
    try {
      await request(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (String(error).includes("404")) return;
      throw error;
    }
  };

  return {
    async ensureComment(body) {
      return upsertWithRetry(
        async () => {
          const existing = await findMarkedCommentsAcrossPages(
            listCommentsPage,
            marker,
            commentAuthor,
          );
          if (existing.length === 0) {
            await postComment(body);
          }

          const pinned = [
            ...(await findMarkedCommentsAcrossPages(
              listCommentsPage,
              marker,
              commentAuthor,
            )),
          ].sort((left, right) => left.id - right.id);
          const keep = pinned[0];
          if (!keep) {
            throw new Error("Failed to pin thermo-nuclear review comment");
          }

          await Promise.all(
            pinned.slice(1).map((comment) => deleteComment(comment.id)),
          );
          return { id: keep.id };
        },
        { retries: 1, delayMs: 1_000 },
      );
    },
    async upsertComment(body) {
      await upsertWithRetry(
        () =>
          upsertMarkedPrComment({
            body,
            marker,
            authorLogin: commentAuthor,
            listCommentsPage,
            patchComment: (commentId, commentBody) =>
              request(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
                method: "PATCH",
                body: JSON.stringify({ body: commentBody }),
              }).then(() => undefined),
            postComment,
          }).then(() => undefined),
        { retries: 1, delayMs: 1_000 },
      );
    },
    async createCommitStatus(input) {
      await request(`/repos/${owner}/${repo}/statuses/${input.sha}`, {
        method: "POST",
        body: JSON.stringify({
          state: input.state,
          target_url: input.targetUrl,
          description: input.description,
          context: input.context,
        }),
      });
    },
  };
}
