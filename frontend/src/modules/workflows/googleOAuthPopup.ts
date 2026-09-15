import {
  acceptGoogleOAuthPostMessage,
  resolveOAuthMessageAllowedOrigins,
} from "@/modules/workflows/googleOAuthMessage";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import type { WorkflowCredentialType } from "@/modules/workflows/types";

type StartGoogleOAuthPopupArgs = {
  workspaceId: string;
  product: WorkflowCredentialType;
  name?: string;
  credentialId?: string;
};

type StartGoogleOAuthPopupResult =
  | { ok: true; credentialId: string }
  | { ok: false; error: string; popupBlocked?: boolean };

/**
 * Opens the Google account chooser popup and waits for the OpsAi OAuth callback.
 */
export async function startGoogleOAuthPopup(
  args: StartGoogleOAuthPopupArgs
): Promise<StartGoogleOAuthPopupResult> {
  const { url, callbackOrigin } =
    await workflowCredentialsApi.startGoogleOAuth(args);

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
      try {
        popup.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const onMsg = (event: MessageEvent) => {
      const result = acceptGoogleOAuthPostMessage(event, {
        allowedOrigins,
        expectedSource: popup,
      });
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
      finish({
        ok: false,
        error:
          "Google window closed before connecting. Click Sign in with Google to try again.",
      });
    }, 500);
  });
}
