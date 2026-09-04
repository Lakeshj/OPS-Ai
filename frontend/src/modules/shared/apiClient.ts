import { isAccessTokenExpired } from "@/modules/auth/token";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = RequestInit & {
  skipUnauthorizedHandler?: boolean;
};

class ApiClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  private getAuthToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("token");
  }

  private clearExpiredToken(skipUnauthorizedHandler?: boolean) {
    const token = this.getAuthToken();
    if (!token || !isAccessTokenExpired(token)) return token;

    localStorage.removeItem("token");
    localStorage.removeItem("user");
    if (unauthorizedHandler && !skipUnauthorizedHandler) {
      unauthorizedHandler();
    }
    return null;
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const { skipUnauthorizedHandler, ...fetchOptions } = options;

    const token = this.clearExpiredToken(skipUnauthorizedHandler);
    const isFormData =
      typeof FormData !== "undefined" && fetchOptions.body instanceof FormData;
    const headers: Record<string, string> = {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(fetchOptions.headers as Record<string, string>),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const message =
          (typeof errorData?.error === "string"
            ? errorData.error
            : errorData?.error?.message) ||
          `API Error: ${response.status} ${response.statusText}`;
        const code =
          typeof errorData?.code === "string" ? errorData.code : undefined;

        if (
          response.status === 401 &&
          token &&
          unauthorizedHandler &&
          !skipUnauthorizedHandler
        ) {
          unauthorizedHandler();
        }

        throw new ApiError(message, response.status, code);
      }

      // 204 No Content and other empty bodies must not call response.json().
      if (response.status === 204 || response.status === 205) {
        return undefined as T;
      }

      const raw = await response.text();
      if (!raw) {
        return undefined as T;
      }

      try {
        return JSON.parse(raw) as T;
      } catch {
        throw new ApiError(
          "Server returned an invalid JSON response",
          response.status,
          "INVALID_JSON"
        );
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      const message =
        error instanceof TypeError
          ? "Unable to reach the server. Check that the API is running."
          : error instanceof Error
            ? error.message
            : "Request failed";

      console.error(`API request failed: ${endpoint}`, error);
      throw new ApiError(message, 0, "NETWORK_ERROR");
    }
  }

  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "GET" });
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async postForm<T>(endpoint: string, data: FormData): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data,
    });
  }

  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
