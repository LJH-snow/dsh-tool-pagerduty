import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { URL } from 'node:url'

export const DEFAULT_BASE_URL = 'https://api.pagerduty.com'

type LookupAddress = {
  address: string
  family: number
}

/** DNS lookup seam used by tests so URL security checks do not require external DNS. */
export type LookupImpl = (hostname: string, options: { all: true }) => Promise<LookupAddress[]>

export class UrlSecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlSecurityError'
  }
}

const defaultLookup: LookupImpl = async (hostname, options) => {
  return await dnsLookup(hostname, options)
}

function invalidBaseUrl(): never {
  throw new UrlSecurityError('Invalid PagerDuty base URL.')
}

/** Parse and normalize a configured base URL without retaining query or fragment data. */
export function normalizeBaseUrl(value?: string): string {
  const input = value ?? DEFAULT_BASE_URL
  if (typeof input !== 'string' || input.length === 0 || input !== input.trim() || !/^https?:\/\/[^/]/i.test(input)) {
    return invalidBaseUrl()
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return invalidBaseUrl()
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return invalidBaseUrl()
  if (!url.hostname || url.username || url.password || url.search || url.hash || input.includes('?') || input.includes('#')) {
    return invalidBaseUrl()
  }

  const pathPrefix = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${pathPrefix}`
}

function ipv4ToNumber(value: string): number | undefined {
  if (isIP(value) !== 4) return undefined
  const octets = value.split('.')
  if (octets.length !== 4) return undefined
  let result = 0
  for (const octet of octets) {
    const parsed = Number(octet)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) return undefined
    result = result * 256 + parsed
  }
  return result >>> 0
}

function ipv4InRange(value: number, start: number, prefixLength: number): boolean {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0
  return (value & mask) === (start & mask)
}

function parseIpv6(value: string): bigint | undefined {
  if (isIP(value) !== 6) return undefined

  const parts = value.split('::')
  if (parts.length > 2) return undefined
  const parsePart = (part: string): number[] => {
    if (!part) return []
    const result: number[] = []
    for (const item of part.split(':')) {
      if (item.includes('.')) {
        const ipv4 = ipv4ToNumber(item)
        if (ipv4 === undefined) return []
        result.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff)
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(item)) return []
        result.push(Number.parseInt(item, 16))
      }
    }
    return result
  }

  const left = parsePart(parts[0])
  const right = parts.length === 2 ? parsePart(parts[1]) : []
  if (parts[0] && left.length === 0) return undefined
  if (parts.length === 2 && parts[1] && right.length === 0) return undefined
  if (parts.length === 1 && left.length !== 8) return undefined
  if (parts.length === 2 && left.length + right.length >= 8) return undefined

  const groups = parts.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
    : left
  if (groups.length !== 8) return undefined

  return groups.reduce((result, group) => (result << 16n) | BigInt(group), 0n)
}

function ipv6InRange(value: bigint, start: bigint, prefixLength: number): boolean {
  const hostBits = 128 - prefixLength
  if (hostBits === 128) return true
  const mask = ((1n << 128n) - 1n) ^ ((1n << BigInt(hostBits)) - 1n)
  return (value & mask) === (start & mask)
}

const IPV4_SPECIAL_RANGES: Array<[number, number]> = [
  [0x00000000, 8], // This network and unspecified addresses.
  [0x0a000000, 8], // Private use.
  [0x64400000, 10], // Shared address space / CGNAT.
  [0x7f000000, 8], // Loopback.
  [0xa9fe0000, 16], // Link-local.
  [0xac100000, 12], // Private use.
  [0xc0000000, 24], // IETF protocol assignments.
  [0xc0000200, 24], // Documentation (TEST-NET-1).
  [0xc01fc400, 24], // AS112-v4.
  [0xc034c100, 24], // AMT.
  [0xc0586300, 24], // 6to4 relay anycast.
  [0xc0a80000, 16], // Private use.
  [0xc0af3000, 24], // AS112-v4 direct delegation.
  [0xc6120000, 15], // Benchmarking.
  [0xc6336400, 24], // Documentation (TEST-NET-2).
  [0xcb007100, 24], // Documentation (TEST-NET-3).
  [0xe0000000, 4], // Multicast.
  [0xf0000000, 4], // Reserved and future use.
]

function ipv6Range(address: string, prefixLength: number): [bigint, number] {
  const parsed = parseIpv6(address)
  if (parsed === undefined) throw new Error('Invalid IPv6 security range.')
  return [parsed, prefixLength]
}

const IPV6_SPECIAL_RANGES: Array<[bigint, number]> = [
  ipv6Range('::', 96), // Unspecified and deprecated IPv4-compatible addresses.
  ipv6Range('::ffff:0:0', 96), // IPv4-mapped addresses.
  ipv6Range('64:ff9b::', 96), // Well-known NAT64 prefix.
  ipv6Range('64:ff9b:1::', 48), // IPv4-translatable address space.
  ipv6Range('100::', 64), // Discard-only prefix.
  ipv6Range('100:0:0:1::', 64), // Dummy IPv6 prefix (RFC 9780).
  ipv6Range('2001::', 23), // IETF protocol assignments: Teredo, AMT, AS112-v6, benchmarking, ORCHID/ORCHIDv2, DRiP.
  ipv6Range('2001:db8::', 32), // Documentation.
  ipv6Range('2002::', 16), // 6to4.
  ipv6Range('2620:4f:8000::', 48), // Direct delegation AS112 service.
  ipv6Range('3fff::', 20), // Documentation.
  ipv6Range('5f00::', 16), // Segment routing (SRv6) SIDs.
  ipv6Range('fc00::', 7), // Unique local addresses.
  ipv6Range('fe80::', 10), // Link-local.
  ipv6Range('fec0::', 10), // Deprecated site-local.
  ipv6Range('ff00::', 8), // Multicast.
]

function isBlockedIpv4(value: string): boolean {
  const numeric = ipv4ToNumber(value)
  return numeric === undefined || IPV4_SPECIAL_RANGES.some(([start, prefixLength]) => ipv4InRange(numeric, start, prefixLength))
}

function isBlockedIpv6(value: string): boolean {
  const numeric = parseIpv6(value)
  if (numeric === undefined) return true

  if (IPV6_SPECIAL_RANGES.some(([start, prefixLength]) => ipv6InRange(numeric, start, prefixLength))) return true

  // IPv4-compatible and IPv4-mapped IPv6 addresses can route to an IPv4 destination.
  const ipv4MappedPrefix = 0xffffn
  if ((numeric >> 32n) === ipv4MappedPrefix || (numeric >> 32n) === 0n) {
    const embedded = Number(numeric & 0xffffffffn)
    const address = `${embedded >>> 24}.${(embedded >>> 16) & 255}.${(embedded >>> 8) & 255}.${embedded & 255}`
    return isBlockedIpv4(address)
  }

  return false
}

function isBlockedAddress(value: string): boolean {
  const family = isIP(value)
  if (family === 4) return isBlockedIpv4(value)
  if (family === 6) return isBlockedIpv6(value)
  return true
}

function hostnameForCheck(url: URL): string {
  const hostname = url.hostname.toLowerCase()
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.replace(/\.+$/, '')
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === 'localhost.localdomain'
    || normalized.endsWith('.localhost.localdomain')
    || normalized === 'local'
    || normalized.endsWith('.local')
    || normalized === 'ip6-localhost'
    || normalized === 'ip6-loopback'
    || normalized === 'ip6-allnodes'
    || normalized === 'ip6-allrouters'
    || normalized === 'broadcasthost'
}

/** Validate the final request destination, resolving ordinary hostnames fail-closed. */
export async function assertSafeUrl(url: URL, lookupImpl: LookupImpl = defaultLookup): Promise<void> {
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new UrlSecurityError('Unsafe PagerDuty destination.')
  }

  const hostname = hostnameForCheck(url)
  if (!hostname) throw new UrlSecurityError('Unsafe PagerDuty destination.')

  if (isLocalHostname(hostname)) {
    throw new UrlSecurityError('Unsafe PagerDuty destination.')
  }

  const family = isIP(hostname)
  if (family !== 0) {
    if (isBlockedAddress(hostname)) throw new UrlSecurityError('Unsafe PagerDuty destination.')
    return
  }

  let addresses: LookupAddress[]
  try {
    addresses = await lookupImpl(hostname, { all: true })
  } catch {
    throw new UrlSecurityError('Unsafe PagerDuty destination.')
  }
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(address => {
    if (!address || typeof address.address !== 'string' || (address.family !== 4 && address.family !== 6)) return true
    return isIP(address.address) !== address.family || isBlockedAddress(address.address)
  })) {
    throw new UrlSecurityError('Unsafe PagerDuty destination.')
  }
}
