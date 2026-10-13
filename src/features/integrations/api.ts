import { call } from "@/lib/tauri-client";
import type {
  CreateMergeRequestParams,
  GitLabEvent,
  GitLabProject,
  GitLabUser,
  MergeRequestInfo,
} from "./types";

export const gitlabGetProject = (baseUrl: string, token: string, projectPath: string) =>
  call<GitLabProject>("gitlab_get_project", { baseUrl, token, projectPath });

export const gitlabListOpenMergeRequests = (baseUrl: string, token: string, projectPath: string) =>
  call<MergeRequestInfo[]>("gitlab_list_open_merge_requests", { baseUrl, token, projectPath });

export const gitlabCreateMergeRequest = (
  baseUrl: string,
  token: string,
  projectPath: string,
  params: CreateMergeRequestParams,
) =>
  call<MergeRequestInfo>("gitlab_create_merge_request", {
    baseUrl,
    token,
    projectPath,
    sourceBranch: params.sourceBranch,
    targetBranch: params.targetBranch,
    title: params.title,
    description: params.description,
    assigneeId: params.assigneeId,
    reviewerIds: params.reviewerIds,
    removeSourceBranch: params.removeSourceBranch,
    squash: params.squash,
  });

export const gitlabSearchMembers = (baseUrl: string, token: string, projectPath: string) =>
  call<GitLabUser[]>("gitlab_search_members", { baseUrl, token, projectPath });

export const gitlabListProjectEvents = (baseUrl: string, token: string, projectPath: string) =>
  call<GitLabEvent[]>("gitlab_list_project_events", { baseUrl, token, projectPath });
