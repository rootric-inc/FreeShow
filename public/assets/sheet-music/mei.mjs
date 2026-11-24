export const DEFAULT_PAGE_WIDTH = 2100
export const MIN_PAGE_WIDTH = 100
export const MAX_PAGE_WIDTH = 100000
export const CANONICAL_START_WIDTH = DEFAULT_PAGE_WIDTH
export const MAX_FIT_LAYOUTS = 8
export const MAX_FIT_TIME_MS = 8000
export const FIT_TOLERANCE = 0.05
export const FIT_STEP_UP_FACTOR = 1.05

const WIDTH_OVERFLOW_TOLERANCE = 10

export function decodeXmlEntities(text) {
    return text.replace(/&(#x[0-9a-fA-F]+|#X[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (match, entity) => {
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

function cleanHeaderText(raw) {
    return decodeXmlEntities(raw.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim()
}

function collectHeaderMatches(header, pattern) {
    const values = []
    const seen = new Set()
    let match
    while ((match = pattern.exec(header)) !== null) {
        const cleaned = cleanHeaderText(match[1])
        if (cleaned && !seen.has(cleaned)) {
            seen.add(cleaned)
            values.push(cleaned)
        }
    }
    return values
}

export function extractTitle(mei) {
    const headMatch = mei.match(/<meiHead(?:\s[^>]*)?>([\s\S]*?)<\/meiHead>/)
    if (!headMatch) return ""
    const titleMatch = headMatch[1].match(/<title\b[^>]*>([\s\S]*?)<\/title>/)
    if (!titleMatch) return ""
    return cleanHeaderText(titleMatch[1])
}

export function extractHeaderMetadata(mei) {
    const headMatch = mei.match(/<meiHead(?:\s[^>]*)?>([\s\S]*?)<\/meiHead>/)
    if (!headMatch) return { title: "", composer: "", lyricist: "", copyright: "" }
    const header = headMatch[1]

    const titleMatch = header.match(/<title\b[^>]*>([\s\S]*?)<\/title>/)
    const title = titleMatch ? cleanHeaderText(titleMatch[1]) : ""

    let composers = collectHeaderMatches(header, /<(?:persName|corpName)\b[^>]*\brole=(?:"composer"|'composer')[^>]*>([\s\S]*?)<\/(?:persName|corpName)>/gi)
    if (!composers.length) {
        composers = collectHeaderMatches(header, /<composer\b[^>]*>([\s\S]*?)<\/composer>/gi)
    }
    const composer = composers.join(", ")

    let lyricists = collectHeaderMatches(header, /<(?:persName|corpName)\b[^>]*\brole=(?:"lyricist"|'lyricist')[^>]*>([\s\S]*?)<\/(?:persName|corpName)>/gi)
    if (!lyricists.length) {
        lyricists = collectHeaderMatches(header, /<(?:persName|corpName)\b[^>]*\brole=(?:"(?:poet|author|words)"|'(?:poet|author|words)')[^>]*>([\s\S]*?)<\/(?:persName|corpName)>/gi)
    }
    if (!lyricists.length) {
        lyricists = collectHeaderMatches(header, /<lyricist\b[^>]*>([\s\S]*?)<\/lyricist>/gi)
    }
    const lyricist = lyricists.join(", ")

    let copyright = ""
    const availabilityMatch = header.match(/<availability\b[^>]*>([\s\S]*?)<\/availability>/i)
    if (availabilityMatch) {
        const availabilityBody = availabilityMatch[1]
        const rights = collectHeaderMatches(availabilityBody, /<(?:useRestrict|distributor)\b[^>]*>([\s\S]*?)<\/(?:useRestrict|distributor)>/gi)
        copyright = rights.length ? rights.join(" ") : cleanHeaderText(availabilityBody)
    }

    return { title, composer, lyricist, copyright }
}

export function normalizeMei(mei) {
    return mei
        .replace(/<\?xml-model[\s\S]*?\?>\s*/g, "")
        .replace(/<meiHead(?:\s[^>]*)?\/>|<meiHead(?:\s[^>]*)?>[\s\S]*?<\/meiHead>/g, "")
        .replace(/<(label|labelAbbr)(?:\s[^>]*)?\/>|<(label|labelAbbr)(?:\s[^>]*)?>[\s\S]*?<\/\2>/g, "")
        .replace(/<staffGrp\b([^>]*?)(\/?)>/g, (_match, attrs, slash) => {
            if (/\bbar\.thru=(?:"[^"]*"|'[^']*')/.test(attrs)) {
                return `<staffGrp${attrs.replace(/\bbar\.thru=(?:"[^"]*"|'[^']*')/, 'bar.thru="false"')}${slash}>`
            }
            return `<staffGrp${attrs} bar.thru="false"${slash}>`
        })
        .replace(/>\s+</g, "><")
        .trim()
}

export function countMeasures(mei) {
    const matches = mei.match(/<measure(?:\s|>|\/)/g)
    return matches ? matches.length : 0
}

export function insertSlicePageBreaks(mei, first, last) {
    const cleaned = mei.replace(/<pb(?:\s[^>]*)?\/>|<pb(?:\s[^>]*)?>[\s\S]*?<\/pb>/g, "")
    const total = countMeasures(cleaned)
    let measureIndex = 0
    return cleaned.replace(/<measure(?:\s[^>]*)?\/>|<measure(?:\s[^>]*)?>[\s\S]*?<\/measure>/g, (match) => {
        measureIndex++
        let out = match
        if (measureIndex === first && first > 1) out = `<pb/>${out}`
        if (measureIndex === last && last < total) out = `${out}<pb/>`
        return out
    })
}

function readTagAttr(attrs, name) {
    const escaped = name.replace(/\./g, "\\.")
    const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs)
    if (!match) return null
    return match[1] !== undefined ? match[1] : match[2]
}

function setTagAttr(attrs, name, value) {
    const escaped = name.replace(/\./g, "\\.")
    const pattern = new RegExp(`((?:^|\\s)${escaped}\\s*=\\s*)(?:"[^"]*"|'[^']*')`)
    if (pattern.test(attrs)) {
        return attrs.replace(pattern, `$1"${value}"`)
    }
    return `${attrs.replace(/\s+$/, "")} ${name}="${value}"`
}

function removeTagAttr(attrs, name) {
    const escaped = name.replace(/\./g, "\\.")
    const pattern = new RegExp(`\\s+${escaped}\\s*=\\s*(?:"[^"]*"|'[^']*')`, "g")
    return attrs.replace(pattern, "")
}

function extractMeter(attrs, isElement) {
    const count = readTagAttr(attrs, isElement ? "count" : "meter.count")
    const unit = readTagAttr(attrs, isElement ? "unit" : "meter.unit")
    const sym = readTagAttr(attrs, isElement ? "sym" : "meter.sym")
    if (count === null && unit === null && sym === null) return null
    return { count, unit, sym }
}

function formatMeterKey(meter) {
    if (!meter) return null
    return `${meter.count ?? ""}|${meter.unit ?? ""}|${meter.sym ?? ""}`
}

function writeMeterAttrs(attrs, meter, isElement) {
    const countName = isElement ? "count" : "meter.count"
    const unitName = isElement ? "unit" : "meter.unit"
    const symName = isElement ? "sym" : "meter.sym"
    let updated = attrs
    updated = meter.count !== null ? setTagAttr(updated, countName, meter.count) : removeTagAttr(updated, countName)
    updated = meter.unit !== null ? setTagAttr(updated, unitName, meter.unit) : removeTagAttr(updated, unitName)
    updated = meter.sym !== null ? setTagAttr(updated, symName, meter.sym) : removeTagAttr(updated, symName)
    return updated
}

export function getActiveMeterAtMeasure(mei, targetMeasure) {
    if (typeof mei !== "string" || !Number.isFinite(targetMeasure) || targetMeasure < 1) return null

    const tagRe = /<(\/?)(scoreDef|staffDef|meterSig|measure)\b([^>]*?)(\/?)>/g
    let measureIndex = 0
    let activeMeter = null
    let match

    while ((match = tagRe.exec(mei)) !== null) {
        const [, closingSlash, tagName, attrs] = match
        if (tagName === "measure") {
            if (closingSlash) continue
            measureIndex++
            if (measureIndex === targetMeasure) return activeMeter
            continue
        }

        if (closingSlash) continue

        const meter = extractMeter(attrs, tagName === "meterSig")
        if (meter !== null) {
            activeMeter = meter
        }
    }

    return null
}

export function applyInitialMeter(mei, meter) {
    if (typeof mei !== "string" || !meter) return mei
    return mei.replace(/<scoreDef\b[^>]*\/>|<scoreDef\b[^>]*>[\s\S]*?<\/scoreDef>/, (block) => {
        let updatedExisting = false
        let updatedBlock = block
            .replace(/<(scoreDef|staffDef)\b([^>]*?)(\/?)>/g, (tag, name, attrs, slash) => {
                if (!/\bmeter\.(?:count|unit|sym)=(?:"[^"]*"|'[^']*')/.test(attrs)) return tag
                updatedExisting = true
                return `<${name}${writeMeterAttrs(attrs, meter, false)}${slash}>`
            })
            .replace(/<meterSig\b([^>]*?)(\/?)>/g, (_tag, attrs, slash) => {
                updatedExisting = true
                return `<meterSig${writeMeterAttrs(attrs, meter, true)}${slash}>`
            })

        if (!updatedExisting) {
            updatedBlock = updatedBlock.replace(/^<scoreDef\b([^>]*?)(\/?)>/, (_tag, attrs, slash) => `<scoreDef${writeMeterAttrs(attrs, meter, false)}${slash}>`)
        }
        return updatedBlock
    })
}

export function hasMeterChangeAtMeasure(mei, targetMeasure) {
    if (typeof mei !== "string" || !Number.isFinite(targetMeasure) || targetMeasure <= 1) return false

    const tagRe = /<(\/?)(scoreDef|staffDef|meterSig|measure)\b([^>]*?)(\/?)>/g
    let measureIndex = 0
    let insideMeasure = false
    let activeMeter = null
    let meterBeforeTarget = null
    let meterDeclaredAtTarget = null
    let match

    while ((match = tagRe.exec(mei)) !== null) {
        const [, closingSlash, tagName, attrs, selfSlash] = match
        if (tagName === "measure") {
            if (closingSlash) {
                insideMeasure = false
                if (measureIndex === targetMeasure - 1) meterBeforeTarget = activeMeter
                continue
            }
            measureIndex++
            if (measureIndex === targetMeasure) {
                return meterDeclaredAtTarget !== null && meterDeclaredAtTarget !== meterBeforeTarget
            }
            if (selfSlash) {
                insideMeasure = false
                if (measureIndex === targetMeasure - 1) meterBeforeTarget = activeMeter
            } else {
                insideMeasure = true
            }
            continue
        }

        if (closingSlash) continue

        const signature = formatMeterKey(extractMeter(attrs, tagName === "meterSig"))
        if (signature !== null) {
            activeMeter = signature
            if (!insideMeasure && measureIndex === targetMeasure - 1) {
                meterDeclaredAtTarget = signature
            }
        }
    }

    return false
}

export function hideInitialMeter(mei) {
    if (typeof mei !== "string") return mei
    return mei.replace(/<scoreDef\b[^>]*\/>|<scoreDef\b[^>]*>[\s\S]*?<\/scoreDef>/, (block) =>
        block
            .replace(/<(scoreDef|staffDef)\b([^>]*?)(\/?)>/g, (tag, name, attrs, slash) => {
                if (!/\bmeter\.(?:count|unit|sym)=(?:"[^"]*"|'[^']*')/.test(attrs)) return tag
                return `<${name}${setTagAttr(attrs, "meter.visible", "false")}${slash}>`
            })
            .replace(/<meterSig\b([^>]*?)(\/?)>/g, (_tag, attrs, slash) => `<meterSig${setTagAttr(attrs, "visible", "false")}${slash}>`)
    )
}

export function hideMeasureNumbers(mei) {
    if (typeof mei !== "string") return mei
    return mei.replace(/<scoreDef\b([^>]*?)(\/?)>/g, (_tag, attrs, slash) => `<scoreDef${setTagAttr(attrs, "mnum.visible", "false")}${slash}>`).replace(/<mNum(?:\s[^>]*)?\/>|<mNum(?:\s[^>]*)?>[\s\S]*?<\/mNum>/g, "")
}

const TRANSPOSE_INTERVALS = {
    1: [
        { name: "m2", fifths: -5 },
        { name: "A1", fifths: 7 }
    ],
    2: [
        { name: "M2", fifths: 2 },
        { name: "d3", fifths: -10 }
    ],
    3: [
        { name: "m3", fifths: -3 },
        { name: "A2", fifths: 9 }
    ],
    4: [
        { name: "M3", fifths: 4 },
        { name: "d4", fifths: -8 }
    ],
    5: [
        { name: "P4", fifths: -1 },
        { name: "A3", fifths: 11 }
    ],
    6: [
        { name: "A4", fifths: 6 },
        { name: "d5", fifths: -6 }
    ],
    7: [
        { name: "P5", fifths: 1 },
        { name: "d6", fifths: -11 }
    ],
    8: [
        { name: "m6", fifths: -4 },
        { name: "A5", fifths: 8 }
    ],
    9: [
        { name: "M6", fifths: 3 },
        { name: "d7", fifths: -9 }
    ],
    10: [
        { name: "m7", fifths: -2 },
        { name: "A6", fifths: 10 }
    ],
    11: [
        { name: "M7", fifths: 5 },
        { name: "d8", fifths: -7 }
    ]
}

export function parseKeySigFifths(value) {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (trimmed === "0") return 0
    const match = /^(\d+)([sf])$/i.exec(trimmed)
    if (!match) return null
    const count = Number(match[1])
    if (!Number.isFinite(count)) return null
    if (count === 0) return 0
    return match[2].toLowerCase() === "s" ? count : -count
}

export function extractKeySignatures(mei) {
    if (typeof mei !== "string") return []
    const keys = []
    const tagRe = /<(scoreDef|staffDef|keySig)\b([^>]*?)\/?>/g
    let match
    while ((match = tagRe.exec(mei)) !== null) {
        const [, tagName, attrs] = match
        const raw = tagName === "keySig" ? readTagAttr(attrs, "sig") : (readTagAttr(attrs, "keysig") ?? readTagAttr(attrs, "key.sig"))
        const fifths = parseKeySigFifths(raw)
        if (fifths !== null) keys.push(fifths)
    }
    return keys
}

export function chooseTransposeInterval(mei, semitones) {
    if (typeof semitones !== "number" || !Number.isInteger(semitones) || semitones < -11 || semitones > 11 || semitones === 0) return ""

    const pair = TRANSPOSE_INTERVALS[Math.abs(semitones)]
    if (!pair) return ""

    const sign = semitones > 0 ? 1 : -1
    const candidates = pair.map(({ name, fifths }) => ({
        name: sign > 0 ? name : `-${name}`,
        fifths: fifths * sign
    }))

    const parsedKeys = extractKeySignatures(mei)
    const keys = parsedKeys.length ? parsedKeys : [0]

    const score = (candidate) => {
        let maxAccids = 0
        for (const key of keys) {
            const accids = Math.abs(key + candidate.fifths)
            if (accids > maxAccids) maxAccids = accids
        }
        return { maxAccids, firstAccids: Math.abs(keys[0] + candidate.fifths) }
    }

    const first = candidates[0]
    const second = candidates[1]
    const firstScore = score(first)
    const secondScore = score(second)

    if (firstScore.maxAccids !== secondScore.maxAccids) {
        return firstScore.maxAccids < secondScore.maxAccids ? first.name : second.name
    }
    if (firstScore.firstAccids !== secondScore.firstAccids) {
        return firstScore.firstAccids < secondScore.firstAccids ? first.name : second.name
    }
    // For ±6 both spellings have |fifths| === 6; prefer the flatward spelling so +6 and -6 give the same key signature
    if (Math.abs(first.fifths) === Math.abs(second.fifths)) {
        return first.fifths < second.fifths ? first.name : second.name
    }
    return first.name
}

function hasUnsafeCssReference(raw) {
    const decoded = decodeXmlEntities(raw)
    if (decoded.includes("\\")) return true

    const pattern = /url\(\s*([^)]*)\)?/gi
    let match
    while ((match = pattern.exec(decoded)) !== null) {
        let target = match[1].trim()
        if ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'"))) {
            target = target.slice(1, -1).trim()
        } else if (target.startsWith('"') || target.startsWith("'")) {
            target = target.slice(1).trim()
        }
        if (!target.startsWith("#")) return true
    }

    return false
}

export function sanitizeSvg(svg) {
    if (typeof svg !== "string") return ""

    const withCleanStyles = svg.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, content) => {
        const decoded = decodeXmlEntities(content)
        if (decoded.includes("\\") || /url\(/i.test(decoded)) {
            return `<style${attrs}></style>`
        }
        return match
    })

    return withCleanStyles.replace(/<([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^"'<>])*)>/g, (tagMatch, tagName, rest) => {
        if (!rest || !rest.includes("=")) return tagMatch
        if (!rest.includes("\\") && !rest.includes("&") && !/url\(/i.test(rest)) return tagMatch

        const selfClose = rest.endsWith("/") ? "/" : ""
        const attrPart = selfClose ? rest.slice(0, -1) : rest
        const cleanedAttrs = attrPart.replace(/\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g, (attrMatch, _name, dq, sq, bare) => {
            const value = dq !== undefined ? dq : sq !== undefined ? sq : bare || ""
            return hasUnsafeCssReference(value) ? "" : attrMatch
        })
        return `<${tagName}${cleanedAttrs}${selfClose}>`
    })
}

export function parseSvgViewBox(svg) {
    if (typeof svg !== "string") return null
    const rootMatch = svg.match(/<svg\b[^>]*>/i)
    if (!rootMatch) return null
    const viewBoxMatch = rootMatch[0].match(/\bviewBox=["']([^"']+)["']/i)
    if (!viewBoxMatch) return null
    const parts = viewBoxMatch[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number)
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
    const width = parts[2]
    const height = parts[3]
    if (width <= 0 || height < 0) return null
    return { width, height }
}

// marginRight is the right page margin the drawing was made with, when it differs from the left one
export function measureSvgWidth(svg, marginRight) {
    if (typeof svg !== "string") return { fits: true, neededWidth: null }

    const innerSvgMatch = svg.match(/<svg\b[^>]*\bclass=["'][^"']*\bdefinition-scale\b[^"']*["'][^>]*>/i)
    if (!innerSvgMatch) return { fits: true, neededWidth: null }

    const vbMatch = innerSvgMatch[0].match(/\bviewBox=["']([^"']+)["']/i)
    if (!vbMatch) return { fits: true, neededWidth: null }

    const vbParts = vbMatch[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number)
    if (vbParts.length !== 4 || vbParts.some((n) => !Number.isFinite(n)) || vbParts[2] <= 0) {
        return { fits: true, neededWidth: null }
    }
    const innerWidth = vbParts[2]

    const marginTagMatch = svg.match(/<g\b[^>]*\bclass=["'][^"']*\bpage-margin\b[^"']*["'][^>]*>/i)
    if (!marginTagMatch) return { fits: true, neededWidth: null }

    const translateMatch = marginTagMatch[0].match(/\btransform=["'][^"']*translate\(\s*(-?\d+(?:\.\d+)?)/i)
    if (!translateMatch) return { fits: true, neededWidth: null }

    const marginX = Number(translateMatch[1])
    if (!Number.isFinite(marginX) || marginX < 0) return { fits: true, neededWidth: null }

    const outerBox = parseSvgViewBox(svg)
    const unitScale = outerBox && outerBox.width > 0 ? innerWidth / outerBox.width : 10
    const marginRightX = typeof marginRight === "number" && Number.isFinite(marginRight) && marginRight >= 0 ? marginRight * unitScale : marginX

    const usableWidth = innerWidth - marginX - marginRightX
    const pageRight = innerWidth - marginX
    const body = svg.slice(marginTagMatch.index + marginTagMatch[0].length)

    // Verovio clamps staff lines to usableWidth (with ~1 unit per measure of rounding) while notes and stems can extend past them
    let maxStaffX = -Infinity
    const staffRe = /<g\b[^>]*\bclass=["'][^"']*\bstaff\b[^"']*["'][^>]*>([\s\S]*?)<g\b/gi
    let staffMatch
    while ((staffMatch = staffRe.exec(body)) !== null) {
        const lineRe = /\bd=["']M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+L\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)["']/gi
        let lineMatch
        while ((lineMatch = lineRe.exec(staffMatch[1])) !== null) {
            if (lineMatch[2] === lineMatch[4]) {
                const x2 = Math.max(Number(lineMatch[1]), Number(lineMatch[3]))
                if (x2 > maxStaffX) maxStaffX = x2
            }
        }
    }

    let maxContentX = -Infinity
    const translateRe = /\btransform=["'][^"']*translate\(\s*(-?\d+(?:\.\d+)?)/gi
    let transMatch
    while ((transMatch = translateRe.exec(body)) !== null) {
        const x = Number(transMatch[1])
        if (x > maxContentX) maxContentX = x
    }

    const pathRe = /[ML]\s*(-?\d+(?:\.\d+)?)\s+-?\d+(?:\.\d+)?/g
    let pathMatch
    while ((pathMatch = pathRe.exec(body)) !== null) {
        const x = Number(pathMatch[1])
        if (x > maxContentX) maxContentX = x
    }

    const neededWidth = Number.isFinite(maxContentX) ? Math.ceil((maxContentX + marginX + marginRightX) / unitScale) : null

    if (usableWidth <= 0) return { fits: false, neededWidth }
    if (Number.isFinite(maxStaffX) && maxStaffX > pageRight) return { fits: false, neededWidth }

    const rightLimit = Math.max(usableWidth, Number.isFinite(maxStaffX) ? maxStaffX : usableWidth) + WIDTH_OVERFLOW_TOLERANCE
    if (Number.isFinite(maxContentX) && maxContentX > rightLimit) return { fits: false, neededWidth }

    return { fits: true, neededWidth }
}

export function svgFitsWidth(svg, marginRight) {
    return measureSvgWidth(svg, marginRight).fits
}

function inspectLayout(rendered, pageWidth, targetRatio, marginRight) {
    const pages = typeof rendered.pages === "number" && Number.isFinite(rendered.pages) ? rendered.pages : (rendered.pageCount ?? 1)
    const box = parseSvgViewBox(rendered.svg)
    const actualRatio = box ? box.height / box.width : null
    const effectiveRatio = actualRatio !== null ? actualRatio * Math.max(1, pages) : null
    const widthCheck = measureSvgWidth(rendered.svg, marginRight)
    const fits = pages <= 1 && actualRatio !== null && actualRatio <= targetRatio && widthCheck.fits
    return {
        svg: rendered.svg,
        pageWidth,
        pages,
        actualRatio,
        effectiveRatio,
        widthFits: widthCheck.fits,
        neededWidth: widthCheck.neededWidth,
        fits
    }
}

function findCanonicalLayout(targetRatio, renderAt, options) {
    const { maxWidth, maxLayouts, tolerance, startTime, maxTimeMs, now, seed, marginRight } = options
    const startWidth = Math.min(CANONICAL_START_WIDTH, maxWidth)

    let canonicalLayouts = 0
    let newLayouts = 0
    let timedOut = false
    const tried = new Map()
    let low = 0
    let high = maxWidth + 1
    let best = null
    let widest = null

    const record = (entry) => {
        tried.set(entry.pageWidth, entry)
        if (!widest || entry.pageWidth > widest.pageWidth) widest = entry
        if (entry.fits && entry.pageWidth < high) {
            high = entry.pageWidth
            best = entry
        } else if (!entry.fits && entry.pageWidth > low) {
            low = entry.pageWidth
        }
        return entry
    }

    const tryWidth = (rawWidth) => {
        const width = Math.max(MIN_PAGE_WIDTH, Math.min(maxWidth, Math.round(rawWidth)))
        if (tried.has(width)) return tried.get(width)
        if (canonicalLayouts >= maxLayouts) return null
        if (newLayouts > 0 && now() - startTime >= maxTimeMs) {
            timedOut = true
            return null
        }

        canonicalLayouts++
        if (seed && seed.pageWidth === width) {
            return record(seed)
        }
        if (now() - startTime >= maxTimeMs) {
            timedOut = true
            canonicalLayouts--
            return null
        }

        newLayouts++
        return record(inspectLayout(renderAt(width), width, targetRatio, marginRight))
    }

    let current = tryWidth(startWidth)
    if (!current) {
        return {
            svg: seed ? seed.svg : "",
            pageWidth: seed ? seed.pageWidth : startWidth,
            pages: seed ? seed.pages : 1,
            fits: false,
            canonicalLayouts,
            newLayouts,
            timedOut
        }
    }

    for (let step = 0; step < 3; step++) {
        if (current.fits) {
            if (low > 0 && (high - low) / high <= tolerance) break
            if (current.actualRatio !== null && current.actualRatio >= targetRatio * 0.95) break
            if (current.pageWidth <= MIN_PAGE_WIDTH) break

            const rawEstimate = current.actualRatio !== null && current.actualRatio > 0 ? Math.round(current.pageWidth * Math.sqrt(current.actualRatio / targetRatio)) : Math.round(current.pageWidth * 0.5)
            const next = Math.max(Math.max(MIN_PAGE_WIDTH, low + 1), Math.min(high - 1, rawEstimate))
            if (next >= current.pageWidth || tried.has(next)) break

            const attempt = tryWidth(next)
            if (!attempt) break
            current = attempt
        } else {
            if (current.pageWidth >= maxWidth) break

            let estimate
            if (current.effectiveRatio !== null && current.effectiveRatio > targetRatio) {
                const bias = step === 0 ? 1.04 : 1.02
                estimate = Math.round(current.pageWidth * Math.sqrt(current.effectiveRatio / targetRatio) * bias)
            } else if (!current.widthFits && current.neededWidth && current.neededWidth > current.pageWidth) {
                estimate = Math.round(current.neededWidth * 1.15)
            } else {
                estimate = Math.round(current.pageWidth * 1.6)
            }

            let next = Math.max(Math.ceil(current.pageWidth * FIT_STEP_UP_FACTOR), estimate)
            if (high <= maxWidth) {
                if (next >= high) break
            } else {
                next = Math.min(maxWidth, next)
            }
            if (tried.has(next)) break

            const attempt = tryWidth(next)
            if (!attempt) break
            current = attempt
        }
    }

    while (canonicalLayouts < maxLayouts) {
        if (now() - startTime >= maxTimeMs) {
            timedOut = true
            break
        }

        if (!best) {
            if (widest.pageWidth >= maxWidth) break

            let next
            if (widest.effectiveRatio !== null && widest.effectiveRatio > targetRatio) {
                const estimate = Math.round(widest.pageWidth * Math.sqrt(widest.effectiveRatio / targetRatio) * 1.03)
                next = Math.max(Math.ceil(widest.pageWidth * FIT_STEP_UP_FACTOR), estimate)
            } else if (!widest.widthFits && widest.neededWidth && widest.neededWidth > widest.pageWidth) {
                next = Math.max(Math.ceil(widest.pageWidth * FIT_STEP_UP_FACTOR), Math.round(widest.neededWidth * 1.15))
            } else {
                next = Math.ceil(widest.pageWidth * 1.5)
            }
            next = Math.min(maxWidth, next)
            if (tried.has(next)) break
            if (!tryWidth(next)) break
        } else if (low > 0) {
            if ((high - low) / high <= tolerance) break
            if (best.actualRatio !== null && best.actualRatio >= targetRatio * 0.95 && (high - low) / high <= 0.1) break

            const mid = Math.round(Math.sqrt(low * high))
            if (mid <= low || mid >= high || tried.has(mid)) break
            if (!tryWidth(mid)) break
        } else {
            if (best.pageWidth <= MIN_PAGE_WIDTH) break
            if (best.actualRatio !== null && best.actualRatio >= targetRatio * 0.95) break

            const next = Math.max(MIN_PAGE_WIDTH, Math.round(high * 0.7))
            if (next >= high || tried.has(next)) break
            if (!tryWidth(next)) break
        }
    }

    const chosen = best || widest
    return {
        svg: chosen.svg,
        pageWidth: chosen.pageWidth,
        pages: chosen.pages,
        fits: chosen.fits,
        canonicalLayouts,
        newLayouts,
        timedOut
    }
}

export function findFittingLayout(preferredWidth, targetRatio, renderAt, options = {}) {
    const maxWidth = options.maxWidth ?? MAX_PAGE_WIDTH
    const maxLayouts = options.maxLayouts ?? MAX_FIT_LAYOUTS
    const maxTimeMs = options.maxTimeMs ?? MAX_FIT_TIME_MS
    const tolerance = options.tolerance ?? FIT_TOLERANCE
    const now = options.now ?? (() => Date.now())
    const cachedCanonical = options.canonical ?? null
    const marginRight = options.marginRight

    const startTime = now()
    const initialWidth = Math.max(MIN_PAGE_WIDTH, Math.min(maxWidth, Math.round(preferredWidth)))

    let layouts = 1
    const first = inspectLayout(renderAt(initialWidth), initialWidth, targetRatio, marginRight)
    if (first.fits) {
        return {
            svg: first.svg,
            pageWidth: first.pageWidth,
            pages: first.pages,
            fits: true,
            layouts,
            canonical: null
        }
    }

    let widest = first
    let canonical = cachedCanonical
    if (!canonical) {
        const canonicalStart = Math.min(CANONICAL_START_WIDTH, maxWidth)
        const canonicalBudget = maxLayouts >= 4 ? maxLayouts - 2 : Math.max(1, maxLayouts - 1)
        canonical = findCanonicalLayout(targetRatio, renderAt, {
            maxWidth,
            maxLayouts: canonicalBudget,
            tolerance,
            startTime,
            maxTimeMs,
            now,
            seed: initialWidth === canonicalStart ? first : null,
            marginRight
        })
        layouts += canonical.newLayouts
        if (canonical.pageWidth > widest.pageWidth) {
            widest = canonical
        }
    }

    if (canonical.fits) {
        if (canonical.pageWidth >= initialWidth) {
            return {
                svg: canonical.svg,
                pageWidth: canonical.pageWidth,
                pages: canonical.pages,
                fits: true,
                layouts,
                canonical
            }
        }

        // Irregular layout: preferred width overflowed even though it is already wider than the canonical width
        const canonicalCost = typeof canonical.canonicalLayouts === "number" ? canonical.canonicalLayouts : 0
        const maxStepUps = Math.max(0, maxLayouts - 1 - canonicalCost)
        let currentWidth = initialWidth
        for (let step = 0; step < maxStepUps; step++) {
            if (currentWidth >= maxWidth || layouts >= maxLayouts || now() - startTime >= maxTimeMs) break
            const nextWidth = Math.min(maxWidth, Math.max(currentWidth + 1, Math.round(currentWidth * FIT_STEP_UP_FACTOR)))
            if (nextWidth === currentWidth) break
            currentWidth = nextWidth
            layouts++
            const attempt = inspectLayout(renderAt(currentWidth), currentWidth, targetRatio, marginRight)
            if (attempt.pageWidth > widest.pageWidth) widest = attempt
            if (attempt.fits) {
                return {
                    svg: attempt.svg,
                    pageWidth: attempt.pageWidth,
                    pages: attempt.pages,
                    fits: true,
                    layouts,
                    canonical
                }
            }
        }

        return {
            svg: widest.svg,
            pageWidth: widest.pageWidth,
            pages: widest.pages,
            fits: false,
            layouts,
            canonical
        }
    }

    const fallback = canonical.pageWidth >= widest.pageWidth ? canonical : widest
    return {
        svg: fallback.svg,
        pageWidth: fallback.pageWidth,
        pages: fallback.pages,
        fits: false,
        layouts,
        canonical
    }
}

export function insertSystemBreaks(mei, rowStarts) {
    if (typeof mei !== "string") return mei
    const starts = new Set(Array.isArray(rowStarts) ? rowStarts : [])
    const cleaned = mei.replace(/<(sb|pb)(?:\s[^>]*)?\/>|<(sb|pb)(?:\s[^>]*)?>[\s\S]*?<\/\2>/g, "")
    let measureIndex = 0
    return cleaned.replace(/<measure(?=\s|>|\/)/g, (match) => {
        measureIndex++
        return measureIndex > 1 && starts.has(measureIndex) ? `<sb/>${match}` : match
    })
}

export function readSvgMeasureWidths(svg) {
    if (typeof svg !== "string") return []
    const widths = []
    const measureRe = /<g\b[^>]*\bclass=["'](?:[^"']*\s)?measure(?:\s[^"']*)?["'][^>]*>([\s\S]*?)(?=<g\b[^>]*\bclass=["'](?:[^"']*\s)?measure(?:\s[^"']*)?["']|$)/gi
    const staffRe = /<g\b[^>]*\bclass=["'](?:[^"']*\s)?staff(?:\s[^"']*)?["'][^>]*>([\s\S]*)/i
    const lineRe = /\bd=["']M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+L\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)["']/gi
    let measureMatch
    while ((measureMatch = measureRe.exec(svg)) !== null) {
        const staffMatch = staffRe.exec(measureMatch[1])
        const searchArea = staffMatch ? staffMatch[1] : measureMatch[1]
        lineRe.lastIndex = 0
        let lineMatch
        while ((lineMatch = lineRe.exec(searchArea)) !== null) {
            if (Number(lineMatch[2]) === Number(lineMatch[4])) {
                widths.push(Math.abs(Number(lineMatch[3]) - Number(lineMatch[1])))
                break
            }
        }
    }
    return widths
}

export function readSvgRowStarts(svg) {
    if (typeof svg !== "string") return []
    const starts = []
    const groupRe = /<g\b[^>]*\bclass=["'](?:[^"']*\s)?(system|measure)(?:\s[^"']*)?["'][^>]*>/gi
    let systemIndex = 0
    let measureIndex = 0
    let seenMeasureInSystem = false
    let match
    while ((match = groupRe.exec(svg)) !== null) {
        if (match[1].toLowerCase() === "system") {
            systemIndex++
            seenMeasureInSystem = false
        } else {
            measureIndex++
            if (systemIndex > 1 && !seenMeasureInSystem) {
                starts.push(measureIndex)
            }
            seenMeasureInSystem = true
        }
    }
    return starts
}

export function chooseRowStarts(plainWidths, startWidths, rowCount) {
    if (!Array.isArray(plainWidths) || !Array.isArray(startWidths)) return []
    const barCount = plainWidths.length
    if (barCount <= 1 || startWidths.length !== barCount) return []
    if (!Number.isInteger(rowCount) || rowCount <= 1) return []

    const rows = Math.min(rowCount, barCount)
    if (rows === barCount) {
        return Array.from({ length: barCount - 1 }, (_, i) => i + 2)
    }

    const prefix = [0]
    for (let i = 0; i < barCount; i++) {
        if (typeof plainWidths[i] !== "number" || !Number.isFinite(plainWidths[i]) || plainWidths[i] <= 0) return []
        if (typeof startWidths[i] !== "number" || !Number.isFinite(startWidths[i]) || startWidths[i] <= 0) return []
        prefix.push(prefix[i] + plainWidths[i])
    }

    const rowWidth = (start, end) => startWidths[start] + (prefix[end] - prefix[start + 1])

    const minMax = Array.from({ length: rows + 1 }, () => Array(barCount + 1).fill(Infinity))
    minMax[0][0] = 0
    for (let k = 1; k <= rows; k++) {
        const maxEnd = barCount - (rows - k)
        for (let end = k; end <= maxEnd; end++) {
            let best = Infinity
            for (let start = k - 1; start < end; start++) {
                const prev = minMax[k - 1][start]
                if (prev === Infinity) continue
                const width = Math.max(prev, rowWidth(start, end))
                if (width < best) best = width
            }
            minMax[k][end] = best
        }
    }
    const bestMax = minMax[rows][barCount]
    if (!Number.isFinite(bestMax)) return []

    const maxMin = Array.from({ length: rows + 1 }, () => Array(barCount + 1).fill(-Infinity))
    maxMin[0][0] = Infinity
    for (let k = 1; k <= rows; k++) {
        const maxEnd = barCount - (rows - k)
        for (let end = k; end <= maxEnd; end++) {
            let best = -Infinity
            for (let start = k - 1; start < end; start++) {
                const prev = maxMin[k - 1][start]
                if (prev === -Infinity) continue
                const width = rowWidth(start, end)
                if (width > bestMax) continue
                const narrowest = Math.min(prev, width)
                if (narrowest > best) best = narrowest
            }
            maxMin[k][end] = best
        }
    }
    const bestMin = maxMin[rows][barCount]
    if (!Number.isFinite(bestMin)) return []

    const canFinish = Array.from({ length: rows + 1 }, () => Array(barCount + 1).fill(false))
    canFinish[0][barCount] = true
    for (let remaining = 1; remaining <= rows; remaining++) {
        for (let start = 0; start <= barCount - remaining; start++) {
            for (let end = start + 1; end <= barCount - (remaining - 1); end++) {
                if (!canFinish[remaining - 1][end]) continue
                const width = rowWidth(start, end)
                if (width >= bestMin && width <= bestMax) {
                    canFinish[remaining][start] = true
                    break
                }
            }
        }
    }

    const starts = []
    let pos = 0
    for (let row = 1; row < rows; row++) {
        const remaining = rows - row
        for (let end = pos + 1; end <= barCount - remaining; end++) {
            const width = rowWidth(pos, end)
            if (width >= bestMin && width <= bestMax && canFinish[remaining][end]) {
                starts.push(end + 1)
                pos = end
                break
            }
        }
    }
    return starts
}

// The width of each row when the bars are cut into rows at rowStarts. plainWidths holds the width of every bar and
// startWidths its width when it starts a row.
export function getRowWidths(plainWidths, startWidths, rowStarts) {
    const bounds = [1, ...rowStarts, plainWidths.length + 1]
    return bounds.slice(0, -1).map((start, row) => {
        let width = startWidths[start - 1]
        for (let bar = start + 1; bar < bounds[row + 1]; bar++) width += plainWidths[bar - 1]
        return width
    })
}

// The least gap between two words for a words size in percent. Verovio lets large words touch unless the gap grows
// much faster than the words, so it reaches its full value at 150 and stays there.
export function calculateLyricWordSpace(lyricSize, minWordSpace = 1.2, maxWordSpace = 3.2) {
    if (typeof lyricSize !== "number" || !Number.isFinite(lyricSize) || lyricSize <= 100) return minWordSpace
    if (lyricSize >= 150) return maxWordSpace
    const ratio = (lyricSize - 100) / (150 - 100)
    return Math.round((minWordSpace + (maxWordSpace - minWordSpace) * ratio) * 1e6) / 1e6
}
