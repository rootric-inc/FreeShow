export const DEFAULT_PAGE_WIDTH = 2100
export const MIN_PAGE_WIDTH = 100
export const MAX_PAGE_WIDTH = 100000
export const MAX_FIT_LAYOUTS = 12
export const FIT_TOLERANCE = 0.03
export const FIT_STEP_FACTOR = 1.6

export function buildFitWidthGrid(minWidth = MIN_PAGE_WIDTH, maxWidth = MAX_PAGE_WIDTH, factor = FIT_STEP_FACTOR) {
    const widths = []
    let current = minWidth
    while (current < maxWidth) {
        widths.push(current)
        const next = Math.round(current * factor)
        current = next > current ? Math.min(maxWidth, next) : maxWidth
    }
    widths.push(maxWidth)
    return widths
}

export const FIT_WIDTH_GRID = buildFitWidthGrid()

export function decodeXmlEntities(text) {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_match, entity) => {
        if (entity === "amp") return "&"
        if (entity === "lt") return "<"
        if (entity === "gt") return ">"
        if (entity === "quot") return '"'
        if (entity === "apos") return "'"
        if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16))
        if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10))
        return `&${entity};`
    })
}

export function extractTitle(mei) {
    const headMatch = mei.match(/<meiHead(?:\s[^>]*)?>([\s\S]*?)<\/meiHead>/)
    if (!headMatch) return ""
    const titleMatch = headMatch[1].match(/<title\b[^>]*>([\s\S]*?)<\/title>/)
    if (!titleMatch) return ""
    const plain = titleMatch[1].replace(/<[^>]+>/g, " ")
    return decodeXmlEntities(plain).replace(/\s+/g, " ").trim()
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

export function sanitizeSvgUrls(svg) {
    return svg.replace(/url\(([^)]*)\)/gi, (match, inner) => {
        const trimmed = inner.trim()
        const unquoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")) ? trimmed.slice(1, -1).trim() : trimmed
        return unquoted.startsWith("#") ? match : "none"
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

function layoutFitsRatio(attempt, targetRatio) {
    if (attempt.pageCount > 1) return false
    const box = parseSvgViewBox(attempt.svg)
    if (!box) return false
    return box.height / box.width <= targetRatio
}

export function findFittingLayout(startWidth, targetRatio, renderAt, options = {}) {
    const maxWidth = options.maxWidth ?? MAX_PAGE_WIDTH
    const maxLayouts = options.maxLayouts ?? MAX_FIT_LAYOUTS
    const tolerance = options.tolerance ?? FIT_TOLERANCE
    const grid = options.grid ?? (maxWidth === MAX_PAGE_WIDTH ? FIT_WIDTH_GRID : buildFitWidthGrid(MIN_PAGE_WIDTH, maxWidth, FIT_STEP_FACTOR))

    let layouts = 0
    const tryWidth = (pageWidth) => {
        layouts++
        const rendered = renderAt(pageWidth)
        return { svg: rendered.svg, pageWidth, pageCount: rendered.pageCount }
    }

    const initialWidth = Math.max(MIN_PAGE_WIDTH, Math.min(maxWidth, Math.round(startWidth)))
    const first = tryWidth(initialWidth)
    if (layoutFitsRatio(first, targetRatio)) {
        return { ...first, truncated: false, layouts }
    }

    let gridIndex = 0
    while (gridIndex < grid.length && grid[gridIndex] <= initialWidth) {
        gridIndex++
    }

    // Use a fixed width grid so different starting sizes that all overflow land on the same bracket
    let prevGridWidth = gridIndex > 0 ? grid[gridIndex - 1] : MIN_PAGE_WIDTH
    let lastAttempt = first
    let best = null
    let low = prevGridWidth
    let high = maxWidth

    while (layouts < maxLayouts && gridIndex < grid.length) {
        const candidateWidth = grid[gridIndex]
        const attempt = tryWidth(candidateWidth)
        if (layoutFitsRatio(attempt, targetRatio)) {
            best = attempt
            low = prevGridWidth
            high = candidateWidth
            break
        }
        lastAttempt = attempt
        prevGridWidth = candidateWidth
        gridIndex++
    }

    if (!best) {
        return { ...lastAttempt, truncated: true, layouts }
    }

    const knownNoFit = Math.max(low, initialWidth)
    while (layouts < maxLayouts && (high - low) / high > tolerance) {
        const mid = Math.round((low + high) / 2)
        if (mid <= low || mid >= high) break
        if (mid <= knownNoFit) {
            low = mid
            continue
        }

        const attempt = tryWidth(mid)
        if (layoutFitsRatio(attempt, targetRatio)) {
            best = attempt
            high = mid
        } else {
            low = mid
        }
    }

    return { ...best, truncated: false, layouts }
}
