import type { AbcParseOnly } from "./abcjs"

export type AbcPartsLayout = "four" | "two" | "one"

export interface AbcTemplateOptions {
    key: string
    meter: string
    parts: AbcPartsLayout
    title?: string
}

export interface AbcHeaderInfo {
    key: string
    meter: string
    parts: AbcPartsLayout
}

export interface AbcInsertResult {
    value: string
    cursor: number
}

export const ABC_KEYS: readonly string[] = "C G D A E B F# F Bb Eb Ab Db Gb Am Em Bm F#m C#m Dm Gm Cm Fm Bbm".split(" ")
export const ABC_METERS: readonly string[] = "4/4 3/4 2/4 6/8 3/2 2/2 6/4 9/8 12/8 none".split(" ")

export const normalizeLineEndings = (text: string): string => text.replace(/\r\n?/g, "\n")

export function createAbcTemplate({ key, meter, parts, title }: AbcTemplateOptions): string {
    const base = [`T: ${(title || "").trim()}`, `M: ${(meter || "4/4").trim()}`, "L: 1/4", `K: ${(key || "C").trim()}`]
    if (parts === "four") {
        // octave=-1 on bass voices lets typists use plain letters for the bass staff
        return [...base, "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] ", "w: ", "[V:A] ", "[V:T] ", "[V:B] "].join("\n")
    }
    return (parts === "two" ? [...base, "%%score (S A)", "V: S", "V: A", "[V:S] ", "w: ", "[V:A] "] : [...base, ""]).join("\n")
}

export function readAbcHeader(abc: string): AbcHeaderInfo {
    let key = "C"
    let meter = "4/4"
    let parts: AbcPartsLayout | "" = ""
    const voices = new Set<string>()
    let hasK = false
    let hasM = false

    for (const line of normalizeLineEndings(abc).split("\n")) {
        const clean = line.split("%")[0].trim()
        if (!hasM && clean.startsWith("M:")) {
            const v = clean.slice(2).trim()
            if (v) meter = v === "C" ? "4/4" : v === "C|" ? "2/2" : v.toLowerCase() === "none" ? "none" : v.replace(/\s+/g, "")
            hasM = true
        } else if (!hasK && clean.startsWith("K:")) {
            const tok = clean.slice(2).trim().split(/\s+/)[0]
            if (tok) key = tok
            hasK = true
        }
        if (!parts) {
            const sm = /^\s*%%(?:score|staves)\s+([^%]+)/i.exec(line)
            if (sm) {
                const spec = sm[1].trim()
                const toks = spec
                    .replace(/[()|{}[\]]/g, " ")
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                parts = (spec.match(/\([^)]+\)/g) || []).length >= 2 || toks.length >= 3 ? "four" : toks.length === 2 ? "two" : "one"
            } else {
                const vm = /^V:\s*([^\s]+)/.exec(clean)
                if (vm) voices.add(vm[1])
                for (const im of clean.match(/\[V:\s*([^\s\]]+)/g) || []) voices.add(im.replace(/^\[V:\s*/, ""))
            }
        }
    }
    return { key, meter, parts: parts || (voices.size >= 3 ? "four" : voices.size === 2 ? "two" : "one") }
}

export function updateAbcHeaderField(abc: string, field: "K" | "M", value: string): string {
    const clean = value.trim()
    if (!clean) return abc
    const eol = abc.includes("\r\n") ? "\r\n" : "\n"
    const lines = normalizeLineEndings(abc).split("\n")
    const re = new RegExp(`^(\\s*${field}:\\s*)([^%\\n]*?)(\\s*%.*)?$`)
    for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i])
        if (m) {
            lines[i] = `${m[1]}${clean}${m[3] || ""}`
            return lines.join(eol)
        }
    }
    let idx = 0
    if (field === "M") {
        const before = lines.findIndex((l) => /^\s*(?:L|K):/.test(l))
        const afterT = lines.findIndex((l) => /^\s*T:/.test(l))
        idx = before >= 0 ? before : afterT >= 0 ? afterT + 1 : 0
    } else {
        for (let i = 0; i < lines.length; i++) {
            if (/^\s*(?:[XTMLCQZ]:|%%)/.test(lines[i])) idx = i + 1
            else if (lines[i].trim() && !/^\s*%/.test(lines[i])) break
        }
    }
    lines.splice(idx, 0, `${field}: ${clean}`)
    return lines.join(eol)
}

export function insertAbcAtCursor(abc: string, text: string, selectionStart: number, selectionEnd = selectionStart): AbcInsertResult {
    const s = Math.max(0, Math.min(abc.length, Math.floor(selectionStart)))
    const e = Math.max(s, Math.min(abc.length, Math.floor(selectionEnd)))
    return { value: abc.slice(0, s) + text + abc.slice(e), cursor: s + text.length }
}

export function sliceAbcByLine(abc: string, parseOnly: AbcParseOnly): string[] {
    const normalized = normalizeLineEndings(abc)
    if (!normalized.trim()) return []
    const tune = parseOnly(normalized)?.[0]
    if (!tune || !Array.isArray(tune.lines)) return []

    const textLines = normalized.split("\n")
    const starts: number[] = []
    let pos = 0
    for (const l of textLines) {
        starts.push(pos)
        pos += l.length + 1
    }
    const lineOf = (ch: number) => {
        let lo = 0
        let hi = starts.length - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (starts[mid] <= ch) lo = mid
            else hi = mid - 1
        }
        return lo
    }

    const systems: number[][] = []
    for (const line of tune.lines) {
        if (!line.staff) continue
        const set = new Set<number>()
        for (const st of line.staff) {
            for (const v of st.voices || []) {
                for (const el of v) {
                    const sc = (el as { startChar?: number }).startChar
                    if (sc !== undefined && el.el_type !== "stem") set.add(lineOf(sc))
                }
            }
        }
        if (set.size) systems.push(Array.from(set).sort((a, b) => a - b))
    }
    if (!systems.length) return []

    const firstBody = Math.min(...systems.map((s) => s[0]))
    const header = textLines.slice(0, firstBody).filter((l) => !/^\s*%(?!%score\b|%staves\b)/i.test(l))

    return systems.map((sysLines) => {
        const out: string[] = []
        let lastVoice = ""
        for (const idx of sysLines) {
            const src = textLines[idx]
            if (!/^\s*\[V:/i.test(src)) {
                let p = idx - 1
                while (p >= firstBody && !/^\s*V:/i.test(textLines[p])) p--
                if (p >= firstBody && textLines[p] !== lastVoice) {
                    lastVoice = textLines[p]
                    out.push(lastVoice)
                }
            }
            out.push(src)
            for (let w = idx + 1; w < textLines.length && /^\s*w:/.test(textLines[w]); w++) out.push(textLines[w])
        }
        return [...header, ...out].join("\n") + "\n"
    })
}
