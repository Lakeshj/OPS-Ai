import {
  userApiService,
  workspaceApiService,
  folderApiService,
  chatThreadApiService,
  chatMessageApiService,
  keywordAssistantApiService,
  analyticsApiService,
} from "@/modules";

export const userService = userApiService;
export const projectService = workspaceApiService;
export const folderService = folderApiService;
export const chatThreadService = chatThreadApiService;
export const chatMessageService = chatMessageApiService;
export const keywordAssistantService = keywordAssistantApiService;
export const analyticsService = analyticsApiService;
