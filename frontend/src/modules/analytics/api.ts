import { apiClient } from "@/modules/shared/apiClient";

export interface AnalyticsOverview {
  totalUsers: number;
  totalWorkspaces: number;
  totalThreads: number;
  totalMessages: number;
}

export interface AnalyticsDashboardStats extends AnalyticsOverview {
  activeUsers: number;
  recentActivity: Array<{
    id: string;
    type:
      | "user_created"
      | "workspace_created"
      | "thread_created"
      | "message_sent";
    description: string;
    timestamp: string;
    user?: string;
  }>;
  userGrowth: Array<{ month: string; users: number }>;
  workspaceActivity: Array<{
    name: string;
    threads: number;
    messages: number;
  }>;
}

type AnalyticsChartData =
  | AnalyticsDashboardStats["userGrowth"]
  | AnalyticsDashboardStats["workspaceActivity"];

export const analyticsApiService = {
  getOverview: async (): Promise<AnalyticsOverview> => {
    return apiClient.get<AnalyticsOverview>("/analytics/overview");
  },

  getChartData: async (type: string): Promise<AnalyticsChartData> => {
    return apiClient.get<AnalyticsChartData>(`/analytics/charts/${type}`);
  },

  getDashboardStats: async (): Promise<AnalyticsDashboardStats> => {
    return apiClient.get<AnalyticsDashboardStats>("/analytics/dashboard-stats");
  },
};
