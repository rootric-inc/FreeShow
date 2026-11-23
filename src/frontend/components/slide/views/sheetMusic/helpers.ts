import { getStyles } from "../../../helpers/style"

export const DEFAULT_ITEM_WIDTH = 1920
export const DEFAULT_ITEM_HEIGHT = 1080
export const DEFAULT_NOTATION_SIZE = 100
export const MIN_NOTATION_SIZE = 50
export const MAX_NOTATION_SIZE = 200
export const MIN_PAGE_WIDTH = 100
export const MAX_PAGE_WIDTH = 100000
export const SVG_CACHE_MAX_BYTES = 20 * 1024 * 1024

export function clampNotationSize(size: unknown): number {
    if (typeof size !== "number" || !Number.isFinite(size)) return DEFAULT_NOTATION_SIZE
    return Math.min(MAX_NOTATION_SIZE, Math.max(MIN_NOTATION_SIZE, size))
}

export function getSheetMusicData(sheetMusic: unknown): string {
    if (!sheetMusic || typeof sheetMusic !== "object") return ""
    const data = (sheetMusic as { data?: unknown }).data
    return typeof data === "string" ? data : ""
}

export function getSheetMusicAbc(sheetMusic: unknown): string {
    if (!sheetMusic || typeof sheetMusic !== "object") return ""
    const abc = (sheetMusic as { abc?: unknown }).abc
    return typeof abc === "string" ? abc : ""
}

export function getSheetMusicLabel(sheetMusic: unknown): string {
    if (!sheetMusic || typeof sheetMusic !== "object") return ""
    const label = (sheetMusic as { label?: unknown }).label
    return typeof label === "string" ? label : ""
}

export type SheetMusicPartsPreset = "all" | "upper" | "lower" | "melody" | "custom"

const SHEET_MUSIC_PARTS_PRESETS = new Set<string>(["all", "upper", "lower", "melody", "custom"])

export function getSheetMusicSize(sheetMusic: unknown): number | undefined {
    if (!sheetMusic || typeof sheetMusic !== "object") return undefined
    const size = (sheetMusic as { size?: unknown }).size
    return typeof size === "number" && Number.isFinite(size) ? size : undefined
}

export function getSheetMusicParts(sheetMusic: unknown): SheetMusicPartsPreset | undefined {
    if (!sheetMusic || typeof sheetMusic !== "object") return undefined
    const parts = (sheetMusic as { parts?: unknown }).parts
    return typeof parts === "string" && SHEET_MUSIC_PARTS_PRESETS.has(parts) ? (parts as SheetMusicPartsPreset) : undefined
}

export function getSheetMusicCustomParts(sheetMusic: unknown): string[] | undefined {
    if (!sheetMusic || typeof sheetMusic !== "object") return undefined
    const customParts = (sheetMusic as { customParts?: unknown }).customParts
    if (!Array.isArray(customParts)) return undefined
    return customParts.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
}

export function getSheetMusicVerses(sheetMusic: unknown): string {
    if (!sheetMusic || typeof sheetMusic !== "object") return ""
    const verses = (sheetMusic as { verses?: unknown }).verses
    return typeof verses === "string" ? verses : ""
}

export function getSheetMusicMeasures(sheetMusic: unknown): string {
    if (!sheetMusic || typeof sheetMusic !== "object") return ""
    const measures = (sheetMusic as { measures?: unknown }).measures
    return typeof measures === "string" ? measures : ""
}

export function getSheetMusicDisplayLabel(sheetMusic: unknown): string {
    const label = getSheetMusicLabel(sheetMusic)
    const measures = getSheetMusicMeasures(sheetMusic).trim()
    if (!label) return ""
    return measures ? `${label} (${measures})` : label
}

export function escapeHtml(text: string): string {
    if (typeof text !== "string") return ""
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export function parseItemWidth(style: string | null | undefined): number {
    const raw = getStyles(style, true)?.width
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ITEM_WIDTH
    return parsed
}

export function parseItemHeight(style: string | null | undefined): number {
    const raw = getStyles(style, true)?.height
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ITEM_HEIGHT
    return parsed
}

export function getItemRatioFromStyle(style: string | null | undefined): number {
    const width = parseItemWidth(style)
    const height = parseItemHeight(style)
    return Math.max(0.01, Math.round((height / width) * 100) / 100)
}

export function calculatePageWidth(itemWidth: unknown, size: unknown): number {
    const width = typeof itemWidth === "number" && Number.isFinite(itemWidth) && itemWidth > 0 ? itemWidth : DEFAULT_ITEM_WIDTH
    const clampedSize = clampNotationSize(size)
    const raw = (width * 1.2 * 100) / clampedSize
    const rounded = Math.round(raw / 10) * 10
    return Math.max(MIN_PAGE_WIDTH, Math.min(MAX_PAGE_WIDTH, rounded))
}

export function getPageWidthFromStyle(style: string | null | undefined, size: unknown): number {
    return calculatePageWidth(parseItemWidth(style), size)
}

export function createRenderCacheKey(mei: string, pageWidth: number, ratio?: number): string {
    const ratioPart = typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? String(ratio) : ""
    return `${pageWidth}:${ratioPart}:${mei}`
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

export function decodeBase64Text(base64: string): string {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }

    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(bytes.subarray(2))
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder("utf-16be").decode(bytes.subarray(2))
    }
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return new TextDecoder("utf-8").decode(bytes.subarray(3))
    }
    return new TextDecoder("utf-8").decode(bytes)
}

export class SvgCache<T = string> {
    private entries = new Map<string, T>()
    private totalBytes = 0
    private readonly maxBytes: number
    private readonly sizeOf: (value: T) => number

    constructor(maxBytes = SVG_CACHE_MAX_BYTES, sizeOf: (value: T) => number = (value) => (typeof value === "string" ? value.length : 0)) {
        this.maxBytes = maxBytes
        this.sizeOf = sizeOf
    }

    get size(): number {
        return this.entries.size
    }

    get bytes(): number {
        return this.totalBytes
    }

    get(key: string): T | undefined {
        const value = this.entries.get(key)
        if (value === undefined) return undefined

        this.entries.delete(key)
        this.entries.set(key, value)
        return value
    }

    set(key: string, value: T): void {
        const valueBytes = this.sizeOf(value)
        const existing = this.entries.get(key)
        if (existing !== undefined) {
            this.totalBytes -= this.sizeOf(existing)
            this.entries.delete(key)
        }

        if (valueBytes > this.maxBytes) return

        this.entries.set(key, value)
        this.totalBytes += valueBytes

        while (this.totalBytes > this.maxBytes && this.entries.size > 0) {
            const oldestKey = this.entries.keys().next().value
            if (oldestKey === undefined) break
            const oldestValue = this.entries.get(oldestKey)
            this.entries.delete(oldestKey)
            if (oldestValue !== undefined) this.totalBytes -= this.sizeOf(oldestValue)
        }
    }

    clear(): void {
        this.entries.clear()
        this.totalBytes = 0
    }
}
