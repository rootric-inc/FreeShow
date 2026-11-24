import { decodeXmlEntities } from "../../../../../../public/assets/sheet-music/mei.mjs"
import { filterMei, summarizeMei } from "./meiParts"
import { resolveVersesSelection } from "./parts"

export type SheetMusicSlideGrouping = "breaks" | "2" | "4" | "8"

export interface MeasureSliceRange {
    first: number
    last: number
}

interface RawSyllable {
    text: string
    continuesWord: boolean
}

const MAJOR_KEYS_BY_SIG: Record<string, string> = {
    "0": "C",
    "1s": "G",
    "2s": "D",
    "3s": "A",
    "4s": "E",
    "5s": "B",
    "6s": "F#",
    "7s": "C#",
    "1f": "F",
    "2f": "Bb",
    "3f": "Eb",
    "4f": "Ab",
    "5f": "Db",
    "6f": "Gb",
    "7f": "Cb"
}

const MINOR_KEYS_BY_SIG: Record<string, string> = {
    "0": "Am",
    "1s": "Em",
    "2s": "Bm",
    "3s": "F#m",
    "4s": "C#m",
    "5s": "G#m",
    "6s": "D#m",
    "7s": "A#m",
    "1f": "Dm",
    "2f": "Gm",
    "3f": "Cm",
    "4f": "Fm",
    "5f": "Bbm",
    "6f": "Ebm",
    "7f": "Abm"
}

function readTagAttribute(attrs: string, name: string): string | null {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs)
    if (!match) return null
    return match[1] !== undefined ? match[1] : match[2]
}

export function getLineBreakSlideStarts(mei: string): number[] {
    if (!mei || typeof mei !== "string") return []

    const tagPattern = /<(measure|sb|pb)\b([^>]*)>/g
    const starts: number[] = []
    let measureCount = 0
    let pendingBreak = false
    let match: RegExpExecArray | null

    while ((match = tagPattern.exec(mei)) !== null) {
        const tagName = match[1]
        if (tagName === "sb" || tagName === "pb") {
            if (measureCount > 0) pendingBreak = true
            continue
        }

        measureCount++
        if (measureCount === 1 || pendingBreak) {
            starts.push(measureCount)
            pendingBreak = false
        }
    }

    return starts
}

export function hasMeiLineBreaks(mei: string): boolean {
    return getLineBreakSlideStarts(mei).length > 1
}

export function getFixedMeasureSlideStarts(totalMeasures: number, measuresPerSlide: number): number[] {
    const count = Math.floor(totalMeasures)
    const step = Math.floor(measuresPerSlide)
    if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(step) || step <= 0) return []

    const starts: number[] = []
    for (let position = 1; position <= count; position += step) {
        starts.push(position)
    }
    return starts
}

export function buildMeasureSliceRanges(totalMeasures: number, starts: readonly number[]): MeasureSliceRange[] {
    const count = Math.floor(totalMeasures)
    if (!Number.isFinite(count) || count <= 0) return []

    const normalizedStarts = Array.from(new Set(starts.map((start) => Math.floor(start)).filter((start) => Number.isFinite(start) && start >= 1 && start <= count))).sort((a, b) => a - b)

    if (!normalizedStarts.length || normalizedStarts[0] !== 1) {
        normalizedStarts.unshift(1)
    }

    const ranges: MeasureSliceRange[] = []
    for (let index = 0; index < normalizedStarts.length; index++) {
        const first = normalizedStarts[index]
        const nextStart = normalizedStarts[index + 1]
        const last = nextStart !== undefined ? nextStart - 1 : count
        if (last >= first) ranges.push({ first, last })
    }
    return ranges
}

export function getFileSlideRanges(mei: string, totalMeasures: number, grouping: SheetMusicSlideGrouping): MeasureSliceRange[] {
    const starts = grouping === "breaks" ? getLineBreakSlideStarts(mei) : getFixedMeasureSlideStarts(totalMeasures, Number(grouping))
    return buildMeasureSliceRanges(totalMeasures, starts)
}

export function extractKeyFromMei(mei: string): string {
    if (!mei || typeof mei !== "string") return ""
    const scoreDefMatch = /<scoreDef\b[^>]*\/>|<scoreDef\b[^>]*>[\s\S]*?<\/scoreDef>/.exec(mei)
    if (!scoreDefMatch) return ""
    const block = scoreDefMatch[0]

    let sig: string | null = null
    let mode: string | null = null

    const keySigElement = /<keySig\b([^>]*)\/?>/.exec(block)
    if (keySigElement) {
        sig = readTagAttribute(keySigElement[1], "sig")
        mode = readTagAttribute(keySigElement[1], "mode")
    }

    if (sig === null) {
        const scoreTag = /<scoreDef\b([^>]*)>/.exec(block)
        if (scoreTag) {
            sig = readTagAttribute(scoreTag[1], "keysig") || readTagAttribute(scoreTag[1], "key.sig")
            mode = readTagAttribute(scoreTag[1], "key.mode")
        }
    }

    if (sig === null) {
        const staffTag = /<staffDef\b([^>]*)>/.exec(block)
        if (staffTag) {
            sig = readTagAttribute(staffTag[1], "keysig") || readTagAttribute(staffTag[1], "key.sig")
            mode = readTagAttribute(staffTag[1], "key.mode")
        }
    }

    if (!sig) return ""
    const cleanSig = sig.trim().toLowerCase()
    const isMinor = typeof mode === "string" && mode.trim().toLowerCase() === "minor"
    const table = isMinor ? MINOR_KEYS_BY_SIG : MAJOR_KEYS_BY_SIG
    return table[cleanSig] || ""
}

function joinSyllables(syllables: readonly RawSyllable[]): string {
    let result = ""
    let pendingDash = false

    for (const syllable of syllables) {
        const cleaned = decodeXmlEntities(syllable.text)
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim()

        if (!cleaned) {
            if (syllable.continuesWord) pendingDash = true
            continue
        }

        if (!result) {
            result = cleaned
        } else if (pendingDash) {
            result += cleaned
        } else {
            result += ` ${cleaned}`
        }

        pendingDash = syllable.continuesWord
    }

    const trimmed = result.trim()
    if (pendingDash && trimmed && !trimmed.endsWith("-")) {
        return `${trimmed}-`
    }
    return trimmed
}

function extractLyricsByVerseFromMei(mei: string): string[] {
    if (!mei || typeof mei !== "string") return []

    const syllablesByVerse = new Map<number, RawSyllable[]>()
    const measurePattern = /<measure\b[^>]*>([\s\S]*?)<\/measure>/g
    const staffPattern = /<staff\b([^>]*)>([\s\S]*?)<\/staff>/g
    const layerPattern = /<layer\b([^>]*)>([\s\S]*?)<\/layer>/g
    const versePattern = /<verse\b([^>]*)>([\s\S]*?)<\/verse>/g
    const sylPattern = /<syl\b([^>]*)>([\s\S]*?)<\/syl>|<syl\b([^>]*)\/>/g

    let measureMatch: RegExpExecArray | null
    while ((measureMatch = measurePattern.exec(mei)) !== null) {
        const measureBody = measureMatch[1]
        // Within one measure, take each verse from the first staff/layer that carries it so multi-voice doubles do not repeat words
        const versesTakenInMeasure = new Set<number>()

        staffPattern.lastIndex = 0
        let staffMatch: RegExpExecArray | null
        while ((staffMatch = staffPattern.exec(measureBody)) !== null) {
            const staffBody = staffMatch[2]
            layerPattern.lastIndex = 0
            let layerMatch: RegExpExecArray | null
            while ((layerMatch = layerPattern.exec(staffBody)) !== null) {
                const layerBody = layerMatch[2]
                if (!layerBody.includes("<verse")) continue

                const layerVerses = new Map<number, RawSyllable[]>()
                versePattern.lastIndex = 0
                let verseMatch: RegExpExecArray | null
                while ((verseMatch = versePattern.exec(layerBody)) !== null) {
                    const rawN = readTagAttribute(verseMatch[1], "n")
                    const verseNumber = rawN === null ? 1 : /^\d+$/.test(rawN.trim()) ? Number(rawN.trim()) : null
                    if (verseNumber === null || verseNumber <= 0 || versesTakenInMeasure.has(verseNumber)) continue

                    const verseBody = verseMatch[2]
                    sylPattern.lastIndex = 0
                    let sylMatch: RegExpExecArray | null
                    while ((sylMatch = sylPattern.exec(verseBody)) !== null) {
                        const attrs = sylMatch[1] !== undefined ? sylMatch[1] : sylMatch[3] || ""
                        const rawText = sylMatch[2] !== undefined ? sylMatch[2].replace(/<[^>]+>/g, "") : ""
                        const connector = readTagAttribute(attrs, "con")
                        let bucket = layerVerses.get(verseNumber)
                        if (!bucket) {
                            bucket = []
                            layerVerses.set(verseNumber, bucket)
                        }
                        bucket.push({ text: rawText, continuesWord: connector === "d" })
                    }
                }

                for (const [verseNumber, syllables] of layerVerses) {
                    versesTakenInMeasure.add(verseNumber)
                    let total = syllablesByVerse.get(verseNumber)
                    if (!total) {
                        total = []
                        syllablesByVerse.set(verseNumber, total)
                    }
                    total.push(...syllables)
                }
            }
        }
    }

    const sortedVerses = Array.from(syllablesByVerse.keys()).sort((a, b) => a - b)
    const lines: string[] = []
    for (const verseNumber of sortedVerses) {
        const line = joinSyllables(syllablesByVerse.get(verseNumber) || [])
        if (line) lines.push(line)
    }
    return lines
}

export function extractSlideLyrics(mei: string, verseNumber?: number): string[] {
    if (!mei || typeof mei !== "string") return []
    if (verseNumber === undefined) {
        return extractLyricsByVerseFromMei(mei)
    }

    const summary = summarizeMei(mei)
    const resolvedVerses = resolveVersesSelection(String(verseNumber), summary.verses)
    const filteredMei = filterMei(mei, { parts: "all", verses: resolvedVerses })
    return extractLyricsByVerseFromMei(filteredMei)
}
