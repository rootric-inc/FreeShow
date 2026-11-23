import type { KeySignature, Meter, NotePitch, Staff, TuneObject } from "abcjs"
import type { AbcPartInfo, AbcProblem, RawAbcElem } from "./abcChecks"
import { buildOffsetMapper, checkAbcTune, collectHeldLyrics, getAbcParts, getLineIndexAt, getLineStarts, getStaffLines, hasAbcNotes, makeAbcProblem, parseAbcTune, splitVoiceIntoMeasures, trimCharRange } from "./abcChecks"
import type { AbcParseOnly } from "./abcjs"

export interface AbcNoteRange {
    id: string
    startChar: number
    endChar: number
}

export interface AbcToMeiResult {
    mei: string
    title: string
    problems: AbcProblem[]
    parts: AbcPartInfo[]
    noteRanges?: AbcNoteRange[]
}

export interface AbcAnalysisResult extends AbcToMeiResult {
    hasError: boolean
}

interface RawNotePitch extends NotePitch {
    startTie?: unknown
    endTie?: unknown
    startSlur?: ({ label?: number } | number)[]
    endSlur?: ({ label?: number } | number)[]
}

interface MeiDuration {
    value: string
    dots: number
}

interface OpenSlur {
    startId: string
    measureIndex: number
}

interface RenderedNote {
    id: string
    attributes: string
}

const PITCH_NAMES = "cdefgab"
const ACCIDENTAL_CODES: Record<string, string> = { sharp: "s", flat: "f", natural: "n", dblsharp: "x", dblflat: "ff" }
const RIGHT_BAR_TYPES: Record<string, string> = { bar_thin_thin: "dbl", bar_thin_thick: "end", bar_right_repeat: "rptend", bar_dbl_repeat: "rptboth", bar_invisible: "invis" }
const CLEF_ATTRIBUTES: Record<string, string> = { bass: `F" clef.line="4`, alto: `C" clef.line="3`, tenor: `C" clef.line="4`, perc: `perc" clef.line="3` }
const IGNORED_ELEMENT_TYPES = new Set(["stem", "style", "tempo", "part", "scale", "midi", "transpose", "break"])
const MEI_DURATIONS = ["breve", "1", "2", "4", "8", "16", "32", "64", "128"]

function escapeXml(value: string): string {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function getMeiDuration(durationValue: number): MeiDuration | null {
    if (!Number.isFinite(durationValue) || durationValue <= 0) return null
    for (let dots = 0; dots <= 3; dots++) {
        const dotScale = 2 - 1 / 2 ** dots
        for (let index = 0; index < MEI_DURATIONS.length; index++) {
            if (Math.abs((2 / 2 ** index) * dotScale - durationValue) < 1e-6) {
                return { value: MEI_DURATIONS[index], dots }
            }
        }
    }
    return null
}

function splitRestDurations(durationValue: number): MeiDuration[] | null {
    const exact = getMeiDuration(durationValue)
    if (exact) return [exact]
    if (!Number.isFinite(durationValue) || durationValue <= 0) return null
    const segments: MeiDuration[] = []
    let remaining = durationValue
    for (let step = 0; step < 3 && remaining > 1e-6; step++) {
        const match = getMeiDuration(remaining)
        if (match) return [...segments, match]
        const baseIndex = MEI_DURATIONS.findIndex((_, index) => 2 / 2 ** index <= remaining + 1e-6)
        if (baseIndex < 0) return null
        segments.push({ value: MEI_DURATIONS[baseIndex], dots: 0 })
        remaining -= 2 / 2 ** baseIndex
    }
    return remaining < 1e-6 && segments.length ? segments : null
}

function formatDurationAttr(duration: MeiDuration): string {
    return `dur="${duration.value}"${duration.dots ? ` dots="${duration.dots}"` : ""}`
}

function formatKeySignature(key: KeySignature | undefined): string {
    const accidentals = (key && key.accidentals ? key.accidentals : []).filter((item) => item.acc === "flat" || item.acc === "sharp")
    return accidentals.length ? `${accidentals.length}${accidentals[0].acc === "flat" ? "f" : "s"}` : "0"
}

function getKeyAccidentalMap(key: KeySignature | undefined): Record<string, string> {
    const map: Record<string, string> = {}
    if (key && key.accidentals) {
        for (const item of key.accidentals) {
            map[item.note.toLowerCase()] = item.acc === "flat" ? "f" : item.acc === "sharp" ? "s" : "n"
        }
    }
    return map
}

function formatMeterAttrs(meter: Meter | undefined): string {
    if (!meter) return ""
    if (meter.type === "common_time") return ` meter.count="4" meter.unit="4" meter.sym="common"`
    if (meter.type === "cut_time") return ` meter.count="2" meter.unit="2" meter.sym="cut"`
    const first = meter.value && meter.value[0]
    if (first && first.num && first.den) return ` meter.count="${escapeXml(first.num)}" meter.unit="${escapeXml(first.den)}"`
    return ""
}

function formatClefAttrs(clefType = "treble"): string {
    const octaveMatch = /([+-])8$/.exec(clefType)
    const baseType = octaveMatch ? clefType.slice(0, -2) : clefType
    const shapeAndLine = CLEF_ATTRIBUTES[baseType] || `G" clef.line="2`
    const octaveAttrs = octaveMatch ? ` clef.dis="8" clef.dis.place="${octaveMatch[1] === "+" ? "above" : "below"}"` : ""
    const hiddenAttr = baseType === "none" ? ` clef.visible="false"` : ""
    return `clef.shape="${shapeAndLine}"${octaveAttrs}${hiddenAttr}`
}

function getSlurLabel(entry: { label?: number } | number): string | null {
    if (typeof entry === "number") return String(entry)
    return entry && typeof entry.label === "number" ? String(entry.label) : null
}

export function convertTuneToMei(tune: TuneObject | undefined, abc: string): AbcToMeiResult {
    const mapper = buildOffsetMapper(abc)
    const normalized = mapper.normalized
    const meta = tune && (tune as TuneObject & { metaText?: { title?: string } }).metaText
    const title = meta && meta.title ? meta.title.trim() : ""
    if (!tune || !hasAbcNotes(tune)) {
        return { mei: "", title, problems: [makeAbcProblem("no_notes", [], 0, Math.min(abc.length, 1), "error")], parts: [], noteRanges: [] }
    }

    const lines = getStaffLines(tune)
    const parts = getAbcParts(tune)
    const heldLyrics = collectHeldLyrics(tune, normalized)
    const lineStarts = getLineStarts(normalized)
    const problems: AbcProblem[] = []
    const droppedDecorationsByLine = new Map<number, { startChar: number; endChar: number }>()
    const firstStaves: Staff[] = lines[0].staff

    let currentKey = ""
    let keyAccidentals: Record<string, string> = {}
    const applyKey = (key: KeySignature | undefined) => {
        keyAccidentals = getKeyAccidentalMap(key)
        currentKey = formatKeySignature(key)
    }
    applyKey(firstStaves[0] && firstStaves[0].key)

    let currentMeter = firstStaves[0] && firstStaves[0].meter
    let currentMeterAttrs = formatMeterAttrs(currentMeter)
    const currentClefs = firstStaves.map((staff) => (staff.clef && staff.clef.type) || "treble")
    let pendingKey: KeySignature | undefined
    let pendingMeter: Meter | undefined
    const pendingClefs: (string | undefined)[] = firstStaves.map(() => undefined)

    const staffDefinitions = firstStaves.map((staff, staffIndex) => `<staffDef n="${staffIndex + 1}" lines="5" ${formatClefAttrs(staff.clef && staff.clef.type)}/>`).join("")
    const scoreOutput: string[] = [`<scoreDef keysig="${currentKey}"${currentMeterAttrs}><staffGrp${firstStaves.length > 1 ? ` symbol="brace"` : ""} bar.thru="false">${staffDefinitions}</staffGrp></scoreDef><section>`]

    const inWordByVerse: Record<string, boolean> = {}
    const openSlurs: Record<string, OpenSlur> = {}
    const measureControls: Record<number, string[]> = {}
    const tiedAccidentals: Record<string, Record<string, string>> = {}
    const carriedBarAccidentals: Record<string, Record<string, string>> = {}
    const usedIds = new Set<string>()
    const noteRanges: AbcNoteRange[] = []
    const measureBuffers: string[][] = []
    let measureNumberOffset = 0

    const allocateId = (startChar: number): string => {
        let id = `c${startChar}`
        for (let suffix = 2; usedIds.has(id); suffix++) id = `c${startChar}_${suffix}`
        usedIds.add(id)
        return id
    }

    const pushWarning = (kind: string, values: string[], element: RawAbcElem) => {
        const range = trimCharRange(normalized, element.startChar, element.endChar)
        problems.push(makeAbcProblem(kind, values, mapper.toOriginal(range.startChar), mapper.toOriginal(range.endChar)))
    }

    const warnChordOrAnnotation = (element: RawAbcElem) => {
        if (!element.chord || !element.chord.length) return
        let hasChord = false
        let hasAnnotation = false
        for (const item of element.chord) {
            if (item && item.position && item.position !== "default") hasAnnotation = true
            else hasChord = true
        }
        if (hasChord) pushWarning("chord_symbols", [], element)
        if (hasAnnotation) pushWarning("text_annotations", [], element)
    }

    const recordDroppedDecorations = (element: RawAbcElem) => {
        const decorations = element.decoration || []
        if (!decorations.some((name) => name !== "fermata" && name !== "invertedfermata")) return
        const range = trimCharRange(normalized, element.startChar, element.endChar)
        const lineIndex = getLineIndexAt(lineStarts, range.startChar)
        const existing = droppedDecorationsByLine.get(lineIndex)
        if (existing) {
            existing.startChar = Math.min(existing.startChar, range.startChar)
            existing.endChar = Math.max(existing.endChar, range.endChar)
        } else {
            droppedDecorationsByLine.set(lineIndex, { startChar: range.startChar, endChar: range.endChar })
        }
    }

    const closeSlur = (slurKey: string, endId: string) => {
        const opened = openSlurs[slurKey]
        if (!opened) return
        delete openSlurs[slurKey]
        ;(measureControls[opened.measureIndex] = measureControls[opened.measureIndex] || []).push(`<slur startid="#${opened.startId}" endid="#${endId}"/>`)
    }

    const renderLyricsXml = (element: RawAbcElem, staffIndex: number, voiceIndex: number): string => {
        const heldVerses = heldLyrics.get(element)
        return (element.lyric || [])
            .map((lyric, verseIndex) => {
                if (!lyric || (lyric.syllable === "" && lyric.divider === " ")) return ""
                const verseKey = `${staffIndex}.${voiceIndex}.${verseIndex}`
                const wasInWord = Boolean(inWordByVerse[verseKey])
                const isDash = lyric.divider === "-"
                const isHold = lyric.divider === "_" || Boolean(heldVerses && heldVerses.has(verseIndex))
                inWordByVerse[verseKey] = isDash
                const wordPos = wasInWord && isDash ? "m" : wasInWord ? "t" : isDash ? "i" : ""
                const connector = isDash ? "d" : isHold ? "u" : ""
                return `<verse n="${verseIndex + 1}"><syl${wordPos ? ` wordpos="${wordPos}"` : ""}${connector ? ` con="${connector}"` : ""}>${escapeXml(lyric.syllable)}</syl></verse>`
            })
            .join("")
    }

    const handleSlurs = (list: ({ label?: number } | number)[] | undefined, isStart: boolean, staffIndex: number, voiceIndex: number, noteId: string, measureIndex: number) => {
        for (const entry of list || []) {
            const label = getSlurLabel(entry)
            if (label === null) continue
            const slurKey = `${staffIndex}.${voiceIndex}.${label}`
            if (isStart) openSlurs[slurKey] = { startId: noteId, measureIndex }
            else closeSlur(slurKey, noteId)
        }
    }

    const applyScoreChange = (key: KeySignature | undefined, meter: Meter | undefined, target: string[], onlyIfChanged: boolean) => {
        if (key && (!onlyIfChanged || formatKeySignature(key) !== currentKey)) {
            applyKey(key)
            target.push(` keysig="${currentKey}"`)
        }
        if (meter && (!onlyIfChanged || formatMeterAttrs(meter) !== currentMeterAttrs)) {
            currentMeter = meter
            currentMeterAttrs = formatMeterAttrs(currentMeter)
            target.push(currentMeterAttrs)
        }
    }

    lines.forEach((line, lineIndex) => {
        const lineScoreChanges: string[] = []
        if (lineIndex > 0 && line.staff[0]) applyScoreChange(line.staff[0].key, line.staff[0].meter, lineScoreChanges, true)

        const parsedVoices = line.staff.map((staff, staffIndex) =>
            (staff.voices || []).map((voice, voiceIndex) =>
                splitVoiceIntoMeasures(
                    voice,
                    normalized,
                    staffIndex === 0 && voiceIndex === 0,
                    (element) => {
                        if (element.startEnding) pushWarning("repeat_ending", [], element)
                        if (element.gracenotes && element.gracenotes.length) pushWarning("grace_notes", [], element)
                        warnChordOrAnnotation(element)
                        recordDroppedDecorations(element)
                    },
                    (element) => {
                        if (!IGNORED_ELEMENT_TYPES.has(element.el_type)) pushWarning("unsupported_element", [String(element.el_type || "unknown")], element)
                    },
                    voiceIndex === 0
                )
            )
        )
        const measureCount = Math.max(0, ...parsedVoices.flat().map((measures) => measures.length))
        if (!measureCount) return

        for (let measureOffset = 0; measureOffset < measureCount; measureOffset++) {
            const measureXml: string[] = []
            const topMeasure = parsedVoices[0] && parsedVoices[0][0] && parsedVoices[0][0][measureOffset]
            const scoreDefAttrs = measureOffset === 0 ? [...lineScoreChanges] : []
            if (pendingKey || pendingMeter) {
                applyScoreChange(pendingKey, pendingMeter, scoreDefAttrs, false)
                pendingKey = undefined
                pendingMeter = undefined
            }
            if (topMeasure && topMeasure.change) applyScoreChange(topMeasure.change.key, topMeasure.change.meter, scoreDefAttrs, false)
            if (scoreDefAttrs.length) measureXml.push(`<scoreDef${scoreDefAttrs.join("")}/>`)

            const measureKeyAccidentals = { ...keyAccidentals }
            const rightBar = topMeasure && topMeasure.barType ? RIGHT_BAR_TYPES[topMeasure.barType] || "" : "invis"
            const leftBar = topMeasure && topMeasure.leftBarType === "bar_left_repeat" ? "rptstart" : topMeasure && topMeasure.leftBarType === "bar_thick_thin" ? "dbl" : ""
            measureXml.push(`<measure n="${measureNumberOffset + measureOffset + 1}"${leftBar ? ` left="${leftBar}"` : ""}${rightBar ? ` right="${rightBar}"` : ""}${currentMeter ? "" : ` metcon="false"`}>`)

            const bufferIndex = measureBuffers.length
            parsedVoices.forEach((staffVoices, staffIndex) => {
                measureXml.push(`<staff n="${staffIndex + 1}">`)
                const lineClef = measureOffset === 0 && lineIndex > 0 && line.staff[staffIndex] && line.staff[staffIndex].clef ? line.staff[staffIndex].clef.type : undefined
                const firstVoiceMeasure = staffVoices[0] && staffVoices[0][measureOffset]
                const newClef = (firstVoiceMeasure && firstVoiceMeasure.change && firstVoiceMeasure.change.clef && firstVoiceMeasure.change.clef.type) || pendingClefs[staffIndex] || (lineClef && lineClef !== currentClefs[staffIndex] ? lineClef : undefined)
                pendingClefs[staffIndex] = undefined

                staffVoices.forEach((measures, voiceIndex) => {
                    const voiceKey = `${staffIndex}.${voiceIndex}`
                    const barAccidentals: Record<string, string> = carriedBarAccidentals[voiceKey] ? { ...carriedBarAccidentals[voiceKey] } : {}
                    let voiceKeyAccidentals: Record<string, string> = { ...measureKeyAccidentals }
                    const previousTied = tiedAccidentals[voiceKey] || {}
                    const nextTied: Record<string, string> = {}
                    const stemAttr = staffVoices.length >= 2 ? ` stem.dir="${voiceIndex ? "down" : "up"}"` : ""
                    measureXml.push(`<layer n="${voiceIndex + 1}">`)
                    if (voiceIndex === 0 && newClef) {
                        currentClefs[staffIndex] = newClef
                        measureXml.push(`<clef ${formatClefAttrs(newClef)}/>`)
                    }

                    const openTags: string[] = []
                    const closeTag = (tagName: string) => {
                        const tagIndex = openTags.lastIndexOf(tagName)
                        if (tagIndex === -1) return
                        const tagsToReopen: string[] = []
                        while (openTags.length - 1 > tagIndex) {
                            const popped = openTags.pop()!
                            measureXml.push(`</${popped}>`)
                            tagsToReopen.push(popped)
                        }
                        openTags.pop()
                        measureXml.push(`</${tagName}>`)
                        while (tagsToReopen.length) {
                            if (tagsToReopen.pop() === "beam") {
                                measureXml.push("<beam>")
                                openTags.push("beam")
                            }
                        }
                    }

                    const currentMeasure = measures[measureOffset]
                    for (const element of currentMeasure ? currentMeasure.events : []) {
                        if (element.el_type === "key") {
                            voiceKeyAccidentals = getKeyAccidentalMap(element as unknown as KeySignature)
                            for (const pitchKey of Object.keys(barAccidentals)) delete barAccidentals[pitchKey]
                            if (staffIndex === 0 && voiceIndex === 0) pendingKey = element as unknown as KeySignature
                            else if (!pendingKey) pendingKey = element as unknown as KeySignature
                            pushWarning("midbar_change", [], element)
                            continue
                        }
                        if (element.el_type === "meter") {
                            if (staffIndex === 0 && voiceIndex === 0) pendingMeter = element as unknown as Meter
                            else if (!pendingMeter) pendingMeter = element as unknown as Meter
                            pushWarning("midbar_change", [], element)
                            continue
                        }
                        if (element.el_type === "clef") {
                            if (voiceIndex === 0 && element.type) pendingClefs[staffIndex] = element.type
                            pushWarning("midbar_change", [], element)
                            continue
                        }

                        if (element.gracenotes && element.gracenotes.length) pushWarning("grace_notes", [], element)
                        warnChordOrAnnotation(element)
                        recordDroppedDecorations(element)

                        const trimmedRange = trimCharRange(normalized, element.startChar, element.endChar)
                        const originalStart = mapper.toOriginal(trimmedRange.startChar)
                        const elementId = allocateId(originalStart)
                        if (element.startChar !== undefined && elementId === `c${originalStart}`) {
                            noteRanges.push({ id: elementId, startChar: originalStart, endChar: mapper.toOriginal(trimmedRange.endChar) })
                        }

                        const rawDuration = Array.isArray(element.duration) ? element.duration[0] : element.duration
                        const isMeasureRest = Boolean(element.rest && (element.rest.type === "whole" || element.rest.type === "multimeasure"))
                        const duration = typeof rawDuration === "number" ? getMeiDuration(rawDuration) : null
                        const restDurations = element.rest && !isMeasureRest && typeof rawDuration === "number" ? splitRestDurations(rawDuration) : null
                        if (!isMeasureRest && !duration && !restDurations) {
                            pushWarning("unsupported_duration", [], element)
                            continue
                        }

                        if (element.startTriplet && !openTags.includes("tuplet")) {
                            const numbase = Math.max(1, Math.round(element.startTriplet * (element.tripletMultiplier || 2 / 3)))
                            measureXml.push(`<tuplet num="${element.startTriplet}" numbase="${numbase}">`)
                            openTags.push("tuplet")
                        }
                        if (element.startBeam && !element.endBeam && !openTags.includes("beam")) {
                            measureXml.push("<beam>")
                            openTags.push("beam")
                        }

                        const decorations = element.decoration || []
                        const fermataAttr = decorations.includes("invertedfermata") ? ` fermata="below"` : decorations.includes("fermata") ? ` fermata="${voiceIndex === 1 ? "below" : "above"}"` : ""

                        if (element.rest) {
                            if (element.rest.type === "multimeasure") {
                                const restBars = Number(element.rest.text)
                                if (Number.isFinite(restBars) && restBars > 1) measureXml.push(`<multiRest xml:id="${elementId}" num="${Math.round(restBars)}"/>`)
                                else measureXml.push(`<mRest xml:id="${elementId}"${fermataAttr}/>`)
                            } else if (element.rest.type === "whole") {
                                measureXml.push(`<mRest xml:id="${elementId}"${fermataAttr}/>`)
                            } else {
                                const restTag = element.rest.type === "invisible" || element.rest.type === "spacer" ? "space" : "rest"
                                ;(restDurations || [duration!]).forEach((segment, segmentIndex) => {
                                    const segmentId = segmentIndex ? `${elementId}_p${segmentIndex + 1}` : elementId
                                    const segmentFermata = restTag === "rest" && !segmentIndex ? fermataAttr : ""
                                    measureXml.push(`<${restTag} xml:id="${segmentId}" ${formatDurationAttr(segment)}${segmentFermata}/>`)
                                })
                            }
                        } else {
                            const pitches = (element.pitches || []) as RawNotePitch[]
                            if (!pitches.length) continue
                            const renderedNotes: RenderedNote[] = pitches.map((pitch, pitchIndex) => {
                                // abcjs already shifts pitch.pitch by any voice octave= setting
                                const step = ((pitch.pitch % 7) + 7) % 7
                                const octave = 4 + Math.floor(pitch.pitch / 7)
                                const noteId = pitches.length > 1 ? `${elementId}-${pitchIndex}` : elementId
                                const pitchKey = `${step}.${octave}`
                                const tieAttr = pitch.startTie && pitch.endTie ? ` tie="m"` : pitch.startTie ? ` tie="i"` : pitch.endTie ? ` tie="t"` : ""
                                const writtenAccidental = pitch.accidental && ACCIDENTAL_CODES[pitch.accidental]
                                if (writtenAccidental) barAccidentals[pitchKey] = writtenAccidental
                                const soundingAccidental = writtenAccidental || barAccidentals[pitchKey] || (pitch.endTie && previousTied[pitchKey]) || voiceKeyAccidentals[PITCH_NAMES[step]] || "n"
                                if (pitch.startTie) nextTied[pitchKey] = soundingAccidental
                                else delete nextTied[pitchKey]
                                const accidentalAttr = (writtenAccidental ? ` accid="${writtenAccidental}"` : "") + (!writtenAccidental && soundingAccidental !== "n" ? ` accid.ges="${soundingAccidental}"` : "")
                                handleSlurs(pitch.startSlur, true, staffIndex, voiceIndex, noteId, bufferIndex)
                                handleSlurs(pitch.endSlur, false, staffIndex, voiceIndex, noteId, bufferIndex)
                                return { id: noteId, attributes: `pname="${PITCH_NAMES[step]}" oct="${octave}"${accidentalAttr}${tieAttr}` }
                            })

                            handleSlurs(element.startSlur, true, staffIndex, voiceIndex, renderedNotes[0].id, bufferIndex)
                            const versesXml = renderLyricsXml(element, staffIndex, voiceIndex)
                            if (renderedNotes.length === 1) {
                                measureXml.push(`<note xml:id="${renderedNotes[0].id}" ${formatDurationAttr(duration!)} ${renderedNotes[0].attributes}${stemAttr}${fermataAttr}>${versesXml}</note>`)
                            } else {
                                const chordNotesXml = renderedNotes.map((note, noteIndex) => `<note xml:id="${note.id}" ${note.attributes}>${noteIndex === renderedNotes.length - 1 ? versesXml : ""}</note>`).join("")
                                measureXml.push(`<chord xml:id="${elementId}" ${formatDurationAttr(duration!)}${stemAttr}${fermataAttr}>${chordNotesXml}</chord>`)
                            }
                            handleSlurs(element.endSlur, false, staffIndex, voiceIndex, renderedNotes[renderedNotes.length - 1].id, bufferIndex)
                        }

                        if (element.endBeam && !element.startBeam) closeTag("beam")
                        if (element.endTriplet) closeTag("tuplet")
                    }

                    while (openTags.length) measureXml.push(`</${openTags.pop()!}>`)
                    tiedAccidentals[voiceKey] = nextTied
                    carriedBarAccidentals[voiceKey] = currentMeasure && !currentMeasure.barType ? barAccidentals : {}
                    measureXml.push("</layer>")
                })
                measureXml.push("</staff>")
            })
            measureXml.push("</measure>")
            measureBuffers.push(measureXml)
        }
        measureNumberOffset += measureCount
    })

    for (const [, range] of Array.from(droppedDecorationsByLine.entries()).sort((a, b) => a[0] - b[0])) {
        problems.push(makeAbcProblem("decorations", [], mapper.toOriginal(range.startChar), mapper.toOriginal(range.endChar)))
    }

    scoreOutput.push(measureBuffers.map((xmlParts, index) => xmlParts.join("").replace("</measure>", `${(measureControls[index] || []).join("")}</measure>`)).join(""), "</section>")
    return {
        mei: `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><meiHead><fileDesc><titleStmt><title>${escapeXml(title)}</title></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score>${scoreOutput.join("")}</score></mdiv></body></music></mei>`,
        title,
        problems,
        parts,
        noteRanges: noteRanges.sort((a, b) => a.startChar - b.startChar)
    }
}

export function abcToMei(abc: string, parseOnly: AbcParseOnly): AbcToMeiResult {
    return convertTuneToMei(parseAbcTune(abc, parseOnly), abc)
}

export function convertAndCheckAbc(abc: string, parseOnly: AbcParseOnly): AbcAnalysisResult {
    const tune = parseAbcTune(abc, parseOnly)
    const converted = convertTuneToMei(tune, abc)
    const problems = checkAbcTune(tune, abc, converted.problems)
    return {
        ...converted,
        problems,
        hasError: !converted.mei || problems.some((problem) => problem.severity === "error")
    }
}
