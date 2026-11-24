import type { KeySignature, Meter } from "abcjs"
import type { RawAbcElem } from "./abcChecks"
import { findSecondTuneLine, getLineIndexAt, getLineStarts, getStaffLines, hasAbcNotes, parseAbcTunes, splitTuneIntoMeasures } from "./abcChecks"
import type { AbcParseOnly } from "./abcjs"
import { KEY_TOKEN_PATTERN, normalizeLineEndings, updateAbcHeaderField } from "./abcSource"
import type { AbcAnalysisResult, RawNotePitch } from "./abcToMei"
import { PITCH_NAMES, convertAndCheckAbc, createTuneAccidentalTracker, getKeyAccidentalMap } from "./abcToMei"

export interface AbcMetadata {
    title?: string
    composer?: string
    author?: string
    copyright?: string
    key?: string
}

export interface AbcSystemSlice {
    abc: string
    analysis: AbcAnalysisResult
}

interface VoiceHeaderSettings {
    clef?: string
    octave?: string
}

interface AccidentalInjection {
    rowIndex: number
    colOffset: number
    prefix: string
}

interface PreparedAbcSlice {
    abc: string
    hideInitialMeter: boolean
}

const MEI_TO_ABC_ACCIDENTAL: Record<string, string> = { s: "^", f: "_", n: "=", x: "^^", ff: "__" }
const BAR_TYPE_TO_ABC: Record<string, string> = {
    bar_thin: "|",
    bar_thin_thin: "||",
    bar_thin_thick: "|]",
    bar_right_repeat: ":|",
    bar_dbl_repeat: "::"
}
const KEY_ACCIDENTAL_TOKEN = /^(?:exp|(?:(?:\^\^|\^|__|_|=)[A-Ga-g])+)$/i
const CREDIT_LABEL_PATTERN = /\b(words|text|music\s+and\s+setting|music|tune|setting)\s*:/gi
const INLINE_FIELD_ONLY_LINE = /^(?:\[[A-Za-z]:[^\]]*\]\s*)+$/

function stripInlineComment(line: string): string {
    return line.replace(/(?<!\\)%.*$/, "").trim()
}

function isSinglePercentComment(trimmed: string): boolean {
    return trimmed.startsWith("%") && !/^%%[A-Za-z]/.test(trimmed)
}

function hasVoiceAttributes(voiceLine: string): boolean {
    const clean = stripInlineComment(voiceLine)
    const match = /^V:\s*([^\s]+)(.*)$/.exec(clean)
    return Boolean(match && match[2].trim().length > 0)
}

function isContinuationLine(line: string): boolean {
    return /\\\s*$/.test(stripInlineComment(line))
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

function getDefaultLengthForMeter(meterText: string): string {
    const trimmed = meterText.trim()
    if (!trimmed || trimmed.toLowerCase() === "none" || trimmed === "C" || trimmed === "C|") {
        return "1/8"
    }
    const clean = trimmed.replace(/[()]/g, "")
    const parts = clean.split("/")
    if (parts.length !== 2) return "1/8"
    const numerator = parts[0]
        .split("+")
        .map((value) => Number(value.trim()))
        .reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
    const denominator = Number(parts[1].trim())
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
        return "1/8"
    }
    return numerator / denominator < 0.75 ? "1/16" : "1/8"
}

function parseKeySpec(rawBody: string): string {
    const trimmed = rawBody.trim()
    if (!trimmed) return ""
    const match = KEY_TOKEN_PATTERN.exec(trimmed)
    if (!match) return ""
    const head = match[0].replace(/\s+/g, " ").trim()
    const restTokens = trimmed
        .slice(match[0].length)
        .trim()
        .split(/\s+/)
        .filter((token) => KEY_ACCIDENTAL_TOKEN.test(token))
    return restTokens.length ? `${head} ${restTokens.join(" ")}` : head
}

function replaceKeyLineValue(line: string, newKeySpec: string): string {
    const match = /^(\s*K:\s*)([^%\n]*?)(\s*%.*)?$/.exec(line)
    if (!match) return line
    const prefix = match[1]
    const body = match[2].trim()
    const comment = match[3] || ""
    const keyMatch = KEY_TOKEN_PATTERN.exec(body)
    const afterKey = keyMatch ? body.slice(keyMatch[0].length).trim() : body
    const keptParams = afterKey
        .split(/\s+/)
        .filter((token) => token && !KEY_ACCIDENTAL_TOKEN.test(token))
        .join(" ")
    const combined = keptParams ? `${newKeySpec} ${keptParams}` : newKeySpec
    return `${prefix}${combined}${comment}`
}

function updateSliceKeyLine(headerText: string, newKeySpec: string): string {
    const cleanValue = newKeySpec.trim()
    if (!cleanValue) return headerText
    const lines = headerText.split("\n")
    let inBlock = false
    for (let index = 0; index < lines.length; index++) {
        const trimmed = lines[index].trim()
        if (/^%%begin(?:text|ps)\b/i.test(trimmed)) {
            inBlock = true
            continue
        }
        if (/^%%end(?:text|ps)\b/i.test(trimmed)) {
            inBlock = false
            continue
        }
        if (inBlock || !trimmed || trimmed.startsWith("%")) continue
        if (/^\s*K:/.test(lines[index])) {
            lines[index] = replaceKeyLineValue(lines[index], cleanValue)
            return lines.join("\n")
        }
    }
    return updateAbcHeaderField(headerText, "K", cleanValue)
}

function extractKeyTextFromElement(element: RawAbcElem, normalized: string): string {
    if (element.startChar !== undefined && element.endChar !== undefined && element.endChar > element.startChar) {
        const raw = normalized.slice(element.startChar, element.endChar).trim()
        const inlineMatch = /^\[K:([^\]]*)\]/.exec(raw)
        if (inlineMatch) return parseKeySpec(stripInlineComment(inlineMatch[1]))
        const lineMatch = /^K:(.*)$/.exec(raw)
        if (lineMatch) return parseKeySpec(stripInlineComment(lineMatch[1]))
    }
    return ""
}

function getLastHeaderVoiceAfterKey(sliceHeader: string[]): string | null {
    let seenKey = false
    let inBlock = false
    let lastVoice: string | null = null
    for (const line of sliceHeader) {
        const trimmed = line.trim()
        if (/^%%begin(?:text|ps)\b/i.test(trimmed)) {
            inBlock = true
            continue
        }
        if (/^%%end(?:text|ps)\b/i.test(trimmed)) {
            inBlock = false
            continue
        }
        if (inBlock || !trimmed || trimmed.startsWith("%")) continue
        const clean = stripInlineComment(line)
        if (/^K:/.test(clean)) {
            seenKey = true
            lastVoice = null
            continue
        }
        if (seenKey) {
            const voiceMatch = /^V:\s*([^\s]+)/.exec(clean)
            if (voiceMatch) lastVoice = voiceMatch[1]
        }
    }
    return lastVoice
}

function appendClosingBarToRow(rowText: string, barToken: string | undefined): string {
    if (!barToken) return rowText
    const match = /^((?:\\.|[^%\n\\])*?)(\s*\\\s*)?(\s*(?<!\\)%.*)?$/.exec(rowText)
    if (!match) return `${rowText} ${barToken}`
    const body = match[1]
    const continuation = match[2] || ""
    const comment = match[3] || ""
    return `${body.trimEnd()} ${barToken}${continuation}${comment}`
}

function parseClefAndOctave(paramText: string): VoiceHeaderSettings {
    const settings: VoiceHeaderSettings = {}
    const explicitClef = /(?:^|\s)clef\s*=\s*([^\s%\]]+)/i.exec(paramText)
    if (explicitClef) {
        settings.clef = explicitClef[1]
    } else {
        const bareClef = /(?:^|\s)((?:treble|bass|alto|tenor|perc)(?:[+-]8)?)(?=\s|$|%|\])/i.exec(paramText)
        if (bareClef) settings.clef = bareClef[1]
    }
    const octaveMatch = /(?:^|\s)octave\s*=\s*([+-]?\d+)/i.exec(paramText)
    if (octaveMatch) settings.octave = octaveMatch[1]
    return settings
}

function mergeVoiceSettings(target: Map<string, VoiceHeaderSettings>, voiceId: string, incoming: VoiceHeaderSettings): void {
    if (!incoming.clef && !incoming.octave) return
    const existing = target.get(voiceId) || {}
    const next: VoiceHeaderSettings = { ...existing }
    if (incoming.clef) next.clef = incoming.clef
    if (incoming.octave) next.octave = incoming.octave
    target.set(voiceId, next)
}

function cloneVoiceSettingsMap(source: Map<string, VoiceHeaderSettings>): Map<string, VoiceHeaderSettings> {
    const copy = new Map<string, VoiceHeaderSettings>()
    for (const [voiceId, settings] of source) {
        copy.set(voiceId, { ...settings })
    }
    return copy
}

function updateFieldParameter(line: string, paramName: "clef" | "octave", paramValue: string | undefined): string {
    const commentMatch = /^([^%\n]*?)(\s*%.*)?$/.exec(line)
    const body = commentMatch ? commentMatch[1] : line
    const comment = commentMatch && commentMatch[2] ? commentMatch[2] : ""
    const pattern = new RegExp(`(\\s+)${paramName}\\s*=\\s*[^\\s%]+`, "i")

    let updatedBody = body
    if (paramName === "clef") {
        if (pattern.test(updatedBody)) {
            updatedBody = paramValue ? updatedBody.replace(pattern, `$1clef=${paramValue}`) : updatedBody.replace(pattern, "")
        } else {
            const barePattern = /(\s+)(?:treble|bass|alto|tenor|perc)(?:[+-]8)?(?=\s|$)/i
            if (barePattern.test(updatedBody)) {
                updatedBody = paramValue ? updatedBody.replace(barePattern, `$1clef=${paramValue}`) : updatedBody.replace(barePattern, "")
            } else if (paramValue) {
                updatedBody = `${updatedBody.trimEnd()} clef=${paramValue}`
            }
        }
    } else if (pattern.test(updatedBody)) {
        updatedBody = paramValue ? updatedBody.replace(pattern, `$1octave=${paramValue}`) : updatedBody.replace(pattern, "")
    } else if (paramValue) {
        updatedBody = `${updatedBody.trimEnd()} octave=${paramValue}`
    }

    return `${updatedBody}${comment}`
}

function applySettingsToVoiceLine(line: string, settings: VoiceHeaderSettings | undefined): string {
    if (!settings) return line
    let updated = line
    if (settings.clef) updated = updateFieldParameter(updated, "clef", settings.clef)
    if (settings.octave) updated = updateFieldParameter(updated, "octave", settings.octave)
    return updated
}

function findNotePitchOffsets(text: string, startChar: number, endChar: number, isChord: boolean): number[] {
    const limit = Math.min(text.length, endChar)
    let cursor = Math.max(0, startChar)

    const skipDecorationOrMeta = (): boolean => {
        const ch = text[cursor]
        if (ch === '"') {
            cursor++
            while (cursor < limit && text[cursor] !== '"') cursor++
            if (cursor < limit) cursor++
            return true
        }
        if (ch === "!" || ch === "+") {
            const delimiter = ch
            cursor++
            while (cursor < limit && text[cursor] !== delimiter) cursor++
            if (cursor < limit) cursor++
            return true
        }
        if (ch === "{") {
            cursor++
            while (cursor < limit && text[cursor] !== "}") cursor++
            if (cursor < limit) cursor++
            return true
        }
        if (ch === "[" && cursor + 2 < limit && /[A-Za-z]/.test(text[cursor + 1]) && text[cursor + 2] === ":") {
            cursor++
            while (cursor < limit && text[cursor] !== "]") cursor++
            if (cursor < limit) cursor++
            return true
        }
        return false
    }

    if (!isChord) {
        while (cursor < limit) {
            if (skipDecorationOrMeta()) continue
            const ch = text[cursor]
            if (/[A-Ga-g]/.test(ch)) return [cursor]
            cursor++
        }
        return []
    }

    while (cursor < limit) {
        if (skipDecorationOrMeta()) continue
        if (text[cursor] === "[") {
            cursor++
            break
        }
        cursor++
    }

    const offsets: number[] = []
    while (cursor < limit && text[cursor] !== "]") {
        if (skipDecorationOrMeta()) continue
        const ch = text[cursor]
        if (/[A-Ga-g]/.test(ch)) {
            offsets.push(cursor)
            cursor++
            while (cursor < limit && /[,']/.test(text[cursor])) cursor++
            continue
        }
        cursor++
    }

    return offsets
}

function applyRowInjections(rowText: string, injections: readonly AccidentalInjection[] | undefined): string {
    if (!injections || !injections.length) return rowText
    const sorted = [...injections].sort((a, b) => b.colOffset - a.colOffset)
    let updated = rowText
    for (const injection of sorted) {
        if (injection.colOffset >= 0 && injection.colOffset <= updated.length) {
            updated = `${updated.slice(0, injection.colOffset)}${injection.prefix}${updated.slice(injection.colOffset)}`
        }
    }
    return updated
}

export function extractAbcMetadata(abc: string): AbcMetadata {
    const normalized = normalizeLineEndings(abc)
    const lines = normalized.split("\n")

    let firstXLine = -1
    let inBlock = false
    for (let index = 0; index < lines.length; index++) {
        const trimmed = lines[index].trim()
        if (/^%%begin(?:text|ps)\b/i.test(trimmed)) {
            inBlock = true
            continue
        }
        if (/^%%end(?:text|ps)\b/i.test(trimmed)) {
            inBlock = false
            continue
        }
        if (inBlock) continue
        if (/^X:/.test(trimmed)) {
            firstXLine = index
            break
        }
    }

    const startLine = firstXLine >= 0 ? firstXLine : 0
    let endLine = lines.length
    if (firstXLine >= 0) {
        inBlock = false
        for (let index = firstXLine + 1; index < lines.length; index++) {
            const trimmed = lines[index].trim()
            if (/^%%begin(?:text|ps)\b/i.test(trimmed)) {
                inBlock = true
                continue
            }
            if (/^%%end(?:text|ps)\b/i.test(trimmed)) {
                inBlock = false
                continue
            }
            if (inBlock) continue
            if (/^X:/.test(trimmed)) {
                endLine = index
                break
            }
        }
    } else {
        const secondTuneLine = findSecondTuneLine(lines)
        if (secondTuneLine >= 0) endLine = secondTuneLine
    }

    let title = ""
    let author = ""
    let explicitComposer = ""
    let fallbackComposer = ""
    let copyright = ""
    let key = ""
    inBlock = false

    for (let index = startLine; index < endLine; index++) {
        const line = lines[index]
        const trimmed = line.trim()
        if (/^%%begin(?:text|ps)\b/i.test(trimmed)) {
            inBlock = true
            continue
        }
        if (/^%%end(?:text|ps)\b/i.test(trimmed)) {
            inBlock = false
            continue
        }
        if (inBlock || !trimmed || trimmed.startsWith("%")) continue

        const cleanLine = stripInlineComment(line)
        if (!/^[A-Za-z+]:/.test(cleanLine)) break

        if (!title && /^T:/.test(cleanLine)) {
            title = cleanLine.slice(2).trim()
            continue
        }
        if (/^C:/.test(cleanLine)) {
            const value = cleanLine.slice(2).trim()
            if (!value) continue
            if (/^copyright:/i.test(value)) {
                const text = value.replace(/^copyright:\s*/i, "").trim()
                if (text && !copyright) copyright = text
                continue
            }
            CREDIT_LABEL_PATTERN.lastIndex = 0
            const matches: { label: string; index: number; end: number }[] = []
            let labelMatch: RegExpExecArray | null
            while ((labelMatch = CREDIT_LABEL_PATTERN.exec(value)) !== null) {
                matches.push({
                    label: labelMatch[1].toLowerCase().replace(/\s+/g, " "),
                    index: labelMatch.index,
                    end: labelMatch.index + labelMatch[0].length
                })
            }
            if (matches.length > 0) {
                for (let matchIdx = 0; matchIdx < matches.length; matchIdx++) {
                    const current = matches[matchIdx]
                    const segmentEnd = matchIdx + 1 < matches.length ? matches[matchIdx + 1].index : value.length
                    const text = value.slice(current.end, segmentEnd).trim()
                    if (!text) continue
                    if ((current.label === "words" || current.label === "text") && !author) {
                        author = text
                    } else if ((current.label === "music" || current.label === "music and setting" || current.label === "tune") && !explicitComposer) {
                        explicitComposer = text
                    }
                }
                continue
            }
            if (!fallbackComposer) fallbackComposer = value
            continue
        }
        if (!key && /^K:/.test(cleanLine)) {
            const rawKey = cleanLine.slice(2).trim()
            const tokenMatch = KEY_TOKEN_PATTERN.exec(rawKey)
            const token = tokenMatch ? tokenMatch[0].replace(/\s+/g, " ").trim() : ""
            if (token && token.toLowerCase() !== "none") key = token
        }
    }

    const composer = explicitComposer || fallbackComposer
    const metadata: AbcMetadata = {}
    if (title) metadata.title = title
    if (composer) metadata.composer = composer
    if (author) metadata.author = author
    if (copyright) metadata.copyright = copyright
    if (key) metadata.key = key
    return metadata
}

export function extractAbcTextVerses(abc: string): string[][] {
    const normalized = normalizeLineEndings(abc)
    if (!normalized.trim()) return []

    const lines = normalized.split("\n")
    const secondTuneLine = findSecondTuneLine(lines)
    const endLine = secondTuneLine >= 0 ? secondTuneLine : lines.length

    const verses: string[][] = []
    let currentVerse: string[] = []
    let inTextBlock = false

    const flushVerse = () => {
        if (currentVerse.length > 0) {
            verses.push(currentVerse)
            currentVerse = []
        }
    }

    for (let index = 0; index < endLine; index++) {
        const line = lines[index]
        const trimmed = line.trim()
        if (/^%%begintext\b/i.test(trimmed)) {
            inTextBlock = true
            flushVerse()
            continue
        }
        if (/^%%endtext\b/i.test(trimmed)) {
            inTextBlock = false
            continue
        }
        if (inTextBlock) continue

        if (/^W:/.test(trimmed)) {
            const cleanLine = stripInlineComment(line)
            const text = cleanLine.slice(2).trim()
            if (!text) {
                flushVerse()
            } else {
                if (/^\d+[.)\]]/.test(text) && currentVerse.length > 0) {
                    flushVerse()
                }
                currentVerse.push(text)
            }
            continue
        }

        if (!trimmed.startsWith("%")) {
            flushVerse()
        }
    }

    flushVerse()
    return verses
}

function prepareAbcSystemSlices(abc: string, parseOnly: AbcParseOnly): PreparedAbcSlice[] {
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

    // Map each system to the source line indices of its music rows using notes, rests and bar lines only
    const systemMusicRows: Set<number>[] = []
    const claimedRows = new Set<number>()
    let firstMusicLine = endLine

    for (const staffLine of staffLines) {
        const rows = new Set<number>()
        for (const staff of staffLine.staff) {
            for (const voice of staff.voices || []) {
                for (const element of voice as RawAbcElem[]) {
                    if (element.el_type !== "note" && element.el_type !== "bar") continue
                    if (element.startChar === undefined || !Number.isFinite(element.startChar)) continue
                    const startRow = getLineIndexAt(lineStarts, element.startChar)
                    if (startRow < endLine && !claimedRows.has(startRow)) {
                        rows.add(startRow)
                        claimedRows.add(startRow)
                        if (startRow < firstMusicLine) firstMusicLine = startRow
                    }
                    if (element.endChar !== undefined && Number.isFinite(element.endChar) && element.endChar > element.startChar) {
                        const endRow = getLineIndexAt(lineStarts, element.endChar - 1)
                        if (endRow < endLine && !claimedRows.has(endRow)) {
                            rows.add(endRow)
                            claimedRows.add(endRow)
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
                if (!claimedRows.has(cursor)) {
                    rows.add(cursor)
                    claimedRows.add(cursor)
                }
            }
        }

        systemMusicRows.push(rows)
    }

    if (firstMusicLine >= endLine) return []

    // Build header lines (everything before the first music row, keeping at most one M:, L:, K: and excluding W:, single-% comments, and standalone inline-only voice/field rows)
    const headerLines: string[] = []
    const headerDeclaredVoices = new Set<string>()
    const initialVoiceSettings = new Map<string, VoiceHeaderSettings>()
    const allDeclaredVoices = new Set<string>()
    let seenHeaderKey = false
    let seenHeaderMeterSlot = false
    let seenHeaderLengthSlot = false
    let initialRunningVoice: string | null = null
    let explicitHeaderLength = ""
    let initialHeaderKeyText = ""
    let initialHeaderMeter = formatAbcMeter(staffLines[0].staff[0]?.meter)
    let initialHeaderKeyClef = ""
    let initialHeaderKeyOctave = ""
    let inTextBlock = false

    for (let index = 0; index < firstMusicLine; index++) {
        const line = sourceLines[index]
        const trimmed = line.trim()
        if (/^%%begin(?:text|ps)\b/i.test(trimmed)) {
            inTextBlock = true
            headerLines.push(line)
            continue
        }
        if (/^%%end(?:text|ps)\b/i.test(trimmed)) {
            inTextBlock = false
            headerLines.push(line)
            continue
        }
        if (!inTextBlock) {
            if (/^W:/.test(trimmed)) continue
            if (isSinglePercentComment(trimmed)) continue
            if (!trimmed && (headerLines.length === 0 || !headerLines[headerLines.length - 1].trim())) continue
        }

        if (inTextBlock || !trimmed || trimmed.startsWith("%")) {
            headerLines.push(line)
            continue
        }

        const clean = stripInlineComment(line)
        if (/^M:/.test(clean)) {
            if (!seenHeaderKey) {
                const rawMeter = clean.slice(2).trim()
                if (rawMeter) initialHeaderMeter = rawMeter.split(/\s+/)[0]
                if (!seenHeaderMeterSlot) {
                    headerLines.push(line)
                    seenHeaderMeterSlot = true
                }
            }
            continue
        }
        if (/^L:/.test(clean)) {
            const lengthMatch = /^L:\s*([0-9]+\s*\/\s*[0-9]+)/.exec(clean)
            if (lengthMatch) explicitHeaderLength = lengthMatch[1].replace(/\s+/g, "")
            if (!seenHeaderKey && !seenHeaderLengthSlot) {
                headerLines.push(line)
                seenHeaderLengthSlot = true
            }
            continue
        }
        if (/^K:/.test(clean)) {
            const keyBody = clean.slice(2)
            const keySpec = parseKeySpec(keyBody)
            if (keySpec) initialHeaderKeyText = keySpec
            const keyParams = parseClefAndOctave(keyBody)
            if (seenHeaderKey && initialRunningVoice && allDeclaredVoices.size > 0) {
                mergeVoiceSettings(initialVoiceSettings, initialRunningVoice, keyParams)
            } else {
                if (keyParams.clef) initialHeaderKeyClef = keyParams.clef
                if (keyParams.octave) initialHeaderKeyOctave = keyParams.octave
            }
            if (!seenHeaderKey) {
                seenHeaderKey = true
                initialRunningVoice = null
                headerLines.push(line)
            }
            continue
        }
        const voiceMatch = /^V:\s*([^\s]+)(.*)$/.exec(clean)
        if (voiceMatch) {
            const voiceId = voiceMatch[1]
            headerDeclaredVoices.add(voiceId)
            allDeclaredVoices.add(voiceId)
            mergeVoiceSettings(initialVoiceSettings, voiceId, parseClefAndOctave(voiceMatch[2]))
            if (seenHeaderKey) initialRunningVoice = voiceId
            headerLines.push(line)
            continue
        }
        if (INLINE_FIELD_ONLY_LINE.test(clean)) {
            const inlineFieldPattern = /\[(V|L|K):([^\]]*)\]/g
            let inlineMatch: RegExpExecArray | null
            while ((inlineMatch = inlineFieldPattern.exec(clean)) !== null) {
                const fieldName = inlineMatch[1]
                const fieldBody = inlineMatch[2]
                if (fieldName === "V") {
                    const vParts = /^\s*([^\s]+)(.*)$/.exec(fieldBody)
                    if (vParts) {
                        const voiceId = vParts[1]
                        initialRunningVoice = voiceId
                        allDeclaredVoices.add(voiceId)
                        mergeVoiceSettings(initialVoiceSettings, voiceId, parseClefAndOctave(vParts[2]))
                    }
                } else if (fieldName === "L") {
                    const lenMatch = /^\s*([0-9]+\s*\/\s*[0-9]+)/.exec(fieldBody)
                    if (lenMatch) explicitHeaderLength = lenMatch[1].replace(/\s+/g, "")
                } else if (fieldName === "K") {
                    const keySpec = parseKeySpec(fieldBody)
                    if (keySpec) initialHeaderKeyText = keySpec
                    const keyParams = parseClefAndOctave(fieldBody)
                    if (initialRunningVoice && allDeclaredVoices.size > 0) {
                        mergeVoiceSettings(initialVoiceSettings, initialRunningVoice, keyParams)
                    } else {
                        if (keyParams.clef) initialHeaderKeyClef = keyParams.clef
                        if (keyParams.octave) initialHeaderKeyOctave = keyParams.octave
                    }
                }
            }
            continue
        }

        headerLines.push(line)
    }

    while (headerLines.length > 0 && !headerLines[headerLines.length - 1].trim()) {
        headerLines.pop()
    }

    const initialLengthText = explicitHeaderLength || getDefaultLengthForMeter(initialHeaderMeter)

    // Track voice state, L:, clef/octave settings, body voice declarations, and body %%score/%%staves directives
    const bodyVoiceDeclarations = new Map<string, string>()
    const rowVoiceBefore = new Map<number, string | null>()
    const rowStartsWithInlineVoice = new Set<number>()
    const rowEndingInlineVoice = new Map<number, string>()
    const lengthBeforeRow = new Map<number, string>()
    const keyClefBeforeRow = new Map<number, string>()
    const keyOctaveBeforeRow = new Map<number, string>()
    const voiceSettingsBeforeRow = new Map<number, Map<string, VoiceHeaderSettings>>()
    const bodyScoreDirectives: { lineIndex: number; text: string }[] = []

    let runningVoice: string | null = initialRunningVoice
    let runningLength = initialLengthText
    let runningKeyClef = initialHeaderKeyClef
    let runningKeyOctave = initialHeaderKeyOctave
    const runningVoiceSettings = cloneVoiceSettingsMap(initialVoiceSettings)

    inTextBlock = false
    for (let index = firstMusicLine; index < endLine; index++) {
        lengthBeforeRow.set(index, runningLength)
        keyClefBeforeRow.set(index, runningKeyClef)
        keyOctaveBeforeRow.set(index, runningKeyOctave)
        voiceSettingsBeforeRow.set(index, cloneVoiceSettingsMap(runningVoiceSettings))

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
        const lengthHeader = /^L:\s*([0-9]+\s*\/\s*[0-9]+)/.exec(clean)
        if (lengthHeader) {
            runningLength = lengthHeader[1].replace(/\s+/g, "")
            continue
        }
        const keyHeader = /^K:(.*)$/.exec(clean)
        if (keyHeader) {
            const keyParams = parseClefAndOctave(keyHeader[1])
            if (runningVoice && allDeclaredVoices.size > 0) {
                mergeVoiceSettings(runningVoiceSettings, runningVoice, keyParams)
            } else {
                if (keyParams.clef) runningKeyClef = keyParams.clef
                if (keyParams.octave) runningKeyOctave = keyParams.octave
            }
            continue
        }
        const voiceHeader = /^V:\s*([^\s]+)(.*)$/.exec(clean)
        if (voiceHeader) {
            const voiceId = voiceHeader[1]
            runningVoice = voiceId
            allDeclaredVoices.add(voiceId)
            mergeVoiceSettings(runningVoiceSettings, voiceId, parseClefAndOctave(voiceHeader[2]))
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

        const inlineFieldPattern = /\[(V|L|K):([^\]]*)\]/g
        let inlineMatch: RegExpExecArray | null
        let lastInlineVoice: string | null = null
        while ((inlineMatch = inlineFieldPattern.exec(clean)) !== null) {
            const fieldName = inlineMatch[1]
            const fieldBody = inlineMatch[2]
            if (fieldName === "V") {
                const vParts = /^\s*([^\s]+)(.*)$/.exec(fieldBody)
                if (vParts) {
                    const voiceId = vParts[1]
                    runningVoice = voiceId
                    lastInlineVoice = voiceId
                    allDeclaredVoices.add(voiceId)
                    mergeVoiceSettings(runningVoiceSettings, voiceId, parseClefAndOctave(vParts[2]))
                }
            } else if (fieldName === "L") {
                const lenMatch = /^\s*([0-9]+\s*\/\s*[0-9]+)/.exec(fieldBody)
                if (lenMatch) runningLength = lenMatch[1].replace(/\s+/g, "")
            } else if (fieldName === "K") {
                const keyParams = parseClefAndOctave(fieldBody)
                if (runningVoice && allDeclaredVoices.size > 0) {
                    mergeVoiceSettings(runningVoiceSettings, runningVoice, keyParams)
                } else {
                    if (keyParams.clef) runningKeyClef = keyParams.clef
                    if (keyParams.octave) runningKeyOctave = keyParams.octave
                }
            }
        }
        if (lastInlineVoice) {
            rowEndingInlineVoice.set(index, lastInlineVoice)
        }
    }

    const hasVoices = allDeclaredVoices.size > 0

    // Attach w: and +: lyric rows immediately following each music row (skipping % comments and %% directives)
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
            if (trimmed.startsWith("%") && !/^%%(?:begintext|score|staves)\b/i.test(trimmed)) {
                continue
            }
            break
        }
        if (attached.length) attachedLyricsByRow.set(rowIndex, attached)
    }

    // Walk all systems using the converter's shared measure splitting and accidental tracker
    const parsedLines = splitTuneIntoMeasures(staffLines, normalized)
    const accidentalTracker = createTuneAccidentalTracker()
    const injectionsBySystem = new Map<number, Map<number, AccidentalInjection[]>>()
    const closingBarsBySystem = new Map<number, Map<number, string>>()
    let accKeyAccidentals = getKeyAccidentalMap(staffLines[0].staff[0]?.key)

    for (let systemIndex = 0; systemIndex < staffLines.length; systemIndex++) {
        const staffLine = staffLines[systemIndex]
        if (systemIndex > 0 && staffLine.staff[0]?.key) {
            accKeyAccidentals = getKeyAccidentalMap(staffLine.staff[0].key)
        }

        const systemInjections = new Map<number, AccidentalInjection[]>()
        const systemClosingBars = new Map<number, string>()
        let nextSystemKeyAcc = accKeyAccidentals

        const parsedVoices = parsedLines[systemIndex]
        parsedVoices.forEach((staffVoices, staffIndex) => {
            staffVoices.forEach((measures, voiceIndex) => {
                if (!measures.length) return
                const voiceKey = `${staffIndex}.${voiceIndex}`
                let voiceKeyAcc = { ...accKeyAccidentals }

                for (let measureIdx = 0; measureIdx < measures.length; measureIdx++) {
                    const measure = measures[measureIdx]
                    if (measure.change?.key) {
                        voiceKeyAcc = getKeyAccidentalMap(measure.change.key)
                        if (staffIndex === 0 && voiceIndex === 0) {
                            nextSystemKeyAcc = voiceKeyAcc
                        }
                    }

                    const accState = accidentalTracker.beginMeasure(voiceKey, voiceKeyAcc)
                    const sliceBarAcc: Record<string, string> = {}
                    let needSliceFixup = systemIndex > 0 && measureIdx === 0 && (accState.hadCarriedBar || accState.hadCarriedTied)

                    for (const element of measure.events) {
                        if (element.el_type === "key") {
                            accidentalTracker.applyKeyChange(accState, element as unknown as KeySignature)
                            voiceKeyAcc = { ...accState.keyAccidentals }
                            if (staffIndex === 0 && voiceIndex === 0) {
                                nextSystemKeyAcc = voiceKeyAcc
                            }
                            for (const pitchKey of Object.keys(sliceBarAcc)) delete sliceBarAcc[pitchKey]
                            needSliceFixup = false
                            continue
                        }
                        if (element.el_type !== "note" || element.rest || !element.pitches?.length) continue

                        const pitches = element.pitches as RawNotePitch[]
                        const neededByPitch = new Map<number, string>()

                        pitches.forEach((pitch, pitchIndex) => {
                            const { step, pitchKey, explicitAccidental, soundingAccidental } = accidentalTracker.resolvePitch(accState, pitch)
                            if (needSliceFixup) {
                                const sliceSounding = explicitAccidental || sliceBarAcc[pitchKey] || accState.keyAccidentals[PITCH_NAMES[step]] || "n"
                                if (explicitAccidental) {
                                    sliceBarAcc[pitchKey] = explicitAccidental
                                } else if (soundingAccidental !== sliceSounding) {
                                    const abcPrefix = MEI_TO_ABC_ACCIDENTAL[soundingAccidental]
                                    if (abcPrefix) {
                                        neededByPitch.set(pitchIndex, abcPrefix)
                                        sliceBarAcc[pitchKey] = soundingAccidental
                                    }
                                }
                            }
                        })

                        if (neededByPitch.size > 0 && element.startChar !== undefined && element.endChar !== undefined) {
                            const offsets = findNotePitchOffsets(normalized, element.startChar, element.endChar, pitches.length > 1)
                            for (const [pitchIndex, prefix] of neededByPitch) {
                                const charOffset = offsets[pitchIndex]
                                if (charOffset === undefined) continue
                                const rowIndex = getLineIndexAt(lineStarts, charOffset)
                                const colOffset = charOffset - lineStarts[rowIndex]
                                let rowList = systemInjections.get(rowIndex)
                                if (!rowList) {
                                    rowList = []
                                    systemInjections.set(rowIndex, rowList)
                                }
                                rowList.push({ rowIndex, colOffset, prefix })
                            }
                        }
                    }

                    if (measure.closedByNextLine && measure.barType) {
                        const closingBarToken = BAR_TYPE_TO_ABC[measure.barType]
                        if (closingBarToken && measure.endChar !== undefined) {
                            const lastOffset = Math.max(0, measure.endChar - 1)
                            const lastRow = getLineIndexAt(lineStarts, lastOffset)
                            if (systemMusicRows[systemIndex].has(lastRow)) {
                                systemClosingBars.set(lastRow, closingBarToken)
                            }
                        }
                    }

                    accidentalTracker.endMeasure(voiceKey, accState, Boolean(measure.barType))
                }
            })
        })

        accKeyAccidentals = nextSystemKeyAcc
        if (systemInjections.size > 0) {
            injectionsBySystem.set(systemIndex, systemInjections)
        }
        if (systemClosingBars.size > 0) {
            closingBarsBySystem.set(systemIndex, systemClosingBars)
        }
    }

    // Track active key and time signature at the first and last note of each system
    let pendingMeterFromPrevEnd: Meter | undefined = staffLines[0].staff[0]?.meter
    let prevSystemEndMeterText = ""
    let runningKey: KeySignature | undefined = staffLines[0].staff[0]?.key
    let runningKeyText = initialHeaderKeyText || formatAbcKeySignature(runningKey)

    const slices: PreparedAbcSlice[] = []

    for (let systemIndex = 0; systemIndex < staffLines.length; systemIndex++) {
        const staffLine = staffLines[systemIndex]
        const sortedRows = Array.from(systemMusicRows[systemIndex]).sort((a, b) => a - b)

        if (staffLine.staff[0]?.key) runningKey = staffLine.staff[0].key
        const baseMeter: Meter | undefined = systemIndex === 0 ? staffLine.staff[0]?.meter : staffLine.staff[0]?.meter || pendingMeterFromPrevEnd

        let startKey: KeySignature | undefined = runningKey
        let startKeyText = runningKeyText
        let startMeter: Meter | undefined = baseMeter
        let endMeter: Meter | undefined = baseMeter
        let trailingMeter: Meter | undefined = baseMeter
        let trailingKey: KeySignature | undefined = runningKey
        let trailingKeyText = runningKeyText

        let foundPrimaryStart = false
        staffLine.staff.forEach((staff, staffIndex) => {
            ;(staff.voices || []).forEach((voice, voiceIndex) => {
                const isPrimary = staffIndex === 0 && voiceIndex === 0
                let seenNote = false
                let localMeter: Meter | undefined = baseMeter
                let localEndMeter: Meter | undefined = baseMeter
                let localKey: KeySignature | undefined = runningKey
                let localKeyText = runningKeyText

                for (const element of voice as RawAbcElem[]) {
                    if (element.el_type === "meter") {
                        localMeter = element as unknown as Meter
                        if (!seenNote && (isPrimary || !foundPrimaryStart)) {
                            startMeter = localMeter
                        }
                    } else if (element.el_type === "key") {
                        localKey = element as unknown as KeySignature
                        const extractedKeyText = extractKeyTextFromElement(element, normalized)
                        if (extractedKeyText) localKeyText = extractedKeyText
                        if (!seenNote && (isPrimary || !foundPrimaryStart)) {
                            startKey = localKey
                            startKeyText = localKeyText
                        }
                    } else if (element.el_type === "note") {
                        seenNote = true
                        localEndMeter = localMeter
                    }
                }

                if (isPrimary) {
                    foundPrimaryStart = true
                    endMeter = localEndMeter
                    trailingMeter = localMeter
                    trailingKey = localKey
                    trailingKeyText = localKeyText
                } else if (!foundPrimaryStart) {
                    endMeter = localEndMeter
                    trailingMeter = localMeter
                    trailingKey = localKey
                    trailingKeyText = localKeyText
                }
            })
        })

        const systemKeyText = startKeyText || formatAbcKeySignature(startKey)
        const systemMeterText = formatAbcMeter(startMeter)
        const endMeterText = formatAbcMeter(endMeter)

        pendingMeterFromPrevEnd = trailingMeter
        if (trailingKey) runningKey = trailingKey
        if (trailingKeyText) runningKeyText = trailingKeyText

        if (!sortedRows.length) continue

        const firstSystemRow = sortedRows[0]
        const systemLengthText = lengthBeforeRow.get(firstSystemRow) || initialLengthText
        const systemVoiceSettings = voiceSettingsBeforeRow.get(firstSystemRow) || new Map<string, VoiceHeaderSettings>()

        let headerText = headerLines.join("\n")
        if (systemKeyText) {
            headerText = updateSliceKeyLine(headerText, systemKeyText)
        }
        if (systemMeterText) {
            headerText = updateAbcHeaderField(headerText, "M", systemMeterText)
        }
        headerText = updateAbcHeaderField(headerText, "L", systemLengthText)

        const sliceHeader = headerText.split("\n")

        if (!hasVoices) {
            const activeClef = staffLine.staff[0]?.clef?.type || keyClefBeforeRow.get(firstSystemRow) || ""
            const activeOctave = keyOctaveBeforeRow.get(firstSystemRow) || ""
            const keyLineIndex = sliceHeader.findIndex((line) => /^\s*K:/.test(line))
            if (keyLineIndex >= 0) {
                const clefParam = activeClef && activeClef !== "treble" ? activeClef : undefined
                let updatedKeyLine = sliceHeader[keyLineIndex]
                if (clefParam || /(?:^|\s)(?:clef\s*=|(?:treble|bass|alto|tenor|perc)(?:[+-]8)?(?=\s|$|%))/i.test(updatedKeyLine)) {
                    updatedKeyLine = updateFieldParameter(updatedKeyLine, "clef", clefParam || (activeClef === "treble" ? "treble" : undefined))
                }
                if (activeOctave) {
                    updatedKeyLine = updateFieldParameter(updatedKeyLine, "octave", activeOctave)
                }
                sliceHeader[keyLineIndex] = updatedKeyLine
            }
        } else {
            for (let index = 0; index < sliceHeader.length; index++) {
                const voiceMatch = /^\s*V:\s*([^\s]+)/.exec(stripInlineComment(sliceHeader[index]))
                if (voiceMatch) {
                    const settings = systemVoiceSettings.get(voiceMatch[1])
                    if (settings) {
                        sliceHeader[index] = applySettingsToVoiceLine(sliceHeader[index], settings)
                    }
                }
            }
        }

        // Apply the latest body %%score/%%staves directive that precedes this system's first row
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
        let activeSliceVoice: string | null = getLastHeaderVoiceAfterKey(sliceHeader)
        const emittedBodyDecls = new Set<string>()
        const rowInjections = injectionsBySystem.get(systemIndex)
        const rowClosingBars = closingBarsBySystem.get(systemIndex)

        for (const rowIndex of sortedRows) {
            if (!rowStartsWithInlineVoice.has(rowIndex)) {
                const neededVoice = rowVoiceBefore.get(rowIndex) ?? null
                if (neededVoice && neededVoice !== activeSliceVoice) {
                    const bodyDecl = bodyVoiceDeclarations.get(neededVoice)
                    const activeSettings = systemVoiceSettings.get(neededVoice)
                    if (!headerDeclaredVoices.has(neededVoice) && !emittedBodyDecls.has(neededVoice)) {
                        const baseDecl = bodyDecl || `V: ${neededVoice}`
                        sliceLines.push(applySettingsToVoiceLine(baseDecl, activeSettings))
                        emittedBodyDecls.add(neededVoice)
                    } else {
                        sliceLines.push(`V: ${neededVoice}`)
                    }
                    activeSliceVoice = neededVoice
                }
            } else {
                const inlineVoiceMatch = /^\s*\[V:\s*([^\s\]]+)/.exec(stripInlineComment(sourceLines[rowIndex]))
                const inlineVoiceId = inlineVoiceMatch ? inlineVoiceMatch[1] : null
                if (inlineVoiceId && !headerDeclaredVoices.has(inlineVoiceId) && !emittedBodyDecls.has(inlineVoiceId)) {
                    const activeSettings = systemVoiceSettings.get(inlineVoiceId)
                    if (activeSettings && (activeSettings.clef || activeSettings.octave)) {
                        const baseDecl = bodyVoiceDeclarations.get(inlineVoiceId) || `V: ${inlineVoiceId}`
                        sliceLines.push(applySettingsToVoiceLine(baseDecl, activeSettings))
                        emittedBodyDecls.add(inlineVoiceId)
                    }
                }
            }

            const injectedRow = applyRowInjections(sourceLines[rowIndex], rowInjections?.get(rowIndex))
            const renderedRow = appendClosingBarToRow(injectedRow, rowClosingBars?.get(rowIndex))
            sliceLines.push(renderedRow)

            const endedVoice = rowEndingInlineVoice.get(rowIndex)
            if (endedVoice) activeSliceVoice = endedVoice

            const lyrics = attachedLyricsByRow.get(rowIndex)
            if (lyrics) {
                for (const lyricIndex of lyrics) {
                    sliceLines.push(sourceLines[lyricIndex])
                }
            }
        }

        const hideInitialMeter = slices.length > 0 && systemMeterText === prevSystemEndMeterText
        slices.push({
            abc: sliceLines.join("\n"),
            hideInitialMeter
        })
        prevSystemEndMeterText = endMeterText
    }

    return slices
}

export function splitAbcIntoSystemTexts(abc: string, parseOnly: AbcParseOnly): string[] {
    return prepareAbcSystemSlices(abc, parseOnly).map((slice) => slice.abc)
}

export function sliceAbcIntoSystems(abc: string, parseOnly: AbcParseOnly): AbcSystemSlice[] {
    return prepareAbcSystemSlices(abc, parseOnly).map((slice) => ({
        abc: slice.abc,
        analysis: convertAndCheckAbc(slice.abc, parseOnly, { hideInitialMeter: slice.hideInitialMeter })
    }))
}
