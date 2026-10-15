import {
  acceptGoogleOAuthPostMessage,
  resolveOAuthMessageAllowedOrigins,
} from "@/modules/workflows/googleOAuthMessage";
import { workflowCredentialsApi } from "@/modules/workflows/api";

const MESSAGE_TYPE = "opsai-meta-oauth";

type StartMetaOAuthPopupArgs = {
  workspaceId: string;
  name?: string;
  credentialId?: string;
};

type StartMetaOAuthPopupResult =
  | { ok: true; credentialId: string }
  | { ok: false; error: string; popupBlocked?: boolean };

export async function startMetaOAuthPopup(
  args: StartMetaOAuthPopupArgs
): Promise<StartMetaOAuthPopupResult> {
  const { url, callbackOrigin } =
    await workflowCredentialsApi.startMetaOAuth(args);

  const popup = window.open(url, "opsai-meta-oauth", "width=520,height=720");
  if (!popup) {
    return {
      ok: false,
      error:
        "Meta sign-in popup was blocked. Allow popups for this site, then try again.",
      popupBlocked: true,
    };
  }

  const allowedOrigins = resolveOAuthMessageAllowedOrigins({
    editorOrigin: window.location.origin,
    callbackOrigin,
  });

  return await new Promise<StartMetaOAuthPopupResult>((resolve) => {
    let settled = false;
    const finish = (result: StartMetaOAuthPopupResult) => {
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
        const error = String(result.error || "");
        finish({
          ok: false,
          error: /google connect failed/i.test(error)
            ? "Meta connect failed. Start again."
            : error || "Meta connect failed. Start again.",
        });
      }
    };

    window.addEventListener("message", onMsg);
    const closeTimer = window.setInterval(() => {
      if (!popup.closed) return;
      finish({
        ok: false,
        error: "Meta window closed before connecting. Click Connect with Meta to try again.",
      });
    }, 500);
  });
}
