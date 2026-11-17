import {
  acceptGoogleOAuthPostMessage,
  resolveOAuthMessageAllowedOrigins,
} from "@/modules/workflows/googleOAuthMessage";
import { workflowCredentialsApi } from "@/modules/workflows/api";

const MESSAGE_TYPE = "opsai-instagram-oauth";

type StartInstagramOAuthPopupArgs = {
  workspaceId: string;
  name?: string;
  credentialId?: string;
};

type StartInstagramOAuthPopupResult =
  | { ok: true; credentialId: string }
  | { ok: false; error: string; popupBlocked?: boolean };

export async function startInstagramOAuthPopup(
  args: StartInstagramOAuthPopupArgs
): Promise<StartInstagramOAuthPopupResult> {
  const { url, callbackOrigin } =
    await workflowCredentialsApi.startInstagramOAuth(args);

  const popup = window.open(
    url,
    "opsai-instagram-oauth",
    "width=520,height=720"
  );
  if (!popup) {
    return {
      ok: false,
      error:
        "Instagram sign-in popup was blocked. Allow popups for this site, then try again.",
      popupBlocked: true,
    };
  }

  const allowedOrigins = resolveOAuthMessageAllowedOrigins({
    editorOrigin: window.location.origin,
    callbackOrigin,
  });

  return await new Promise<StartInstagramOAuthPopupResult>((resolve) => {
    let settled = false;
    const finish = (result: StartInstagramOAuthPopupResult) => {
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
          error: String(result.error || "Instagram connect failed. Start again."),
        });
      }
    };

    window.addEventListener("message", onMsg);
    const closeTimer = window.setInterval(() => {
      if (!popup.closed) return;
      finish({
        ok: false,
        error:
          "Instagram window closed before connecting. Click Connect Instagram to try again.",
      });
    }, 500);
  });
}
