import type { AbcElem, KeySignature, Meter, NotePitch, Staff, TuneObject } from "abcjs"
import type { AbcParseOnly } from "./abcjs"
import { normalizeLineEndings } from "./abcSource"

export type AbcProblemSeverity = "error" | "warning"

export interface AbcProblem {
    severity: AbcProblemSeverity
    key: string
    values: string[]
    startChar: number
    endChar: number
}

export interface AbcPartInfo {
    staff: number
    layer: number
    name: string
}

export interface RawAbcChord {
    name?: string
    position?: string
}

export interface RawAbcElem extends AbcElem {
    startChar?: number
    endChar?: number
    startTriplet?: number
    endTriplet?: boolean
    tripletMultiplier?: number
    startBeam?: boolean
    endBeam?: boolean
    duration?: number | number[]
    pitches?: NotePitch[]
    rest?: { type: string; text?: number | string }
    type?: string
    startEnding?: string
    endEnding?: boolean
    gracenotes?: unknown[]
    chord?: RawAbcChord[]
    decoration?: string[]
    startSlur?: ({ label?: number } | number)[]
    endSlur?: ({ label?: number } | number)[]
    lyric?: { syllable: string; divider: string }[]
}

export interface VoiceMeasure {
    events: RawAbcElem[]
    length: number
    hasNotes: boolean
    barType?: string
    leftBarType?: string
    closedByNextLine?: boolean
    change?: { key?: KeySignature; meter?: Meter; clef?: { type?: string } }
    startChar?: number
    endChar?: number
}

export interface OffsetMapper {
    normalized: string
    toOriginal: (index: number) => number
}

interface PitchInterval {
    start: number
    end: number
    semitones: number
    startChar: number
    endChar: number
}

interface AlignedVoice {
    staffIndex: number
    voiceIndex: number
    length: number
    startChar: number
    endChar: number
    intervals: PitchInterval[]
    hasNotes: boolean
    hasMeasure: boolean
}

interface AlignedBar {
    barNumber: number
    isLast: boolean
    meter: Meter | undefined
    barLength: number | null
    barType: string | undefined
    leftBarType: string | undefined
    staves: Staff[]
    voices: AlignedVoice[][]
}

interface CarriedVoiceMeasure {
    length: number
    startChar: number | undefined
    endChar: number | undefined
    leftBarType: string | undefined
    intervals: PitchInterval[]
    hasNotes: boolean
    hasMeasure: boolean
}

interface CrossingMatch {
    crossed: boolean
    startChar: number
    endChar: number
}

type LyricTokenKind = "syllable" | "hold" | "skip" | "bar"

interface LyricToken {
    kind: LyricTokenKind
    text: string
    startChar: number
    endChar: number
}

interface VoiceLyricLine {
    lineIndex: number
    contentOffset: number
    content: string
}

const SATB_PART_NAMES = ["Soprano", "Alto", "Tenor", "Bass"]
const HARMLESS_WARNING_PATTERN = /Unknown directive|Decoration redefinition|Unknown decoration|Postscript ignored/i
const SECTION_BAR_TYPES = new Set(["bar_thin_thin", "bar_thin_thick", "bar_right_repeat", "bar_dbl_repeat"])
const WEAK_BAR_TYPES = new Set(["bar_thin", "bar_invisible"])
const DIATONIC_SEMITONES = [0, 2, 4, 5, 7, 9, 11]
const PITCH_LETTERS = "cdefgab"
const ACCIDENTAL_SEMITONES: Record<string, number> = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 }
const ALTO_TENOR_CROSSING_SEMITONES = 5

function clamp(value: number, max: number): number {
    if (value < 0) return 0
    if (value > max) return max
    return value
}

export function makeAbcProblem(kind: string, values: string[], startChar: number, endChar: number, severity: AbcProblemSeverity = "warning"): AbcProblem {
    return {
        severity,
        key: `sheet_music.problem_${kind}`,
        values,
        startChar,
        endChar
    }
}

export function parseAbcTunes(abc: string, parseOnly: AbcParseOnly): TuneObject[] {
    const normalized = normalizeLineEndings(abc)
    if (!normalized.trim()) return []
    try {
        const parsed = parseOnly(normalized)
        return Array.isArray(parsed) ? parsed.filter((item): item is TuneObject => Boolean(item)) : []
    } catch {
        return []
    }
}

export function buildOffsetMapper(raw: string): OffsetMapper {
    const normalized = normalizeLineEndings(raw)
    if (normalized === raw) {
        return { normalized, toOriginal: (index: number) => clamp(index, raw.length) }
    }
    const indexMap: number[] = []
    for (let index = 0; index < raw.length; index += raw[index] === "\r" && raw[index + 1] === "\n" ? 2 : 1) {
        indexMap.push(index)
    }
    indexMap.push(raw.length)
    return { normalized, toOriginal: (index: number) => indexMap[clamp(index, indexMap.length - 1)] }
}

export function trimCharRange(text: string, start: number | undefined, end: number | undefined): { startChar: number; endChar: number } {
    if (start === undefined || !Number.isFinite(start)) return { startChar: 0, endChar: 0 }
    let trimmedStart = clamp(Math.floor(start), text.length)
    let trimmedEnd = end !== undefined && Number.isFinite(end) ? Math.max(trimmedStart, clamp(Math.floor(end), text.length)) : trimmedStart
    while (trimmedStart < trimmedEnd && (text[trimmedStart] === " " || text[trimmedStart] === "\t")) trimmedStart++
    while (trimmedEnd > trimmedStart && (text[trimmedEnd - 1] === " " || text[trimmedEnd - 1] === "\t")) trimmedEnd--
    return { startChar: trimmedStart, endChar: trimmedEnd === trimmedStart && trimmedStart < text.length ? trimmedStart + 1 : trimmedEnd }
}

export function getLineStarts(text: string): number[] {
    const starts = [0]
    for (let index = 0; index < text.length; index++) {
        if (text[index] === "\n") starts.push(index + 1)
    }
    return starts
}

export function getLineIndexAt(starts: number[], offset: number): number {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
        const mid = (low + high + 1) >> 1
        if (starts[mid] <= offset) low = mid
        else high = mid - 1
    }
    return low
}

export function getStaffLines(tune: TuneObject | undefined): { staff: Staff[] }[] {
    if (!tune || !Array.isArray(tune.lines)) return []
    return tune.lines.filter((line): line is { staff: Staff[] } => Array.isArray(line.staff) && line.staff.length > 0)
}

export function hasAbcNotes(tune: TuneObject | undefined): boolean {
    return getStaffLines(tune).some((line) => line.staff.some((staff) => (staff.voices || []).some((voice) => (voice as RawAbcElem[]).some((element) => element.el_type === "note" && !element.rest && Boolean(element.pitches && element.pitches.length)))))
}

function isMusicSourceLine(trimmed: string, inTextBlock: boolean): boolean {
    return !inTextBlock && trimmed !== "" && !trimmed.startsWith("%") && !/^[A-Za-z]:/.test(trimmed)
}

export function findSecondTuneLine(sourceLines: string[]): number {
    let inBlock = false
    let firstTuneStarted = false
    let seenX = false
    for (let index = 0; index < sourceLines.length; index++) {
        const trimmed = sourceLines[index].trim()
        if (/^%%begin(?:text|ps)\b/i.test(trimmed)) {
            inBlock = true
            continue
        }
        if (/^%%end(?:text|ps)\b/i.test(trimmed)) {
            inBlock = false
            continue
        }
        if (inBlock || !trimmed || trimmed.startsWith("%")) continue
        if (/^X:/.test(trimmed)) {
            if (seenX || firstTuneStarted) return index
            seenX = true
            firstTuneStarted = true
            continue
        }
        if (/^[A-Za-z]:/.test(trimmed)) {
            firstTuneStarted = true
        }
    }
    return -1
}

function parseScoreDirective(spec: string): number[] {
    const counts: number[] = []
    let cursor = 0
    while (cursor < spec.length) {
        const openIndex = spec.indexOf("(", cursor)
        const outside = openIndex >= 0 ? spec.slice(cursor, openIndex) : spec.slice(cursor)
        const standalone = outside
            .replace(/[{}[\]|*+]/g, " ")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
        for (const token of standalone) {
            if (token) counts.push(1)
        }
        if (openIndex < 0) break
        const closeIndex = spec.indexOf(")", openIndex + 1)
        const groupText = closeIndex >= 0 ? spec.slice(openIndex + 1, closeIndex) : spec.slice(openIndex + 1)
        const groupVoices = groupText
            .replace(/[{}[\]|*+]/g, " ")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
        if (groupVoices.length) counts.push(groupVoices.length)
        cursor = closeIndex >= 0 ? closeIndex + 1 : spec.length
    }
    return counts
}

export function getDeclaredStaffVoices(normalized: string, secondTuneLine = -1): number[] {
    const sourceLines = normalized.split("\n")
    const endLine = secondTuneLine >= 0 ? secondTuneLine : sourceLines.length
    const voices = new Set<string>()
    let inTextBlock = false
    let seenMusic = false

    for (let index = 0; index < endLine; index++) {
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

        if (!seenMusic) {
            const scoreMatch = /^\s*%%(?:score|staves)\s+(.+)$/i.exec(line)
            if (scoreMatch) {
                const parsed = parseScoreDirective(scoreMatch[1].replace(/%.*/, "").trim())
                if (parsed.length) return parsed
            }
        }

        if (trimmed.startsWith("%")) continue
        const cleanLine = line.replace(/(?<!\\)%.*$/, "").trim()
        const voiceHeader = /^V:\s*([^\s]+)/.exec(cleanLine)
        if (voiceHeader) {
            voices.add(voiceHeader[1])
            continue
        }
        if (isMusicSourceLine(trimmed, false)) {
            seenMusic = true
            for (const inlineMatch of cleanLine.match(/\[V:\s*([^\s\]]+)/g) || []) {
                voices.add(inlineMatch.replace(/^\[V:\s*/, ""))
            }
        }
    }

    return voices.size > 0 ? Array(voices.size).fill(1) : [1]
}

export function getExpectedVoiceCounts(firstStaves: Staff[], declaredStaffVoices?: number[]): number[] {
    return firstStaves.map((staff, staffIndex) => {
        const actualCount = (staff.voices || []).length
        if (declaredStaffVoices && declaredStaffVoices[staffIndex] !== undefined) {
            return Math.min(declaredStaffVoices[staffIndex], actualCount)
        }
        return actualCount
    })
}

export function getAbcParts(tune: TuneObject | undefined, declaredStaffVoices?: number[]): AbcPartInfo[] {
    const lines = getStaffLines(tune)
    if (!lines.length) return []
    const firstStaves = lines[0].staff
    const expectedCounts = getExpectedVoiceCounts(firstStaves, declaredStaffVoices)
    const isSatb = firstStaves.length === 2 && expectedCounts[0] === 2 && expectedCounts[1] === 2
    const parts: AbcPartInfo[] = []
    let partIndex = 0
    firstStaves.forEach((staff, staffIndex) => {
        const titles = (staff as Staff & { title?: string[] }).title
        const voiceCount = expectedCounts[staffIndex]
        for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex++, partIndex++) {
            const customTitle = Array.isArray(titles) && titles[voiceIndex] ? titles[voiceIndex].trim() : ""
            parts.push({
                staff: staffIndex + 1,
                layer: voiceIndex + 1,
                name: isSatb ? SATB_PART_NAMES[partIndex] : customTitle || `Voice ${partIndex + 1}`
            })
        }
    })
    return parts
}

function getElementDuration(element: RawAbcElem): number {
    const raw = Array.isArray(element.duration) ? element.duration[0] : element.duration
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0
}

function getMeterLength(meter: Meter | undefined): number | null {
    if (!meter) return null
    if (meter.type === "common_time" || meter.type === "cut_time") return 1
    const first = meter.value && meter.value[0]
    const numerator = first ? Number(first.num) : 0
    const denominator = first ? Number(first.den) : 0
    return numerator > 0 && denominator > 0 ? numerator / denominator : null
}

function formatBeats(length: number, meter: Meter | undefined): string {
    const denominator = !meter ? 4 : meter.type === "common_time" ? 4 : meter.type === "cut_time" ? 2 : meter.value && meter.value[0] ? Number(meter.value[0].den) : 4
    return String(Math.round(length * (denominator > 0 ? denominator : 4) * 100) / 100)
}

function getKeySemitoneMap(key: KeySignature | undefined): Record<string, number> {
    const map: Record<string, number> = {}
    if (key && key.accidentals) {
        for (const accidental of key.accidentals) {
            map[accidental.note.toLowerCase()] = accidental.acc === "flat" ? -1 : accidental.acc === "sharp" ? 1 : 0
        }
    }
    return map
}

export function splitVoiceIntoMeasures(voice: AbcElem[], normalized: string, isPrimary: boolean, onBar?: (element: RawAbcElem) => void, onOther?: (element: RawAbcElem) => void, collectClef = false): VoiceMeasure[] {
    const measures: VoiceMeasure[] = [{ events: [], length: 0, hasNotes: false }]
    let tripletMultiplier = 1

    for (const rawElem of voice) {
        const element = rawElem as RawAbcElem
        const current = measures[measures.length - 1]
        if (element.el_type === "bar") {
            if (onBar) onBar(element)
            if (!current.events.length) {
                const previous = measures.length > 1 ? measures[measures.length - 2] : undefined
                if (element.type === "bar_left_repeat" || element.type === "bar_thick_thin") {
                    if (current.leftBarType !== "bar_left_repeat") current.leftBarType = element.type
                } else if (element.type === "bar_right_repeat" || element.type === "bar_dbl_repeat") {
                    if (previous) {
                        if (element.type === "bar_dbl_repeat") previous.barType = "bar_dbl_repeat"
                        else if (previous.barType !== "bar_dbl_repeat") previous.barType = "bar_right_repeat"
                    } else if (!current.leftBarType) {
                        current.leftBarType = element.type
                    }
                } else if (!previous) {
                    if (!current.leftBarType) current.leftBarType = element.type
                } else if (element.type && (!previous.barType || WEAK_BAR_TYPES.has(previous.barType))) {
                    previous.barType = element.type
                }
            } else {
                current.barType = element.type === "bar_left_repeat" ? "bar_thin" : element.type
                measures.push(element.type === "bar_left_repeat" ? { events: [], length: 0, hasNotes: false, leftBarType: element.type } : { events: [], length: 0, hasNotes: false })
            }
        } else if (element.el_type === "note") {
            current.events.push(element)
            current.hasNotes = true
            const range = trimCharRange(normalized, element.startChar, element.endChar)
            if (current.startChar === undefined) current.startChar = range.startChar
            current.endChar = range.endChar
            if (element.startTriplet) tripletMultiplier = element.tripletMultiplier || 1
            if (element.rest && element.rest.type === "multimeasure") {
                const restBars = Number(element.rest.text)
                current.length += Number.isFinite(restBars) && restBars > 1 ? getElementDuration(element) / restBars : getElementDuration(element)
            } else {
                current.length += getElementDuration(element) * tripletMultiplier
            }
            if (element.endTriplet) tripletMultiplier = 1
        } else if (element.el_type === "key" || element.el_type === "meter" || element.el_type === "clef") {
            if (!current.events.length) {
                if (isPrimary || (element.el_type === "clef" && collectClef)) {
                    current.change = Object.assign(current.change || {}, { [element.el_type]: element })
                }
            } else {
                current.events.push(element)
            }
        } else if (onOther) {
            onOther(element)
        }
    }

    const lastMeasure = measures[measures.length - 1]
    if (!lastMeasure.events.length && (measures.length === 1 || !lastMeasure.change)) measures.pop()
    return measures
}

function resolveLeadingLineBarlines(parsedLines: VoiceMeasure[][][][]): void {
    for (let lineIndex = 1; lineIndex < parsedLines.length; lineIndex++) {
        const prevLine = parsedLines[lineIndex - 1]
        const curLine = parsedLines[lineIndex]
        for (let staffIndex = 0; staffIndex < curLine.length; staffIndex++) {
            const curStaff = curLine[staffIndex]
            const prevStaff = prevLine[staffIndex]
            if (!curStaff || !prevStaff) continue
            for (let voiceIndex = 0; voiceIndex < curStaff.length; voiceIndex++) {
                const curMeasures = curStaff[voiceIndex]
                const prevMeasures = prevStaff[voiceIndex]
                if (!curMeasures?.length || !prevMeasures?.length) continue
                const firstMeasure = curMeasures[0]
                const prevLastMeasure = prevMeasures[prevMeasures.length - 1]
                if (!firstMeasure.leftBarType || !prevLastMeasure.events.length || prevLastMeasure.barType) continue

                if (firstMeasure.leftBarType === "bar_left_repeat") {
                    prevLastMeasure.barType = "bar_thin"
                    prevLastMeasure.closedByNextLine = true
                } else if (firstMeasure.leftBarType === "bar_thick_thin") {
                    prevLastMeasure.barType = "bar_invisible"
                    prevLastMeasure.closedByNextLine = true
                } else {
                    prevLastMeasure.barType = firstMeasure.leftBarType
                    prevLastMeasure.closedByNextLine = true
                    firstMeasure.leftBarType = undefined
                }
            }
        }
    }
}

export function splitTuneIntoMeasures(lines: { staff: Staff[] }[], normalized: string, onBar?: (element: RawAbcElem) => void, onOther?: (element: RawAbcElem) => void, collectClef = false): VoiceMeasure[][][][] {
    const parsedLines = lines.map((line) => line.staff.map((staff, staffIndex) => (staff.voices || []).map((voice, voiceIndex) => splitVoiceIntoMeasures(voice, normalized, staffIndex === 0 && voiceIndex === 0, onBar, onOther, collectClef && voiceIndex === 0))))
    resolveLeadingLineBarlines(parsedLines)
    return parsedLines
}

function collectPitchIntervals(measure: VoiceMeasure | undefined, normalized: string, keySemitones: Record<string, number>, barAccidentals: Record<string, number>): PitchInterval[] {
    if (!measure || !measure.events.length) return []
    const intervals: PitchInterval[] = []
    let time = 0
    let tripletMultiplier = 1
    let activeKey = { ...keySemitones }

    for (const element of measure.events) {
        if (element.el_type === "key") {
            activeKey = getKeySemitoneMap(element as unknown as KeySignature)
            for (const pitchKey of Object.keys(barAccidentals)) delete barAccidentals[pitchKey]
            continue
        }
        if (element.el_type !== "note") continue
        if (element.startTriplet) tripletMultiplier = element.tripletMultiplier || 1
        const duration = element.rest && element.rest.type === "multimeasure" && Number(element.rest.text) > 1 ? getElementDuration(element) / Number(element.rest.text) : getElementDuration(element) * tripletMultiplier
        if (element.endTriplet) tripletMultiplier = 1

        if (!element.rest && element.pitches && element.pitches.length && duration > 0) {
            const range = trimCharRange(normalized, element.startChar, element.endChar)
            let semitoneSum = 0
            for (const pitch of element.pitches) {
                const step = ((pitch.pitch % 7) + 7) % 7
                const octave = Math.floor(pitch.pitch / 7)
                const pitchKey = `${step}.${octave}`
                const written = pitch.accidental !== undefined ? ACCIDENTAL_SEMITONES[pitch.accidental] : undefined
                if (written !== undefined) barAccidentals[pitchKey] = written
                const accidentalOffset = written !== undefined ? written : barAccidentals[pitchKey] !== undefined ? barAccidentals[pitchKey] : activeKey[PITCH_LETTERS[step]] || 0
                semitoneSum += 60 + octave * 12 + DIATONIC_SEMITONES[step] + accidentalOffset
            }
            intervals.push({
                start: time,
                end: time + duration,
                semitones: semitoneSum / element.pitches.length,
                startChar: range.startChar,
                endChar: range.endChar
            })
        }
        time += duration
    }
    return intervals
}

function firstDefinedNumber(...values: (number | undefined)[]): number {
    for (const value of values) {
        if (value !== undefined) return value
    }
    return 0
}

function collectAlignedBars(tune: TuneObject, normalized: string): AlignedBar[] {
    const lines = getStaffLines(tune)
    if (!lines.length) return []

    const bars: AlignedBar[] = []
    let meter = lines[0].staff[0] && lines[0].staff[0].meter
    let barLength = getMeterLength(meter)
    let keySemitones = getKeySemitoneMap(lines[0].staff[0] && lines[0].staff[0].key)
    let pendingMeter: Meter | undefined
    let pendingKey: KeySignature | undefined
    let barOffset = 0
    let carried: (CarriedVoiceMeasure | null)[][] | null = null
    const carriedBarAccidentals: Record<string, Record<string, number>> = {}
    const lastVoiceRange = new Map<string, { startChar: number; endChar: number }>()

    const parsedLines = splitTuneIntoMeasures(lines, normalized)

    lines.forEach((line, lineIndex) => {
        if (lineIndex > 0 && line.staff[0] && line.staff[0].meter) {
            meter = line.staff[0].meter
            barLength = getMeterLength(meter)
        }
        if (lineIndex > 0 && line.staff[0] && line.staff[0].key) {
            keySemitones = getKeySemitoneMap(line.staff[0].key)
        }

        const parsedVoices = parsedLines[lineIndex]
        const measureCount = Math.max(0, ...parsedVoices.flat().map((measures) => measures.length))
        if (!measureCount) return

        const topVoice = parsedVoices[0] && parsedVoices[0][0]
        const isUnfinishedBar = Boolean(lineIndex < lines.length - 1 && topVoice && topVoice[measureCount - 1] && !topVoice[measureCount - 1].barType)
        const nextCarried: (CarriedVoiceMeasure | null)[][] | null = isUnfinishedBar ? parsedVoices.map((staffVoices) => staffVoices.map(() => null)) : null

        for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
            const topMeasure = topVoice && topVoice[measureIndex]
            if (pendingMeter) {
                meter = pendingMeter
                barLength = getMeterLength(meter)
                pendingMeter = undefined
            }
            if (pendingKey) {
                keySemitones = getKeySemitoneMap(pendingKey)
                pendingKey = undefined
            }
            if (topMeasure && topMeasure.change && topMeasure.change.meter) {
                meter = topMeasure.change.meter
                barLength = getMeterLength(meter)
            }
            if (topMeasure && topMeasure.change && topMeasure.change.key) {
                keySemitones = getKeySemitoneMap(topMeasure.change.key)
            }
            if (topMeasure) {
                for (const element of topMeasure.events) {
                    if (element.el_type === "meter") pendingMeter = element as unknown as Meter
                    else if (element.el_type === "key") pendingKey = element as unknown as KeySignature
                }
            }

            const voices: AlignedVoice[][] = parsedVoices.map((staffVoices, staffIndex) =>
                staffVoices.map((measures, voiceIndex) => {
                    const voiceKey = `${staffIndex}.${voiceIndex}`
                    const current = measures[measureIndex]
                    const fallback = measures[measures.length - 1]
                    const previous = measureIndex === 0 && carried && carried[staffIndex] ? carried[staffIndex][voiceIndex] : null
                    const barAccidentals = carriedBarAccidentals[voiceKey] ? { ...carriedBarAccidentals[voiceKey] } : {}
                    const currentIntervals = collectPitchIntervals(current, normalized, keySemitones, barAccidentals)
                    carriedBarAccidentals[voiceKey] = current && !current.barType ? barAccidentals : {}

                    const intervals: PitchInterval[] = previous
                        ? previous.intervals.concat(
                              currentIntervals.map((interval) => ({
                                  ...interval,
                                  start: interval.start + previous.length,
                                  end: interval.end + previous.length
                              }))
                          )
                        : currentIntervals

                    if (previous && previous.leftBarType && current && !current.leftBarType) {
                        current.leftBarType = previous.leftBarType
                    }

                    const lastSeen = lastVoiceRange.get(voiceKey)
                    const startChar = firstDefinedNumber(current && current.startChar, previous ? previous.startChar : undefined, fallback && fallback.startChar, lastSeen ? lastSeen.startChar : undefined, topMeasure && topMeasure.startChar)
                    const endChar = firstDefinedNumber(current && current.endChar, previous ? previous.endChar : undefined, fallback && fallback.endChar, lastSeen ? lastSeen.endChar : undefined, topMeasure && topMeasure.endChar, startChar)
                    if (current && current.startChar !== undefined && current.endChar !== undefined) {
                        lastVoiceRange.set(voiceKey, { startChar: current.startChar, endChar: current.endChar })
                    }

                    const hasMeasure = Boolean(current || (previous && previous.hasMeasure))
                    return {
                        staffIndex,
                        voiceIndex,
                        length: (current ? current.length : 0) + (previous ? previous.length : 0),
                        startChar,
                        endChar,
                        intervals,
                        hasNotes: Boolean((current && current.hasNotes) || (previous && previous.hasNotes)),
                        hasMeasure
                    }
                })
            )

            if (isUnfinishedBar && measureIndex === measureCount - 1 && nextCarried) {
                voices.forEach((staffVoices, staffIndex) =>
                    staffVoices.forEach((voice, voiceIndex) => {
                        const currentMeasure = parsedVoices[staffIndex][voiceIndex][measureIndex]
                        nextCarried[staffIndex][voiceIndex] = {
                            length: voice.length,
                            startChar: firstDefinedNumber(currentMeasure && currentMeasure.startChar, voice.startChar),
                            endChar: firstDefinedNumber(currentMeasure && currentMeasure.endChar, voice.endChar),
                            leftBarType: currentMeasure ? currentMeasure.leftBarType : undefined,
                            intervals: voice.intervals,
                            hasNotes: voice.hasNotes,
                            hasMeasure: voice.hasMeasure
                        }
                    })
                )
                continue
            }

            bars.push({
                barNumber: barOffset + measureIndex + 1,
                isLast: lineIndex === lines.length - 1 && measureIndex === measureCount - 1,
                meter,
                barLength,
                barType: topMeasure && topMeasure.barType,
                leftBarType: topMeasure && topMeasure.leftBarType,
                staves: line.staff,
                voices
            })
        }

        carried = nextCarried
        barOffset += isUnfinishedBar ? Math.max(0, measureCount - 1) : measureCount
    })

    return bars
}

function checkSyntaxWarnings(tune: TuneObject | undefined, mapper: OffsetMapper): AbcProblem[] {
    const rawWarnings = tune && (tune as TuneObject & { warnings?: string[] }).warnings
    if (!Array.isArray(rawWarnings) || !rawWarnings.length) return []

    const lineStarts = getLineStarts(mapper.normalized)
    // Mirror abcjs bookParser's line numbering: directives before X: are prepended to the first tune
    const sourceLines = mapper.normalized.split("\n")
    const firstContentLine = Math.max(
        0,
        sourceLines.findIndex((line) => line.trim())
    )
    const headerStartLine = sourceLines.findIndex((line, index) => index >= firstContentLine && line.startsWith("X:"))
    const lineMap: number[] = []
    for (let index = firstContentLine; index < sourceLines.length; index++) {
        if (headerStartLine <= firstContentLine || index >= headerStartLine || sourceLines[index].startsWith("%%")) {
            lineMap.push(index)
        }
    }

    const problems: AbcProblem[] = []
    for (const warning of rawWarnings) {
        if (typeof warning !== "string") continue
        const match = /^Music Line:(\d+):(\d+):\s*(.*?)(?:: {2}|$)/.exec(warning)
        if (!match) {
            const plainText = warning.replace(/<[^>]+>/g, "").trim()
            if (plainText && !HARMLESS_WARNING_PATTERN.test(plainText)) problems.push(makeAbcProblem("syntax", [plainText], 0, 0))
            continue
        }
        const message = match[3].trim()
        if (!message || HARMLESS_WARNING_PATTERN.test(message)) continue
        const tuneLineIndex = Math.max(0, Number(match[1]) - 1)
        const sourceLineIndex = clamp(lineMap[tuneLineIndex] !== undefined ? lineMap[tuneLineIndex] : tuneLineIndex, lineStarts.length - 1)
        const lineStart = lineStarts[sourceLineIndex] || 0
        const lineEnd = sourceLineIndex + 1 < lineStarts.length ? lineStarts[sourceLineIndex + 1] - 1 : mapper.normalized.length
        const startOffset = Math.max(lineStart, Math.min(lineEnd, lineStart + Math.max(0, Number(match[2]) - 1)))
        problems.push(makeAbcProblem("syntax", [message], mapper.toOriginal(startOffset), mapper.toOriginal(Math.min(mapper.normalized.length, startOffset + 1))))
    }
    return problems
}

function findEarliestTuneOffset(tune: TuneObject, normalized: string): number {
    let earliest = Infinity
    const metaInfo = (tune as TuneObject & { metaTextInfo?: Record<string, { startChar?: number }> }).metaTextInfo
    if (metaInfo) {
        for (const info of Object.values(metaInfo)) {
            if (info && typeof info.startChar === "number" && Number.isFinite(info.startChar)) {
                earliest = Math.min(earliest, info.startChar)
            }
        }
    }
    for (const line of getStaffLines(tune)) {
        for (const staff of line.staff) {
            for (const voice of staff.voices || []) {
                for (const element of voice as RawAbcElem[]) {
                    if (element.startChar !== undefined && element.el_type !== "stem") {
                        earliest = Math.min(earliest, trimCharRange(normalized, element.startChar, element.endChar).startChar)
                    }
                }
            }
        }
    }
    return Number.isFinite(earliest) ? earliest : 0
}

function checkMultipleTunes(tunes: TuneObject[], mapper: OffsetMapper, secondTuneLine: number): AbcProblem[] {
    if (tunes.length <= 1) return []
    const normalized = mapper.normalized
    const lineStarts = getLineStarts(normalized)
    const targetLine = secondTuneLine >= 0 ? secondTuneLine : getLineIndexAt(lineStarts, findEarliestTuneOffset(tunes[1], normalized))
    const startOffset = lineStarts[targetLine] || 0
    const endOffset = targetLine + 1 < lineStarts.length ? lineStarts[targetLine + 1] - 1 : normalized.length
    return [makeAbcProblem("multiple_tunes", [], mapper.toOriginal(startOffset), mapper.toOriginal(endOffset))]
}

function hasMusicLineAfter(sourceLines: string[], startIndex: number, endLine: number): boolean {
    let inTextBlock = false
    for (let index = startIndex; index < endLine; index++) {
        const trimmed = sourceLines[index].trim()
        if (/^%%begintext\b/i.test(trimmed)) {
            inTextBlock = true
            continue
        }
        if (/^%%endtext\b/i.test(trimmed)) {
            inTextBlock = false
            continue
        }
        if (isMusicSourceLine(trimmed, inTextBlock)) return true
    }
    return false
}

function checkBlankLines(tune: TuneObject | undefined, mapper: OffsetMapper, secondTuneLine: number, severity: AbcProblemSeverity): AbcProblem[] {
    const normalized = mapper.normalized
    const lineStarts = getLineStarts(normalized)
    const sourceLines = normalized.split("\n")
    const endLine = secondTuneLine >= 0 ? secondTuneLine : sourceLines.length

    let scanStartLine = -1
    if (tune && hasAbcNotes(tune)) {
        let firstMusicLine = Infinity
        for (const line of getStaffLines(tune)) {
            for (const staff of line.staff) {
                for (const voice of staff.voices || []) {
                    for (const element of voice as RawAbcElem[]) {
                        if (element.startChar !== undefined && element.el_type !== "stem") {
                            firstMusicLine = Math.min(firstMusicLine, getLineIndexAt(lineStarts, trimCharRange(normalized, element.startChar, element.endChar).startChar))
                        }
                    }
                }
            }
        }
        if (!Number.isFinite(firstMusicLine)) return []
        scanStartLine = firstMusicLine + 1
    } else {
        let inHeaderTextBlock = false
        let xLine = -1
        let firstContentLine = -1
        for (let index = 0; index < endLine; index++) {
            const trimmed = sourceLines[index].trim()
            if (/^%%begintext\b/i.test(trimmed)) {
                inHeaderTextBlock = true
                continue
            }
            if (/^%%endtext\b/i.test(trimmed)) {
                inHeaderTextBlock = false
                continue
            }
            if (inHeaderTextBlock || !trimmed || trimmed.startsWith("%")) continue
            if (firstContentLine < 0) firstContentLine = index
            if (xLine < 0 && /^X:/.test(trimmed)) {
                xLine = index
                break
            }
        }
        const headerStartLine = xLine >= 0 ? xLine : firstContentLine
        if (headerStartLine < 0) return []
        scanStartLine = headerStartLine + 1
    }

    let inTextBlock = false
    for (let index = 0; index < endLine; index++) {
        const trimmed = sourceLines[index].trim()
        if (/^%%begintext\b/i.test(trimmed)) {
            inTextBlock = true
            continue
        }
        if (/^%%endtext\b/i.test(trimmed)) {
            inTextBlock = false
            continue
        }
        if (inTextBlock || index < scanStartLine) continue
        if (trimmed !== "") continue
        if (hasMusicLineAfter(sourceLines, index + 1, endLine)) {
            const startOffset = lineStarts[index]
            const endOffset = index + 1 < lineStarts.length ? lineStarts[index + 1] : normalized.length
            return [makeAbcProblem("blank_line", [], mapper.toOriginal(startOffset), mapper.toOriginal(endOffset), severity)]
        }
        break
    }
    return []
}

function checkMissingParts(tune: TuneObject, mapper: OffsetMapper, expectedVoiceCounts: number[]): AbcProblem[] {
    const lines = getStaffLines(tune)
    if (lines.length <= 1) return []
    const normalized = mapper.normalized
    const lineStarts = getLineStarts(normalized)
    const expectedStaffCount = expectedVoiceCounts.length
    const problems: AbcProblem[] = []

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
        const staves = lines[lineIndex].staff
        let missing = staves.length !== expectedStaffCount
        if (!missing) {
            for (let staffIndex = 0; staffIndex < expectedStaffCount; staffIndex++) {
                if ((staves[staffIndex].voices || []).length < expectedVoiceCounts[staffIndex]) {
                    missing = true
                    break
                }
            }
        }
        if (!missing) continue

        let earliestStart = Infinity
        for (const staff of staves) {
            for (const voice of staff.voices || []) {
                for (const element of voice as RawAbcElem[]) {
                    if (element.startChar !== undefined && element.el_type !== "stem") {
                        earliestStart = Math.min(earliestStart, trimCharRange(normalized, element.startChar, element.endChar).startChar)
                    }
                }
            }
        }
        const sourceLine = Number.isFinite(earliestStart) ? getLineIndexAt(lineStarts, earliestStart) : 0
        const startOffset = lineStarts[sourceLine] || 0
        const endOffset = sourceLine + 1 < lineStarts.length ? lineStarts[sourceLine + 1] - 1 : normalized.length
        problems.push(makeAbcProblem("missing_parts", [], mapper.toOriginal(startOffset), mapper.toOriginal(endOffset), "error"))
    }
    return problems
}

function findAmpersandOnLine(lineText: string, lineStart: number, beforeOffset: number): number {
    let inQuote = false
    let escaped = false
    let lastMatch = -1
    let firstMatch = -1
    for (let index = 0; index < lineText.length; index++) {
        const ch = lineText[index]
        if (!inQuote && !escaped && ch === "%") break
        if (!escaped && ch === '"') {
            inQuote = !inQuote
        } else if (!inQuote && !escaped && ch === "&") {
            const absOffset = lineStart + index
            if (firstMatch < 0) firstMatch = absOffset
            if (absOffset <= beforeOffset) lastMatch = absOffset
        }
        escaped = ch === "\\" && !escaped
    }
    return lastMatch >= 0 ? lastMatch : firstMatch
}

function checkOverlayCorruption(tune: TuneObject, mapper: OffsetMapper, expectedVoiceCounts: number[]): AbcProblem[] {
    const lines = getStaffLines(tune)
    if (!lines.length) return []
    const normalized = mapper.normalized
    const lineStarts = getLineStarts(normalized)
    const sourceLines = normalized.split("\n")
    const problems: AbcProblem[] = []
    const reportedOffsets = new Set<number>()

    for (const line of lines) {
        line.staff.forEach((staff, staffIndex) => {
            const declaredCount = expectedVoiceCounts[staffIndex] ?? 0
            const voices = staff.voices || []
            if (voices.length <= declaredCount) return

            const seenNoteStarts = new Set<number>()
            for (let voiceIndex = 0; voiceIndex < voices.length; voiceIndex++) {
                const voice = voices[voiceIndex] as RawAbcElem[]
                const voiceStarts: number[] = []
                for (const element of voice) {
                    if (element.el_type !== "note" || (element.rest && element.rest.type === "invisible") || element.startChar === undefined) continue
                    const start = trimCharRange(normalized, element.startChar, element.endChar).startChar
                    if (voiceIndex >= declaredCount && seenNoteStarts.has(start)) {
                        const sourceLine = getLineIndexAt(lineStarts, start)
                        const ampOffset = findAmpersandOnLine(sourceLines[sourceLine] || "", lineStarts[sourceLine] || 0, start)
                        const targetOffset = ampOffset >= 0 ? ampOffset : start
                        if (!reportedOffsets.has(targetOffset)) {
                            reportedOffsets.add(targetOffset)
                            problems.push(makeAbcProblem("overlay_unsupported", [], mapper.toOriginal(targetOffset), mapper.toOriginal(Math.min(normalized.length, targetOffset + 1)), "error"))
                        }
                        break
                    }
                    voiceStarts.push(start)
                }
                for (const start of voiceStarts) seenNoteStarts.add(start)
            }
        })
    }
    return problems
}

function getPartName(parts: AbcPartInfo[], staffIndex: number, voiceIndex: number): string {
    const found = parts.find((part) => part.staff === staffIndex + 1 && part.layer === voiceIndex + 1)
    return found ? found.name : `Voice ${voiceIndex + 1}`
}

function majorityLength(values: number[]): number {
    let bestValue = values[0]
    let bestCount = 0
    for (const candidate of values) {
        let count = 0
        for (const value of values) {
            if (Math.abs(value - candidate) <= 1e-4) count++
        }
        if (count > bestCount) {
            bestCount = count
            bestValue = candidate
        }
    }
    return bestValue
}

function majorityInteger(values: number[]): number {
    let bestValue = values[0]
    let bestCount = 0
    for (const candidate of values) {
        let count = 0
        for (const value of values) {
            if (value === candidate) count++
        }
        if (count > bestCount) {
            bestCount = count
            bestValue = candidate
        }
    }
    return bestValue
}

function checkMeasuresOnBars(bars: AlignedBar[], mapper: OffsetMapper, parts: AbcPartInfo[], expectedVoiceCounts: number[]): AbcProblem[] {
    const problems: AbcProblem[] = []
    const isDeclaredVoice = (staffIndex: number, voiceIndex: number) => voiceIndex < (expectedVoiceCounts[staffIndex] ?? Infinity)
    const activeVoices = new Set<string>()
    const activeVoiceOrder: { key: string; staffIndex: number; voiceIndex: number }[] = []

    for (const bar of bars) {
        for (const staffVoices of bar.voices) {
            for (const voice of staffVoices) {
                if (!isDeclaredVoice(voice.staffIndex, voice.voiceIndex)) continue
                const voiceKey = `${voice.staffIndex}.${voice.voiceIndex}`
                if ((voice.hasNotes || voice.length > 1e-4) && !activeVoices.has(voiceKey)) {
                    activeVoices.add(voiceKey)
                    activeVoiceOrder.push({ key: voiceKey, staffIndex: voice.staffIndex, voiceIndex: voice.voiceIndex })
                }
            }
        }
    }
    if (!activeVoices.size) return problems

    if (activeVoiceOrder.length >= 2) {
        const barCounts = new Map<string, number>()
        for (const entry of activeVoiceOrder) barCounts.set(entry.key, 0)
        for (const bar of bars) {
            for (const voice of bar.voices.flat()) {
                const voiceKey = `${voice.staffIndex}.${voice.voiceIndex}`
                if (activeVoices.has(voiceKey) && voice.hasMeasure) {
                    barCounts.set(voiceKey, (barCounts.get(voiceKey) || 0) + 1)
                }
            }
        }

        const countValues = activeVoiceOrder.map((entry) => barCounts.get(entry.key) || 0)
        const expectedBarCount = majorityInteger(countValues)
        const halfActive = activeVoiceOrder.length / 2

        for (const entry of activeVoiceOrder) {
            const partBarCount = barCounts.get(entry.key) || 0
            if (partBarCount === expectedBarCount) continue

            let targetRange: { startChar: number; endChar: number } | null = null
            if (partBarCount > expectedBarCount) {
                let seenForPart = 0
                let fallbackRange: { startChar: number; endChar: number } | null = null
                for (const bar of bars) {
                    const partVoices = bar.voices.flat().filter((voice) => activeVoices.has(`${voice.staffIndex}.${voice.voiceIndex}`))
                    const partVoice = partVoices.find((voice) => voice.staffIndex === entry.staffIndex && voice.voiceIndex === entry.voiceIndex)
                    if (!partVoice || !partVoice.hasMeasure) continue
                    seenForPart++
                    if (seenForPart === expectedBarCount + 1 && !fallbackRange) {
                        fallbackRange = { startChar: partVoice.startChar, endChar: partVoice.endChar }
                    }
                    const missingCount = partVoices.filter((voice) => !voice.hasMeasure).length
                    if (missingCount > halfActive) {
                        targetRange = { startChar: partVoice.startChar, endChar: partVoice.endChar }
                        break
                    }
                }
                if (!targetRange) targetRange = fallbackRange
            } else {
                let lastPresent: { startChar: number; endChar: number } | null = null
                for (const bar of bars) {
                    const partVoice = bar.voices.flat().find((voice) => voice.staffIndex === entry.staffIndex && voice.voiceIndex === entry.voiceIndex)
                    if (partVoice && partVoice.hasMeasure) {
                        lastPresent = { startChar: partVoice.startChar, endChar: partVoice.endChar }
                    } else if (lastPresent) {
                        targetRange = lastPresent
                        break
                    }
                }
                if (!targetRange) targetRange = lastPresent
            }

            const partName = getPartName(parts, entry.staffIndex, entry.voiceIndex)
            const rangeStart = targetRange ? targetRange.startChar : 0
            const rangeEnd = targetRange ? targetRange.endChar : 0
            const problemKey = partBarCount === 1 ? "part_bars_one" : "part_bars"
            const values = partBarCount === 1 ? [partName, String(expectedBarCount)] : [partName, String(partBarCount), String(expectedBarCount)]
            problems.push(makeAbcProblem(problemKey, values, mapper.toOriginal(rangeStart), mapper.toOriginal(rangeEnd)))
        }
    }

    const splitOkKeys = new Set<string>()
    for (let index = 0; index + 1 < bars.length; index++) {
        const firstBar = bars[index]
        const nextBar = bars[index + 1]
        if (!((firstBar.barType && SECTION_BAR_TYPES.has(firstBar.barType)) || nextBar.leftBarType === "bar_left_repeat")) continue
        if (firstBar.barLength === null || nextBar.barLength !== firstBar.barLength) continue
        const expectedBarLength = firstBar.barLength
        for (const firstVoice of firstBar.voices.flat()) {
            if (!firstVoice.hasMeasure || !isDeclaredVoice(firstVoice.staffIndex, firstVoice.voiceIndex)) continue
            const voiceKey = `${firstVoice.staffIndex}.${firstVoice.voiceIndex}`
            const nextVoice = nextBar.voices.flat().find((voice) => voice.staffIndex === firstVoice.staffIndex && voice.voiceIndex === firstVoice.voiceIndex)
            if (!nextVoice || !nextVoice.hasMeasure) continue
            if (firstVoice.length > 1e-4 && nextVoice.length > 1e-4 && firstVoice.length < expectedBarLength - 1e-4 && nextVoice.length < expectedBarLength - 1e-4 && Math.abs(firstVoice.length + nextVoice.length - expectedBarLength) <= 1e-4) {
                splitOkKeys.add(`${index}:${voiceKey}`)
                splitOkKeys.add(`${index + 1}:${voiceKey}`)
            }
        }
    }

    const pickupLengthByVoice = new Map<string, number>()
    if (bars.length > 0 && bars[0].barLength !== null) {
        const firstBarLength = bars[0].barLength
        for (const voice of bars[0].voices.flat()) {
            const voiceKey = `${voice.staffIndex}.${voice.voiceIndex}`
            if (voice.hasMeasure && activeVoices.has(voiceKey) && voice.length > 1e-4 && voice.length < firstBarLength - 1e-4) {
                pickupLengthByVoice.set(voiceKey, voice.length)
            }
        }
    }

    const pushBeatsProblem = (kind: string, partName: string, barNumber: number, gotBeats: string, expectedBeats: string, startChar: number, endChar: number) => {
        const problemKey = gotBeats === "1" ? `${kind}_one` : kind
        const values = gotBeats === "1" ? [partName, String(barNumber), expectedBeats] : [partName, String(barNumber), gotBeats, expectedBeats]
        problems.push(makeAbcProblem(problemKey, values, mapper.toOriginal(startChar), mapper.toOriginal(endChar)))
    }

    bars.forEach((bar, barIndex) => {
        const entries = bar.voices.flat().filter((voice) => voice.hasMeasure && isDeclaredVoice(voice.staffIndex, voice.voiceIndex) && activeVoices.has(`${voice.staffIndex}.${voice.voiceIndex}`))
        if (!entries.length) return

        if (bar.barLength === null) {
            const referenceLength = majorityLength(entries.map((voice) => voice.length))
            const referenceBeats = formatBeats(referenceLength, bar.meter)
            for (const voice of entries) {
                if (Math.abs(voice.length - referenceLength) > 1e-4) {
                    pushBeatsProblem("bar_beats_part", getPartName(parts, voice.staffIndex, voice.voiceIndex), bar.barNumber, formatBeats(voice.length, bar.meter), referenceBeats, voice.startChar, voice.endChar)
                }
            }
            return
        }

        const expectedBarLength = bar.barLength
        if (bar.barNumber === 1) {
            const nonZeroLengths = entries.map((voice) => voice.length).filter((length) => length > 1e-4)
            const referenceLength = nonZeroLengths.length ? majorityLength(nonZeroLengths) : 0
            if (referenceLength > 1e-4 && referenceLength < expectedBarLength - 1e-4) {
                const referenceBeats = formatBeats(referenceLength, bar.meter)
                for (const voice of entries) {
                    if (Math.abs(voice.length - referenceLength) > 1e-4) {
                        pushBeatsProblem("bar_beats_part", getPartName(parts, voice.staffIndex, voice.voiceIndex), bar.barNumber, formatBeats(voice.length, bar.meter), referenceBeats, voice.startChar, voice.endChar)
                    }
                }
                return
            }
        }

        if (bar.isLast && entries.every((voice) => voice.length > 1e-4 && voice.length < expectedBarLength - 1e-4 && Math.abs(voice.length - entries[0].length) <= 1e-4)) {
            return
        }

        const expectedBeats = formatBeats(expectedBarLength, bar.meter)
        const mismatched = entries.filter((voice) => {
            const voiceKey = `${voice.staffIndex}.${voice.voiceIndex}`
            if (splitOkKeys.has(`${barIndex}:${voiceKey}`)) return false
            if (bar.isLast && voice.length > 1e-4 && voice.length < expectedBarLength - 1e-4) {
                const pickupLength = pickupLengthByVoice.get(voiceKey)
                if (pickupLength !== undefined && Math.abs(pickupLength + voice.length - expectedBarLength) <= 1e-4) return false
            }
            return Math.abs(voice.length - expectedBarLength) > 1e-4
        })

        if (entries.length > 1 && mismatched.length === entries.length && entries.every((voice) => Math.abs(voice.length - entries[0].length) <= 1e-4)) {
            const gotBeats = formatBeats(entries[0].length, bar.meter)
            const problemKey = gotBeats === "1" ? "bar_beats_all_one" : "bar_beats_all"
            const values = gotBeats === "1" ? [String(bar.barNumber), expectedBeats] : [String(bar.barNumber), gotBeats, expectedBeats]
            problems.push(makeAbcProblem(problemKey, values, mapper.toOriginal(entries[0].startChar), mapper.toOriginal(entries[0].endChar)))
            return
        }

        for (const voice of mismatched) {
            pushBeatsProblem("bar_beats_meter", getPartName(parts, voice.staffIndex, voice.voiceIndex), bar.barNumber, formatBeats(voice.length, bar.meter), expectedBeats, voice.startChar, voice.endChar)
        }
    })

    return problems
}

function findVoiceCrossing(upperIntervals: PitchInterval[], lowerIntervals: PitchInterval[], minSemitones = 0): CrossingMatch {
    let upperIndex = 0
    let lowerIndex = 0
    let overlapDuration = 0
    let crossedDuration = 0
    let startChar = 0
    let endChar = 0

    while (upperIndex < upperIntervals.length && lowerIndex < lowerIntervals.length) {
        const upper = upperIntervals[upperIndex]
        const lower = lowerIntervals[lowerIndex]
        const duration = Math.min(upper.end, lower.end) - Math.max(upper.start, lower.start)
        if (duration > 1e-6) {
            overlapDuration += duration
            const isCrossed = minSemitones > 0 ? lower.semitones - upper.semitones >= minSemitones - 1e-6 : lower.semitones > upper.semitones + 1e-6
            if (isCrossed) {
                if (!crossedDuration) {
                    startChar = lower.startChar
                    endChar = lower.endChar
                }
                crossedDuration += duration
            }
        }
        if (upper.end <= lower.end) upperIndex++
        else lowerIndex++
    }
    return { crossed: overlapDuration > 0 && crossedDuration > overlapDuration / 2, startChar, endChar }
}

function checkVoiceOrderOnBars(bars: AlignedBar[], mapper: OffsetMapper, parts: AbcPartInfo[], expectedVoiceCounts: number[]): AbcProblem[] {
    const problems: AbcProblem[] = []
    for (const bar of bars) {
        const barNumberText = String(bar.barNumber)
        const flaggedVoices = new Set<string>()
        const pushCrossing = (lowerStaff: number, lowerVoice: number, upperStaff: number, upperVoice: number, startChar: number, endChar: number) => {
            problems.push(makeAbcProblem("voice_order", [getPartName(parts, lowerStaff, lowerVoice), getPartName(parts, upperStaff, upperVoice), barNumberText], mapper.toOriginal(startChar), mapper.toOriginal(endChar)))
        }

        bar.voices.forEach((staffVoices, staffIndex) => {
            const declaredCount = Math.min(staffVoices.length, expectedVoiceCounts[staffIndex] ?? staffVoices.length)
            if (declaredCount >= 2) {
                const match = findVoiceCrossing(staffVoices[0].intervals, staffVoices[1].intervals, 0)
                if (match.crossed) {
                    flaggedVoices.add(`${staffIndex}.1`)
                    pushCrossing(staffIndex, 1, staffIndex, 0, match.startChar, match.endChar)
                }
            }
        })

        const upperIsNonBass = !((bar.staves[0] && bar.staves[0].clef && bar.staves[0].clef.type) || "treble").startsWith("bass")
        const lowerIsBass = Boolean(bar.staves[1] && bar.staves[1].clef && bar.staves[1].clef.type && bar.staves[1].clef.type.startsWith("bass"))
        const upperDeclaredCount = bar.voices[0] ? Math.min(bar.voices[0].length, expectedVoiceCounts[0] ?? bar.voices[0].length) : 0
        const lowerDeclaredCount = bar.voices[1] ? Math.min(bar.voices[1].length, expectedVoiceCounts[1] ?? bar.voices[1].length) : 0
        if (bar.staves.length >= 2 && upperDeclaredCount > 0 && lowerDeclaredCount > 0 && upperIsNonBass && lowerIsBass) {
            const upperBottomVoiceIndex = upperDeclaredCount - 1
            for (let voiceIndex = 0; voiceIndex < lowerDeclaredCount; voiceIndex++) {
                if (flaggedVoices.has(`1.${voiceIndex}`)) continue
                const match = findVoiceCrossing(bar.voices[0][upperBottomVoiceIndex].intervals, bar.voices[1][voiceIndex].intervals, ALTO_TENOR_CROSSING_SEMITONES)
                if (match.crossed) pushCrossing(1, voiceIndex, 0, upperBottomVoiceIndex, match.startChar, match.endChar)
            }
        }
    }
    return problems
}

function tokenizeLyrics(content: string, offset: number): LyricToken[] {
    const trimmed = content.replace(/(?<!\\)%.*$/, "").replace(/\s+$/, "")
    if (!trimmed.trim()) return []
    const padded = /(?:^|[^\\])(?:\\\\)*-$/.test(trimmed) ? trimmed : `${trimmed} `
    const tokens: LyricToken[] = []
    let segmentStart = 0
    let escaped = false

    const flushSegment = (endIndex: number): boolean => {
        const segment = padded.slice(segmentStart, endIndex)
        const body = segment.trim()
        const bodyStart = segmentStart + segment.indexOf(body)
        segmentStart = endIndex + 1
        if (body) tokens.push({ kind: "syllable", text: body, startChar: offset + bodyStart, endChar: offset + bodyStart + body.length })
        return Boolean(body)
    }

    for (let index = 0; index < padded.length; index++) {
        const ch = padded[index]
        if (ch === " " || ch === "\t") {
            flushSegment(index)
        } else if (!escaped && ch === "-") {
            if (!flushSegment(index) && tokens.length) tokens.push({ kind: "skip", text: ch, startChar: offset + index, endChar: offset + index + 1 })
        } else if (!escaped && (ch === "_" || ch === "*" || ch === "|")) {
            flushSegment(index)
            tokens.push({ kind: ch === "|" ? "bar" : ch === "_" ? "hold" : "skip", text: ch, startChar: offset + index, endChar: offset + index + 1 })
        }
        escaped = ch === "\\" && !escaped
    }
    return tokens
}

function findVoiceLyricLines(elements: RawAbcElem[], normalized: string, sourceLines: string[], lineStarts: number[], usedLines: Set<number>): VoiceLyricLine[] {
    let lastMusicLine = -1
    for (const element of elements) {
        if (element.startChar !== undefined && element.el_type !== "stem") {
            lastMusicLine = Math.max(lastMusicLine, getLineIndexAt(lineStarts, trimCharRange(normalized, element.startChar, element.endChar).startChar))
        }
    }
    if (lastMusicLine < 0) return []
    const lyricLines: VoiceLyricLine[] = []
    for (let scanIndex = lastMusicLine + 1; scanIndex < sourceLines.length; scanIndex++) {
        const match = /^(\s*w:\s*)(.*)$/.exec(sourceLines[scanIndex])
        if (!match) {
            if (/^\s*%/.test(sourceLines[scanIndex])) continue
            break
        }
        if (usedLines.has(scanIndex)) continue
        usedLines.add(scanIndex)
        lyricLines.push({ lineIndex: scanIndex, contentOffset: lineStarts[scanIndex] + match[1].length, content: match[2] })
    }
    return lyricLines
}

export function collectHeldLyrics(tune: TuneObject, normalized: string): Map<RawAbcElem, Set<number>> {
    const heldByElement = new Map<RawAbcElem, Set<number>>()
    const lines = getStaffLines(tune)
    if (!lines.length) return heldByElement
    const sourceLines = normalized.split("\n")
    const lineStarts = getLineStarts(normalized)
    const usedLines = new Set<number>()

    for (const line of lines) {
        for (const staff of line.staff) {
            for (const voice of staff.voices || []) {
                const elements = voice as RawAbcElem[]
                const lyricLines = findVoiceLyricLines(elements, normalized, sourceLines, lineStarts, usedLines)
                if (!lyricLines.length) continue
                const items = elements.filter((element) => element.el_type === "note" || element.el_type === "bar")

                lyricLines.forEach((lyricLine, verseIndex) => {
                    const tokens = tokenizeLyrics(lyricLine.content, lyricLine.contentOffset)
                    let itemIndex = 0
                    let lastSyllableElement: RawAbcElem | null = null
                    for (const token of tokens) {
                        if (token.kind === "bar") {
                            while (itemIndex < items.length && items[itemIndex].el_type !== "bar") itemIndex++
                            if (itemIndex < items.length) itemIndex++
                            lastSyllableElement = null
                        } else if (token.kind === "syllable") {
                            while (itemIndex < items.length && (items[itemIndex].el_type !== "note" || items[itemIndex].rest)) itemIndex++
                            if (itemIndex < items.length) {
                                lastSyllableElement = items[itemIndex]
                                itemIndex++
                            }
                        } else if (token.kind === "hold") {
                            if (lastSyllableElement) {
                                let verses = heldByElement.get(lastSyllableElement)
                                if (!verses) {
                                    verses = new Set<number>()
                                    heldByElement.set(lastSyllableElement, verses)
                                }
                                verses.add(verseIndex)
                            }
                            while (itemIndex < items.length && items[itemIndex].el_type !== "note") itemIndex++
                            if (itemIndex < items.length) itemIndex++
                        } else {
                            while (itemIndex < items.length && items[itemIndex].el_type !== "note") itemIndex++
                            if (itemIndex < items.length) itemIndex++
                            lastSyllableElement = null
                        }
                    }
                })
            }
        }
    }
    return heldByElement
}

function checkLyrics(tune: TuneObject, mapper: OffsetMapper): AbcProblem[] {
    const lines = getStaffLines(tune)
    if (!lines.length) return []
    const sourceLines = mapper.normalized.split("\n")
    const lineStarts = getLineStarts(mapper.normalized)
    const usedLines = new Set<number>()
    const problems: AbcProblem[] = []

    for (const line of lines) {
        for (const staff of line.staff) {
            for (const voice of staff.voices || []) {
                const elements = voice as RawAbcElem[]
                const items = elements.filter((element) => (element.el_type === "note" && !element.rest) || element.el_type === "bar")
                const totalNotes = items.filter((element) => element.el_type === "note").length
                if (!totalNotes) continue

                const lyricLines = findVoiceLyricLines(elements, mapper.normalized, sourceLines, lineStarts, usedLines)
                lyricLines.forEach((lyricLine, verseIndex) => {
                    const verseNumber = verseIndex + 1
                    const tokens = tokenizeLyrics(lyricLine.content, lyricLine.contentOffset)
                    if (!tokens.length) return

                    let itemIndex = 0
                    let notesCovered = 0
                    let syllableCount = 0
                    let firstOverflowSyllable: LyricToken | null = null

                    for (const token of tokens) {
                        if (token.kind === "bar") {
                            while (itemIndex < items.length && items[itemIndex].el_type !== "bar") {
                                if (items[itemIndex++].el_type === "note") notesCovered++
                            }
                            if (itemIndex < items.length) itemIndex++
                        } else {
                            if (token.kind === "syllable") syllableCount++
                            while (itemIndex < items.length && items[itemIndex].el_type !== "note") itemIndex++
                            if (itemIndex < items.length) {
                                notesCovered++
                                itemIndex++
                            } else if (token.kind === "syllable" && !firstOverflowSyllable) {
                                firstOverflowSyllable = token
                            }
                        }
                    }

                    if (firstOverflowSyllable) {
                        problems.push(makeAbcProblem("syllables_overflow", [String(verseNumber), firstOverflowSyllable.text], mapper.toOriginal(firstOverflowSyllable.startChar), mapper.toOriginal(firstOverflowSyllable.endChar)))
                    } else if (notesCovered < totalNotes) {
                        const scanLine = lyricLine.lineIndex
                        problems.push(makeAbcProblem("syllables", [String(verseNumber), String(syllableCount), String(totalNotes)], mapper.toOriginal(lineStarts[scanLine]), mapper.toOriginal(lineStarts[scanLine] + sourceLines[scanLine].length)))
                    }
                })
            }
        }
    }
    return problems
}

export function checkAbcTune(tunes: TuneObject[], abc: string, converterProblems: AbcProblem[] = []): AbcProblem[] {
    const tune = tunes[0]
    const mapper = buildOffsetMapper(abc)
    const sourceLines = mapper.normalized.split("\n")
    const secondTuneLine = tunes.length > 1 ? findSecondTuneLine(sourceLines) : -1
    const problems: AbcProblem[] = []

    if (!tune || !hasAbcNotes(tune)) {
        const blankProblems = checkBlankLines(tune, mapper, secondTuneLine, "error")
        if (blankProblems.length) {
            problems.push(...blankProblems)
        } else if (!converterProblems.some((problem) => problem.severity === "error")) {
            problems.push(makeAbcProblem("no_notes", [], 0, Math.min(abc.length, 1), "error"))
        }
        const filteredConverterProblems = blankProblems.length ? converterProblems.filter((problem) => problem.key !== "sheet_music.problem_no_notes") : converterProblems
        problems.push(...checkSyntaxWarnings(tune, mapper), ...checkMultipleTunes(tunes, mapper, secondTuneLine), ...filteredConverterProblems)
    } else {
        const lines = getStaffLines(tune)
        const declaredStaffVoices = getDeclaredStaffVoices(mapper.normalized, secondTuneLine)
        const expectedVoiceCounts = getExpectedVoiceCounts(lines[0].staff, declaredStaffVoices)
        const parts = getAbcParts(tune, declaredStaffVoices)
        const bars = collectAlignedBars(tune, mapper.normalized)
        problems.push(...checkSyntaxWarnings(tune, mapper), ...checkMultipleTunes(tunes, mapper, secondTuneLine), ...checkBlankLines(tune, mapper, secondTuneLine, "warning"), ...checkMissingParts(tune, mapper, expectedVoiceCounts), ...checkOverlayCorruption(tune, mapper, expectedVoiceCounts), ...checkMeasuresOnBars(bars, mapper, parts, expectedVoiceCounts), ...checkVoiceOrderOnBars(bars, mapper, parts, expectedVoiceCounts), ...checkLyrics(tune, mapper), ...converterProblems)
    }

    const seen = new Set<string>()
    return problems
        .filter((problem) => {
            const signature = `${problem.severity}|${problem.key}|${problem.values.join(",")}|${problem.startChar}|${problem.endChar}`
            if (seen.has(signature)) return false
            seen.add(signature)
            return true
        })
        .sort((a, b) => (a.severity !== b.severity ? (a.severity === "error" ? -1 : 1) : a.startChar - b.startChar))
}

function sameProblemValues(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return false
    }
    return true
}

export function mergeNeighborProblems(problems: AbcProblem[], abc: string): AbcProblem[] {
    if (problems.length <= 1) return problems.map((problem) => ({ ...problem, values: [...problem.values] }))

    const lineStarts = getLineStarts(abc)
    const merged: AbcProblem[] = []
    let previousLine = -1

    for (const problem of problems) {
        const startLine = getLineIndexAt(lineStarts, problem.startChar)
        const endOffset = problem.endChar > problem.startChar ? problem.endChar - 1 : problem.startChar
        const endLine = getLineIndexAt(lineStarts, endOffset)
        const previous = merged[merged.length - 1]

        const canMerge = previous !== undefined && previousLine === startLine && startLine === endLine && previous.severity === problem.severity && previous.key === problem.key && sameProblemValues(previous.values, problem.values)

        if (canMerge) {
            previous.endChar = Math.max(previous.endChar, problem.endChar)
        } else {
            merged.push({ ...problem, values: [...problem.values] })
            previousLine = startLine === endLine ? startLine : -1
        }
    }

    return merged
}
