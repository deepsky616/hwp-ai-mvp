export type OpenAiLoginStartResult = {
  ok: true;
  loginUrl: string;
  code: string;
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
const LOGIN_FEATURES = "noopener,noreferrer";

export async function startBrowserOpenAiAccountLogin({
  openWindow,
  requestLoginStart,
}: StartBrowserOpenAiAccountLoginOptions): Promise<{ data: OpenAiLoginStartResult; popupBlocked: boolean }> {
  const reservedWindow = openWindow("about:blank", LOGIN_TARGET, LOGIN_FEATURES);

  try {
    const data = await requestLoginStart();
    if (data.loginUrl) {
      if (reservedWindow && !reservedWindow.closed) {
        reservedWindow.location.href = data.loginUrl;
      } else {
        openWindow(data.loginUrl, LOGIN_TARGET, LOGIN_FEATURES);
      }
    }

    return { data, popupBlocked: !reservedWindow };
  } catch (error) {
    reservedWindow?.close?.();
    throw error;
  }
}
