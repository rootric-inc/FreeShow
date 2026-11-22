import createVerovioModule from "./verovio-module.mjs"
import { VerovioToolkit, enableLogToBuffer } from "./verovio.mjs"

const DEFAULT_PAGE_WIDTH = 2100
const MIN_PAGE_WIDTH = 100
const MAX_PAGE_WIDTH = 100000

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

function decodeXmlEntities(text) {
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

function extractTitle(mei) {
    const headMatch = mei.match(/<meiHead(?:\s[^>]*)?>([\s\S]*?)<\/meiHead>/)
    if (!headMatch) return ""
    const titleMatch = headMatch[1].match(/<title\b[^>]*>([\s\S]*?)<\/title>/)
    if (!titleMatch) return ""
    const plain = titleMatch[1].replace(/<[^>]+>/g, " ")
    return decodeXmlEntities(plain).replace(/\s+/g, " ").trim()
}

function normalizeMei(mei) {
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

function countMeasures(mei) {
    const matches = mei.match(/<measure(?:\s|>|\/)/g)
    return matches ? matches.length : 0
}

function formatError(err, fallback) {
    if (err instanceof Error && err.message) return err.message
    if (typeof err === "string" && err.trim()) return err.trim()
    return fallback
}

export async function handleMessage(message) {
    const { type } = message || {}
    const tk = await getToolkit()

    if (type === "load") {
        const { text, base64 } = message
        tk.resetOptions()
        // Verovio's resetOptions defaults inputFrom to "mei", so restore auto-detection for MusicXML/MEI
        tk.setOptions({ inputFrom: "auto" })

        let loaded = 0
        if (typeof base64 === "string" && base64.length > 0) {
            try {
                loaded = tk.loadZipDataBase64(base64)
            } catch (_err) {
                throw new Error("Could not read music file")
            }
        } else if (typeof text === "string" && text.length > 0) {
            loaded = tk.loadData(text)
        } else {
            throw new Error("No music data provided")
        }

        if (!loaded) throw new Error("Could not read music file")

        const rawMei = tk.getMEI({ removeIds: true })
        if (!rawMei) throw new Error("Could not extract music data")

        const title = extractTitle(rawMei)
        const mei = normalizeMei(rawMei)
        const measures = countMeasures(mei)
        if (measures === 0) throw new Error("No music measures found")

        return { mei, title, measures }
    }

    if (type === "render") {
        const { mei, pageWidth } = message
        if (typeof mei !== "string" || !mei.trim()) throw new Error("No music data to render")

        const parsedWidth = Math.round(Number(pageWidth) || DEFAULT_PAGE_WIDTH)
        const clampedWidth = Math.max(MIN_PAGE_WIDTH, Math.min(MAX_PAGE_WIDTH, parsedWidth))

        tk.resetOptions()
        tk.setOptions({ ...RENDER_OPTIONS, pageWidth: clampedWidth })

        const loaded = tk.loadData(mei)
        if (!loaded) throw new Error("Could not render music")

        const svg = tk.renderToSVG(1)
        if (!svg) throw new Error("Could not render music")

        return { svg }
    }

    throw new Error(`Unknown sheet music worker message: ${String(type)}`)
}

if (typeof self !== "undefined") {
    self.onmessage = async (event) => {
        const message = event.data || {}
        const { id } = message

        try {
            const result = await handleMessage(message)
            self.postMessage({ id, ok: true, result })
        } catch (err) {
            self.postMessage({ id, ok: false, error: formatError(err, "Sheet music engine error") })
        }
    }
}
