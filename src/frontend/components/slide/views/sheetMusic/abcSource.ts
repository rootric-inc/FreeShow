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

export const KEY_TOKEN_PATTERN = /^(?:none|H[Pp]|[A-G][#b]?(?:major|maj|minor|min|m|ionian|ion|dorian|dor|phrygian|phr|lydian|lyd|mixolydian|mix|aeolian|aeo|locrian|loc)?(?:\s+(?:major|maj|minor|min|m|ionian|ion|dorian|dor|phrygian|phr|lydian|lyd|mixolydian|mix|aeolian|aeo|locrian|loc))?)(?=\s|$)/i
export const METER_TOKEN_PATTERN = /^(?:[Nn][Oo][Nn][Ee]|C\|?|\(?[0-9+]+(?:\s*\/\s*[0-9]+)?\)?)(?=\s|$)/
export const LENGTH_TOKEN_PATTERN = /^[0-9]+\s*\/\s*[0-9]+(?=\s|$)/

export const normalizeLineEndings = (text: string): string => text.replace(/\r\n?/g, "\n")

export function createAbcTemplate({ key, meter, parts, title }: AbcTemplateOptions): string {
    const headerLines = [`T: ${(title || "").trim()}`, `M: ${(meter || "4/4").trim()}`, "L: 1/4", `K: ${(key || "C").trim()}`]
    if (parts === "four") {
        // octave=-1 on bass voices lets typists use plain letters for the bass staff
        return [...headerLines, "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] ", "w: ", "[V:A] ", "[V:T] ", "[V:B] "].join("\n")
    }
    return (parts === "two" ? [...headerLines, "%%score (S A)", "V: S", "V: A", "[V:S] ", "w: ", "[V:A] "] : [...headerLines, ""]).join("\n")
}

export function readAbcHeader(abc: string): AbcHeaderInfo {
    let key = "C"
    let meter = "4/4"
    let parts: AbcPartsLayout | "" = ""
    const voices = new Set<string>()
    let hasKey = false
    let hasMeter = false

    for (const line of normalizeLineEndings(abc).split("\n")) {
        const cleanLine = line.split("%")[0].trim()
        if (!hasMeter && !hasKey && cleanLine.startsWith("M:")) {
            const rawMeter = cleanLine.slice(2).trim()
            const tokenMatch = METER_TOKEN_PATTERN.exec(rawMeter)
            const token = tokenMatch ? tokenMatch[0] : rawMeter.split(/\s+/)[0]
            if (token) meter = token === "C" ? "4/4" : token === "C|" ? "2/2" : token.toLowerCase() === "none" ? "none" : token.replace(/\s+/g, "")
            hasMeter = true
        } else if (!hasKey && cleanLine.startsWith("K:")) {
            const rawKey = cleanLine.slice(2).trim()
            const tokenMatch = KEY_TOKEN_PATTERN.exec(rawKey)
            const token = tokenMatch ? tokenMatch[0].split(/\s+/)[0] : ""
            if (token) key = token
            hasKey = true
        }
        if (!parts) {
            const scoreMatch = /^\s*%%(?:score|staves)\s+([^%]+)/i.exec(line)
            if (scoreMatch) {
                const spec = scoreMatch[1].trim()
                const tokens = spec
                    .replace(/[()|{}[\]]/g, " ")
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                parts = (spec.match(/\([^)]+\)/g) || []).length >= 2 || tokens.length >= 3 ? "four" : tokens.length === 2 ? "two" : "one"
            } else {
                const voiceMatch = /^V:\s*([^\s]+)/.exec(cleanLine)
                if (voiceMatch) voices.add(voiceMatch[1])
                for (const inlineMatch of cleanLine.match(/\[V:\s*([^\s\]]+)/g) || []) {
                    voices.add(inlineMatch.replace(/^\[V:\s*/, ""))
                }
            }
        }
    }
    return { key, meter, parts: parts || (voices.size >= 3 ? "four" : voices.size === 2 ? "two" : "one") }
}

function findHeaderEnd(lines: string[]): number {
    let inTextBlock = false
    for (let index = 0; index < lines.length; index++) {
        const trimmed = lines[index].trim()
        if (/^%%begintext\b/i.test(trimmed)) {
            inTextBlock = true
            continue
        }
        if (/^%%endtext\b/i.test(trimmed)) {
            inTextBlock = false
            continue
        }
        if (inTextBlock || !trimmed || trimmed.startsWith("%")) continue
        if (/^K:/.test(trimmed)) return index
        if (!/^[A-Za-z]:/.test(trimmed)) return index - 1
    }
    return lines.length - 1
}

export function replaceHeaderToken(field: "K" | "M" | "L", valuePart: string, replacement: string): string {
    if (!valuePart) return replacement
    const tokenPattern = field === "K" ? KEY_TOKEN_PATTERN : field === "M" ? METER_TOKEN_PATTERN : LENGTH_TOKEN_PATTERN
    const match = tokenPattern.exec(valuePart)
    if (match) return `${replacement}${valuePart.slice(match[0].length)}`
    return `${replacement} ${valuePart}`
}

export function updateAbcHeaderField(abc: string, field: "K" | "M" | "L", value: string): string {
    const cleanValue = value.trim()
    if (!cleanValue) return abc
    const lineEnding = abc.includes("\r\n") ? "\r\n" : "\n"
    const lines = normalizeLineEndings(abc).split("\n")
    const headerEnd = findHeaderEnd(lines)
    const linePattern = new RegExp(`^(\\s*${field}:\\s*)([^%\\n]*?)(\\s*%.*)?$`)
    let inTextBlock = false
    let lastMatchIndex = -1
    for (let index = 0; index <= headerEnd; index++) {
        const trimmed = lines[index].trim()
        if (/^%%begintext\b/i.test(trimmed)) {
            inTextBlock = true
            continue
        }
        if (/^%%endtext\b/i.test(trimmed)) {
            inTextBlock = false
            continue
        }
        if (inTextBlock || !trimmed || trimmed.startsWith("%")) continue
        if (linePattern.test(lines[index])) lastMatchIndex = index
    }
    if (lastMatchIndex >= 0) {
        const match = linePattern.exec(lines[lastMatchIndex])!
        const updatedValue = replaceHeaderToken(field, match[2], cleanValue)
        lines[lastMatchIndex] = `${match[1]}${updatedValue}${match[3] || ""}`
        return lines.join(lineEnding)
    }

    const headerLines = lines.slice(0, headerEnd + 1)
    let insertIndex = 0
    if (field === "M") {
        const beforeLengthOrKey = headerLines.findIndex((line) => /^\s*(?:L|K):/.test(line))
        const afterTitle = headerLines.findIndex((line) => /^\s*T:/.test(line))
        insertIndex = beforeLengthOrKey >= 0 ? beforeLengthOrKey : afterTitle >= 0 ? afterTitle + 1 : 0
    } else if (field === "L") {
        const beforeKey = headerLines.findIndex((line) => /^\s*K:/.test(line))
        const afterMeter = headerLines.findIndex((line) => /^\s*M:/.test(line))
        const afterTitle = headerLines.findIndex((line) => /^\s*T:/.test(line))
        insertIndex = beforeKey >= 0 ? beforeKey : afterMeter >= 0 ? afterMeter + 1 : afterTitle >= 0 ? afterTitle + 1 : 0
    } else {
        for (let index = 0; index <= headerEnd; index++) {
            if (/^\s*(?:[XTMLCQZ]:|%%)/.test(lines[index])) insertIndex = index + 1
            else if (lines[index].trim() && !/^\s*%/.test(lines[index])) break
        }
    }
    lines.splice(insertIndex, 0, `${field}: ${cleanValue}`)
    return lines.join(lineEnding)
}

export function adjustCursorForEdit(position: number, editStart: number, editEnd: number, replacementLength: number): number {
    if (position <= editStart) return position
    if (position >= editEnd) return position + replacementLength - (editEnd - editStart)
    return editStart + replacementLength
}

export function insertAbcAtCursor(abc: string, text: string, selectionStart: number, selectionEnd = selectionStart): AbcInsertResult {
    const start = Math.max(0, Math.min(abc.length, Math.floor(selectionStart)))
    const end = Math.max(start, Math.min(abc.length, Math.floor(selectionEnd)))
    return { value: abc.slice(0, start) + text + abc.slice(end), cursor: start + text.length }
}
