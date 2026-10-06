// Links shared in chat apps open in the app's own browser. Those browsers cannot receive web push,
// and on iPhone they cannot add the site to the Home Screen either, so the visitor has to move to
// the phone's real browser first. LINE is the common case in Thailand.

export type InAppBrowser = "line" | "facebook" | "instagram" | "other";

/** Which in-app browser a user agent belongs to, or null for a real browser. */
export function inAppBrowser(ua: string): InAppBrowser | null {
  if (/\bLine\/\d/i.test(ua)) return "line";
  if (/FBAN\/|FBAV\/|FB_IAB\//.test(ua)) return "facebook"; // Facebook and Messenger
  if (/\bInstagram\b/.test(ua)) return "instagram";
  if (/musical_ly|TikTok|BytedanceWebview|MicroMessenger|\bwv\)/i.test(ua)) return "other";
  return null;
}

/** The same address with LINE's flag that makes it open the link in the phone's own browser. */
export function externalBrowserUrl(href: string) {
  const url = new URL(href);
  url.searchParams.set("openExternalBrowser", "1");
  return url.href;
}
