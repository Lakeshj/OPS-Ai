
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { apiClient } from "@/lib/apiClient";

const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [isForgotLoading, setIsForgotLoading] = useState(false);
  const [forgotStep, setForgotStep] = useState<"request" | "verify" | "reset">(
    "request"
  );
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { signIn, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthLoading, isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await signIn(email, password);
    } catch (error) {
      console.error("Login error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPasswordRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsForgotLoading(true);

    try {
      const response = await apiClient.post<{ message: string }>(
        "/auth/forgot-password",
        { email: forgotEmail }
      );
      toast.success(response.message);
      setForgotStep("verify");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to submit request"
      );
    } finally {
      setIsForgotLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsForgotLoading(true);

    try {
      const response = await apiClient.post<{ message: string; resetToken: string }>(
        "/auth/verify-reset-otp",
        { email: forgotEmail, otp }
      );
      setResetToken(response.resetToken);
      setForgotStep("reset");
      toast.success(response.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid OTP");
    } finally {
      setIsForgotLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setIsForgotLoading(true);

    try {
      const response = await apiClient.post<{ message: string }>("/auth/reset-password", {
        resetToken,
        newPassword,
        confirmPassword,
      });
      toast.success(response.message);
      setIsForgotOpen(false);
      setForgotStep("request");
      setForgotEmail("");
      setOtp("");
      setResetToken("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset password");
    } finally {
      setIsForgotLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary">OpsAi</h1>
          <p className="text-muted-foreground mt-2">Sign in to your account</p>
        </div>

        <Card className="border-border/40 shadow-lg">
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
            <CardDescription>
              Enter your credentials to access your account
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => {
                      setForgotEmail(email);
                      setIsForgotOpen(true);
                      setForgotStep("request");
                      setOtp("");
                      setResetToken("");
                      setNewPassword("");
                      setConfirmPassword("");
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </CardContent>

            <CardFooter>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <div className="flex items-center">
                    <div className="w-4 h-4 rounded-full border-2 border-b-transparent border-white animate-spin mr-2"></div>
                    Signing in...
                  </div>
                ) : (
                  "Sign In"
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <div className="mt-6 text-center text-sm">
          {process.env.NODE_ENV === "development" && (
            <>
              <p className="text-muted-foreground">Demo accounts:</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEmail("admin@example.com");
                    setPassword("password");
                    toast.info("Admin credentials filled");
                  }}
                >
                  Admin
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEmail("pm@example.com");
                    setPassword("password");
                    toast.info("Project Manager credentials filled");
                  }}
                >
                  Project Manager
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEmail("rohit@example.com");
                    setPassword("password");
                    toast.info("Employee credentials filled");
                  }}
                >
                  Employee
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={isForgotOpen} onOpenChange={setIsForgotOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forgot password</DialogTitle>
            <DialogDescription>
              {forgotStep === "request" &&
                "Enter your email to receive a one-time OTP for password reset."}
              {forgotStep === "verify" &&
                "Enter the OTP sent to your email."}
              {forgotStep === "reset" &&
                "Set your new password."}
            </DialogDescription>
          </DialogHeader>
          {forgotStep === "request" && (
            <form onSubmit={handleForgotPasswordRequest}>
              <div className="space-y-2 py-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="name@example.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                />
              </div>
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setIsForgotOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isForgotLoading}>
                  {isForgotLoading ? "Sending OTP..." : "Send OTP"}
                </Button>
              </DialogFooter>
            </form>
          )}

          {forgotStep === "verify" && (
            <form onSubmit={handleVerifyOtp}>
              <div className="space-y-2 py-2">
                <Label htmlFor="otp">OTP</Label>
                <Input
                  id="otp"
                  type="text"
                  placeholder="Enter 6-digit OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  required
                />
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setForgotStep("request")}
                >
                  Back
                </Button>
                <Button type="submit" disabled={isForgotLoading}>
                  {isForgotLoading ? "Verifying..." : "Verify OTP"}
                </Button>
              </DialogFooter>
            </form>
          )}

          {forgotStep === "reset" && (
            <form onSubmit={handleResetPassword}>
              <div className="space-y-2 py-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2 py-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setForgotStep("verify")}
                >
                  Back
                </Button>
                <Button type="submit" disabled={isForgotLoading}>
                  {isForgotLoading ? "Resetting..." : "Set Password"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LoginPage;
