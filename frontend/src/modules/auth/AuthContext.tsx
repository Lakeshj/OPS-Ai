"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { User, UserRole } from "@/modules/shared/types";
import { toast } from "sonner";
import {
  apiClient,
  setUnauthorizedHandler,
} from "@/modules/shared/apiClient";
import { isAccessTokenExpired } from "@/modules/auth/token";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  isAuthenticated: boolean;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
}

interface AuthResponse {
  token: string;
  user: User;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const clearStoredSession = () => {
  localStorage.removeItem("user");
  localStorage.removeItem("token");
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const clearSession = () => {
      clearStoredSession();
      setUser(null);
    };

    const initAuth = async () => {
      const token = localStorage.getItem("token");

      if (!token) {
        clearSession();
        setIsLoading(false);
        return;
      }

      // Client-side expiry — do not keep a stale "logged in" UI after 12h.
      if (isAccessTokenExpired(token)) {
        clearSession();
        setIsLoading(false);
        return;
      }

      try {
        const currentUser = await apiClient.get<User>("/auth/me", {
          skipUnauthorizedHandler: true,
        });
        setUser(currentUser);
        localStorage.setItem("user", JSON.stringify(currentUser));
      } catch {
        // Expired/invalid token, 401, or API unreachable on boot → require login.
        // Do not restore cached user (that caused "auto login" while the API was down).
        clearSession();
      } finally {
        setIsLoading(false);
      }
    };

    void initAuth();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      clearStoredSession();
      router.replace("/");
      toast.info("Session expired. Please sign in again.");
    });

    return () => setUnauthorizedHandler(null);
  }, [router]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      setIsLoading(true);

      const data = await apiClient.post<AuthResponse>("/auth/login", {
        email,
        password,
      });

      setUser(data.user);
      localStorage.setItem("user", JSON.stringify(data.user));
      localStorage.setItem("token", data.token);

      router.push("/dashboard");
      toast.success(`Welcome back, ${data.user.name}!`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to sign in");
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  const signOut = useCallback(() => {
    setUser(null);
    clearStoredSession();
    router.push("/");
    toast.info("You have been signed out");
  }, [router]);

  const hasRole = useCallback((roles: UserRole | UserRole[]): boolean => {
    if (!user) return false;
    if (Array.isArray(roles)) return roles.includes(user.role);
    return user.role === roles;
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      signIn,
      signOut,
      isAuthenticated: !!user,
      hasRole,
    }),
    [user, isLoading, signIn, signOut, hasRole]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
