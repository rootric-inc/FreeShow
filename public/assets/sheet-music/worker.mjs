import createVerovioModule from "./verovio-module.mjs"
import { VerovioToolkit, enableLogToBuffer } from "./verovio.mjs"
import { DEFAULT_PAGE_WIDTH, MAX_PAGE_WIDTH, MIN_PAGE_WIDTH, countMeasures, extractTitle, findFittingLayout, insertSlicePageBreaks, normalizeMei, sanitizeSvg, stripInitialMeter, svgFitsWidth } from "./mei.mjs"

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

const MAX_CANONICAL_MEMO = 8
const canonicalMemo = new Map()

let toolkitPromise = null
let lastRenderLayouts = 0

export function getLastRenderLayouts() {
    return lastRenderLayouts
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

            const title = extractTitle(rawMei)
            const mei = normalizeMei(rawMei)
            const measures = countMeasures(mei)
            if (measures === 0) throw createWorkerError("empty_music", "No music measures found")

            return { mei, title, measures }
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

            const withoutMeter = startMeasure > 1 ? stripInitialMeter(rawSlice) : rawSlice
            const slicedMei = normalizeMei(withoutMeter)
            const measures = countMeasures(slicedMei)
            if (measures === 0) throw createWorkerError("empty_music", "No music measures found")

            return { mei: slicedMei, measures }
        } catch (err) {
            if (err && typeof err === "object" && typeof err.code === "string") throw err
            throw createWorkerError("load_failed", formatError(err, "Could not slice music"))
        }
    }

    if (type === "render") {
        const { mei, pageWidth, ratio } = message
        if (typeof mei !== "string" || !mei.trim()) throw createWorkerError("render_failed", "No music data to render")

        const parsedWidth = Math.round(Number(pageWidth) || DEFAULT_PAGE_WIDTH)
        const clampedWidth = Math.max(MIN_PAGE_WIDTH, Math.min(MAX_PAGE_WIDTH, parsedWidth))
        const targetRatio = typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : null

        try {
            const renderAt = (width) => {
                // Reload from scratch with a fixed id seed so layouts never depend on earlier widths or call history
                tk.resetOptions()
                tk.resetXmlIdSeed(1)
                tk.setOptions({ ...RENDER_OPTIONS, pageWidth: width })
                const loaded = tk.loadData(mei)
                if (!loaded) throw createWorkerError("render_failed", "Could not render music")

                const svg = tk.renderToSVG(1)
                if (!svg) throw createWorkerError("render_failed", "Could not render music")
                const pages = tk.getPageCount()
                return { svg, pages }
            }

            if (targetRatio === null) {
                lastRenderLayouts = 1
                const { svg, pages } = renderAt(clampedWidth)
                const cleanSvg = sanitizeSvg(svg)
                return {
                    svg: cleanSvg,
                    pageWidth: clampedWidth,
                    scale: 1,
                    fits: pages <= 1 && svgFitsWidth(cleanSvg),
                    pages
                }
            }

            const canonicalKey = `${targetRatio}:${mei}`
            const cachedCanonical = getCanonicalMemo(canonicalKey)
            const fitted = findFittingLayout(clampedWidth, targetRatio, renderAt, { canonical: cachedCanonical })
            lastRenderLayouts = fitted.layouts

            if (!cachedCanonical && fitted.canonical && !fitted.canonical.timedOut) {
                const cleanCanonicalSvg = sanitizeSvg(fitted.canonical.svg)
                setCanonicalMemo(canonicalKey, {
                    svg: cleanCanonicalSvg,
                    pageWidth: fitted.canonical.pageWidth,
                    pages: fitted.canonical.pages,
                    fits: fitted.canonical.fits,
                    canonicalLayouts: fitted.canonical.canonicalLayouts,
                    timedOut: false
                })
            }

            const svg = cachedCanonical && fitted.svg === cachedCanonical.svg ? cachedCanonical.svg : sanitizeSvg(fitted.svg)
            const scale = Math.min(1, clampedWidth / fitted.pageWidth)
            return {
                svg,
                pageWidth: fitted.pageWidth,
                scale,
                fits: fitted.fits,
                pages: fitted.pages
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
