export interface SliceComparisonIssue {
    sliceIndex?: number
    measureNumber?: number
    kind: string
    detail: string
}

interface ParsedBarState {
    key: string
    meter: string
    clefs: Record<string, string>
}

interface ParsedNoteItem {
    pname: string
    oct: string
    accid: string
}

interface ParsedEvent {
    kind: string
    dur: string
    dots: string
    num: string
    note?: ParsedNoteItem
    chordNotes?: ParsedNoteItem[]
}

interface ParsedLayer {
    n: string
    events: ParsedEvent[]
    lyrics: string[]
}

interface ParsedStaff {
    n: string
    layers: ParsedLayer[]
}

interface ParsedMeasure {
    stateAtFirstNote: ParsedBarState
    barlines: { left: string; right: string; metcon: string }
    staves: ParsedStaff[]
}

interface ParsedMeiScore {
    initial: ParsedBarState
    measures: ParsedMeasure[]
}

function readAttrs(raw: string): Record<string, string> {
    const out: Record<string, string> = {}
    const pattern = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(raw)) !== null) {
        out[match[1]] = match[2] !== undefined ? match[2] : match[3] || ""
    }
    return out
}

function formatClef(attrs: Record<string, string>): string {
    const shape = attrs["clef.shape"] || attrs.shape || ""
    const line = attrs["clef.line"] || attrs.line || ""
    const dis = attrs["clef.dis"] || attrs.dis || ""
    const disPlace = attrs["clef.dis.place"] || attrs["dis.place"] || ""
    return `${shape}${line}${dis ? `d${dis}${disPlace}` : ""}`
}

function formatMeter(attrs: Record<string, string>): string {
    const count = attrs["meter.count"] || ""
    const unit = attrs["meter.unit"] || ""
    const sym = attrs["meter.sym"] || ""
    if (!count && !unit && !sym) return ""
    return `${count}/${unit}${sym}`
}

function parseNoteItem(attrs: Record<string, string>): ParsedNoteItem {
    return {
        pname: attrs.pname || "",
        oct: attrs.oct || "",
        accid: attrs.accid || attrs["accid.ges"] || "n"
    }
}

function parseLayerContent(layerXml: string): { leadingClef: string; events: ParsedEvent[]; lyrics: string[] } {
    let leadingClef = ""
    const events: ParsedEvent[] = []
    const lyrics: string[] = []

    const versePattern = /<verse\b([^>]*)>([\s\S]*?)<\/verse>/g
    let verseMatch: RegExpExecArray | null
    while ((verseMatch = versePattern.exec(layerXml)) !== null) {
        const verseAttrs = readAttrs(verseMatch[1])
        const verseN = verseAttrs.n || "1"
        const sylPattern = /<syl\b([^>]*)>([\s\S]*?)<\/syl>|<syl\b([^>]*)\/>/g
        let sylMatch: RegExpExecArray | null
        while ((sylMatch = sylPattern.exec(verseMatch[2])) !== null) {
            const sylAttrs = readAttrs(sylMatch[1] !== undefined ? sylMatch[1] : sylMatch[3] || "")
            const text = sylMatch[2] !== undefined ? sylMatch[2] : ""
            lyrics.push(`${verseN}:${text}{${sylAttrs.con || ""}}`)
        }
    }

    const tokenPattern = /<clef\b([^>]*)\/?>|<chord\b([^>]*)>([\s\S]*?)<\/chord>|<note\b([^>]*?)(?:\/>|>[\s\S]*?<\/note>)|<(rest|space|mRest|multiRest)\b([^>]*?)(?:\/>|>[\s\S]*?<\/\5>)/g
    let match: RegExpExecArray | null
    while ((match = tokenPattern.exec(layerXml)) !== null) {
        if (match[1] !== undefined) {
            if (!events.length) leadingClef = formatClef(readAttrs(match[1]))
            continue
        }
        if (match[2] !== undefined) {
            const chordAttrs = readAttrs(match[2])
            const chordNotes: ParsedNoteItem[] = []
            const childNotePattern = /<note\b([^>]*?)(?:\/>|>)/g
            let noteMatch: RegExpExecArray | null
            while ((noteMatch = childNotePattern.exec(match[3])) !== null) {
                chordNotes.push(parseNoteItem(readAttrs(noteMatch[1])))
            }
            events.push({
                kind: "chord",
                dur: chordAttrs.dur || "",
                dots: chordAttrs.dots || "",
                num: "",
                chordNotes
            })
            continue
        }
        if (match[4] !== undefined) {
            const noteAttrs = readAttrs(match[4])
            events.push({
                kind: "note",
                dur: noteAttrs.dur || "",
                dots: noteAttrs.dots || "",
                num: "",
                note: parseNoteItem(noteAttrs)
            })
            continue
        }
        if (match[5] !== undefined) {
            const restAttrs = readAttrs(match[6] || "")
            events.push({
                kind: match[5],
                dur: restAttrs.dur || "",
                dots: restAttrs.dots || "",
                num: restAttrs.num || ""
            })
        }
    }

    return { leadingClef, events, lyrics }
}

function parseMeiScore(mei: string): ParsedMeiScore {
    const sectionIndex = mei.indexOf("<section>")
    const headDef = sectionIndex >= 0 ? mei.slice(0, sectionIndex) : mei
    const scoreDefMatch = /<scoreDef\b([^>]*)>/.exec(headDef)
    const scoreAttrs = scoreDefMatch ? readAttrs(scoreDefMatch[1]) : {}

    const initial: ParsedBarState = {
        key: scoreAttrs.keysig || "0",
        meter: formatMeter(scoreAttrs),
        clefs: {}
    }

    const staffDefPattern = /<staffDef\b([^>]*)\/?>/g
    let staffDefMatch: RegExpExecArray | null
    while ((staffDefMatch = staffDefPattern.exec(headDef)) !== null) {
        const staffAttrs = readAttrs(staffDefMatch[1])
        if (staffAttrs.n) initial.clefs[staffAttrs.n] = formatClef(staffAttrs)
    }

    const body = sectionIndex >= 0 ? mei.slice(sectionIndex) : ""
    const measures: ParsedMeasure[] = []
    const current: ParsedBarState = {
        key: initial.key,
        meter: initial.meter,
        clefs: { ...initial.clefs }
    }

    const bodyPattern = /<scoreDef\b([^>]*)\/>|<measure\b([^>]*)>([\s\S]*?)<\/measure>/g
    let bodyMatch: RegExpExecArray | null
    while ((bodyMatch = bodyPattern.exec(body)) !== null) {
        if (bodyMatch[1] !== undefined) {
            const defAttrs = readAttrs(bodyMatch[1])
            if (defAttrs.keysig !== undefined) current.key = defAttrs.keysig
            const nextMeter = formatMeter(defAttrs)
            if (nextMeter) current.meter = nextMeter
            continue
        }

        const measureAttrs = readAttrs(bodyMatch[2])
        const measureBody = bodyMatch[3]
        const barClefs = { ...current.clefs }
        const staves: ParsedStaff[] = []

        const staffPattern = /<staff\b([^>]*)>([\s\S]*?)<\/staff>/g
        let staffMatch: RegExpExecArray | null
        while ((staffMatch = staffPattern.exec(measureBody)) !== null) {
            const staffN = readAttrs(staffMatch[1]).n || "1"
            const layers: ParsedLayer[] = []
            const layerPattern = /<layer\b([^>]*)>([\s\S]*?)<\/layer>/g
            let layerMatch: RegExpExecArray | null
            while ((layerMatch = layerPattern.exec(staffMatch[2])) !== null) {
                const layerN = readAttrs(layerMatch[1]).n || "1"
                const parsedLayer = parseLayerContent(layerMatch[2])
                if (parsedLayer.leadingClef) {
                    barClefs[staffN] = parsedLayer.leadingClef
                    current.clefs[staffN] = parsedLayer.leadingClef
                }
                layers.push({ n: layerN, events: parsedLayer.events, lyrics: parsedLayer.lyrics })
            }
            staves.push({ n: staffN, layers })
        }

        measures.push({
            stateAtFirstNote: {
                key: current.key,
                meter: current.meter,
                clefs: barClefs
            },
            barlines: {
                left: measureAttrs.left || "",
                right: measureAttrs.right || "",
                metcon: measureAttrs.metcon || ""
            },
            staves
        })
    }

    return { initial, measures }
}

export function compareMeiSlicesToWhole(wholeMei: string, sliceMeis: readonly string[]): SliceComparisonIssue[] {
    const whole = parseMeiScore(wholeMei)
    const issues: SliceComparisonIssue[] = []
    let offset = 0

    for (let sliceIndex = 0; sliceIndex < sliceMeis.length; sliceIndex++) {
        const sliceMei = sliceMeis[sliceIndex]
        if (!sliceMei) {
            issues.push({ sliceIndex, kind: "empty_slice", detail: "Slice MEI is empty" })
            continue
        }

        const slice = parseMeiScore(sliceMei)
        const sliceCount = slice.measures.length
        const wholeWindow = whole.measures.slice(offset, offset + sliceCount)
        if (wholeWindow.length !== sliceCount) {
            issues.push({ sliceIndex, kind: "measure_count", detail: `slice has ${sliceCount} measures, whole has ${whole.measures.length - offset} left` })
        }

        const compareLen = Math.min(sliceCount, wholeWindow.length)
        for (let barIndex = 0; barIndex < compareLen; barIndex++) {
            const wholeBar = wholeWindow[barIndex]
            const sliceBar = slice.measures[barIndex]
            const measureNumber = offset + barIndex + 1

            if (wholeBar.stateAtFirstNote.key !== sliceBar.stateAtFirstNote.key) {
                issues.push({ sliceIndex, measureNumber, kind: "key", detail: `whole=${wholeBar.stateAtFirstNote.key} slice=${sliceBar.stateAtFirstNote.key}` })
            }
            if (wholeBar.stateAtFirstNote.meter !== sliceBar.stateAtFirstNote.meter) {
                issues.push({ sliceIndex, measureNumber, kind: "meter", detail: `whole=${wholeBar.stateAtFirstNote.meter} slice=${sliceBar.stateAtFirstNote.meter}` })
            }
            if (JSON.stringify(wholeBar.stateAtFirstNote.clefs) !== JSON.stringify(sliceBar.stateAtFirstNote.clefs)) {
                issues.push({ sliceIndex, measureNumber, kind: "clef", detail: `whole=${JSON.stringify(wholeBar.stateAtFirstNote.clefs)} slice=${JSON.stringify(sliceBar.stateAtFirstNote.clefs)}` })
            }
            if (JSON.stringify(wholeBar.barlines) !== JSON.stringify(sliceBar.barlines)) {
                issues.push({ sliceIndex, measureNumber, kind: "barline", detail: `whole=${JSON.stringify(wholeBar.barlines)} slice=${JSON.stringify(sliceBar.barlines)}` })
            }
            if (wholeBar.staves.length !== sliceBar.staves.length) {
                issues.push({ sliceIndex, measureNumber, kind: "staves", detail: `whole=${wholeBar.staves.length} slice=${sliceBar.staves.length}` })
                continue
            }

            for (let staffIndex = 0; staffIndex < wholeBar.staves.length; staffIndex++) {
                const wholeStaff = wholeBar.staves[staffIndex]
                const sliceStaff = sliceBar.staves[staffIndex]
                if (wholeStaff.layers.length !== sliceStaff.layers.length) {
                    issues.push({ sliceIndex, measureNumber, kind: "layers", detail: `staff ${wholeStaff.n}: whole=${wholeStaff.layers.length} slice=${sliceStaff.layers.length}` })
                    continue
                }
                for (let layerIndex = 0; layerIndex < wholeStaff.layers.length; layerIndex++) {
                    const wholeLayer = wholeStaff.layers[layerIndex]
                    const sliceLayer = sliceStaff.layers[layerIndex]
                    if (JSON.stringify(wholeLayer.events) !== JSON.stringify(sliceLayer.events)) {
                        issues.push({
                            sliceIndex,
                            measureNumber,
                            kind: "notes",
                            detail: `staff ${wholeStaff.n} layer ${wholeLayer.n}: whole=${JSON.stringify(wholeLayer.events)} slice=${JSON.stringify(sliceLayer.events)}`
                        })
                    }
                    if (JSON.stringify(wholeLayer.lyrics) !== JSON.stringify(sliceLayer.lyrics)) {
                        issues.push({
                            sliceIndex,
                            measureNumber,
                            kind: "lyrics",
                            detail: `staff ${wholeStaff.n} layer ${wholeLayer.n}: whole=${JSON.stringify(wholeLayer.lyrics)} slice=${JSON.stringify(sliceLayer.lyrics)}`
                        })
                    }
                }
            }
        }

        offset += sliceCount
    }

    if (offset !== whole.measures.length) {
        issues.push({ kind: "total_measures", detail: `slices=${offset} whole=${whole.measures.length}` })
    }

    return issues
}
