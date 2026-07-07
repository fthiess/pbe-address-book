import type { BugReportClientContext } from "@pbe/shared";

/**
 * Best-effort, non-PII technical context captured with a bug report so an admin
 * can diagnose it. The web platform deliberately hides some of what we'd like —
 * the specific device *model* ("iPhone 17") and the radio generation ("5G") are
 * never exposed, and the network details are Chromium-only (blank on Safari/iOS).
 * So every field here is best-effort; a missing field just means "the browser
 * wouldn't tell us." The pure parsers are exported for unit testing; the globals
 * are read only in {@link collectClientContext}.
 */

/** The subset of the User-Agent Client Hints API we use (Chromium only; undefined elsewhere). */
interface HighEntropyValues {
  platform?: string;
  platformVersion?: string;
  model?: string;
}
interface NavigatorUAData {
  mobile?: boolean;
  getHighEntropyValues?(hints: string[]): Promise<HighEntropyValues>;
}
/** The subset of the Network Information API we use (Chromium only). */
interface NetworkInformation {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
}

/**
 * Classify the device as Mobile / Tablet / Desktop. The model is never available,
 * so this coarse class is the most we can offer. iPadOS defaults to a desktop
 * ("Macintosh") UA, so a Mac UA with touch points is treated as a tablet.
 */
export function detectDevice(
  ua: string,
  mobileHint: boolean | undefined,
  maxTouchPoints: number,
): string {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) {
    return "Tablet";
  }
  if (mobileHint === true || /Mobi|iPhone|iPod/.test(ua)) {
    return "Mobile";
  }
  if (/\bTablet\b/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) {
    return "Tablet";
  }
  return "Desktop";
}

/** Format the OS from Client Hints platform + version (the precise path; Chromium). */
export function formatOsFromHints(
  platform: string | undefined,
  version: string | undefined,
): string | undefined {
  if (!platform) {
    return undefined;
  }
  const major = version ? Number.parseInt(version, 10) : Number.NaN;
  if (platform === "Windows") {
    // Windows 11 reports a platformVersion major of 13+; 1–10 is Windows 10.
    return Number.isFinite(major) ? (major >= 13 ? "Windows 11" : "Windows 10") : "Windows";
  }
  const label = platform === "Chrome OS" ? "ChromeOS" : platform;
  return version ? `${label} ${version}` : label;
}

/** Parse the OS from the raw UA string — the fallback for Safari/Firefox (no Client Hints). */
export function parseOsFromUa(ua: string): string | undefined {
  let m = /iPhone OS (\d+)[._](\d+)/.exec(ua);
  if (m) return `iOS ${m[1]}.${m[2]}`;
  m = /iPad;.*OS (\d+)[._](\d+)/.exec(ua);
  if (m) return `iPadOS ${m[1]}.${m[2]}`;
  m = /Android (\d+(?:\.\d+)?)/.exec(ua);
  if (m) return `Android ${m[1]}`;
  m = /Mac OS X (\d+)[._](\d+)/.exec(ua);
  if (m) return `macOS ${m[1]}.${m[2]}`;
  if (/Windows NT 10\.0/.test(ua)) return "Windows 10 or 11";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return undefined;
}

/** Parse the browser + major version from the UA (order matters: Edge→Chrome→Safari). */
export function parseBrowserFromUa(ua: string): string | undefined {
  let m = /Edg(?:iOS|A)?\/(\d+)/.exec(ua);
  if (m) return `Edge ${m[1]}`;
  m = /(?:CriOS|Chrome)\/(\d+)/.exec(ua);
  if (m) return `Chrome ${m[1]}`;
  m = /Firefox\/(\d+)/.exec(ua);
  if (m) return `Firefox ${m[1]}`;
  m = /Version\/(\d+(?:\.\d+)?).*Safari/.exec(ua);
  if (m) return `Safari ${m[1]}`;
  return undefined;
}

/** Summarize the network from the Network Information API (Chromium only). */
export function describeNetwork(connection: NetworkInformation | undefined): string | undefined {
  if (!connection) {
    return undefined;
  }
  const parts: string[] = [];
  const type = connection.type;
  if (type && type !== "unknown" && type !== "other") {
    const pretty: Record<string, string> = {
      wifi: "Wi-Fi",
      cellular: "Cellular",
      ethernet: "Ethernet",
    };
    parts.push(pretty[type] ?? type);
  }
  if (connection.effectiveType) {
    parts.push(connection.effectiveType);
  }
  if (typeof connection.downlink === "number" && connection.downlink > 0) {
    parts.push(`~${connection.downlink} Mbps`);
  }
  if (connection.saveData) {
    parts.push("Data Saver");
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function assign(
  ctx: BugReportClientContext,
  key: keyof BugReportClientContext,
  value: string | undefined,
) {
  if (value) {
    ctx[key] = value;
  }
}

/**
 * Gather the client context from browser globals. `webVersion` is the SPA build
 * identifier (from the Vite `define`). The Client-Hints call is async, so this is
 * async; it degrades to the UA-string parses when the API is absent (Safari/iOS).
 */
export async function collectClientContext(webVersion: string): Promise<BugReportClientContext> {
  const ua = navigator.userAgent;
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;

  const ctx: BugReportClientContext = {
    userAgent: ua,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    webVersion,
  };
  assign(ctx, "device", detectDevice(ua, uaData?.mobile, navigator.maxTouchPoints));

  let os: string | undefined;
  if (uaData?.getHighEntropyValues) {
    try {
      const hev = await uaData.getHighEntropyValues(["platform", "platformVersion", "model"]);
      os = formatOsFromHints(hev.platform, hev.platformVersion);
    } catch {
      // Fall through to the UA parse.
    }
  }
  assign(ctx, "os", os ?? parseOsFromUa(ua));
  assign(ctx, "browser", parseBrowserFromUa(ua));
  assign(ctx, "network", describeNetwork(connection));
  return ctx;
}
