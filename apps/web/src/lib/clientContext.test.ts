import { describe, expect, it } from "vitest";
import {
  describeNetwork,
  detectDevice,
  formatOsFromHints,
  parseBrowserFromUa,
  parseOsFromUa,
} from "./clientContext.js";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidPhone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  winChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  winEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  samsung:
    "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  opera:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 OPR/102.0.0.0",
};

describe("detectDevice", () => {
  it("classifies phones as Mobile", () => {
    expect(detectDevice(UA.iphone, undefined, 5)).toBe("Mobile");
    expect(detectDevice(UA.androidPhone, true, 5)).toBe("Mobile");
  });
  it("classifies tablets as Tablet, including iPadOS in desktop-UA mode", () => {
    expect(detectDevice(UA.ipad, undefined, 5)).toBe("Tablet");
    expect(detectDevice(UA.androidTablet, false, 5)).toBe("Tablet");
    // iPadOS reports a "Macintosh" UA; touch points give it away.
    expect(detectDevice(UA.macSafari, undefined, 5)).toBe("Tablet");
  });
  it("classifies everything else as Desktop", () => {
    expect(detectDevice(UA.winChrome, false, 0)).toBe("Desktop");
    expect(detectDevice(UA.macSafari, undefined, 0)).toBe("Desktop");
  });
});

describe("formatOsFromHints", () => {
  it("disambiguates Windows 11 from 10 by platform-version major", () => {
    expect(formatOsFromHints("Windows", "15.0.0")).toBe("Windows 11");
    expect(formatOsFromHints("Windows", "10.0.0")).toBe("Windows 10");
    expect(formatOsFromHints("Windows", undefined)).toBe("Windows");
  });
  it("formats other platforms with their version", () => {
    expect(formatOsFromHints("Android", "14")).toBe("Android 14");
    expect(formatOsFromHints("macOS", "14.5")).toBe("macOS 14.5");
    expect(formatOsFromHints("Chrome OS", "16093.0.0")).toBe("ChromeOS 16093.0.0");
  });
  it("returns undefined without a platform", () => {
    expect(formatOsFromHints(undefined, "14")).toBeUndefined();
  });
});

describe("parseOsFromUa", () => {
  it("parses the OS from the raw UA (the Safari/Firefox fallback)", () => {
    expect(parseOsFromUa(UA.iphone)).toBe("iOS 18.2");
    expect(parseOsFromUa(UA.ipad)).toBe("iPadOS 17.5");
    expect(parseOsFromUa(UA.androidPhone)).toBe("Android 14");
    // Safari/Firefox freeze the Mac token, so the version is dropped (not "10.15").
    expect(parseOsFromUa(UA.macSafari)).toBe("macOS");
    expect(parseOsFromUa(UA.winChrome)).toBe("Windows 10 or 11");
  });
  it("returns undefined for an unrecognized UA", () => {
    expect(parseOsFromUa("Some unknown agent")).toBeUndefined();
  });
});

describe("parseBrowserFromUa", () => {
  it("identifies the browser + major version, including Chromium skins before Chrome", () => {
    expect(parseBrowserFromUa(UA.winChrome)).toBe("Chrome 130");
    expect(parseBrowserFromUa(UA.winEdge)).toBe("Edge 130");
    expect(parseBrowserFromUa(UA.winFirefox)).toBe("Firefox 130");
    expect(parseBrowserFromUa(UA.iphone)).toBe("Safari 18.2");
    expect(parseBrowserFromUa(UA.macSafari)).toBe("Safari 17.4");
    // Chromium skins carry a Chrome/ token too, so they must win over the Chrome branch.
    expect(parseBrowserFromUa(UA.samsung)).toBe("Samsung Internet 23");
    expect(parseBrowserFromUa(UA.opera)).toBe("Opera 102");
  });
});

describe("describeNetwork", () => {
  it("summarizes the connection, never surfacing the misleading '4g' speed bucket", () => {
    // The top "4g" bucket is dropped (it reads like cellular on a wired link); the
    // downlink estimate is kept.
    expect(
      describeNetwork({ type: "wifi", effectiveType: "4g", downlink: 10, saveData: false }),
    ).toBe("Wi-Fi · ~10 Mbps");
    // A genuine desktop reading: no link type, "4g" dropped, just the speed estimate.
    expect(describeNetwork({ type: "unknown", effectiveType: "4g", downlink: 10 })).toBe(
      "~10 Mbps",
    );
    expect(describeNetwork({ type: "ethernet" })).toBe("Ethernet");
    expect(describeNetwork({ effectiveType: "4g", saveData: true })).toBe("Data Saver");
  });
  it("flags genuinely-slow connections (the meaningful effectiveType buckets)", () => {
    expect(describeNetwork({ type: "cellular", effectiveType: "3g", downlink: 2 })).toBe(
      "Cellular · slow connection · ~2 Mbps",
    );
    expect(describeNetwork({ effectiveType: "slow-2g" })).toBe("very slow connection");
  });
  it("returns undefined when nothing is known", () => {
    expect(describeNetwork({})).toBeUndefined();
    expect(describeNetwork(undefined)).toBeUndefined();
  });
});
