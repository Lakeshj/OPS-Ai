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

/** Max wait for Google consent + callback postMessage (avoids endless Connecting…). */
const OAUTH_POPUP_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Opens the Google account chooser popup and waits for the OpsAi OAuth callback.
 */
export async function startGoogleOAuthPopup(
  args: StartGoogleOAuthPopupArgs
): Promise<StartGoogleOAuthPopupResult> {
  const started = await workflowCredentialsApi.startGoogleOAuth(args);
  const { url, callbackOrigin } = started;
  const redirectUri =
    typeof (started as { redirectUri?: string }).redirectUri === "string"
      ? String((started as { redirectUri?: string }).redirectUri)
      : "";

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
    const finish = (result: StartGoogleOAuthPopupResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMsg);
      window.clearInterval(closeTimer);
      window.clearTimeout(timeoutTimer);
      try {
        popup.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const onMsg = (event: MessageEvent) => {
      // Prefer exact popup source; if Google COOP broke source identity, still
      // accept a well-formed message from an allowlisted callback/editor origin.
      let result = acceptGoogleOAuthPostMessage(event, {
        allowedOrigins,
        expectedSource: popup,
      });
      if (!result.handled && result.reason === "source") {
        result = acceptGoogleOAuthPostMessage(event, {
          allowedOrigins,
        });
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

    window.addEventListener("message", onMsg);
    const closeTimer = window.setInterval(() => {
      if (!popup.closed) return;
      // Popup closed without a message — often redirect_uri mismatch (Google
      // error page) or opener lost after consent. Surface an actionable error.
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
