import createVerovioModule from "./verovio-module.mjs"
import { VerovioToolkit, enableLogToBuffer } from "./verovio.mjs"
import { DEFAULT_PAGE_WIDTH, MAX_PAGE_WIDTH, MIN_PAGE_WIDTH, countMeasures, extractTitle, findFittingLayout, normalizeMei, sanitizeSvgUrls } from "./mei.mjs"

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

let toolkitPromise = null

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

    if (type === "render") {
        const { mei, pageWidth, ratio } = message
        if (typeof mei !== "string" || !mei.trim()) throw createWorkerError("render_failed", "No music data to render")

        const parsedWidth = Math.round(Number(pageWidth) || DEFAULT_PAGE_WIDTH)
        const clampedWidth = Math.max(MIN_PAGE_WIDTH, Math.min(MAX_PAGE_WIDTH, parsedWidth))
        const targetRatio = typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : null

        try {
            let loadedOnce = false
            const renderAt = (width) => {
                if (!loadedOnce) {
                    tk.resetOptions()
                    tk.setOptions({ ...RENDER_OPTIONS, pageWidth: width })
                    const loaded = tk.loadData(mei)
                    if (!loaded) throw createWorkerError("render_failed", "Could not render music")
                    loadedOnce = true
                } else {
                    tk.setOptions({ ...RENDER_OPTIONS, pageWidth: width })
                    tk.redoLayout()
                }

                const svg = tk.renderToSVG(1)
                if (!svg) throw createWorkerError("render_failed", "Could not render music")
                const pageCount = tk.getPageCount()
                return { svg, pageCount }
            }

            if (targetRatio === null) {
                const { svg, pageCount } = renderAt(clampedWidth)
                return { svg: sanitizeSvgUrls(svg), pageWidth: clampedWidth, truncated: pageCount > 1 }
            }

            const fitted = findFittingLayout(clampedWidth, targetRatio, renderAt)
            return { svg: sanitizeSvgUrls(fitted.svg), pageWidth: fitted.pageWidth, truncated: fitted.truncated }
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
