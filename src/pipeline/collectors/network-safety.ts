import { lookup as nodeLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { fetchableSourceUrlSchema } from "../../contracts";
import { CollectorError } from "./collector-error";

export interface DnsAddress {
  address: string;
  family: 4 | 6;
}

export type DnsLookup = (hostname: string) => Promise<readonly DnsAddress[]>;

export const lookupPublicAddresses: DnsLookup = async (hostname) => {
  const addresses = await nodeLookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((entry) =>
    entry.family === 4 || entry.family === 6
      ? [{ address: entry.address, family: entry.family }]
      : [],
  );
};

function parseIpv4(address: string): number | null {
  if (isIP(address) !== 4) {
    return null;
  }

  return address
    .split(".")
    .map(Number)
    .reduce((result, part) => (result << 8) + part, 0) >>> 0;
}

function ipv4InCidr(address: number, base: string, prefix: number): boolean {
  const baseAddress = parseIpv4(base);
  if (baseAddress === null) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (baseAddress & mask);
}

const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isUnsafeIpv4(address: string): boolean {
  const parsed = parseIpv4(address);
  return (
    parsed === null ||
    BLOCKED_IPV4_RANGES.some(([base, prefix]) =>
      ipv4InCidr(parsed, base, prefix),
    )
  );
}

function parseIpv6(address: string): bigint | null {
  const withoutZone = address.split("%", 1)[0].toLowerCase();
  if (isIP(withoutZone) !== 6) {
    return null;
  }

  let normalized = withoutZone;
  const ipv4Match = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (ipv4Match) {
    const ipv4 = parseIpv4(ipv4Match[1]);
    if (ipv4 === null) {
      return null;
    }
    const high = ((ipv4 >>> 16) & 0xffff).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    normalized = `${normalized.slice(0, -ipv4Match[1].length)}${high}:${low}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) {
    return null;
  }

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null;
  }

  const parts = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[a-f0-9]{1,4}$/.test(part))) {
    return null;
  }

  return parts.reduce(
    (result, part) =>
      (result << BigInt(16)) + BigInt(Number.parseInt(part, 16)),
    BigInt(0),
  );
}

function ipv6InCidr(address: bigint, base: bigint, prefix: number): boolean {
  const shift = BigInt(128) - BigInt(prefix);
  return address >> shift === base >> shift;
}

const IPV6_GLOBAL_UNICAST_BASE = BigInt("0x20000000000000000000000000000000");
const IPV6_DOCUMENTATION_BASE = BigInt("0x20010db8000000000000000000000000");
const IPV4_MAPPED_BASE = BigInt("0x00000000000000000000ffff00000000");

function isUnsafeIpv6(address: string): boolean {
  const parsed = parseIpv6(address);
  if (parsed === null) {
    return true;
  }

  if (ipv6InCidr(parsed, IPV4_MAPPED_BASE, 96)) {
    return isUnsafeIpv4(Number(parsed & BigInt("0xffffffff"))
      .toString(16)
      .padStart(8, "0")
      .match(/.{2}/g)
      ?.map((part) => Number.parseInt(part, 16))
      .join(".") ?? "");
  }

  // Public RSS hosts should resolve to global unicast. This also excludes
  // loopback, unspecified, link-local, unique-local and multicast addresses.
  return (
    !ipv6InCidr(parsed, IPV6_GLOBAL_UNICAST_BASE, 3) ||
    ipv6InCidr(parsed, IPV6_DOCUMENTATION_BASE, 32)
  );
}

export function isUnsafeNetworkAddress(address: string): boolean {
  const normalized = address.startsWith("[") && address.endsWith("]")
    ? address.slice(1, -1)
    : address;
  const family = isIP(normalized.split("%", 1)[0]);

  if (family === 4) {
    return isUnsafeIpv4(normalized);
  }
  if (family === 6) {
    return isUnsafeIpv6(normalized);
  }
  return true;
}

export async function assertSafeRequestUrl(
  value: string,
  lookup: DnsLookup,
  signal?: AbortSignal,
): Promise<URL> {
  const parsed = fetchableSourceUrlSchema.safeParse(value);
  if (!parsed.success) {
    throw new CollectorError(
      "UNSAFE_SOURCE_URL",
      "HTTPS 공개 주소가 아닌 수집 요청을 차단했습니다.",
    );
  }

  const url = new URL(parsed.data);
  const hostname = url.hostname.startsWith("[")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const literalFamily = isIP(hostname.split("%", 1)[0]);

  let addresses: readonly DnsAddress[];
  try {
    const lookupPromise: Promise<readonly DnsAddress[]> =
      literalFamily === 4 || literalFamily === 6
        ? Promise.resolve([{ address: hostname, family: literalFamily }])
        : lookup(hostname);
    if (signal === undefined) {
      addresses = await lookupPromise;
    } else {
      addresses = await new Promise<readonly DnsAddress[]>((resolve, reject) => {
        const handleAbort = () => {
          reject(
            new CollectorError(
              "COLLECTION_TIMEOUT",
              "RSS 수집원 DNS 확인 제한 시간을 초과했습니다.",
              { retryable: true },
            ),
          );
        };
        if (signal.aborted) {
          handleAbort();
          return;
        }
        signal.addEventListener("abort", handleAbort, { once: true });
        lookupPromise.then(
          (result) => {
            signal.removeEventListener("abort", handleAbort);
            resolve(result);
          },
          (error: unknown) => {
            signal.removeEventListener("abort", handleAbort);
            reject(error);
          },
        );
      });
    }
  } catch (error) {
    if (error instanceof CollectorError) {
      throw error;
    }
    throw new CollectorError(
      "SOURCE_UNAVAILABLE",
      "수집원 호스트의 DNS 주소를 확인하지 못했습니다.",
      { cause: error, retryable: true },
    );
  }

  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) =>
        family !== isIP(address.split("%", 1)[0]) ||
        isUnsafeNetworkAddress(address),
    )
  ) {
    throw new CollectorError(
      "UNSAFE_SOURCE_URL",
      "로컬·사설·예약 네트워크로 연결되는 수집 요청을 차단했습니다.",
    );
  }

  return url;
}
