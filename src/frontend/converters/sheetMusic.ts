import type { KeySignature, Meter } from "abcjs"
import { uid } from "uid"
import type { Item, Line, Show, Slide, SlideData } from "../../types/Show"
import type { RawAbcElem } from "../components/slide/views/sheetMusic/abcChecks"
import { findSecondTuneLine, getLineIndexAt, getLineStarts, getStaffLines, hasAbcNotes, parseAbcTunes } from "../components/slide/views/sheetMusic/abcChecks"
import type { AbcParseOnly } from "../components/slide/views/sheetMusic/abcjs"
import { normalizeLineEndings } from "../components/slide/views/sheetMusic/abcSource"
import type { AbcAnalysisResult } from "../components/slide/views/sheetMusic/abcToMei"
import { convertAndCheckAbc } from "../components/slide/views/sheetMusic/abcToMei"
import { MAX_NOTATION_SIZE } from "../components/slide/views/sheetMusic/helpers"
import { filterMei, summarizeMei } from "../components/slide/views/sheetMusic/meiParts"
import { resolveVersesSelection } from "../components/slide/views/sheetMusic/parts"

export type SheetMusicImportParts = "all" | "upper" | "lower" | "melody"
export type SheetMusicVerseMode = "per_verse" | "all"
export type SheetMusicSlideGrouping = "breaks" | "2" | "4" | "8"

export interface MeasureSliceRange {
    first: number
    last: number
}

export interface SheetMusicMetadata {
    title?: string
    composer?: string
    author?: string
    copyright?: string
    key?: string
}

export interface SheetMusicImportSlide {
    mei: string
    abc?: string
    measures?: string
}

export interface AbcSystemSlice {
    abc: string
    analysis: AbcAnalysisResult
}

export interface BuildSheetMusicSlidesOptions {
    slides: readonly SheetMusicImportSlide[]
    verseMode: SheetMusicVerseMode
    verseNumbers: readonly number[]
    parts: SheetMusicImportParts
    label: string
    createId?: () => string
}

export interface BuiltSheetMusicSlides {
    slides: { [key: string]: Slide }
    layoutSlides: SlideData[]
    groupCount: number
    slideCount: number
}

export interface BuildSheetMusicShowOptions {
    name: string
    label: string
    category?: string | null
    layoutName?: string
    slides: readonly SheetMusicImportSlide[]
    verseMode: SheetMusicVerseMode
    verseNumbers: readonly number[]
    parts: SheetMusicImportParts
    metadata?: SheetMusicMetadata
    created?: number
    createId?: () => string
}

export const SHEET_MUSIC_ITEM_STYLE = "left:50px;top:40px;width:1820px;height:800px;color:#ffffff;"
export const STAGE_TEXT_ITEM_STYLE = "left:50px;top:860px;width:1820px;height:180px;"
export const STAGE_TEXT_STYLE = "font-size: 50px;"

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

const KEY_TOKEN_PATTERN = /^(?:none|H[Pp]|[A-G][#b]?(?:major|maj|minor|min|m|ionian|ion|dorian|dor|phrygian|phr|lydian|lyd|mixolydian|mix|aeolian|aeo|locrian|loc)?(?:\s+(?:major|maj|minor|min|m|ionian|ion|dorian|dor|phrygian|phr|lydian|lyd|mixolydian|mix|aeolian|aeo|locrian|loc))?)(?=\s|$)/i
const METER_TOKEN_PATTERN = /^(?:[Nn][Oo][Nn][Ee]|C\|?|\(?[0-9+]+(?:\s*\/\s*[0-9]+)?\)?)(?=\s|$)/

function decodeXmlEntities(text: string): string {
    return text.replace(/&(#x[0-9a-fA-F]+|#X[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
        if (entity === "amp") return "&"
        if (entity === "lt") return "<"
        if (entity === "gt") return ">"
        if (entity === "quot") return '"'
        if (entity === "apos") return "'"
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
            const code = parseInt(entity.slice(2), 16)
            return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
        }
        if (entity.startsWith("#")) {
            const code = parseInt(entity.slice(1), 10)
            return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
        }
        return match
    })
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

export function extractAbcMetadata(abc: string): SheetMusicMetadata {
    const normalized = normalizeLineEndings(abc)
    const lines = normalized.split("\n")
    const secondTuneLine = findSecondTuneLine(lines)
    const endLine = secondTuneLine >= 0 ? secondTuneLine : lines.length

    let title = ""
    const composers: string[] = []
    let key = ""
    let inTextBlock = false
    let headerEnded = false

    for (let index = 0; index < endLine; index++) {
        const line = lines[index]
        const trimmed = line.trim()
        if (/^%%begintext\b/i.test(trimmed)) {
            inTextBlock = true
            continue
        }
        if (/^%%endtext\b/i.test(trimmed)) {
            inTextBlock = false
            continue
        }
        if (inTextBlock || !trimmed || trimmed.startsWith("%")) continue

        const cleanLine = line.replace(/(?<!\\)%.*$/, "").trim()
        if (!headerEnded) {
            if (!title && /^T:/.test(cleanLine)) {
                title = cleanLine.slice(2).trim()
                continue
            }
            if (/^C:/.test(cleanLine)) {
                const value = cleanLine.slice(2).trim()
                if (value) composers.push(value)
                continue
            }
            if (/^K:/.test(cleanLine)) {
                const rawKey = cleanLine.slice(2).trim()
                const tokenMatch = KEY_TOKEN_PATTERN.exec(rawKey)
                const token = tokenMatch ? tokenMatch[0].replace(/\s+/g, " ").trim() : ""
                if (token && token.toLowerCase() !== "none") key = token
                headerEnded = true
                continue
            }
            if (!/^[A-Za-z]:/.test(cleanLine)) {
                headerEnded = true
            }
        }
    }

    const metadata: SheetMusicMetadata = {}
    if (title) metadata.title = title
    if (composers.length) metadata.composer = composers.join(" ")
    if (key) metadata.key = key
    return metadata
}

interface RawSyllable {
    text: string
    continuesWord: boolean
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

    return result.trim()
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

function formatAbcKeySignature(key: KeySignature | undefined): string {
    if (!key || !key.root) return ""
    if (key.root === "none") return "none"
    if (key.root === "HP" || key.root === "Hp") return key.root
    const accidental = key.acc === "sharp" ? "#" : key.acc === "flat" ? "b" : key.acc || ""
    const mode = key.mode || ""
    return `${key.root}${accidental}${mode}`
}

function formatAbcMeter(meter: Meter | undefined): string {
    if (!meter) return "none"
    if (meter.type === "common_time") return "C"
    if (meter.type === "cut_time") return "C|"
    if (meter.type === "specified" && meter.value && meter.value.length > 0) {
        return meter.value
            .map((entry) => (entry.den ? `${entry.num}/${entry.den}` : entry.num))
            .filter(Boolean)
            .join("+")
    }
    return "none"
}

function replaceFieldToken(field: "K" | "M", valuePart: string, replacement: string): string {
    if (!valuePart) return replacement
    const pattern = field === "K" ? KEY_TOKEN_PATTERN : METER_TOKEN_PATTERN
    const match = pattern.exec(valuePart)
    if (match) return `${replacement}${valuePart.slice(match[0].length)}`
    return `${replacement} ${valuePart}`
}

function updateSliceHeaderField(headerLines: readonly string[], field: "K" | "M", value: string): string[] {
    const cleanValue = value.trim()
    if (!cleanValue) return [...headerLines]

    const updated = [...headerLines]
    const linePattern = new RegExp(`^(\\s*${field}:\\s*)([^%\\n]*?)(\\s*%.*)?$`)
    let inTextBlock = false
    let lastMatchIndex = -1

    for (let index = 0; index < updated.length; index++) {
        const trimmed = updated[index].trim()
        if (/^%%begintext\b/i.test(trimmed)) {
            inTextBlock = true
            continue
        }
        if (/^%%endtext\b/i.test(trimmed)) {
            inTextBlock = false
            continue
        }
        if (inTextBlock || !trimmed || trimmed.startsWith("%")) continue
        if (linePattern.test(updated[index])) lastMatchIndex = index
    }

    if (lastMatchIndex >= 0) {
        const match = linePattern.exec(updated[lastMatchIndex])!
        updated[lastMatchIndex] = `${match[1]}${replaceFieldToken(field, match[2], cleanValue)}${match[3] || ""}`
        return updated
    }

    let insertIndex = updated.length
    if (field === "M") {
        const keyIndex = updated.findIndex((line) => /^\s*K:/.test(line))
        if (keyIndex >= 0) insertIndex = keyIndex
    }
    updated.splice(insertIndex, 0, `${field}: ${cleanValue}`)
    return updated
}

function stripInlineComment(line: string): string {
    return line.replace(/(?<!\\)%.*$/, "").trim()
}

function hasVoiceAttributes(voiceLine: string): boolean {
    const clean = stripInlineComment(voiceLine)
    const match = /^V:\s*([^\s]+)(.*)$/.exec(clean)
    return Boolean(match && match[2].trim().length > 0)
}

function isContinuationLine(line: string): boolean {
    return /\\\s*$/.test(stripInlineComment(line))
}

export function splitAbcIntoSystemTexts(abc: string, parseOnly: AbcParseOnly): string[] {
    const normalized = normalizeLineEndings(abc)
    if (!normalized.trim()) return []

    const tunes = parseAbcTunes(normalized, parseOnly)
    const tune = tunes[0]
    if (!tune || !hasAbcNotes(tune)) return []

    const sourceLines = normalized.split("\n")
    const lineStarts = getLineStarts(normalized)
    const secondTuneLine = tunes.length > 1 ? findSecondTuneLine(sourceLines) : -1
    const endLine = secondTuneLine >= 0 ? secondTuneLine : sourceLines.length
    const staffLines = getStaffLines(tune)
    if (!staffLines.length) return []

    // Map each system to the source line indices of its music rows
    const systemMusicRows: Set<number>[] = []
    let firstMusicLine = endLine

    for (const staffLine of staffLines) {
        const rows = new Set<number>()
        for (const staff of staffLine.staff) {
            for (const voice of staff.voices || []) {
                for (const element of voice as RawAbcElem[]) {
                    if (element.startChar === undefined || !Number.isFinite(element.startChar)) continue
                    const startRow = getLineIndexAt(lineStarts, element.startChar)
                    if (startRow < endLine) {
                        rows.add(startRow)
                        if (startRow < firstMusicLine) firstMusicLine = startRow
                    }
                    if (element.endChar !== undefined && Number.isFinite(element.endChar) && element.endChar > element.startChar) {
                        const endRow = getLineIndexAt(lineStarts, element.endChar - 1)
                        if (endRow < endLine) {
                            rows.add(endRow)
                            if (endRow < firstMusicLine) firstMusicLine = endRow
                        }
                    }
                }
            }
        }

        // Pull in any trailing continuation row if a music row ends with a backslash
        for (const rowIndex of Array.from(rows).sort((a, b) => a - b)) {
            let cursor = rowIndex
            while (cursor + 1 < endLine && isContinuationLine(sourceLines[cursor])) {
                cursor++
                rows.add(cursor)
            }
        }

        systemMusicRows.push(rows)
    }

    if (firstMusicLine >= endLine) return []

    // Build header lines (everything before the first music row, excluding W: lines)
    const headerLines: string[] = []
    const headerDeclaredVoices = new Set<string>()
    let seenHeaderKey = false
    let lastHeaderVoice: string | null = null
    let inTextBlock = false

    for (let index = 0; index < firstMusicLine; index++) {
        const line = sourceLines[index]
        const trimmed = line.trim()
        if (/^%%begintext\b/i.test(trimmed)) {
            inTextBlock = true
            headerLines.push(line)
            continue
        }
        if (/^%%endtext\b/i.test(trimmed)) {
            inTextBlock = false
            headerLines.push(line)
            continue
        }
        if (!inTextBlock && /^W:/.test(trimmed)) continue

        headerLines.push(line)
        if (inTextBlock || !trimmed || trimmed.startsWith("%")) continue

        const clean = stripInlineComment(line)
        if (/^K:/.test(clean)) {
            seenHeaderKey = true
            lastHeaderVoice = null
            continue
        }
        const voiceMatch = /^V:\s*([^\s]+)/.exec(clean)
        if (voiceMatch) {
            headerDeclaredVoices.add(voiceMatch[1])
            if (seenHeaderKey) lastHeaderVoice = voiceMatch[1]
        }
    }

    // Track voice state, body voice declarations, and body %%score/%%staves directives across all source lines
    const bodyVoiceDeclarations = new Map<string, string>()
    const rowVoiceBefore = new Map<number, string | null>()
    const rowStartsWithInlineVoice = new Set<number>()
    const rowEndingInlineVoice = new Map<number, string>()
    const bodyScoreDirectives: { lineIndex: number; text: string }[] = []

    let runningVoice: string | null = lastHeaderVoice
    inTextBlock = false
    for (let index = firstMusicLine; index < endLine; index++) {
        const line = sourceLines[index]
        const trimmed = line.trim()
        if (/^%%begintext\b/i.test(trimmed)) {
            inTextBlock = true
            continue
        }
        if (/^%%endtext\b/i.test(trimmed)) {
            inTextBlock = false
            continue
        }
        if (inTextBlock || !trimmed) continue

        if (/^%%(?:score|staves)\s+/i.test(trimmed)) {
            bodyScoreDirectives.push({ lineIndex: index, text: line })
            continue
        }
        if (trimmed.startsWith("%")) continue

        const clean = stripInlineComment(line)
        const voiceHeader = /^V:\s*([^\s]+)/.exec(clean)
        if (voiceHeader) {
            const voiceId = voiceHeader[1]
            runningVoice = voiceId
            const existing = bodyVoiceDeclarations.get(voiceId)
            if (!existing || (!hasVoiceAttributes(existing) && hasVoiceAttributes(line))) {
                bodyVoiceDeclarations.set(voiceId, line)
            }
            continue
        }

        if (/^[A-Za-z+]:/.test(clean)) continue

        if (/^\s*\[V:\s*([^\s\]]+)/.test(clean)) {
            rowStartsWithInlineVoice.add(index)
        } else {
            rowVoiceBefore.set(index, runningVoice)
        }

        const inlineMatches = clean.match(/\[V:\s*([^\s\]]+)/g)
        if (inlineMatches && inlineMatches.length > 0) {
            const lastInline = inlineMatches[inlineMatches.length - 1].replace(/^\[V:\s*/, "")
            runningVoice = lastInline
            rowEndingInlineVoice.set(index, lastInline)
        }
    }

    // Attach w: and +: lyric rows immediately following each music row
    const attachedLyricsByRow = new Map<number, number[]>()
    const allMusicRows = new Set<number>()
    for (const rows of systemMusicRows) {
        for (const rowIndex of rows) allMusicRows.add(rowIndex)
    }

    for (const rowIndex of allMusicRows) {
        const attached: number[] = []
        for (let cursor = rowIndex + 1; cursor < endLine; cursor++) {
            const trimmed = sourceLines[cursor].trim()
            if (/^(?:w|\+):/.test(trimmed)) {
                attached.push(cursor)
                continue
            }
            if (trimmed.startsWith("%") && !trimmed.startsWith("%%")) {
                continue
            }
            break
        }
        if (attached.length) attachedLyricsByRow.set(rowIndex, attached)
    }

    // Track active key and time signature at the start of each system
    const initialKeyText = formatAbcKeySignature(staffLines[0].staff[0]?.key)
    const initialMeterText = formatAbcMeter(staffLines[0].staff[0]?.meter)
    let runningMeter: Meter | undefined = staffLines[0].staff[0]?.meter

    const slices: string[] = []

    for (let systemIndex = 0; systemIndex < staffLines.length; systemIndex++) {
        const staffLine = staffLines[systemIndex]
        const sortedRows = Array.from(systemMusicRows[systemIndex]).sort((a, b) => a - b)

        const systemKeyText = formatAbcKeySignature(staffLine.staff[0]?.key)
        if (systemIndex > 0 && staffLine.staff[0]?.meter) {
            runningMeter = staffLine.staff[0].meter
        }
        const systemMeterText = formatAbcMeter(runningMeter)

        // Advance runningMeter for any inline [M:...] changes inside this system
        let meterChangeFromPrimary: Meter | undefined
        let meterChangeFallback: Meter | undefined
        staffLine.staff.forEach((staff, staffIndex) => {
            ;(staff.voices || []).forEach((voice, voiceIndex) => {
                for (const element of voice as RawAbcElem[]) {
                    if (element.el_type === "meter") {
                        const meterValue = element as unknown as Meter
                        if (staffIndex === 0 && voiceIndex === 0) meterChangeFromPrimary = meterValue
                        else meterChangeFallback = meterValue
                    }
                }
            })
        })
        if (meterChangeFromPrimary) runningMeter = meterChangeFromPrimary
        else if (meterChangeFallback) runningMeter = meterChangeFallback

        if (!sortedRows.length) continue

        let sliceHeader = [...headerLines]
        if (systemKeyText && systemKeyText !== initialKeyText) {
            sliceHeader = updateSliceHeaderField(sliceHeader, "K", systemKeyText)
        }
        if (systemMeterText && systemMeterText !== initialMeterText) {
            sliceHeader = updateSliceHeaderField(sliceHeader, "M", systemMeterText)
        }

        // Apply the latest body %%score/%%staves directive that precedes this system's first row
        const firstSystemRow = sortedRows[0]
        let latestBodyScore = ""
        for (const directive of bodyScoreDirectives) {
            if (directive.lineIndex < firstSystemRow) latestBodyScore = directive.text
        }
        if (latestBodyScore) {
            const existingScoreIndex = sliceHeader.findIndex((line) => /^\s*%%(?:score|staves)\s+/i.test(line))
            if (existingScoreIndex >= 0) sliceHeader[existingScoreIndex] = latestBodyScore
            else sliceHeader.push(latestBodyScore)
        }

        const sliceLines = [...sliceHeader]
        let activeSliceVoice: string | null = lastHeaderVoice
        const emittedBodyDecls = new Set<string>()

        for (const rowIndex of sortedRows) {
            if (!rowStartsWithInlineVoice.has(rowIndex)) {
                const neededVoice = rowVoiceBefore.get(rowIndex) ?? null
                if (neededVoice && neededVoice !== activeSliceVoice) {
                    const bodyDecl = bodyVoiceDeclarations.get(neededVoice)
                    if (!headerDeclaredVoices.has(neededVoice) && !emittedBodyDecls.has(neededVoice) && bodyDecl) {
                        sliceLines.push(bodyDecl)
                        emittedBodyDecls.add(neededVoice)
                    } else {
                        sliceLines.push(`V: ${neededVoice}`)
                    }
                    activeSliceVoice = neededVoice
                }
            }

            sliceLines.push(sourceLines[rowIndex])

            const endedVoice = rowEndingInlineVoice.get(rowIndex)
            if (endedVoice) activeSliceVoice = endedVoice

            const lyrics = attachedLyricsByRow.get(rowIndex)
            if (lyrics) {
                for (const lyricIndex of lyrics) {
                    sliceLines.push(sourceLines[lyricIndex])
                }
            }
        }

        slices.push(sliceLines.join("\n"))
    }

    return slices
}

export function sliceAbcIntoSystems(abc: string, parseOnly: AbcParseOnly): AbcSystemSlice[] {
    const texts = splitAbcIntoSystemTexts(abc, parseOnly)
    return texts.map((sliceAbc, index) => ({
        abc: sliceAbc,
        analysis: convertAndCheckAbc(sliceAbc, parseOnly, { hideInitialMeter: index > 0 })
    }))
}

export function getFirstSlideVerses(verseMode: SheetMusicVerseMode, verseNumbers: readonly number[]): string {
    return verseMode === "per_verse" && verseNumbers.length > 1 ? String(verseNumbers[0]) : ""
}

function createSlideItems(slide: SheetMusicImportSlide, label: string, parts: SheetMusicImportParts, verseNumber?: number): Item[] {
    const sheetMusic: NonNullable<Item["sheet_music"]> = {
        data: slide.mei,
        size: MAX_NOTATION_SIZE
    }
    if (slide.abc) sheetMusic.abc = slide.abc
    if (label) sheetMusic.label = label
    if (slide.measures) sheetMusic.measures = slide.measures
    if (parts !== "all") sheetMusic.parts = parts
    if (verseNumber !== undefined) sheetMusic.verses = String(verseNumber)

    const sheetMusicItem: Item = {
        type: "sheet_music",
        style: SHEET_MUSIC_ITEM_STYLE,
        sheet_music: sheetMusic
    }

    const lyricLines: Line[] = extractSlideLyrics(slide.mei, verseNumber).map((value) => ({
        align: "",
        text: [{ value, style: STAGE_TEXT_STYLE }]
    }))

    const textItem: Item = {
        type: "text",
        style: STAGE_TEXT_ITEM_STYLE,
        align: "",
        textFit: "shrinkToFit",
        bindings: ["stage"],
        lines: lyricLines
    }

    return [sheetMusicItem, textItem]
}

export function buildSheetMusicSlidesAndLayout(options: BuildSheetMusicSlidesOptions): BuiltSheetMusicSlides {
    const createId = options.createId || uid
    const slidesMap: { [key: string]: Slide } = {}
    const layoutSlides: SlideData[] = []

    if (!options.slides.length) {
        return { slides: slidesMap, layoutSlides, groupCount: 0, slideCount: 0 }
    }

    const usePerVerseGroups = options.verseMode === "per_verse" && options.verseNumbers.length > 1
    const groupVerses: (number | undefined)[] = usePerVerseGroups ? [...options.verseNumbers] : [undefined]

    let totalSlideCount = 0
    for (const verseNumber of groupVerses) {
        const parentId = createId()
        const childIds: string[] = []

        options.slides.forEach((slideSource, slideIndex) => {
            const items = createSlideItems(slideSource, options.label, options.parts, verseNumber)
            totalSlideCount++

            if (slideIndex === 0) {
                slidesMap[parentId] = {
                    group: "verse",
                    color: "",
                    globalGroup: "verse",
                    settings: {},
                    notes: "",
                    items
                }
                return
            }

            const childId = createId()
            childIds.push(childId)
            slidesMap[childId] = {
                group: null,
                color: null,
                settings: {},
                notes: "",
                items
            }
        })

        if (childIds.length > 0) {
            slidesMap[parentId].children = childIds
        }
        layoutSlides.push({ id: parentId })
    }

    return {
        slides: slidesMap,
        layoutSlides,
        groupCount: groupVerses.length,
        slideCount: totalSlideCount
    }
}

export function buildSheetMusicShow(options: BuildSheetMusicShowOptions): Show {
    const createId = options.createId || uid
    const layoutId = createId()
    const created = options.created ?? Date.now()
    const built = buildSheetMusicSlidesAndLayout({
        slides: options.slides,
        verseMode: options.verseMode,
        verseNumbers: options.verseNumbers,
        parts: options.parts,
        label: options.label,
        createId
    })

    const meta: Show["meta"] = {}
    if (options.metadata?.title?.trim()) meta.title = options.metadata.title.trim()
    if (options.metadata?.composer?.trim()) meta.composer = options.metadata.composer.trim()
    if (options.metadata?.author?.trim()) meta.author = options.metadata.author.trim()
    if (options.metadata?.copyright?.trim()) meta.copyright = options.metadata.copyright.trim()
    if (options.metadata?.key?.trim()) meta.key = options.metadata.key.trim()

    return {
        name: options.name,
        private: false,
        category: options.category ?? null,
        settings: {
            activeLayout: layoutId,
            template: null
        },
        timestamps: {
            created,
            modified: null,
            used: null
        },
        quickAccess: {},
        meta,
        slides: built.slides,
        layouts: {
            [layoutId]: {
                name: options.layoutName || "Default",
                notes: "",
                slides: built.layoutSlides
            }
        },
        media: {}
    }
}
