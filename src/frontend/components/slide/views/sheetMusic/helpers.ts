import { getStyles } from "../../../helpers/style"

export const DEFAULT_ITEM_WIDTH = 1920
export const DEFAULT_NOTATION_SIZE = 100
export const MIN_NOTATION_SIZE = 50
export const MAX_NOTATION_SIZE = 200
export const MIN_PAGE_WIDTH = 100
export const MAX_PAGE_WIDTH = 100000
export const SVG_CACHE_MAX_BYTES = 20 * 1024 * 1024

export function clampNotationSize(size: number | undefined): number {
    if (typeof size !== "number" || !Number.isFinite(size)) return DEFAULT_NOTATION_SIZE
    return Math.min(MAX_NOTATION_SIZE, Math.max(MIN_NOTATION_SIZE, size))
}

export function parseItemWidth(style: string | null | undefined): number {
    const raw = getStyles(style, true)?.width
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ITEM_WIDTH
    return parsed
}

export function calculatePageWidth(itemWidth: number | undefined, size: number | undefined): number {
    const width = typeof itemWidth === "number" && Number.isFinite(itemWidth) && itemWidth > 0 ? itemWidth : DEFAULT_ITEM_WIDTH
    const clampedSize = clampNotationSize(size)
    const raw = (width * 1.2 * 100) / clampedSize
    const rounded = Math.round(raw / 10) * 10
    return Math.max(MIN_PAGE_WIDTH, Math.min(MAX_PAGE_WIDTH, rounded))
}

export function getPageWidthFromStyle(style: string | null | undefined, size: number | undefined): number {
    return calculatePageWidth(parseItemWidth(style), size)
}

export function createRenderCacheKey(mei: string, pageWidth: number): string {
    return `${pageWidth}:${mei}`
}

export function prefixSvgIds(svg: string, prefix: string): string {
    if (!svg || !prefix) return svg

    const ids = new Set<string>()
    const withIds = svg.replace(/\bid="([^"]+)"/g, (_match, id: string) => {
        ids.add(id)
        return `id="${prefix}${id}"`
    })

    if (!ids.size) return svg

    // Verovio scopes its own CSS by the root id (`#id path {stroke:currentColor}`), so the style block must follow the new ids
    return withIds
        .replace(/\b(xlink:href|href)="#([^"]+)"/g, (match, attr: string, id: string) => (ids.has(id) ? `${attr}="#${prefix}${id}"` : match))
        .replace(/url\(#([^)]+)\)/g, (match, id: string) => (ids.has(id) ? `url(#${prefix}${id})` : match))
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, (block) => block.replace(/#([A-Za-z_][\w-]*)/g, (match, id: string) => (ids.has(id) ? `#${prefix}${id}` : match)))
}

export function decodeBase64ToUtf8(base64: string): string {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return new TextDecoder("utf-8").decode(bytes)
}

export class SvgCache {
    private entries = new Map<string, string>()
    private totalBytes = 0
    private readonly maxBytes: number

    constructor(maxBytes = SVG_CACHE_MAX_BYTES) {
        this.maxBytes = maxBytes
    }

    get size(): number {
        return this.entries.size
    }

    get bytes(): number {
        return this.totalBytes
    }

    get(key: string): string | undefined {
        const value = this.entries.get(key)
        if (value === undefined) return undefined

        this.entries.delete(key)
        this.entries.set(key, value)
        return value
    }

    set(key: string, value: string): void {
        const existing = this.entries.get(key)
        if (existing !== undefined) {
            this.totalBytes -= existing.length
            this.entries.delete(key)
        }

        if (value.length > this.maxBytes) return

        this.entries.set(key, value)
        this.totalBytes += value.length

        while (this.totalBytes > this.maxBytes && this.entries.size > 0) {
            const oldestKey = this.entries.keys().next().value
            if (oldestKey === undefined) break
            const oldestValue = this.entries.get(oldestKey)
            this.entries.delete(oldestKey)
            if (oldestValue !== undefined) this.totalBytes -= oldestValue.length
        }
    }

    clear(): void {
        this.entries.clear()
        this.totalBytes = 0
    }
}
