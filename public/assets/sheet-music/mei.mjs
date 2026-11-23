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

export function measureSvgWidth(svg) {
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

    const usableWidth = innerWidth - 2 * marginX
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

    const outerBox = parseSvgViewBox(svg)
    const unitScale = outerBox && outerBox.width > 0 ? innerWidth / outerBox.width : 10
    const neededWidth = Number.isFinite(maxContentX) ? Math.ceil((maxContentX + 2 * marginX) / unitScale) : null

    if (usableWidth <= 0) return { fits: false, neededWidth }
    if (Number.isFinite(maxStaffX) && maxStaffX > pageRight) return { fits: false, neededWidth }

    const rightLimit = Math.max(usableWidth, Number.isFinite(maxStaffX) ? maxStaffX : usableWidth) + WIDTH_OVERFLOW_TOLERANCE
    if (Number.isFinite(maxContentX) && maxContentX > rightLimit) return { fits: false, neededWidth }

    return { fits: true, neededWidth }
}

export function svgFitsWidth(svg) {
    return measureSvgWidth(svg).fits
}

function inspectLayout(rendered, pageWidth, targetRatio) {
    const pages = typeof rendered.pages === "number" && Number.isFinite(rendered.pages) ? rendered.pages : (rendered.pageCount ?? 1)
    const box = parseSvgViewBox(rendered.svg)
    const actualRatio = box ? box.height / box.width : null
    const effectiveRatio = actualRatio !== null ? actualRatio * Math.max(1, pages) : null
    const widthCheck = measureSvgWidth(rendered.svg)
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
    const { maxWidth, maxLayouts, tolerance, startTime, maxTimeMs, now, seed } = options
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
        return record(inspectLayout(renderAt(width), width, targetRatio))
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

    const startTime = now()
    const initialWidth = Math.max(MIN_PAGE_WIDTH, Math.min(maxWidth, Math.round(preferredWidth)))

    let layouts = 1
    const first = inspectLayout(renderAt(initialWidth), initialWidth, targetRatio)
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
            seed: initialWidth === canonicalStart ? first : null
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
            const attempt = inspectLayout(renderAt(currentWidth), currentWidth, targetRatio)
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
