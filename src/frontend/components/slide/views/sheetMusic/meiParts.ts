export interface MeiStaffSummary {
    n: string
    layers: string[]
}

export interface MeiSummary {
    staves: MeiStaffSummary[]
    verses: number[]
    measures: number
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

interface ChordNoteEntry {
    attrsRaw: string
    verses: string[]
    otherChildren: string[]
    removedIds: string[]
}

const PITCH_ORDER = "cdefgab"
const CHORD_INHERITED_ATTRS = ["dur", "dur.ppq", "dots", "fermata", "stem.dir", "artic", "tie", "beam", "tuplet"] as const
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

export function summarizeMei(mei: string): MeiSummary {
    if (!mei || typeof mei !== "string") return { staves: [], verses: [], measures: 0 }

    const tokens = scanXml(mei)
    const staffLayers = new Map<string, Set<string>>()
    const verses = new Set<number>()
    let measures = 0

    const staffStack: string[] = []
    const ensureStaff = (staffN: string) => {
        if (!staffLayers.has(staffN)) staffLayers.set(staffN, new Set())
    }

    for (const token of tokens) {
        if (token.kind === "other") continue

        if (token.kind === "close") {
            if (token.name === "staff" && staffStack.length > 0) staffStack.pop()
            continue
        }

        if (token.name === "staffDef") {
            const staffN = getAttr(token.attrsRaw, "n")
            if (staffN) ensureStaff(staffN)
        } else if (token.name === "measure") {
            measures++
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
            }
        } else if (token.name === "verse") {
            const verseNumber = parseVerseNumber(getAttr(token.attrsRaw, "n"))
            if (verseNumber !== null) verses.add(verseNumber)
        }
    }

    const staves: MeiStaffSummary[] = []
    for (const [n, layers] of staffLayers) {
        staves.push({ n, layers: sortNumericStrings(Array.from(layers)) })
    }

    return {
        staves,
        verses: Array.from(verses).sort((a, b) => a - b),
        measures
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

function serializeSubtree(tokens: XmlToken[], startIndex: number): { html: string; nextIndex: number; slice: XmlToken[] } {
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

function collapseChord(chordAttrsRaw: string, innerTokens: XmlToken[], stripStem: boolean, shouldKeepVerse: (verseAttr: string | null) => boolean, removedIds: Set<string>, remappedIds: Map<string, string>): string {
    const chordVerses: string[] = []
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
            if (shouldKeepVerse(getAttr(token.attrsRaw, "n"))) {
                chordVerses.push(subtree.html)
            } else {
                collectElementIds(subtree.slice, removedIds)
            }
            index = subtree.nextIndex
            continue
        }

        if (token.name === "note") {
            const noteEntry: ChordNoteEntry = {
                attrsRaw: token.attrsRaw,
                verses: [],
                otherChildren: [],
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
                        if (shouldKeepVerse(getAttr(child.attrsRaw, "n"))) {
                            noteEntry.verses.push(childSubtree.html)
                        } else {
                            collectElementIds(childSubtree.slice, removedIds)
                        }
                    } else {
                        noteEntry.otherChildren.push(childSubtree.html)
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
                    noteEntry.otherChildren.push(child.raw)
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
    const fallbackVerses: string[] = []
    for (let i = 0; i < notes.length; i++) {
        if (i === bestIndex) continue
        for (const droppedId of notes[i].removedIds) removedIds.add(droppedId)
        if (notes[i].verses.length) fallbackVerses.push(...notes[i].verses)
    }

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

    if (stripStem) {
        mergedAttrs = removeAttr(mergedAttrs, "stem.dir")
    }

    const keptVerses = chordVerses.length || winner.verses.length ? [...chordVerses, ...winner.verses] : fallbackVerses
    const children = [...winner.otherChildren, ...chordOtherChildren, ...keptVerses].join("")
    if (!children) return formatTag("self", "note", mergedAttrs)
    return `${formatTag("open", "note", mergedAttrs)}${children}</note>`
}

function stripEmptyStaffGroups(mei: string): string {
    let result = mei
    let previous = ""
    while (result !== previous) {
        previous = result
        result = result.replace(/<staffGrp(?:\s[^>]*)?\/>|<staffGrp(?:\s[^>]*)?>\s*<\/staffGrp>/g, "")
    }
    return result
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
    if (options.verses === "none") {
        filteringVerses = summary.verses.length > 0
        keptVerses = new Set()
    } else if (Array.isArray(options.verses)) {
        keptVerses = new Set(options.verses)
        filteringVerses = summary.verses.some((verse) => !keptVerses!.has(verse))
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

    const singleStaffLeft = filteringParts && keptStaves.size === 1
    const firstStaffN = summary.staves[0]?.n ?? ""
    const shouldStripStemsOnStaff = (staffN: string | null): boolean => {
        if (!staffN || (!filteringParts && !reduceChords)) return false
        return (keptLayersByStaff.get(staffN)?.size ?? 0) === 1
    }
    const shouldKeepVerse = (verseAttr: string | null): boolean => {
        if (!filteringVerses || keptVerses === null) return true
        const verseNumber = parseVerseNumber(verseAttr)
        if (verseNumber === null) return keptVerses.size > 0
        return keptVerses.has(verseNumber)
    }

    const tokens = scanXml(mei)
    const output: string[] = []
    const removedIds = new Set<string>()
    const remappedIds = new Map<string, string>()

    const staffStack: string[] = []
    const layerStack: string[] = []
    let skipDepth = 0

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

        if (token.kind === "other") {
            output.push(token.raw)
            continue
        }

        if (token.kind === "close") {
            if (token.name === "staff" && staffStack.length > 0) staffStack.pop()
            else if (token.name === "layer" && layerStack.length > 0) layerStack.pop()
            output.push(token.raw)
            continue
        }

        const currentStaff = staffStack[staffStack.length - 1] ?? null

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
            if (token.kind === "open" && staffN) staffStack.push(staffN)
            output.push(token.raw)
            continue
        }

        if (token.name === "layer" && currentStaff !== null) {
            const layerN = getAttr(token.attrsRaw, "n") || "1"
            if (filteringParts && !keptLayersByStaff.get(currentStaff)?.has(layerN)) {
                const xmlId = getAttr(token.attrsRaw, "xml:id")
                if (xmlId) removedIds.add(xmlId)
                if (token.kind === "open") skipDepth = 1
                continue
            }
            if (token.kind === "open") layerStack.push(layerN)
            output.push(token.raw)
            continue
        }

        if (filteringVerses && token.name === "verse") {
            if (!shouldKeepVerse(getAttr(token.attrsRaw, "n"))) {
                const xmlId = getAttr(token.attrsRaw, "xml:id")
                if (xmlId) removedIds.add(xmlId)
                if (token.kind === "open") skipDepth = 1
                continue
            }
        }

        if (singleStaffLeft && token.name === "grpSym") {
            const xmlId = getAttr(token.attrsRaw, "xml:id")
            if (xmlId) removedIds.add(xmlId)
            if (token.kind === "open") skipDepth = 1
            continue
        }

        if (reduceChords && token.name === "chord" && token.kind === "open" && currentStaff === firstStaffN && layerStack.length > 0) {
            const innerTokens: XmlToken[] = []
            let depth = 1
            let scanIndex = index + 1
            while (scanIndex < tokens.length && depth > 0) {
                const nextToken = tokens[scanIndex]
                if (nextToken.kind === "open") depth++
                else if (nextToken.kind === "close") depth--
                if (depth > 0) innerTokens.push(nextToken)
                scanIndex++
            }
            output.push(collapseChord(token.attrsRaw, innerTokens, shouldStripStemsOnStaff(currentStaff), shouldKeepVerse, removedIds, remappedIds))
            index = scanIndex - 1
            continue
        }

        let attrsRaw = token.attrsRaw
        let modified = false

        if (singleStaffLeft && token.name === "staffGrp" && getAttr(attrsRaw, "symbol") !== null) {
            attrsRaw = removeAttr(attrsRaw, "symbol")
            modified = true
        }

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

        if (shouldStripStemsOnStaff(currentStaff) && getAttr(attrsRaw, "stem.dir") !== null) {
            attrsRaw = removeAttr(attrsRaw, "stem.dir")
            modified = true
        }

        output.push(modified ? formatTag(token.kind, token.name, attrsRaw) : token.raw)
    }

    let result = filteringParts ? stripEmptyStaffGroups(output.join("")) : output.join("")
    if (removedIds.size > 0 || remappedIds.size > 0) {
        result = cleanControlReferences(result, removedIds, remappedIds)
    }

    return result
}
