import { describe, expect, it } from "vitest";
import { externalBrowserUrl, inAppBrowser } from "@/lib/inapp";

// Links shared in LINE or Facebook open inside the app's own browser, which cannot receive web
// push and, on iPhone, cannot add the site to the Home Screen.

const UA = {
  lineIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0",
  lineAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 Line/14.10.1/IAB",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.45.108;FBBV/620474785;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/th_TH;FBOP/5]",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/473.0.0.37.81;]",
  messenger:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerLiteForiOS;FBAV/470.0.0.21.105]",
  instagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91 (iPhone15,2; iOS 17_5; th_TH; th; scale=3.00; 1179x2556; 619218420)",
  tiktok:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.3.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/th Region/TH",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
};

describe("inAppBrowser", () => {
  it("recognises the in-app browsers people in Thailand share links through", () => {
    expect(inAppBrowser(UA.lineIos)).toBe("line");
    expect(inAppBrowser(UA.lineAndroid)).toBe("line");
    expect(inAppBrowser(UA.facebookIos)).toBe("facebook");
    expect(inAppBrowser(UA.facebookAndroid)).toBe("facebook");
    expect(inAppBrowser(UA.messenger)).toBe("facebook");
    expect(inAppBrowser(UA.instagram)).toBe("instagram");
    expect(inAppBrowser(UA.tiktok)).toBe("other");
  });

  it("leaves real browsers alone", () => {
    expect(inAppBrowser(UA.safariIos)).toBeNull();
    expect(inAppBrowser(UA.chromeAndroid)).toBeNull();
  });
});

describe("externalBrowserUrl", () => {
  it("adds LINE's flag for opening a link in the phone's own browser, keeping the rest of the address", () => {
    expect(externalBrowserUrl("https://nont.example/?range=7d#notify")).toBe(
      "https://nont.example/?range=7d&openExternalBrowser=1#notify",
    );
  });
});
