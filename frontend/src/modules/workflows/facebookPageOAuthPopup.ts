import {
  acceptGoogleOAuthPostMessage,
  resolveOAuthMessageAllowedOrigins,
} from "@/modules/workflows/googleOAuthMessage";
import { workflowCredentialsApi } from "@/modules/workflows/api";

const MESSAGE_TYPE = "opsai-facebook-page-oauth";

type StartFacebookPageOAuthPopupArgs = {
  workspaceId: string;
  name?: string;
  credentialId?: string;
};

type StartFacebookPageOAuthPopupResult =
  | { ok: true; credentialId: string }
  | { ok: false; error: string; popupBlocked?: boolean };

export async function startFacebookPageOAuthPopup(
  args: StartFacebookPageOAuthPopupArgs
): Promise<StartFacebookPageOAuthPopupResult> {
  const { url, callbackOrigin } =
    await workflowCredentialsApi.startFacebookPageOAuth(args);

  const popup = window.open(
    url,
    "opsai-facebook-page-oauth",
    "width=520,height=720"
  );
  if (!popup) {
    return {
      ok: false,
      error:
        "Facebook sign-in popup was blocked. Allow popups for this site, then try again.",
      popupBlocked: true,
    };
  }

  const allowedOrigins = resolveOAuthMessageAllowedOrigins({
    editorOrigin: window.location.origin,
    callbackOrigin,
  });

  return await new Promise<StartFacebookPageOAuthPopupResult>((resolve) => {
    let settled = false;
    const finish = (result: StartFacebookPageOAuthPopupResult) => {
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
        messageType: MESSAGE_TYPE,
      });
      if (!result.handled) return;
      if (result.accepted) {
        finish({ ok: true, credentialId: result.credentialId });
      } else {
        finish({
          ok: false,
          error: result.error || "Facebook Page connect failed",
        });
      }
    };

    window.addEventListener("message", onMsg);
    const closeTimer = window.setInterval(() => {
      if (popup.closed) {
        finish({
          ok: false,
          error: "Facebook Page sign-in was cancelled.",
        });
      }
    }, 400);
  });
}
