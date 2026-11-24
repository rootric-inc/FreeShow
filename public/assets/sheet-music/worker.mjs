import createVerovioModule from "./verovio-module.mjs"
import { VerovioToolkit, enableLogToBuffer } from "./verovio.mjs"
import { DEFAULT_PAGE_WIDTH, MAX_PAGE_WIDTH, MIN_PAGE_WIDTH, applyInitialMeter, calculateLyricWordSpace, chooseRowStarts, chooseTransposeInterval, countMeasures, extractHeaderMetadata, findFittingLayout, getActiveMeterAtMeasure, getRowWidths, hasMeterChangeAtMeasure, hideInitialMeter, hideMeasureNumbers, insertSlicePageBreaks, insertSystemBreaks, normalizeMei, parseSvgViewBox, readSvgMeasureWidths, readSvgRowStarts, sanitizeSvg, svgFitsWidth } from "./mei.mjs"

const RENDER_OPTIONS = {
    inputFrom: "mei",
    breaks: "auto",
    minLastJustification: 0,
    adjustPageHeight: true,
    pageHeight: 60000,
    svgViewBox: true,
    header: "none",
    footer: "none",
    scale: 100,
    pageMarginTop: 50,
    pageMarginBottom: 50,
    pageMarginLeft: 50,
    pageMarginRight: 50
}

const MULTI_ROW_MIN_LAST_JUSTIFICATION = 0.8
const MEASURE_PAGE_WIDTH = 60000
// The last row is stretched to the full width when it is at least this share of the widest row
const MIN_LAST_ROW_SHARE = 0.5
const MAX_EVEN_ROW_GROWTH = 1.02
// Even rows may widen the page by this much to keep the drawing inside its box, which makes everything that much smaller
const MAX_EVEN_ROWS_WIDENING = 1.02
const DEFAULT_LYRIC_SIZE = 100
const MIN_LYRIC_SIZE = 100
const MAX_LYRIC_SIZE = 175
const VEROVIO_DEFAULT_LYRIC_SIZE = 4.5
const VEROVIO_MAX_LYRIC_SIZE = 8.0
const VEROVIO_DEFAULT_LYRIC_WORD_SPACE = 1.2
const VEROVIO_MAX_LYRIC_WORD_SPACE = 3.2
// Small margins give large words more of the box. A brace or bracket hangs left of the staves and needs the full
// left margin, and a last syllable can hang past the last note, so the right margin stays a little wider.
const LARGE_LYRIC_PAGE_MARGIN = 10
const LARGE_LYRIC_RIGHT_MARGIN = 30
const GROUP_SYMBOL_LEFT_MARGIN = 50
const LARGE_LYRIC_SPACING_STAFF = 4
const LARGE_LYRIC_SPACING_BRACE_GROUP = 4

export function getLyricRenderOptions(lyricSize, hasGroupSymbol = false) {
    const lyricSizePercent = typeof lyricSize === "number" && Number.isFinite(lyricSize) ? Math.min(MAX_LYRIC_SIZE, Math.max(MIN_LYRIC_SIZE, lyricSize)) : DEFAULT_LYRIC_SIZE
    if (lyricSizePercent <= DEFAULT_LYRIC_SIZE) return {}
    return {
        lyricSize: Math.min(VEROVIO_MAX_LYRIC_SIZE, (VEROVIO_DEFAULT_LYRIC_SIZE * lyricSizePercent) / 100),
        lyricWordSpace: calculateLyricWordSpace(lyricSizePercent, VEROVIO_DEFAULT_LYRIC_WORD_SPACE, VEROVIO_MAX_LYRIC_WORD_SPACE),
        pageMarginTop: LARGE_LYRIC_PAGE_MARGIN,
        pageMarginBottom: LARGE_LYRIC_PAGE_MARGIN,
        pageMarginLeft: hasGroupSymbol ? GROUP_SYMBOL_LEFT_MARGIN : LARGE_LYRIC_PAGE_MARGIN,
        pageMarginRight: LARGE_LYRIC_RIGHT_MARGIN,
        spacingStaff: LARGE_LYRIC_SPACING_STAFF,
        spacingBraceGroup: LARGE_LYRIC_SPACING_BRACE_GROUP
    }
}

// True when the music draws a brace or bracket in front of its staves. A group with no symbol named draws none.
function hasGroupSymbol(mei) {
    return /<(?:grpSym|staffGrp)\b[^>]*\bsymbol="(?!none")/.test(mei)
}

function countSvgSystems(svg) {
    const matches = svg.match(/\bclass="[^"]*\bsystem\b[^"]*"/g)
    return matches ? matches.length : 0
}

const MAX_CANONICAL_MEMO = 8
const canonicalMemo = new Map()

let toolkitPromise = null
let lastRenderLayouts = 0
let lastRenderLog = ""

export function getLastRenderLayouts() {
    return lastRenderLayouts
}

export function getLastRenderLog() {
    return lastRenderLog
}

function getToolkit() {
    if (!toolkitPromise) {
        toolkitPromise = createVerovioModule()
            .then((mod) => {
                enableLogToBuffer(true, mod)
                return new VerovioToolkit(mod)
            })
            .catch((err) => {
                toolkitPromise = null
                throw err
            })
    }
    return toolkitPromise
}

function getCanonicalMemo(key) {
    const entry = canonicalMemo.get(key)
    if (!entry) return null
    canonicalMemo.delete(key)
    canonicalMemo.set(key, entry)
    return entry
}

function setCanonicalMemo(key, entry) {
    if (canonicalMemo.has(key)) {
        canonicalMemo.delete(key)
    } else if (canonicalMemo.size >= MAX_CANONICAL_MEMO) {
        const oldest = canonicalMemo.keys().next().value
        if (oldest !== undefined) canonicalMemo.delete(oldest)
    }
    canonicalMemo.set(key, entry)
}

function formatError(err, fallback) {
    if (err instanceof Error && err.message) return err.message
    if (typeof err === "string" && err.trim()) return err.trim()
    return fallback
}

function createWorkerError(code, message) {
    const err = new Error(message)
    err.code = code
    return err
}

function getErrorCode(err, messageType) {
    if (err && typeof err === "object" && typeof err.code === "string" && err.code) return err.code
    return messageType === "render" ? "render_failed" : "load_failed"
}

export async function handleMessage(message) {
    const { type } = message || {}
    const tk = await getToolkit()

    if (type === "load") {
        const { text, base64 } = message
        try {
            tk.resetOptions()
            // Verovio's resetOptions defaults inputFrom to "mei", so restore auto-detection for MusicXML/MEI
            tk.setOptions({ inputFrom: "auto" })

            let loaded = 0
            if (typeof base64 === "string" && base64.length > 0) {
                loaded = tk.loadZipDataBase64(base64)
            } else if (typeof text === "string" && text.length > 0) {
                loaded = tk.loadData(text)
            } else {
                throw createWorkerError("load_failed", "No music data provided")
            }

            if (!loaded) throw createWorkerError("load_failed", "Could not read music file")

            const rawMei = tk.getMEI({ removeIds: true })
            if (!rawMei) throw createWorkerError("load_failed", "Could not extract music data")

            const { title, composer, lyricist, copyright } = extractHeaderMetadata(rawMei)
            const mei = normalizeMei(rawMei)
            const measures = countMeasures(mei)
            if (measures === 0) throw createWorkerError("empty_music", "No music measures found")

            return { mei, title, composer, lyricist, copyright, measures }
        } catch (err) {
            if (err && typeof err === "object" && typeof err.code === "string") throw err
            throw createWorkerError("load_failed", formatError(err, "Could not read music file"))
        }
    }

    if (type === "slice") {
        const { mei, first, last } = message
        if (typeof mei !== "string" || !mei.trim()) throw createWorkerError("load_failed", "No music data provided")

        const totalMeasures = countMeasures(mei)
        if (totalMeasures === 0) throw createWorkerError("empty_music", "No music measures found")

        const startMeasure = Math.floor(Number(first))
        const endMeasure = Math.floor(Number(last))
        if (!Number.isFinite(startMeasure) || !Number.isFinite(endMeasure) || startMeasure < 1 || endMeasure < startMeasure || startMeasure > totalMeasures) {
            throw createWorkerError("load_failed", "Invalid measure range")
        }

        const clampedLast = Math.min(endMeasure, totalMeasures)

        try {
            const markedMei = insertSlicePageBreaks(mei, startMeasure, clampedLast)
            tk.resetOptions()
            tk.resetXmlIdSeed(1)
            tk.setOptions({ inputFrom: "mei", breaks: "encoded" })
            const loaded = tk.loadData(markedMei)
            if (!loaded) throw createWorkerError("load_failed", "Could not slice music")

            const pageNo = startMeasure > 1 ? 2 : 1
            const rawSlice = tk.getMEI({ pageNo, removeIds: true })
            if (!rawSlice) throw createWorkerError("load_failed", "Could not extract music slice")

            const activeMeter = startMeasure > 1 ? getActiveMeterAtMeasure(mei, startMeasure) : null
            const keepMeterVisible = startMeasure === 1 || hasMeterChangeAtMeasure(mei, startMeasure)
            const withActiveMeter = activeMeter ? applyInitialMeter(rawSlice, activeMeter) : rawSlice
            const adjustedMeter = keepMeterVisible ? withActiveMeter : hideInitialMeter(withActiveMeter)
            const slicedMei = normalizeMei(adjustedMeter)
            const measures = countMeasures(slicedMei)
            if (measures === 0) throw createWorkerError("empty_music", "No music measures found")

            return { mei: slicedMei, measures }
        } catch (err) {
            if (err && typeof err === "object" && typeof err.code === "string") throw err
            throw createWorkerError("load_failed", formatError(err, "Could not slice music"))
        }
    }

    if (type === "render") {
        const { mei, pageWidth, ratio, showMeasureNumbers, transpose, lyricSize } = message
        if (typeof mei !== "string" || !mei.trim()) throw createWorkerError("render_failed", "No music data to render")

        const parsedWidth = Math.round(Number(pageWidth) || DEFAULT_PAGE_WIDTH)
        const clampedWidth = Math.max(MIN_PAGE_WIDTH, Math.min(MAX_PAGE_WIDTH, parsedWidth))
        const targetRatio = typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : null
        const drawMeasureNumbers = Boolean(showMeasureNumbers)
        const transposeSemitones = typeof transpose === "number" && Number.isInteger(transpose) && transpose >= -11 && transpose <= 11 && transpose !== 0 ? transpose : 0
        const lyricSizePercent = typeof lyricSize === "number" && Number.isFinite(lyricSize) ? Math.min(MAX_LYRIC_SIZE, Math.max(MIN_LYRIC_SIZE, lyricSize)) : DEFAULT_LYRIC_SIZE
        const lyricOptions = getLyricRenderOptions(lyricSizePercent, hasGroupSymbol(mei))

        const renderMei = drawMeasureNumbers ? mei : hideMeasureNumbers(mei)
        const transposeInterval = transposeSemitones !== 0 ? chooseTransposeInterval(renderMei, transposeSemitones) : ""

        try {
            let layoutCount = 0
            const runLayout = (width, minLastJustification, overrides = null) => {
                layoutCount++
                // Reload from scratch with a fixed id seed so layouts never depend on earlier widths or call history
                tk.resetOptions()
                tk.resetXmlIdSeed(1)
                const { mei: meiInput = renderMei, ...extraOptions } = overrides || {}
                const renderOptions = { ...RENDER_OPTIONS, ...lyricOptions, minLastJustification, pageWidth: width, ...extraOptions }
                if (drawMeasureNumbers) renderOptions.mnumInterval = 1
                if (transposeInterval) renderOptions.transpose = transposeInterval
                tk.setOptions(renderOptions)
                tk.getLog()
                const loaded = tk.loadData(meiInput)
                if (!loaded) {
                    lastRenderLog = tk.getLog().trim()
                    throw createWorkerError("render_failed", "Could not render music")
                }

                const svg = tk.renderToSVG(1)
                lastRenderLog = tk.getLog().trim()
                if (!svg) throw createWorkerError("render_failed", "Could not render music")
                const pages = tk.getPageCount()
                return { svg, pages }
            }

            const renderSearchAt = (width) => runLayout(width, RENDER_OPTIONS.minLastJustification)

            // Draws the music with its rows cut at rowStarts (or all on one row) and nothing stretched, and reads how wide
            // each bar is on its own. These widths do not depend on the page width.
            const measureBarWidths = (rowStarts) => {
                const options = rowStarts ? { mei: insertSystemBreaks(renderMei, rowStarts), breaks: "encoded" } : { breaks: "none" }
                const drawn = runLayout(MEASURE_PAGE_WIDTH, 0, { ...options, noJustification: true, adjustPageWidth: true })
                const widths = drawn.pages === 1 && countSvgSystems(drawn.svg) === (rowStarts ? rowStarts.length + 1 : 1) ? readSvgMeasureWidths(drawn.svg) : []
                return widths.length === countMeasures(renderMei) && widths.every((width) => Number.isFinite(width) && width > 0) ? widths : null
            }

            // The width of every bar, and its width alone on a row, where it also carries the clef and key a row starts with
            let barWidths
            const measureBars = () => {
                if (barWidths !== undefined) return barWidths
                const plainWidths = measureBarWidths(null)
                const startWidths = plainWidths && measureBarWidths(Array.from({ length: plainWidths.length - 1 }, (_, index) => index + 2))
                barWidths = startWidths ? { plainWidths, startWidths } : null
                return barWidths
            }

            // Draws the bars spread evenly over the rows of a drawing. Returns null when that is not possible or not better.
            const drawEvenRows = (result, width) => {
                try {
                    const currentStarts = readSvgRowStarts(result.svg)
                    const widths = measureBars()
                    if (!widths) return null
                    const { plainWidths, startWidths } = widths
                    const rowStarts = chooseRowStarts(plainWidths, startWidths, currentStarts.length + 1)
                    if (rowStarts.length !== currentStarts.length) return null

                    // Verovio squeezes a row that is too full. The bars' widths miss what a row gets at its end, such as the new
                    // key before a key change, so the rows are measured as they will be drawn: the widest of the even rows may
                    // not be wider than the widest row now.
                    if (rowStarts.some((start, index) => start !== currentStarts[index])) {
                        const evenWidths = measureBarWidths(rowStarts)
                        const currentWidths = measureBarWidths(currentStarts)
                        if (!evenWidths || !currentWidths) return null
                        const widest = (widths, starts) => Math.max(...getRowWidths(widths, widths, starts))
                        if (widest(evenWidths, rowStarts) > widest(currentWidths, currentStarts) * MAX_EVEN_ROW_GROWTH) return null
                    }

                    const rowWidths = getRowWidths(plainWidths, startWidths, rowStarts)
                    const lastRowIsShort = rowWidths[rowWidths.length - 1] < Math.max(...rowWidths) * MIN_LAST_ROW_SHARE
                    const evenMei = insertSystemBreaks(renderMei, rowStarts)
                    const currentBox = parseSvgViewBox(result.svg)
                    if (!currentBox) return null
                    // Rows with other bars can be taller. In a box the drawing may not get taller than the box or than it was.
                    const maxRatio = targetRatio === null ? Infinity : Math.max(targetRatio, currentBox.height / currentBox.width)
                    const drawAt = (evenWidth) => {
                        const drawn = runLayout(evenWidth, lastRowIsShort ? 1 : 0, { mei: evenMei, breaks: "encoded" })
                        if (drawn.pages !== 1 || countSvgSystems(drawn.svg) !== rowStarts.length + 1) return null
                        if (!svgFitsWidth(drawn.svg, lyricOptions.pageMarginRight)) return null
                        const box = parseSvgViewBox(drawn.svg)
                        return box ? { ...drawn, pageWidth: evenWidth, ratio: box.height / box.width } : null
                    }

                    let even = drawAt(width)
                    if (even && even.ratio > maxRatio) {
                        // A slightly wider page makes up for a little more height, at a small cost in size
                        const widerWidth = Math.ceil((width * even.ratio) / maxRatio)
                        even = widerWidth <= Math.min(MAX_PAGE_WIDTH, width * MAX_EVEN_ROWS_WIDENING) ? drawAt(widerWidth) : null
                    }
                    if (!even || even.ratio > maxRatio) return null

                    return { svg: even.svg, pages: even.pages, pageWidth: even.pageWidth }
                } catch {
                    return null
                }
            }

            const finalizeLayout = (result, width) => {
                if (result.pages <= 1 && countSvgSystems(result.svg) <= 1) return { ...result, pageWidth: width }
                const settled = { ...runLayout(width, MULTI_ROW_MIN_LAST_JUSTIFICATION), pageWidth: width }
                // The search justifies every row. The same drawing here means the last row is full, and the rows stay.
                if (result.pages > 1 || settled.svg === result.svg) return settled
                const settledLog = lastRenderLog
                const even = drawEvenRows(result, width)
                if (even) return even
                lastRenderLog = settledLog
                return settled
            }

            if (targetRatio === null) {
                const initial = renderSearchAt(clampedWidth)
                const finalResult = finalizeLayout(initial, clampedWidth)
                lastRenderLayouts = layoutCount
                const cleanSvg = sanitizeSvg(finalResult.svg)
                return {
                    svg: cleanSvg,
                    pageWidth: finalResult.pageWidth,
                    scale: 1,
                    fits: finalResult.pages <= 1 && svgFitsWidth(cleanSvg, lyricOptions.pageMarginRight),
                    pages: finalResult.pages
                }
            }

            const canonicalKey = `${targetRatio}:${drawMeasureNumbers ? "mnum" : ""}:${transposeSemitones || ""}:${lyricSizePercent > DEFAULT_LYRIC_SIZE ? lyricSizePercent : ""}:${mei}`
            const cachedCanonical = getCanonicalMemo(canonicalKey)
            const fitted = findFittingLayout(clampedWidth, targetRatio, renderSearchAt, { canonical: cachedCanonical, marginRight: lyricOptions.pageMarginRight })

            const usedCachedCanonical = Boolean(cachedCanonical && fitted.svg === cachedCanonical.svg)
            const usedFreshCanonical = Boolean(!cachedCanonical && fitted.canonical && fitted.svg === fitted.canonical.svg)

            let finalSvg
            let finalPages = fitted.pages
            let finalPageWidth = fitted.pageWidth

            if (usedCachedCanonical) {
                finalSvg = cachedCanonical.svg
                finalPages = cachedCanonical.pages
                finalPageWidth = cachedCanonical.pageWidth
            } else {
                const finalized = finalizeLayout({ svg: fitted.svg, pages: fitted.pages }, fitted.pageWidth)
                finalSvg = sanitizeSvg(finalized.svg)
                finalPages = finalized.pages
                finalPageWidth = finalized.pageWidth
            }

            if (!cachedCanonical && fitted.canonical && !fitted.canonical.timedOut) {
                let cleanCanonicalSvg
                let canonicalPages = fitted.canonical.pages
                let canonicalPageWidth = fitted.canonical.pageWidth
                if (usedFreshCanonical) {
                    cleanCanonicalSvg = finalSvg
                    canonicalPages = finalPages
                    canonicalPageWidth = finalPageWidth
                } else {
                    const finalizedCanonical = finalizeLayout({ svg: fitted.canonical.svg, pages: fitted.canonical.pages }, fitted.canonical.pageWidth)
                    cleanCanonicalSvg = sanitizeSvg(finalizedCanonical.svg)
                    canonicalPages = finalizedCanonical.pages
                    canonicalPageWidth = finalizedCanonical.pageWidth
                }
                setCanonicalMemo(canonicalKey, {
                    svg: cleanCanonicalSvg,
                    pageWidth: canonicalPageWidth,
                    pages: canonicalPages,
                    fits: fitted.canonical.fits,
                    canonicalLayouts: fitted.canonical.canonicalLayouts,
                    timedOut: false
                })
            }

            lastRenderLayouts = layoutCount
            const scale = Math.min(1, clampedWidth / finalPageWidth)
            return {
                svg: finalSvg,
                pageWidth: finalPageWidth,
                scale,
                fits: fitted.fits,
                pages: finalPages
            }
        } catch (err) {
            if (err && typeof err === "object" && typeof err.code === "string") throw err
            throw createWorkerError("render_failed", formatError(err, "Could not render music"))
        }
    }

    throw createWorkerError("load_failed", `Unknown sheet music worker message: ${String(type)}`)
}

if (typeof self !== "undefined") {
    self.onmessage = async (event) => {
        const message = event.data || {}
        const { id, type } = message

        try {
            const result = await handleMessage(message)
            self.postMessage({ id, ok: true, result })
        } catch (err) {
            self.postMessage({ id, ok: false, code: getErrorCode(err, type), error: formatError(err, "Sheet music engine error") })
        }
    }
}
