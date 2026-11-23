export interface MeiStaffSummary {
    n: string
    layers: string[]
    hasChords: boolean
}

export interface MeiSummary {
    staves: MeiStaffSummary[]
    verses: number[]
    measures: number
    hasTwoLayersPerStaffInEveryBar: boolean
}

export interface FilterMeiOptions {
    parts: "all" | string[]
    verses: "all" | "none" | number[]
    highestNoteOnly?: boolean
}

type XmlToken = { kind: "open" | "self"; name: string; attrsRaw: string; raw: string } | { kind: "close"; name: string; raw: string } | { kind: "other"; raw: string }

interface ParsedAttr {
    name: string
    value: string
}

interface SubtreeResult {
    html: string
    nextIndex: number
    slice: XmlToken[]
}

interface RescuedClef {
    html: string
    ids: string[]
}

interface VerseFilterContext {
    filteringVerses: boolean
    keptVerses: Set<number> | null
    verseRenumberMap: Map<number, number>
    measuresWithChosenVerse: Set<number>
    lastChosenVerseMeasureIndex: number
    lastChosenVerseEndTokenByLayer: Map<string, number>
}

interface VerseNotePosition {
    measureIndex: number
    layerKey: string
    tokenIndex: number
}

interface AccidentalContext {
    removedWritten: Map<string, Map<string, string>>
    readerAccidental: Map<string, string>
}

interface ChordNoteEntry {
    attrsRaw: string
    rawVerses: SubtreeResult[]
    otherSubtrees: SubtreeResult[]
    otherRaw: string[]
    removedIds: string[]
}

const PITCH_ORDER = "cdefgab"
const CHORD_INHERITED_ATTRS = ["dur", "dur.ppq", "dots", "fermata", "stem.dir", "artic", "tie", "beam", "tuplet"] as const
const LAYER_CONTAINER_TAGS = new Set(["beam", "tuplet", "bTrem", "fTrem", "ligature", "graceGrp", "beamSpan"])
const ATTR_PATTERN = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

function scanXml(xml: string): XmlToken[] {
    const tokens: XmlToken[] = []
    const length = xml.length
    let pos = 0

    while (pos < length) {
        if (xml[pos] !== "<") {
            const nextLt = xml.indexOf("<", pos)
            const textEnd = nextLt === -1 ? length : nextLt
            tokens.push({ kind: "other", raw: xml.slice(pos, textEnd) })
            pos = textEnd
            continue
        }

        if (xml.startsWith("<!--", pos)) {
            const endComment = xml.indexOf("-->", pos + 4)
            const commentEnd = endComment === -1 ? length : endComment + 3
            tokens.push({ kind: "other", raw: xml.slice(pos, commentEnd) })
            pos = commentEnd
            continue
        }

        if (xml.startsWith("<?", pos)) {
            const endPi = xml.indexOf("?>", pos + 2)
            const piEnd = endPi === -1 ? length : endPi + 2
            tokens.push({ kind: "other", raw: xml.slice(pos, piEnd) })
            pos = piEnd
            continue
        }

        if (xml.startsWith("<!", pos)) {
            const endDecl = xml.indexOf(">", pos + 2)
            const declEnd = endDecl === -1 ? length : endDecl + 1
            tokens.push({ kind: "other", raw: xml.slice(pos, declEnd) })
            pos = declEnd
            continue
        }

        let cursor = pos + 1
        let quote = ""
        while (cursor < length) {
            const ch = xml[cursor]
            if (quote) {
                if (ch === quote) quote = ""
            } else if (ch === '"' || ch === "'") {
                quote = ch
            } else if (ch === ">") {
                break
            }
            cursor++
        }

        const end = cursor < length ? cursor + 1 : length
        const raw = xml.slice(pos, end)
        pos = end

        if (raw.startsWith("</")) {
            const name = raw.slice(2, -1).trim()
            tokens.push({ kind: "close", name, raw })
            continue
        }

        const selfClosing = raw.endsWith("/>")
        const inner = raw.slice(1, selfClosing ? -2 : -1)
        const spaceIndex = inner.search(/\s/)
        if (spaceIndex === -1) {
            tokens.push({ kind: selfClosing ? "self" : "open", name: inner, attrsRaw: "", raw })
        } else {
            tokens.push({
                kind: selfClosing ? "self" : "open",
                name: inner.slice(0, spaceIndex),
                attrsRaw: inner.slice(spaceIndex),
                raw
            })
        }
    }

    return tokens
}

function parseAttributes(attrsRaw: string): ParsedAttr[] {
    const attrs: ParsedAttr[] = []
    if (!attrsRaw) return attrs

    ATTR_PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = ATTR_PATTERN.exec(attrsRaw)) !== null) {
        attrs.push({ name: match[1], value: match[2] !== undefined ? match[2] : match[3] || "" })
    }
    return attrs
}

function getAttr(attrsRaw: string, name: string): string | null {
    if (!attrsRaw || !attrsRaw.includes(name)) return null
    for (const attr of parseAttributes(attrsRaw)) {
        if (attr.name === name) return attr.value
    }
    return null
}

function escapeAttrRegex(name: string): string {
    return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function removeAttr(attrsRaw: string, name: string): string {
    if (!attrsRaw || !attrsRaw.includes(name)) return attrsRaw
    const pattern = new RegExp(`\\s+${escapeAttrRegex(name)}\\s*=\\s*(?:"[^"]*"|'[^']*')`, "g")
    return attrsRaw.replace(pattern, "")
}

function setAttr(attrsRaw: string, name: string, value: string): string {
    const pattern = new RegExp(`(\\s+${escapeAttrRegex(name)}\\s*=\\s*)(?:"[^"]*"|'[^']*')`)
    if (pattern.test(attrsRaw)) {
        return attrsRaw.replace(pattern, `$1"${value}"`)
    }
    return `${attrsRaw.replace(/\s+$/, "")} ${name}="${value}"`
}

function formatTag(kind: "open" | "self", name: string, attrsRaw: string): string {
    const trimmedTrailing = attrsRaw.replace(/\s+$/, "")
    return kind === "self" ? `<${name}${trimmedTrailing} />` : `<${name}${trimmedTrailing}>`
}

function sortNumericStrings(values: string[]): string[] {
    return values.sort((a, b) => {
        const numA = Number(a)
        const numB = Number(b)
        if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) return numA - numB
        return a.localeCompare(b)
    })
}

function parseVerseNumber(raw: string | null): number | null {
    if (raw === null) return 1
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const parsed = Number(trimmed)
    return parsed > 0 ? parsed : null
}

function getNoteRank(attrsRaw: string): number {
    const octRaw = getAttr(attrsRaw, "oct")
    const pnameRaw = getAttr(attrsRaw, "pname")
    const oct = octRaw !== null ? Number(octRaw) : Number.NaN
    const pitchIndex = pnameRaw ? PITCH_ORDER.indexOf(pnameRaw.toLowerCase()) : -1
    if (!Number.isFinite(oct) || pitchIndex < 0) return -Infinity
    return oct * 7 + pitchIndex
}

export function getMeasureNumbers(mei: string): number[] {
    if (!mei || typeof mei !== "string") return []

    const tokens = scanXml(mei)
    const rawNumbers: (string | null)[] = []
    for (const token of tokens) {
        if ((token.kind === "open" || token.kind === "self") && token.name === "measure") {
            rawNumbers.push(getAttr(token.attrsRaw, "n"))
        }
    }

    if (!rawNumbers.length) return []

    const numericValues: (number | null)[] = rawNumbers.map((raw) => {
        if (raw === null) return null
        const trimmed = raw.trim()
        if (!/^\d+$/.test(trimmed)) return null
        return Number(trimmed)
    })

    const firstNumeric = numericValues.find((value): value is number => value !== null)
    if (firstNumeric === undefined) return rawNumbers.map((_, idx) => idx + 1)

    const parsed: number[] = []
    for (const value of numericValues) {
        if (value !== null) {
            if (parsed.length > 0 && value < parsed[parsed.length - 1]) {
                return rawNumbers.map((_, idx) => idx + 1)
            }
            parsed.push(value)
        } else if (parsed.length > 0) {
            parsed.push(parsed[parsed.length - 1])
        } else {
            parsed.push(firstNumeric)
        }
    }

    return parsed
}

export function summarizeMei(mei: string): MeiSummary {
    if (!mei || typeof mei !== "string") return { staves: [], verses: [], measures: 0, hasTwoLayersPerStaffInEveryBar: false }

    const tokens = scanXml(mei)
    const staffLayers = new Map<string, Set<string>>()
    const staffHasChords = new Set<string>()
    const verses = new Set<number>()
    const measureStaffLayers: Map<string, Set<string>>[] = []
    let currentMeasureLayers: Map<string, Set<string>> | null = null
    let measures = 0

    const staffStack: string[] = []
    const ensureStaff = (staffN: string) => {
        if (!staffLayers.has(staffN)) staffLayers.set(staffN, new Set())
    }

    for (const token of tokens) {
        if (token.kind === "other") continue

        if (token.kind === "close") {
            if (token.name === "staff" && staffStack.length > 0) staffStack.pop()
            else if (token.name === "measure") currentMeasureLayers = null
            continue
        }

        if (token.name === "staffDef") {
            const staffN = getAttr(token.attrsRaw, "n")
            if (staffN) ensureStaff(staffN)
        } else if (token.name === "measure") {
            measures++
            const measureMap = new Map<string, Set<string>>()
            measureStaffLayers.push(measureMap)
            if (token.kind === "open") currentMeasureLayers = measureMap
        } else if (token.name === "staff") {
            const staffN = getAttr(token.attrsRaw, "n")
            if (staffN) {
                ensureStaff(staffN)
                if (token.kind === "open") staffStack.push(staffN)
            }
        } else if (token.name === "layer") {
            const currentStaff = staffStack[staffStack.length - 1]
            if (currentStaff) {
                const layerN = getAttr(token.attrsRaw, "n") || "1"
                staffLayers.get(currentStaff)!.add(layerN)
                if (currentMeasureLayers) {
                    if (!currentMeasureLayers.has(currentStaff)) currentMeasureLayers.set(currentStaff, new Set())
                    currentMeasureLayers.get(currentStaff)!.add(layerN)
                }
            }
        } else if (token.name === "chord") {
            const currentStaff = staffStack[staffStack.length - 1]
            if (currentStaff) staffHasChords.add(currentStaff)
        } else if (token.name === "verse") {
            const verseNumber = parseVerseNumber(getAttr(token.attrsRaw, "n"))
            if (verseNumber !== null) verses.add(verseNumber)
        }
    }

    const staves: MeiStaffSummary[] = []
    for (const [n, layers] of staffLayers) {
        staves.push({ n, layers: sortNumericStrings(Array.from(layers)), hasChords: staffHasChords.has(n) })
    }

    const hasTwoLayersPerStaffInEveryBar = staves.length === 2 && staves[0].layers.length === 2 && staves[1].layers.length === 2 && measures > 0 && measureStaffLayers.length === measures && measureStaffLayers.every((measureMap) => (measureMap.get(staves[0].n)?.size ?? 0) === 2 && (measureMap.get(staves[1].n)?.size ?? 0) === 2)

    return {
        staves,
        verses: Array.from(verses).sort((a, b) => a - b),
        measures,
        hasTwoLayersPerStaffInEveryBar
    }
}

function collectElementIds(tokens: XmlToken[], target: Set<string>): void {
    for (const token of tokens) {
        if (token.kind === "open" || token.kind === "self") {
            const xmlId = getAttr(token.attrsRaw, "xml:id")
            if (xmlId) target.add(xmlId)
        }
    }
}

function extractElementIds(tokens: XmlToken[]): string[] {
    const ids: string[] = []
    for (const token of tokens) {
        if (token.kind === "open" || token.kind === "self") {
            const xmlId = getAttr(token.attrsRaw, "xml:id")
            if (xmlId) ids.push(xmlId)
        }
    }
    return ids
}

function serializeSubtree(tokens: XmlToken[], startIndex: number): SubtreeResult {
    const first = tokens[startIndex]
    if (first.kind === "self") {
        return { html: first.raw, nextIndex: startIndex + 1, slice: [first] }
    }

    const slice: XmlToken[] = [first]
    let depth = 1
    let index = startIndex + 1
    while (index < tokens.length && depth > 0) {
        const token = tokens[index]
        slice.push(token)
        if (token.kind === "open") depth++
        else if (token.kind === "close") depth--
        index++
    }

    return {
        html: slice.map((token) => token.raw).join(""),
        nextIndex: index,
        slice
    }
}

function renumberVerseSubtree(slice: XmlToken[], newNumber: number): string {
    const first = slice[0]
    if (!first || (first.kind !== "open" && first.kind !== "self")) {
        return slice.map((token) => token.raw).join("")
    }

    const updatedAttrs = setAttr(first.attrsRaw, "n", String(newNumber))
    const head = formatTag(first.kind, first.name, updatedAttrs)
    if (slice.length === 1) return head
    return (
        head +
        slice
            .slice(1)
            .map((token) => token.raw)
            .join("")
    )
}

function filterVerseSubtrees(verseSubtrees: SubtreeResult[], verseCtx: VerseFilterContext, notePosition: VerseNotePosition, removedIds: Set<string>): string[] {
    if (!verseSubtrees.length) return []
    if (!verseCtx.filteringVerses || verseCtx.keptVerses === null) {
        return verseSubtrees.map((subtree) => subtree.html)
    }
    if (verseCtx.keptVerses.size === 0) {
        for (const subtree of verseSubtrees) collectElementIds(subtree.slice, removedIds)
        return []
    }
    if (verseSubtrees.length === 1) {
        const onlySubtree = verseSubtrees[0]
        const first = onlySubtree.slice[0]
        const rawN = first && (first.kind === "open" || first.kind === "self") ? getAttr(first.attrsRaw, "n") : null
        const verseNumber = parseVerseNumber(rawN)
        if (verseNumber === null) {
            return [renumberVerseSubtree(onlySubtree.slice, 1)]
        }
        if (verseCtx.keptVerses.has(verseNumber)) {
            const mapped = verseCtx.verseRenumberMap.get(verseNumber) ?? 1
            return [renumberVerseSubtree(onlySubtree.slice, mapped)]
        }

        const barHasChosenVerse = verseCtx.measuresWithChosenVerse.has(notePosition.measureIndex)
        const lastChosenEndInLayer = verseCtx.lastChosenVerseEndTokenByLayer.get(notePosition.layerKey) ?? -1
        const afterLastChosenVerse = notePosition.measureIndex > verseCtx.lastChosenVerseMeasureIndex || (notePosition.measureIndex === verseCtx.lastChosenVerseMeasureIndex && lastChosenEndInLayer !== -1 && notePosition.tokenIndex > lastChosenEndInLayer)
        if (!barHasChosenVerse || afterLastChosenVerse) {
            return [renumberVerseSubtree(onlySubtree.slice, 1)]
        }

        collectElementIds(onlySubtree.slice, removedIds)
        return []
    }

    const kept: string[] = []
    for (const subtree of verseSubtrees) {
        const first = subtree.slice[0]
        const rawN = first && (first.kind === "open" || first.kind === "self") ? getAttr(first.attrsRaw, "n") : null
        const verseNumber = parseVerseNumber(rawN)
        if (verseNumber === null) {
            kept.push(renumberVerseSubtree(subtree.slice, 1))
        } else if (verseCtx.keptVerses.has(verseNumber)) {
            const mapped = verseCtx.verseRenumberMap.get(verseNumber) ?? 1
            kept.push(renumberVerseSubtree(subtree.slice, mapped))
        } else {
            collectElementIds(subtree.slice, removedIds)
        }
    }
    return kept
}

function getPitchKey(attrsRaw: string): string | null {
    const pname = getAttr(attrsRaw, "pname")
    const oct = getAttr(attrsRaw, "oct")
    if (!pname || !oct) return null
    return `${pname.toLowerCase()}:${oct}`
}

function normalizeAccidentalKind(raw: string): string {
    const trimmed = raw.trim().toLowerCase()
    if (trimmed === "x") return "ss"
    return trimmed
}

function recordRemovedWrittenAccidental(target: Map<string, Map<string, string>>, pitchKey: string, written: string): void {
    const kind = normalizeAccidentalKind(written)
    if (!kind) return
    let byKind = target.get(pitchKey)
    if (!byKind) {
        byKind = new Map()
        target.set(pitchKey, byKind)
    }
    if (!byKind.has(kind)) byKind.set(kind, written)
}

function getChildWrittenAccidental(childSubtrees: SubtreeResult[]): string | null {
    for (const subtree of childSubtrees) {
        const first = subtree.slice[0]
        if (!first || (first.kind !== "open" && first.kind !== "self") || first.name !== "accid") continue
        const accidAttr = getAttr(first.attrsRaw, "accid")
        if (accidAttr) return accidAttr
    }
    return null
}

function applyAccidentalPromotion(noteAttrsRaw: string, childSubtrees: SubtreeResult[], accidentalCtx: AccidentalContext | null): { attrsRaw: string; childHtmls: string[] } {
    const childHtmls = childSubtrees.map((subtree) => subtree.html)
    if (!accidentalCtx) return { attrsRaw: noteAttrsRaw, childHtmls }

    const pitchKey = getPitchKey(noteAttrsRaw)
    if (!pitchKey) return { attrsRaw: noteAttrsRaw, childHtmls }

    const attrWritten = getAttr(noteAttrsRaw, "accid")
    let childWritten: string | null = null
    let childGesIndex = -1
    let childGesValue: string | null = null

    for (let i = 0; i < childSubtrees.length; i++) {
        const first = childSubtrees[i].slice[0]
        if (!first || (first.kind !== "open" && first.kind !== "self") || first.name !== "accid") continue
        const accidAttr = getAttr(first.attrsRaw, "accid")
        if (accidAttr) {
            childWritten = accidAttr
            break
        }
        const gesAttr = getAttr(first.attrsRaw, "accid.ges")
        if (gesAttr && childGesIndex === -1) {
            childGesIndex = i
            childGesValue = gesAttr
        }
    }

    const written = attrWritten || childWritten
    if (written) {
        const writtenKind = normalizeAccidentalKind(written)
        if (writtenKind) accidentalCtx.readerAccidental.set(pitchKey, writtenKind)
        return { attrsRaw: noteAttrsRaw, childHtmls }
    }

    const attrGes = getAttr(noteAttrsRaw, "accid.ges")
    const gesValue = attrGes || childGesValue
    if (!gesValue) return { attrsRaw: noteAttrsRaw, childHtmls }

    const gesKind = normalizeAccidentalKind(gesValue)
    if (!gesKind || accidentalCtx.readerAccidental.get(pitchKey) === gesKind) {
        return { attrsRaw: noteAttrsRaw, childHtmls }
    }

    const promotedSpelling = accidentalCtx.removedWritten.get(pitchKey)?.get(gesKind)
    if (!promotedSpelling) return { attrsRaw: noteAttrsRaw, childHtmls }

    accidentalCtx.readerAccidental.set(pitchKey, gesKind)
    if (childGesIndex !== -1 && !attrGes) {
        const targetSubtree = childSubtrees[childGesIndex]
        const first = targetSubtree.slice[0]
        if (first && (first.kind === "open" || first.kind === "self")) {
            const updatedTag = formatTag(first.kind, first.name, setAttr(first.attrsRaw, "accid", promotedSpelling))
            childHtmls[childGesIndex] =
                updatedTag +
                targetSubtree.slice
                    .slice(1)
                    .map((token) => token.raw)
                    .join("")
        }
        return { attrsRaw: noteAttrsRaw, childHtmls }
    }

    return { attrsRaw: setAttr(noteAttrsRaw, "accid", promotedSpelling), childHtmls }
}

function collectRemovedLayerAccidentals(layerTokens: XmlToken[], target: Map<string, Map<string, string>>): void {
    for (let index = 0; index < layerTokens.length; index++) {
        const token = layerTokens[index]
        if ((token.kind !== "open" && token.kind !== "self") || token.name !== "note") continue

        const pitchKey = getPitchKey(token.attrsRaw)
        if (!pitchKey) continue

        let written = getAttr(token.attrsRaw, "accid")
        if (!written && token.kind === "open") {
            let depth = 1
            for (let scan = index + 1; scan < layerTokens.length && depth > 0; scan++) {
                const child = layerTokens[scan]
                if (child.kind === "open") {
                    if (depth === 1 && child.name === "accid") {
                        written = getAttr(child.attrsRaw, "accid")
                        if (written) break
                    }
                    depth++
                } else if (child.kind === "self") {
                    if (depth === 1 && child.name === "accid") {
                        written = getAttr(child.attrsRaw, "accid")
                        if (written) break
                    }
                } else if (child.kind === "close") {
                    depth--
                }
            }
        }

        if (written) {
            recordRemovedWrittenAccidental(target, pitchKey, written)
        }
    }
}

function extractRemovedLayerClefs(layerTokens: XmlToken[], removedIds: Set<string>): { sameBarClef: RescuedClef | null; nextBarClef: RescuedClef | null; rescuedIds: Set<string> } {
    let sameBarClef: RescuedClef | null = null
    let nextBarClef: RescuedClef | null = null
    let sawPrecedingElement = false

    let index = 1
    while (index < layerTokens.length - 1) {
        const token = layerTokens[index]
        if (token.kind === "other" || token.kind === "close") {
            index++
            continue
        }

        if (token.name === "clef") {
            const subtree = serializeSubtree(layerTokens, index)
            const clef: RescuedClef = { html: subtree.html, ids: extractElementIds(subtree.slice) }
            if (!sawPrecedingElement) {
                if (sameBarClef) {
                    for (const oldId of sameBarClef.ids) removedIds.add(oldId)
                }
                sameBarClef = clef
            } else {
                if (nextBarClef) {
                    for (const oldId of nextBarClef.ids) removedIds.add(oldId)
                }
                nextBarClef = clef
            }
            index = subtree.nextIndex
            continue
        }

        if (!LAYER_CONTAINER_TAGS.has(token.name)) {
            sawPrecedingElement = true
        }
        index++
    }

    const rescuedIds = new Set<string>()
    if (sameBarClef) {
        for (const id of sameBarClef.ids) rescuedIds.add(id)
    }
    if (nextBarClef) {
        for (const id of nextBarClef.ids) rescuedIds.add(id)
    }

    return { sameBarClef, nextBarClef, rescuedIds }
}

function layerStartsWithClef(layerTokens: XmlToken[]): boolean {
    for (let i = 1; i < layerTokens.length - 1; i++) {
        const token = layerTokens[i]
        if (token.kind === "other") continue
        return (token.kind === "open" || token.kind === "self") && token.name === "clef"
    }
    return false
}

function collapseChord(chordAttrsRaw: string, innerTokens: XmlToken[], stripStem: boolean, verseCtx: VerseFilterContext, notePosition: VerseNotePosition, accidentalCtx: AccidentalContext | null, removedIds: Set<string>, remappedIds: Map<string, string>): string {
    const rawChordVerses: SubtreeResult[] = []
    const chordOtherChildren: string[] = []
    const notes: ChordNoteEntry[] = []

    let index = 0
    while (index < innerTokens.length) {
        const token = innerTokens[index]
        if (token.kind === "other") {
            if (token.raw.trim()) chordOtherChildren.push(token.raw)
            index++
            continue
        }
        if (token.kind === "close") {
            index++
            continue
        }

        if (token.name === "verse") {
            const subtree = serializeSubtree(innerTokens, index)
            rawChordVerses.push(subtree)
            index = subtree.nextIndex
            continue
        }

        if (token.name === "note") {
            const noteEntry: ChordNoteEntry = {
                attrsRaw: token.attrsRaw,
                rawVerses: [],
                otherSubtrees: [],
                otherRaw: [],
                removedIds: []
            }
            const noteId = getAttr(token.attrsRaw, "xml:id")
            if (noteId) noteEntry.removedIds.push(noteId)

            if (token.kind === "self") {
                notes.push(noteEntry)
                index++
                continue
            }

            let innerIndex = index + 1
            while (innerIndex < innerTokens.length) {
                const child = innerTokens[innerIndex]
                if (child.kind === "close" && child.name === "note") {
                    innerIndex++
                    break
                }
                if (child.kind === "open" || child.kind === "self") {
                    const childSubtree = serializeSubtree(innerTokens, innerIndex)
                    if (child.name === "verse") {
                        noteEntry.rawVerses.push(childSubtree)
                    } else {
                        noteEntry.otherSubtrees.push(childSubtree)
                        for (const sub of childSubtree.slice) {
                            if (sub.kind === "open" || sub.kind === "self") {
                                const subId = getAttr(sub.attrsRaw, "xml:id")
                                if (subId) noteEntry.removedIds.push(subId)
                            }
                        }
                    }
                    innerIndex = childSubtree.nextIndex
                    continue
                }
                if (child.kind === "other" && child.raw.trim()) {
                    noteEntry.otherRaw.push(child.raw)
                }
                innerIndex++
            }

            notes.push(noteEntry)
            index = innerIndex
            continue
        }

        const otherSubtree = serializeSubtree(innerTokens, index)
        chordOtherChildren.push(otherSubtree.html)
        index = otherSubtree.nextIndex
    }

    const chordId = getAttr(chordAttrsRaw, "xml:id")
    if (!notes.length) {
        if (chordId) removedIds.add(chordId)
        for (const verse of rawChordVerses) collectElementIds(verse.slice, removedIds)
        return ""
    }

    let bestIndex = 0
    let bestRank = getNoteRank(notes[0].attrsRaw)
    for (let i = 1; i < notes.length; i++) {
        const rank = getNoteRank(notes[i].attrsRaw)
        if (rank > bestRank) {
            bestRank = rank
            bestIndex = i
        }
    }

    const winner = notes[bestIndex]
    const usePrimaryVerses = rawChordVerses.length > 0 || winner.rawVerses.length > 0
    const fallbackRawVerses: SubtreeResult[] = []
    for (let i = 0; i < notes.length; i++) {
        if (i === bestIndex) continue
        if (accidentalCtx) {
            const droppedPitchKey = getPitchKey(notes[i].attrsRaw)
            if (droppedPitchKey) {
                const droppedWritten = getAttr(notes[i].attrsRaw, "accid") || getChildWrittenAccidental(notes[i].otherSubtrees)
                if (droppedWritten) {
                    recordRemovedWrittenAccidental(accidentalCtx.removedWritten, droppedPitchKey, droppedWritten)
                }
            }
        }
        for (const droppedId of notes[i].removedIds) removedIds.add(droppedId)
        if (usePrimaryVerses) {
            for (const verse of notes[i].rawVerses) collectElementIds(verse.slice, removedIds)
        } else if (notes[i].rawVerses.length) {
            fallbackRawVerses.push(...notes[i].rawVerses)
        }
    }

    const sourceVerses = usePrimaryVerses ? [...rawChordVerses, ...winner.rawVerses] : fallbackRawVerses
    const keptVerses = filterVerseSubtrees(sourceVerses, verseCtx, notePosition, removedIds)

    let mergedAttrs = winner.attrsRaw
    const winnerId = getAttr(mergedAttrs, "xml:id")
    if (chordId) {
        if (winnerId && winnerId !== chordId) {
            remappedIds.set(chordId, winnerId)
        } else if (!winnerId) {
            mergedAttrs = setAttr(mergedAttrs, "xml:id", chordId)
        }
    }

    for (const attrName of CHORD_INHERITED_ATTRS) {
        if (getAttr(mergedAttrs, attrName) !== null) continue
        const chordValue = getAttr(chordAttrsRaw, attrName)
        if (chordValue !== null) mergedAttrs = setAttr(mergedAttrs, attrName, chordValue)
    }

    const promoted = applyAccidentalPromotion(mergedAttrs, winner.otherSubtrees, accidentalCtx)
    mergedAttrs = promoted.attrsRaw

    if (stripStem) {
        mergedAttrs = removeAttr(mergedAttrs, "stem.dir")
    }

    const children = [...promoted.childHtmls, ...winner.otherRaw, ...chordOtherChildren, ...keptVerses].join("")
    if (!children) return formatTag("self", "note", mergedAttrs)
    return `${formatTag("open", "note", mergedAttrs)}${children}</note>`
}

function emitNoteToken(tokens: XmlToken[], startIndex: number, stripStem: boolean, verseCtx: VerseFilterContext, notePosition: VerseNotePosition, accidentalCtx: AccidentalContext | null, removedIds: Set<string>): { html: string; nextIndex: number } {
    const token = tokens[startIndex]
    if (token.kind !== "open" && token.kind !== "self") {
        return { html: token.raw, nextIndex: startIndex + 1 }
    }

    if (token.kind === "self") {
        const selfPromoted = applyAccidentalPromotion(token.attrsRaw, [], accidentalCtx)
        let selfAttrsRaw = selfPromoted.attrsRaw
        let modified = selfAttrsRaw !== token.attrsRaw
        if (stripStem && getAttr(selfAttrsRaw, "stem.dir") !== null) {
            selfAttrsRaw = removeAttr(selfAttrsRaw, "stem.dir")
            modified = true
        }
        return { html: modified ? formatTag("self", "note", selfAttrsRaw) : token.raw, nextIndex: startIndex + 1 }
    }

    const subtree = serializeSubtree(tokens, startIndex)
    const directVerses: SubtreeResult[] = []
    const otherSubtrees: SubtreeResult[] = []
    const parts: ({ kind: "otherSubtree"; index: number } | { kind: "raw"; text: string } | { kind: "verses" })[] = []
    let insertedVerseSlot = false

    let cursor = 1
    while (cursor < subtree.slice.length - 1) {
        const child = subtree.slice[cursor]
        if (child.kind === "other") {
            parts.push({ kind: "raw", text: child.raw })
            cursor++
            continue
        }
        if (child.kind === "close") {
            parts.push({ kind: "raw", text: child.raw })
            cursor++
            continue
        }

        const childSubtree = serializeSubtree(subtree.slice, cursor)
        if (child.name === "verse") {
            if (!insertedVerseSlot) {
                parts.push({ kind: "verses" })
                insertedVerseSlot = true
            }
            directVerses.push(childSubtree)
        } else {
            const subIdx = otherSubtrees.length
            otherSubtrees.push(childSubtree)
            parts.push({ kind: "otherSubtree", index: subIdx })
        }
        cursor = childSubtree.nextIndex
    }

    const promoted = applyAccidentalPromotion(token.attrsRaw, otherSubtrees, accidentalCtx)
    let attrsRaw = promoted.attrsRaw
    if (stripStem && getAttr(attrsRaw, "stem.dir") !== null) {
        attrsRaw = removeAttr(attrsRaw, "stem.dir")
    }

    const keptVerses = filterVerseSubtrees(directVerses, verseCtx, notePosition, removedIds)
    const innerHtml = parts
        .map((part) => {
            if (part.kind === "raw") return part.text
            if (part.kind === "otherSubtree") return promoted.childHtmls[part.index]
            return keptVerses.join("")
        })
        .join("")

    const openTag = attrsRaw === token.attrsRaw ? token.raw : formatTag("open", "note", attrsRaw)
    const closeToken = subtree.slice[subtree.slice.length - 1]
    const closeTag = closeToken.kind === "close" ? closeToken.raw : "</note>"
    return { html: `${openTag}${innerHtml}${closeTag}`, nextIndex: subtree.nextIndex }
}

function emitNonCollapsedChord(tokens: XmlToken[], startIndex: number, stripStem: boolean, verseCtx: VerseFilterContext, chordPosition: VerseNotePosition, accidentalCtx: AccidentalContext | null, removedIds: Set<string>): { html: string; nextIndex: number } {
    const token = tokens[startIndex]
    if (token.kind !== "open") {
        let selfAttrsRaw = token.kind === "self" ? token.attrsRaw : ""
        if (token.kind === "self" && stripStem && getAttr(selfAttrsRaw, "stem.dir") !== null) {
            selfAttrsRaw = removeAttr(selfAttrsRaw, "stem.dir")
            return { html: formatTag("self", "chord", selfAttrsRaw), nextIndex: startIndex + 1 }
        }
        return { html: token.raw, nextIndex: startIndex + 1 }
    }

    const subtree = serializeSubtree(tokens, startIndex)
    const directVerses: SubtreeResult[] = []
    const parts: ({ kind: "raw"; text: string } | { kind: "verses" })[] = []
    let insertedVerseSlot = false

    let cursor = 1
    while (cursor < subtree.slice.length - 1) {
        const child = subtree.slice[cursor]
        if (child.kind === "other" || child.kind === "close") {
            parts.push({ kind: "raw", text: child.raw })
            cursor++
            continue
        }
        if (child.name === "verse") {
            if (!insertedVerseSlot) {
                parts.push({ kind: "verses" })
                insertedVerseSlot = true
            }
            const verseSubtree = serializeSubtree(subtree.slice, cursor)
            directVerses.push(verseSubtree)
            cursor = verseSubtree.nextIndex
            continue
        }
        if (child.name === "note") {
            const notePosition: VerseNotePosition = {
                measureIndex: chordPosition.measureIndex,
                layerKey: chordPosition.layerKey,
                tokenIndex: chordPosition.tokenIndex + cursor
            }
            const emittedNote = emitNoteToken(subtree.slice, cursor, stripStem, verseCtx, notePosition, accidentalCtx, removedIds)
            parts.push({ kind: "raw", text: emittedNote.html })
            cursor = emittedNote.nextIndex
            continue
        }

        const otherSubtree = serializeSubtree(subtree.slice, cursor)
        parts.push({ kind: "raw", text: otherSubtree.html })
        cursor = otherSubtree.nextIndex
    }

    let attrsRaw = token.attrsRaw
    if (stripStem && getAttr(attrsRaw, "stem.dir") !== null) {
        attrsRaw = removeAttr(attrsRaw, "stem.dir")
    }
    const keptVerses = filterVerseSubtrees(directVerses, verseCtx, chordPosition, removedIds)
    const innerHtml = parts.map((part) => (part.kind === "verses" ? keptVerses.join("") : part.text)).join("")
    const openTag = attrsRaw === token.attrsRaw ? token.raw : formatTag("open", "chord", attrsRaw)
    const closeToken = subtree.slice[subtree.slice.length - 1]
    const closeTag = closeToken.kind === "close" ? closeToken.raw : "</chord>"
    return { html: `${openTag}${innerHtml}${closeTag}`, nextIndex: subtree.nextIndex }
}

function emitKeptLayer(layerTokens: XmlToken[], staffN: string, layerN: string, measureIndex: number, layerTokenOffset: number, firstStaffN: string, reduceChords: boolean, stripStem: boolean, verseCtx: VerseFilterContext, accidentalCtx: AccidentalContext | null, clefToPrepend: RescuedClef | null, removedIds: Set<string>, remappedIds: Map<string, string>): string {
    const first = layerTokens[0]
    if (!first || first.kind === "self") return first ? first.raw : ""

    const layerKey = `${staffN}.${layerN}`
    const output: string[] = [first.raw]
    if (clefToPrepend) {
        if (layerStartsWithClef(layerTokens)) {
            for (const id of clefToPrepend.ids) removedIds.add(id)
        } else {
            output.push(clefToPrepend.html)
        }
    }

    let index = 1
    while (index < layerTokens.length - 1) {
        const token = layerTokens[index]
        if (token.kind === "other" || token.kind === "close") {
            output.push(token.raw)
            index++
            continue
        }

        if (token.name === "chord") {
            const chordPosition: VerseNotePosition = { measureIndex, layerKey, tokenIndex: layerTokenOffset + index }
            if (reduceChords && staffN === firstStaffN && token.kind === "open") {
                const subtree = serializeSubtree(layerTokens, index)
                const innerTokens = subtree.slice.slice(1, -1)
                output.push(collapseChord(token.attrsRaw, innerTokens, stripStem, verseCtx, chordPosition, accidentalCtx, removedIds, remappedIds))
                index = subtree.nextIndex
                continue
            }
            const emittedChord = emitNonCollapsedChord(layerTokens, index, stripStem, verseCtx, chordPosition, accidentalCtx, removedIds)
            output.push(emittedChord.html)
            index = emittedChord.nextIndex
            continue
        }

        if (token.name === "note") {
            const notePosition: VerseNotePosition = { measureIndex, layerKey, tokenIndex: layerTokenOffset + index }
            const emittedNote = emitNoteToken(layerTokens, index, stripStem, verseCtx, notePosition, accidentalCtx, removedIds)
            output.push(emittedNote.html)
            index = emittedNote.nextIndex
            continue
        }

        let attrsRaw = token.attrsRaw
        let modified = false
        if (stripStem && getAttr(attrsRaw, "stem.dir") !== null) {
            attrsRaw = removeAttr(attrsRaw, "stem.dir")
            modified = true
        }
        output.push(modified ? formatTag(token.kind, token.name, attrsRaw) : token.raw)
        index++
    }

    const last = layerTokens[layerTokens.length - 1]
    if (last) output.push(last.raw)
    return output.join("")
}

function cloneRemovedWrittenMap(source: Map<string, Map<string, string>>): Map<string, Map<string, string>> {
    const copy = new Map<string, Map<string, string>>()
    for (const [pitchKey, byKind] of source) {
        copy.set(pitchKey, new Map(byKind))
    }
    return copy
}

function processKeptStaff(staffTokens: XmlToken[], staffN: string, measureIndex: number, staffTokenOffset: number, firstStaffN: string, filteringParts: boolean, keptLayers: Set<string> | undefined, reduceChords: boolean, stripStem: boolean, verseCtx: VerseFilterContext, pendingClefByStaff: Map<string, RescuedClef>, removedIds: Set<string>, remappedIds: Map<string, string>): string {
    const first = staffTokens[0]
    if (!first || first.kind === "self") return first ? first.raw : ""

    interface StaffChild {
        kind: "layer" | "other"
        kept: boolean
        layerN: string
        tokenOffset: number
        tokens: XmlToken[]
    }

    const children: StaffChild[] = []
    let cursor = 1
    while (cursor < staffTokens.length - 1) {
        const token = staffTokens[cursor]
        if (token.kind === "other" || token.kind === "close") {
            children.push({ kind: "other", kept: true, layerN: "", tokenOffset: staffTokenOffset + cursor, tokens: [token] })
            cursor++
            continue
        }

        const subtree = serializeSubtree(staffTokens, cursor)
        if (token.name === "layer") {
            const layerN = getAttr(token.attrsRaw, "n") || "1"
            const isKept = !filteringParts || Boolean(keptLayers?.has(layerN))
            children.push({ kind: "layer", kept: isKept, layerN, tokenOffset: staffTokenOffset + cursor, tokens: subtree.slice })
        } else {
            children.push({ kind: "other", kept: true, layerN: "", tokenOffset: staffTokenOffset + cursor, tokens: subtree.slice })
        }
        cursor = subtree.nextIndex
    }

    const removedWritten = new Map<string, Map<string, string>>()
    let sameBarClef: RescuedClef | null = null
    let nextBarClef: RescuedClef | null = null

    for (const child of children) {
        if (child.kind !== "layer" || child.kept) continue
        collectRemovedLayerAccidentals(child.tokens, removedWritten)
        const extracted = extractRemovedLayerClefs(child.tokens, removedIds)
        if (extracted.sameBarClef) {
            if (sameBarClef) {
                for (const id of sameBarClef.ids) removedIds.add(id)
            }
            sameBarClef = extracted.sameBarClef
        }
        if (extracted.nextBarClef) {
            if (nextBarClef) {
                for (const id of nextBarClef.ids) removedIds.add(id)
            }
            nextBarClef = extracted.nextBarClef
        }
        for (const token of child.tokens) {
            if (token.kind === "open" || token.kind === "self") {
                const xmlId = getAttr(token.attrsRaw, "xml:id")
                if (xmlId && !extracted.rescuedIds.has(xmlId)) removedIds.add(xmlId)
            }
        }
    }

    const inheritedClef = pendingClefByStaff.get(staffN) ?? null
    pendingClefByStaff.delete(staffN)

    let clefToPrepend: RescuedClef | null = inheritedClef
    if (sameBarClef) {
        if (inheritedClef) {
            for (const id of inheritedClef.ids) removedIds.add(id)
        }
        clefToPrepend = sameBarClef
    }

    if (nextBarClef) {
        pendingClefByStaff.set(staffN, nextBarClef)
    }

    const trackAccidentals = removedWritten.size > 0 || (reduceChords && staffN === firstStaffN)
    const output: string[] = [first.raw]
    let appliedClef = false

    for (const child of children) {
        if (!child.kept) continue
        if (child.kind === "layer") {
            const prepend = !appliedClef ? clefToPrepend : null
            appliedClef = true
            const accidentalCtx: AccidentalContext | null = trackAccidentals ? { removedWritten: cloneRemovedWrittenMap(removedWritten), readerAccidental: new Map() } : null
            output.push(emitKeptLayer(child.tokens, staffN, child.layerN, measureIndex, child.tokenOffset, firstStaffN, reduceChords, stripStem, verseCtx, accidentalCtx, prepend, removedIds, remappedIds))
        } else {
            output.push(child.tokens.map((token) => token.raw).join(""))
        }
    }

    if (!appliedClef && clefToPrepend) {
        // No kept layer appeared in this bar for this staff: carry the clef forward to the next bar
        if (!nextBarClef) {
            pendingClefByStaff.set(staffN, clefToPrepend)
        } else {
            for (const id of clefToPrepend.ids) removedIds.add(id)
        }
    }

    const last = staffTokens[staffTokens.length - 1]
    if (last) output.push(last.raw)
    return output.join("")
}

function cleanStaffGroupTokens(tokens: XmlToken[], startIndex: number, endIndex: number, removedIds: Set<string>): { html: string; staffDefCount: number } {
    const openToken = tokens[startIndex]
    if (openToken.kind === "self") {
        const xmlId = getAttr(openToken.attrsRaw, "xml:id")
        if (xmlId) removedIds.add(xmlId)
        return { html: "", staffDefCount: 0 }
    }

    const parts: ({ kind: "raw"; text: string } | { kind: "grpSym"; slice: XmlToken[]; html: string })[] = []
    let staffDefCount = 0

    let index = startIndex + 1
    while (index < endIndex) {
        const token = tokens[index]
        if (token.kind === "other" || token.kind === "close") {
            parts.push({ kind: "raw", text: token.raw })
            index++
            continue
        }

        const subtree = serializeSubtree(tokens, index)
        if (token.name === "staffGrp") {
            const nested = cleanStaffGroupTokens(tokens, index, subtree.nextIndex - (token.kind === "open" ? 1 : 0), removedIds)
            staffDefCount += nested.staffDefCount
            if (nested.html) parts.push({ kind: "raw", text: nested.html })
        } else if (token.name === "staffDef") {
            staffDefCount++
            parts.push({ kind: "raw", text: subtree.html })
        } else if (token.name === "grpSym") {
            parts.push({ kind: "grpSym", slice: subtree.slice, html: subtree.html })
        } else {
            parts.push({ kind: "raw", text: subtree.html })
        }
        index = subtree.nextIndex
    }

    if (staffDefCount === 0) {
        collectElementIds(tokens.slice(startIndex, endIndex + 1), removedIds)
        return { html: "", staffDefCount: 0 }
    }

    let openTag = openToken.raw
    const singleStaff = staffDefCount === 1
    if (singleStaff && openToken.kind === "open" && getAttr(openToken.attrsRaw, "symbol") !== null) {
        openTag = formatTag("open", "staffGrp", removeAttr(openToken.attrsRaw, "symbol"))
    }

    const innerHtml = parts
        .map((part) => {
            if (part.kind === "raw") return part.text
            if (singleStaff) {
                collectElementIds(part.slice, removedIds)
                return ""
            }
            return part.html
        })
        .join("")

    const closeToken = tokens[endIndex]
    const closeTag = closeToken && closeToken.kind === "close" ? closeToken.raw : "</staffGrp>"
    return { html: `${openTag}${innerHtml}${closeTag}`, staffDefCount }
}

function cleanStaffGroups(mei: string, removedIds: Set<string>): string {
    const tokens = scanXml(mei)
    const output: string[] = []
    let index = 0

    while (index < tokens.length) {
        const token = tokens[index]
        if ((token.kind === "open" || token.kind === "self") && token.name === "staffGrp") {
            const subtree = serializeSubtree(tokens, index)
            const endIndex = token.kind === "open" ? subtree.nextIndex - 1 : index
            const cleaned = cleanStaffGroupTokens(tokens, index, endIndex, removedIds)
            if (cleaned.html) output.push(cleaned.html)
            index = subtree.nextIndex
            continue
        }
        output.push(token.raw)
        index++
    }

    return output.join("")
}

function rewriteRef(rawRef: string, removedIds: Set<string>, remappedIds: Map<string, string>): { value: string; removed: boolean } {
    const trimmed = rawRef.trim()
    const hasHash = trimmed.startsWith("#")
    const id = hasHash ? trimmed.slice(1) : trimmed
    if (removedIds.has(id)) return { value: rawRef, removed: true }
    const remapped = remappedIds.get(id)
    if (remapped) return { value: hasHash ? `#${remapped}` : remapped, removed: false }
    return { value: rawRef, removed: false }
}

function cleanControlReferences(mei: string, removedIds: Set<string>, remappedIds: Map<string, string>): string {
    const tokens = scanXml(mei)
    const output: string[] = []
    let skipDepth = 0

    for (const token of tokens) {
        if (skipDepth > 0) {
            if (token.kind === "open") skipDepth++
            else if (token.kind === "close") skipDepth--
            continue
        }

        if (token.kind === "other" || token.kind === "close") {
            output.push(token.raw)
            continue
        }

        let attrsRaw = token.attrsRaw
        let modified = false
        let drop = false

        const startId = getAttr(attrsRaw, "startid")
        if (startId !== null) {
            const resolved = rewriteRef(startId, removedIds, remappedIds)
            if (resolved.removed) {
                drop = true
            } else if (resolved.value !== startId) {
                attrsRaw = setAttr(attrsRaw, "startid", resolved.value)
                modified = true
            }
        }

        if (!drop) {
            const endId = getAttr(attrsRaw, "endid")
            if (endId !== null) {
                const resolved = rewriteRef(endId, removedIds, remappedIds)
                if (resolved.removed) {
                    drop = true
                } else if (resolved.value !== endId) {
                    attrsRaw = setAttr(attrsRaw, "endid", resolved.value)
                    modified = true
                }
            }
        }

        if (!drop && token.name !== "expansion") {
            const plist = getAttr(attrsRaw, "plist")
            if (plist !== null) {
                const refs = plist.trim().split(/\s+/).filter(Boolean)
                const keptRefs: string[] = []
                let plistChanged = false
                for (const ref of refs) {
                    const resolved = rewriteRef(ref, removedIds, remappedIds)
                    if (resolved.removed) {
                        plistChanged = true
                    } else {
                        if (resolved.value !== ref) plistChanged = true
                        keptRefs.push(resolved.value)
                    }
                }
                if (refs.length > 0 && keptRefs.length === 0) {
                    drop = true
                } else if (plistChanged) {
                    attrsRaw = setAttr(attrsRaw, "plist", keptRefs.join(" "))
                    modified = true
                }
            }
        }

        if (drop) {
            if (token.kind === "open") skipDepth = 1
            continue
        }

        output.push(modified ? formatTag(token.kind, token.name, attrsRaw) : token.raw)
    }

    return output.join("")
}

function collectChosenVersePositions(tokens: XmlToken[], filteringParts: boolean, keptStaves: Set<string>, keptLayersByStaff: Map<string, Set<string>>, keptVerses: Set<number>): { measuresWithChosenVerse: Set<number>; lastChosenVerseMeasureIndex: number; lastChosenVerseEndTokenByLayer: Map<string, number> } {
    const measuresWithChosenVerse = new Set<number>()
    const lastChosenVerseEndTokenByLayer = new Map<string, number>()
    let lastChosenVerseMeasureIndex = -1

    let measureIndex = 0
    const staffStack: string[] = []
    const layerStack: string[] = []
    let chordDepth = 0
    let chordEndTokenIndex = -1
    let noteDepth = 0
    let noteEndTokenIndex = -1

    const findMatchingCloseIndex = (startIndex: number): number => {
        const first = tokens[startIndex]
        if (!first || first.kind === "self") return startIndex
        let depth = 1
        for (let i = startIndex + 1; i < tokens.length; i++) {
            const current = tokens[i]
            if (current.kind === "open") depth++
            else if (current.kind === "close") {
                depth--
                if (depth === 0) return i
            }
        }
        return tokens.length - 1
    }

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index]
        if (token.kind === "other") continue

        if (token.kind === "close") {
            if (token.name === "staff" && staffStack.length > 0) staffStack.pop()
            else if (token.name === "layer" && layerStack.length > 0) layerStack.pop()
            else if (token.name === "chord" && chordDepth > 0) {
                chordDepth--
                if (chordDepth === 0) chordEndTokenIndex = -1
            } else if (token.name === "note" && noteDepth > 0) {
                noteDepth--
                if (noteDepth === 0) noteEndTokenIndex = -1
            }
            continue
        }

        if (token.name === "measure") {
            measureIndex++
            continue
        }

        if (token.name === "staff") {
            if (token.kind === "open") staffStack.push(getAttr(token.attrsRaw, "n") || "")
            continue
        }

        if (token.name === "layer") {
            if (token.kind === "open") layerStack.push(getAttr(token.attrsRaw, "n") || "1")
            continue
        }

        if (token.name === "chord") {
            if (token.kind === "open") {
                if (chordDepth === 0) chordEndTokenIndex = findMatchingCloseIndex(index)
                chordDepth++
            }
            continue
        }

        if (token.name === "note") {
            if (token.kind === "open") {
                if (noteDepth === 0) noteEndTokenIndex = findMatchingCloseIndex(index)
                noteDepth++
            }
            continue
        }

        if (token.name === "verse") {
            const currentStaff = staffStack[staffStack.length - 1] ?? ""
            const currentLayer = layerStack[layerStack.length - 1] ?? "1"
            if (filteringParts) {
                if (!currentStaff || !keptStaves.has(currentStaff)) continue
                if (!keptLayersByStaff.get(currentStaff)?.has(currentLayer)) continue
            }

            const verseNumber = parseVerseNumber(getAttr(token.attrsRaw, "n"))
            if (verseNumber === null || !keptVerses.has(verseNumber)) continue

            measuresWithChosenVerse.add(measureIndex)
            const ownerEndToken = chordEndTokenIndex !== -1 ? chordEndTokenIndex : noteEndTokenIndex !== -1 ? noteEndTokenIndex : index
            if (measureIndex > lastChosenVerseMeasureIndex) {
                lastChosenVerseMeasureIndex = measureIndex
                lastChosenVerseEndTokenByLayer.clear()
            }
            if (measureIndex === lastChosenVerseMeasureIndex) {
                const layerKey = `${currentStaff}.${currentLayer}`
                const previousEnd = lastChosenVerseEndTokenByLayer.get(layerKey) ?? -1
                if (ownerEndToken > previousEnd) {
                    lastChosenVerseEndTokenByLayer.set(layerKey, ownerEndToken)
                }
            }
        }
    }

    return { measuresWithChosenVerse, lastChosenVerseMeasureIndex, lastChosenVerseEndTokenByLayer }
}

export function filterMei(mei: string, options: FilterMeiOptions): string {
    if (!mei || typeof mei !== "string") return mei

    const summary = summarizeMei(mei)
    const allKeys: string[] = []
    for (const staff of summary.staves) {
        for (const layer of staff.layers) allKeys.push(`${staff.n}.${layer}`)
    }
    const allKeysSet = new Set(allKeys)

    let filteringParts = false
    const keptKeys = new Set<string>()
    if (options.parts !== "all") {
        for (const key of options.parts) {
            if (allKeysSet.has(key)) keptKeys.add(key)
        }
        if (keptKeys.size > 0 && keptKeys.size < allKeysSet.size) {
            filteringParts = true
        }
    }

    const reduceChords = Boolean(options.highestNoteOnly) && mei.includes("<chord")

    let filteringVerses = false
    let keptVerses: Set<number> | null = null
    const verseRenumberMap = new Map<number, number>()
    if (options.verses === "none") {
        filteringVerses = summary.verses.length > 0
        keptVerses = new Set()
    } else if (Array.isArray(options.verses)) {
        const chosenSet = new Set(options.verses)
        const matchingVerses = summary.verses.filter((verse) => chosenSet.has(verse))
        if (matchingVerses.length > 0) {
            keptVerses = new Set(matchingVerses)
            matchingVerses.forEach((verseNumber, idx) => {
                verseRenumberMap.set(verseNumber, idx + 1)
            })
            filteringVerses = matchingVerses.length < summary.verses.length || matchingVerses.some((verseNumber, idx) => verseNumber !== idx + 1)
        }
    }

    if (!filteringParts && !filteringVerses && !reduceChords) {
        return mei
    }

    const keptStaves = new Set<string>()
    const keptLayersByStaff = new Map<string, Set<string>>()
    if (filteringParts) {
        for (const key of keptKeys) {
            const dotIndex = key.indexOf(".")
            if (dotIndex <= 0) continue
            const staffN = key.slice(0, dotIndex)
            const layerN = key.slice(dotIndex + 1)
            keptStaves.add(staffN)
            if (!keptLayersByStaff.has(staffN)) keptLayersByStaff.set(staffN, new Set())
            keptLayersByStaff.get(staffN)!.add(layerN)
        }
    } else {
        for (const staff of summary.staves) {
            keptStaves.add(staff.n)
            keptLayersByStaff.set(staff.n, new Set(staff.layers))
        }
    }

    const firstStaffN = summary.staves[0]?.n ?? ""
    const shouldStripStemsOnStaff = (staffN: string | null): boolean => {
        if (!staffN || (!filteringParts && !reduceChords)) return false
        return (keptLayersByStaff.get(staffN)?.size ?? 0) === 1
    }

    const tokens = scanXml(mei)
    const versePositions = filteringVerses && keptVerses && keptVerses.size > 0 ? collectChosenVersePositions(tokens, filteringParts, keptStaves, keptLayersByStaff, keptVerses) : { measuresWithChosenVerse: new Set<number>(), lastChosenVerseMeasureIndex: -1, lastChosenVerseEndTokenByLayer: new Map<string, number>() }

    const verseCtx: VerseFilterContext = {
        filteringVerses,
        keptVerses,
        verseRenumberMap,
        measuresWithChosenVerse: versePositions.measuresWithChosenVerse,
        lastChosenVerseMeasureIndex: versePositions.lastChosenVerseMeasureIndex,
        lastChosenVerseEndTokenByLayer: versePositions.lastChosenVerseEndTokenByLayer
    }

    const output: string[] = []
    const removedIds = new Set<string>()
    const remappedIds = new Map<string, string>()
    const pendingClefByStaff = new Map<string, RescuedClef>()

    let skipDepth = 0
    let measureIndex = 0

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index]

        if (skipDepth > 0) {
            if (token.kind === "open" || token.kind === "self") {
                const xmlId = getAttr(token.attrsRaw, "xml:id")
                if (xmlId) removedIds.add(xmlId)
                if (token.kind === "open") skipDepth++
            } else if (token.kind === "close") {
                skipDepth--
            }
            continue
        }

        if (token.kind === "other" || token.kind === "close") {
            output.push(token.raw)
            continue
        }

        if (token.name === "measure") {
            measureIndex++
        }

        if (filteringParts && token.name === "staffDef") {
            const staffN = getAttr(token.attrsRaw, "n")
            if (staffN && !keptStaves.has(staffN)) {
                const xmlId = getAttr(token.attrsRaw, "xml:id")
                if (xmlId) removedIds.add(xmlId)
                if (token.kind === "open") skipDepth = 1
                continue
            }
        }

        if (token.name === "staff") {
            const staffN = getAttr(token.attrsRaw, "n")
            if (filteringParts && staffN && !keptStaves.has(staffN)) {
                const xmlId = getAttr(token.attrsRaw, "xml:id")
                if (xmlId) removedIds.add(xmlId)
                if (token.kind === "open") skipDepth = 1
                continue
            }
            if (token.kind === "open" && staffN) {
                const subtree = serializeSubtree(tokens, index)
                output.push(processKeptStaff(subtree.slice, staffN, measureIndex, index, firstStaffN, filteringParts, keptLayersByStaff.get(staffN), reduceChords, shouldStripStemsOnStaff(staffN), verseCtx, pendingClefByStaff, removedIds, remappedIds))
                index = subtree.nextIndex - 1
                continue
            }
            output.push(token.raw)
            continue
        }

        let attrsRaw = token.attrsRaw
        let modified = false

        if (filteringParts && token.name !== "staff" && token.name !== "staffDef") {
            const staffAttr = getAttr(attrsRaw, "staff")
            if (staffAttr !== null) {
                const staffRefs = staffAttr.trim().split(/\s+/).filter(Boolean)
                const keptRefs = staffRefs.filter((ref) => keptStaves.has(ref))
                if (staffRefs.length > 0 && keptRefs.length === 0) {
                    const xmlId = getAttr(attrsRaw, "xml:id")
                    if (xmlId) removedIds.add(xmlId)
                    if (token.kind === "open") skipDepth = 1
                    continue
                }
                if (keptRefs.length !== staffRefs.length) {
                    attrsRaw = setAttr(attrsRaw, "staff", keptRefs.join(" "))
                    modified = true
                }
            }
        }

        output.push(modified ? formatTag(token.kind, token.name, attrsRaw) : token.raw)
    }

    for (const leftoverClef of pendingClefByStaff.values()) {
        for (const id of leftoverClef.ids) removedIds.add(id)
    }

    let result = filteringParts ? cleanStaffGroups(output.join(""), removedIds) : output.join("")
    if (removedIds.size > 0 || remappedIds.size > 0) {
        result = cleanControlReferences(result, removedIds, remappedIds)
    }

    return result
}
