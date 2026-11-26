import {
  acceptGoogleOAuthPostMessage,
  resolveOAuthMessageAllowedOrigins,
} from "@/modules/workflows/googleOAuthMessage";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import type { WorkflowCredentialType } from "@/modules/workflows/types";

type StartGoogleOAuthPopupArgs = {
  workspaceId: string;
  workflowId?: string;
  product: WorkflowCredentialType;
  name?: string;
  credentialId?: string;
  gmailPermissions?: string[];
};

type StartGoogleOAuthPopupResult =
  | { ok: true; credentialId: string }
  | { ok: false; error: string; popupBlocked?: boolean };

const OAUTH_POPUP_TIMEOUT_MS = 3 * 60 * 1000;

const safePopupClosed = (popup: Window | null): boolean => {
  if (!popup) return true;
  try {
    return Boolean(popup.closed);
  } catch {
    return false;
  }
};

/**
 * Opens the Google account chooser popup and waits for callback postMessage
 * or authenticated attempt-status polling (COOP-safe).
 */
export async function startGoogleOAuthPopup(
  args: StartGoogleOAuthPopupArgs
): Promise<StartGoogleOAuthPopupResult> {
  const started = await workflowCredentialsApi.startGoogleOAuth(args);
  const { url, callbackOrigin, attemptId } = started;
  const redirectUri =
    typeof started.redirectUri === "string" ? started.redirectUri : "";

  const popup = window.open(
    url,
    "opsai-google-oauth",
    "width=520,height=720"
  );
  if (!popup) {
    return {
      ok: false,
      error:
        "Google sign-in popup was blocked. Allow popups for this site, then try again.",
      popupBlocked: true,
    };
  }

  const allowedOrigins = resolveOAuthMessageAllowedOrigins({
    editorOrigin: window.location.origin,
    callbackOrigin,
  });

  return await new Promise<StartGoogleOAuthPopupResult>((resolve) => {
    let settled = false;
    let closedSeenAt = 0;
    const finish = (result: StartGoogleOAuthPopupResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMsg);
      window.clearInterval(closeTimer);
      window.clearInterval(pollTimer);
      window.clearTimeout(timeoutTimer);
      try {
        popup.close();
      } catch {
        // ignore — COOP may block close()
      }
      resolve(result);
    };

    const onMsg = (event: MessageEvent) => {
      let result = acceptGoogleOAuthPostMessage(event, {
        allowedOrigins,
        expectedSource: popup,
      });
      if (!result.handled && result.reason === "source") {
        result = acceptGoogleOAuthPostMessage(event, { allowedOrigins });
      }
      if (!result.handled) return;
      if (result.accepted) {
        finish({ ok: true, credentialId: result.credentialId });
      } else {
        finish({
          ok: false,
          error:
            result.error ||
            "Google connect failed. Check consent settings, then try again.",
        });
      }
    };

    const pollAttempt = async () => {
      if (!attemptId || settled) return;
      try {
        const status = await workflowCredentialsApi.getGoogleOAuthStatus({
          workspaceId: args.workspaceId,
          attemptId,
        });
        if (status.status === "succeeded" && status.credentialId) {
          finish({ ok: true, credentialId: status.credentialId });
          return;
        }
        if (status.status === "failed") {
          finish({
            ok: false,
            error:
              status.error ||
              "Google connect failed. Check consent settings, then try again.",
          });
        }
      } catch {
        // Keep waiting — transient poll errors must not fail the connect.
      }
    };

    window.addEventListener("message", onMsg);
    const closeTimer = window.setInterval(() => {
      if (!safePopupClosed(popup)) return;
      if (!closedSeenAt) closedSeenAt = Date.now();
      // Give the callback a few seconds after close (COOP often closes first).
      if (Date.now() - closedSeenAt < 4000) return;
      const redirectHint = redirectUri
        ? ` Confirm this exact redirect URI is registered on your Google Cloud OAuth client: ${redirectUri}`
        : " Confirm the OAuth redirect URI shown in the connection modal is registered on your Google Cloud OAuth client.";
      finish({
        ok: false,
        error:
          "Google window closed before OpsAi received the connection callback." +
          redirectHint,
      });
    }, 500);

    const pollTimer = window.setInterval(() => {
      void pollAttempt();
    }, 1000);
    void pollAttempt();

    const timeoutTimer = window.setTimeout(() => {
      finish({
        ok: false,
        error:
          "Google sign-in timed out. If the popup showed a Google error, fix the redirect URI or Client ID/Secret, then click Try again." +
          (redirectUri ? ` Expected redirect: ${redirectUri}` : ""),
      });
    }, OAUTH_POPUP_TIMEOUT_MS);
  });
}
