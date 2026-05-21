export type OpenAiLoginStartResult = {
  ok: true;
  loginUrl: string;
  code: string;
  device_auth_id: string;
  expiresInMinutes: number;
  message: string;
};

type LoginPopup = {
  closed?: boolean;
  location: { href: string };
  close?: () => void;
};

type OpenWindow = (url?: string | URL, target?: string, features?: string) => LoginPopup | null;

type StartBrowserOpenAiAccountLoginOptions = {
  openWindow: OpenWindow;
  requestLoginStart: () => Promise<OpenAiLoginStartResult>;
};

const LOGIN_TARGET = "_blank";
// noopener makes window.open() return null, preventing popup reservation.
// The reserved window is redirected via location.href (no user-gesture needed),
// so noopener is safe to omit for the initial about:blank open.
const RESERVATION_FEATURES = "";
const FALLBACK_FEATURES = "noopener,noreferrer";

export async function startBrowserOpenAiAccountLogin({
  openWindow,
  requestLoginStart,
}: StartBrowserOpenAiAccountLoginOptions): Promise<{ data: OpenAiLoginStartResult; popupBlocked: boolean }> {
  const reservedWindow = openWindow("about:blank", LOGIN_TARGET, RESERVATION_FEATURES);

  try {
    const data = await requestLoginStart();
    if (data.loginUrl) {
      if (reservedWindow && !reservedWindow.closed) {
        reservedWindow.location.href = data.loginUrl;
      } else {
        openWindow(data.loginUrl, LOGIN_TARGET, FALLBACK_FEATURES);
      }
    }

    return { data, popupBlocked: !reservedWindow };
  } catch (error) {
    reservedWindow?.close?.();
    throw error;
  }
}
