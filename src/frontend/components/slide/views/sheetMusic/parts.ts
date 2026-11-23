import type { SheetMusicPartsPreset } from "./helpers"
import type { MeiSummary } from "./meiParts"

export interface ResolvedPartsSelection {
    parts: "all" | string[]
    highestNoteOnly: boolean
}

export interface NamedPart {
    key: string
    staff: string
    layer: string
    labelKey: string
    values: string[]
}

export interface MeasureRange {
    first: number
    last: number
}

export interface ResolvedMeasureRange extends MeasureRange {
    firstNumber: number
    lastNumber: number
}

const SATB_KEYS = ["sheet_music.part_soprano", "sheet_music.part_alto", "sheet_music.part_tenor", "sheet_music.part_bass"] as const

export function getAllPartKeys(summary: MeiSummary): string[] {
    const keys: string[] = []
    for (const staff of summary.staves) {
        for (const layer of staff.layers) {
            keys.push(`${staff.n}.${layer}`)
        }
    }
    return keys
}

export function hasPartsOptions(summary: MeiSummary): boolean {
    if (summary.staves.length > 1) return true
    const firstStaff = summary.staves[0]
    if (!firstStaff) return false
    return firstStaff.layers.length > 1 || Boolean(firstStaff.hasChords)
}

export function resolveCustomPartsKeys(customParts: readonly string[] | undefined, allKeys: readonly string[]): string[] {
    if (!allKeys.length) return []
    const validSet = new Set(allKeys)
    const seen = new Set<string>()
    const kept: string[] = []
    for (const key of customParts || []) {
        if (validSet.has(key) && !seen.has(key)) {
            seen.add(key)
            kept.push(key)
        }
    }
    if (!kept.length) return [...allKeys]
    return allKeys.filter((key) => seen.has(key))
}

export function toggleCustomPartKey(currentParts: readonly string[] | undefined, allKeys: readonly string[], partKey: string, checked: boolean): string[] | null {
    const currentSet = new Set(resolveCustomPartsKeys(currentParts, allKeys))
    if (checked) currentSet.add(partKey)
    else currentSet.delete(partKey)

    const nextKeys = allKeys.filter((key) => currentSet.has(key))
    if (!nextKeys.length) return null
    return nextKeys
}

export function resolvePartsSelection(preset: SheetMusicPartsPreset | undefined, customParts: readonly string[] | undefined, summary: MeiSummary): ResolvedPartsSelection {
    const allKeys = getAllPartKeys(summary)
    if (!allKeys.length || !preset || preset === "all") {
        return { parts: "all", highestNoteOnly: false }
    }

    if (preset === "upper") {
        const firstStaff = summary.staves[0]
        if (!firstStaff || !firstStaff.layers.length) return { parts: "all", highestNoteOnly: false }
        const keys = firstStaff.layers.map((layer) => `${firstStaff.n}.${layer}`)
        return keys.length === allKeys.length ? { parts: "all", highestNoteOnly: false } : { parts: keys, highestNoteOnly: false }
    }

    if (preset === "lower") {
        const lastStaff = summary.staves[summary.staves.length - 1]
        if (!lastStaff || !lastStaff.layers.length) return { parts: "all", highestNoteOnly: false }
        const keys = lastStaff.layers.map((layer) => `${lastStaff.n}.${layer}`)
        return keys.length === allKeys.length ? { parts: "all", highestNoteOnly: false } : { parts: keys, highestNoteOnly: false }
    }

    if (preset === "melody") {
        const firstStaff = summary.staves[0]
        if (!firstStaff || !firstStaff.layers.length) return { parts: "all", highestNoteOnly: false }
        const topKey = `${firstStaff.n}.${firstStaff.layers[0]}`
        return { parts: [topKey], highestNoteOnly: true }
    }

    if (preset === "custom") {
        const validSet = new Set(allKeys)
        const seen = new Set<string>()
        const kept: string[] = []
        for (const key of customParts || []) {
            if (validSet.has(key) && !seen.has(key)) {
                seen.add(key)
                kept.push(key)
            }
        }
        if (!kept.length || kept.length === allKeys.length) {
            return { parts: "all", highestNoteOnly: false }
        }
        return { parts: kept, highestNoteOnly: false }
    }

    return { parts: "all", highestNoteOnly: false }
}

export function getPartNames(summary: MeiSummary): NamedPart[] {
    const isSatb = Boolean(summary.hasTwoLayersPerStaffInEveryBar) && summary.staves.length === 2 && summary.staves[0].layers.length === 2 && summary.staves[1].layers.length === 2
    const result: NamedPart[] = []

    summary.staves.forEach((staff, staffIndex) => {
        staff.layers.forEach((layer, layerIndex) => {
            const key = `${staff.n}.${layer}`
            if (isSatb) {
                result.push({
                    key,
                    staff: staff.n,
                    layer,
                    labelKey: SATB_KEYS[staffIndex * 2 + layerIndex],
                    values: []
                })
                return
            }

            if (staff.layers.length === 1 && summary.staves.length > 1) {
                result.push({
                    key,
                    staff: staff.n,
                    layer,
                    labelKey: "sheet_music.part_staff",
                    values: [String(staffIndex + 1)]
                })
                return
            }

            result.push({
                key,
                staff: staff.n,
                layer,
                labelKey: "sheet_music.part_staff_voice",
                values: [String(staffIndex + 1), String(layerIndex + 1)]
            })
        })
    })

    return result
}

export function parseVersesFilter(raw: string | undefined): "all" | "none" | number[] {
    if (typeof raw !== "string") return "all"
    const trimmed = raw.trim().toLowerCase()
    if (!trimmed || trimmed === "all") return "all"
    if (trimmed === "none") return "none"

    const seen = new Set<number>()
    for (const part of trimmed.split(",")) {
        const piece = part.trim()
        if (!/^\d+$/.test(piece)) continue
        const parsed = Number(piece)
        if (parsed > 0) seen.add(parsed)
    }

    if (!seen.size) return "all"
    return Array.from(seen).sort((a, b) => a - b)
}

export function resolveVersesSelection(raw: string | undefined, availableVerses: readonly number[]): "all" | "none" | number[] {
    const parsed = parseVersesFilter(raw)
    if (!Array.isArray(parsed)) return parsed
    const availableSet = new Set(availableVerses)
    const matching = parsed.filter((verse) => availableSet.has(verse))
    return matching.length > 0 ? matching : "all"
}

export function getDisplayedVersesValue(raw: string | undefined, availableVerses: readonly number[]): string | null {
    const parsed = parseVersesFilter(raw)
    if (!Array.isArray(parsed)) return null
    const availableSet = new Set(availableVerses)
    const hasMatch = parsed.some((verse) => availableSet.has(verse))
    return hasMatch ? null : ""
}

export function parseMeasureRange(raw: string, totalMeasures: number): MeasureRange | null {
    if (typeof raw !== "string" || !Number.isFinite(totalMeasures)) return null
    const maxMeasure = Math.floor(totalMeasures)
    if (maxMeasure < 1) return null

    const trimmed = raw.trim()
    if (!trimmed) return null

    let start: number
    let end: number

    const singleMatch = /^(\d+)$/.exec(trimmed)
    if (singleMatch) {
        start = Number(singleMatch[1])
        end = start
    } else {
        const openEndMatch = /^(\d+)\s*[-–]\s*$/.exec(trimmed)
        if (openEndMatch) {
            start = Number(openEndMatch[1])
            end = maxMeasure
        } else {
            const rangeMatch = /^(\d+)\s*[-–]\s*(\d+)$/.exec(trimmed)
            if (!rangeMatch) return null
            start = Number(rangeMatch[1])
            end = Number(rangeMatch[2])
        }
    }

    if (start < 1 || end < 1 || start > end || start > maxMeasure) return null

    const last = Math.min(end, maxMeasure)
    return { first: start, last }
}

export function resolveMeasureRange(raw: string, measureNumbers: readonly number[]): ResolvedMeasureRange | null {
    if (typeof raw !== "string" || !measureNumbers.length) return null

    const trimmed = raw.trim()
    if (!trimmed) return null

    const minNumber = measureNumbers[0]
    const maxNumber = measureNumbers[measureNumbers.length - 1]

    let start: number
    let end: number

    const singleMatch = /^(\d+)$/.exec(trimmed)
    if (singleMatch) {
        start = Number(singleMatch[1])
        end = start
    } else {
        const openEndMatch = /^(\d+)\s*[-–]\s*$/.exec(trimmed)
        if (openEndMatch) {
            start = Number(openEndMatch[1])
            end = maxNumber
        } else {
            const rangeMatch = /^(\d+)\s*[-–]\s*(\d+)$/.exec(trimmed)
            if (!rangeMatch) return null
            start = Number(rangeMatch[1])
            end = Number(rangeMatch[2])
        }
    }

    if (start < minNumber || start > maxNumber || end < start) return null

    const clampedEnd = Math.min(end, maxNumber)
    const firstIndex = measureNumbers.indexOf(start)
    let lastIndex = -1
    for (let i = measureNumbers.length - 1; i >= 0; i--) {
        if (measureNumbers[i] === clampedEnd) {
            lastIndex = i
            break
        }
    }

    if (firstIndex === -1 || lastIndex === -1 || firstIndex > lastIndex) return null

    return {
        first: firstIndex + 1,
        last: lastIndex + 1,
        firstNumber: start,
        lastNumber: clampedEnd
    }
}

export function formatMeasureRange(first: number, last: number): string {
    return first === last ? String(first) : `${first}-${last}`
}
