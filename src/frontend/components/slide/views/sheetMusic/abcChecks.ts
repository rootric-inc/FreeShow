import type { AbcElem, KeySignature, Meter, NotePitch, Staff, TuneObject } from "abcjs"
import type { AbcParseOnly } from "./abcjs"
import { normalizeLineEndings } from "./abcSource"

export type AbcProblemSeverity = "error" | "warning"

export interface AbcProblem {
    severity: AbcProblemSeverity
    key: string
    values: string[]
    startChar: number
    endChar: number
}

export interface AbcPartInfo {
    staff: number
    layer: number
    name: string
}

export interface RawAbcElem extends AbcElem {
    startChar?: number
    endChar?: number
    startTriplet?: number
    endTriplet?: boolean
    tripletMultiplier?: number
    startBeam?: boolean
    endBeam?: boolean
    duration?: number | number[]
    pitches?: NotePitch[]
    rest?: { type: string }
    type?: string
    startEnding?: string
    endEnding?: boolean
    gracenotes?: unknown[]
    chord?: unknown[]
    decoration?: string[]
    startSlur?: ({ label?: number } | number)[]
    endSlur?: ({ label?: number } | number)[]
    lyric?: { syllable: string; divider: string }[]
}

export interface VoiceMeasure {
    events: RawAbcElem[]
    len: number
    barType?: string
    leftBarType?: string
    change?: { key?: KeySignature; meter?: Meter; clef?: { type?: string } }
    startChar?: number
    endChar?: number
}

export interface OffsetMapper {
    normalized: string
    toOriginal: (index: number) => number
}

type PitchIv = [number, number, number, number, number]
type AlignedVoice = [number, number, number, number, number, PitchIv[]]
type AlignedBar = [number, boolean, Meter | undefined, number | null, string | undefined, string | undefined, Staff[], AlignedVoice[][]]

const SATB = ["Soprano", "Alto", "Tenor", "Bass"]
const HARMLESS_RE = /Unknown directive|Decoration redefinition|Unknown decoration|Postscript ignored/i
const SECTION_BARS = new Set(["bar_thin_thin", "bar_thin_thick", "bar_right_repeat", "bar_dbl_repeat"])
const clamp = (n: number, max: number) => (n < 0 ? 0 : n > max ? max : n)

export const makeAbcProblem = (k: string, values: string[], startChar: number, endChar: number, severity: AbcProblemSeverity = "warning"): AbcProblem => ({
    severity,
    key: `sheet_music.problem_${k}`,
    values,
    startChar,
    endChar
})

export function buildOffsetMapper(raw: string): OffsetMapper {
    const normalized = normalizeLineEndings(raw)
    if (normalized === raw) return { normalized, toOriginal: (i: number) => clamp(i, raw.length) }
    const map: number[] = []
    for (let i = 0; i < raw.length; i += raw[i] === "\r" && raw[i + 1] === "\n" ? 2 : 1) map.push(i)
    map.push(raw.length)
    return { normalized, toOriginal: (i: number) => map[clamp(i, map.length - 1)] }
}

export function trimCharRange(text: string, start: number | undefined, end: number | undefined): { startChar: number; endChar: number } {
    if (start === undefined || !Number.isFinite(start)) return { startChar: 0, endChar: 0 }
    let s = clamp(Math.floor(start), text.length)
    let e = end !== undefined && Number.isFinite(end) ? Math.max(s, clamp(Math.floor(end), text.length)) : s
    while (s < e && (text[s] === " " || text[s] === "\t")) s++
    while (e > s && (text[e - 1] === " " || text[e - 1] === "\t")) e--
    return { startChar: s, endChar: e === s && s < text.length ? s + 1 : e }
}

export function getLineStarts(text: string): number[] {
    const starts = [0]
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1)
    return starts
}

export function getLineIndexAt(starts: number[], offset: number): number {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (starts[mid] <= offset) lo = mid
        else hi = mid - 1
    }
    return lo
}

export const getStaffLines = (tune: TuneObject | undefined): { staff: Staff[] }[] => (tune && Array.isArray(tune.lines) ? tune.lines.filter((l): l is { staff: Staff[] } => Array.isArray(l.staff) && l.staff.length > 0) : [])

export const hasAbcNotes = (tune: TuneObject | undefined): boolean => getStaffLines(tune).some((l) => l.staff.some((s) => (s.voices || []).some((v) => (v as RawAbcElem[]).some((el) => el.el_type === "note" && !el.rest && Boolean(el.pitches && el.pitches.length)))))

export function getAbcParts(tune: TuneObject | undefined): AbcPartInfo[] {
    const lines = getStaffLines(tune)
    if (!lines.length) return []
    const first = lines[0].staff
    const satb = first.length === 2 && first[0].voices && first[0].voices.length === 2 && first[1].voices && first[1].voices.length === 2
    const parts: AbcPartInfo[] = []
    let idx = 0
    first.forEach((st, si) => {
        const titles = (st as Staff & { title?: string[] }).title
        for (let vi = 0; vi < (st.voices ? st.voices.length : 0); vi++, idx++) {
            parts.push({ staff: si + 1, layer: vi + 1, name: satb ? SATB[idx] : (Array.isArray(titles) && titles[vi] ? titles[vi].trim() : "") || `Voice ${idx + 1}` })
        }
    })
    return parts
}

const elemDur = (el: RawAbcElem) => {
    const r = Array.isArray(el.duration) ? el.duration[0] : el.duration
    return typeof r === "number" && Number.isFinite(r) ? r : 0
}

const meterLen = (m: Meter | undefined) => {
    if (!m) return null
    if (m.type === "common_time" || m.type === "cut_time") return 1
    const v = m.value && m.value[0]
    const n = v ? Number(v.num) : 0
    const d = v ? Number(v.den) : 0
    return n > 0 && d > 0 ? n / d : null
}

const fmtBeats = (len: number, m: Meter | undefined) => {
    const den = !m ? 4 : m.type === "common_time" ? 4 : m.type === "cut_time" ? 2 : m.value && m.value[0] ? Number(m.value[0].den) : 4
    return String(Math.round(len * (den > 0 ? den : 4) * 100) / 100)
}

export function splitVoiceIntoMeasures(voice: AbcElem[], norm: string, isPrimary: boolean, onBar?: (el: RawAbcElem) => void, onOther?: (el: RawAbcElem) => void, collectClef = false): VoiceMeasure[] {
    const ms: VoiceMeasure[] = [{ events: [], len: 0 }]
    let mul = 1
    for (const elem of voice) {
        const el = elem as RawAbcElem
        const cur = ms[ms.length - 1]
        if (el.el_type === "bar") {
            if (onBar) onBar(el)
            if (!cur.events.length && (ms.length === 1 || el.type === "bar_left_repeat") && !cur.leftBarType) cur.leftBarType = el.type
            else {
                cur.barType = el.type === "bar_left_repeat" ? "bar_thin" : el.type
                ms.push(el.type === "bar_left_repeat" ? { events: [], len: 0, leftBarType: el.type } : { events: [], len: 0 })
            }
        } else if (el.el_type === "note") {
            cur.events.push(el)
            const r = trimCharRange(norm, el.startChar, el.endChar)
            if (cur.startChar === undefined) cur.startChar = r.startChar
            cur.endChar = r.endChar
            if (el.startTriplet) mul = el.tripletMultiplier || 1
            cur.len += elemDur(el) * mul
            if (el.endTriplet) mul = 1
        } else if (el.el_type === "key" || el.el_type === "meter" || el.el_type === "clef") {
            if (isPrimary || (el.el_type === "clef" && collectClef)) cur.change = Object.assign(cur.change || {}, { [el.el_type]: el })
        } else if (onOther) onOther(el)
    }
    const last = ms[ms.length - 1]
    if (!last.events.length && (ms.length === 1 || !last.change)) ms.pop()
    return ms
}

function toIvs(ms: VoiceMeasure | undefined, norm: string): PitchIv[] {
    if (!ms || !ms.events.length) return []
    const out: PitchIv[] = []
    let t = 0
    let mul = 1
    for (const el of ms.events) {
        if (el.startTriplet) mul = el.tripletMultiplier || 1
        const dur = elemDur(el) * mul
        if (el.endTriplet) mul = 1
        if (!el.rest && el.pitches && el.pitches.length && dur > 0) {
            const r = trimCharRange(norm, el.startChar, el.endChar)
            out.push([t, t + dur, el.pitches.reduce((a, p) => a + p.pitch, 0) / el.pitches.length, r.startChar, r.endChar])
        }
        t += dur
    }
    return out
}

const firstNum = (...vals: (number | undefined)[]) => {
    for (const v of vals) if (v !== undefined) return v
    return 0
}

function collectBars(tune: TuneObject, norm: string): AlignedBar[] {
    const lines = getStaffLines(tune)
    if (!lines.length) return []
    const bars: AlignedBar[] = []
    let meter = lines[0].staff[0] && lines[0].staff[0].meter
    let barLen = meterLen(meter)
    let mNo = 0
    let carry: ([number, number | undefined, number | undefined, string | undefined, PitchIv[]] | null)[][] | null = null

    lines.forEach((line, li) => {
        if (li > 0 && line.staff[0] && line.staff[0].meter) {
            meter = line.staff[0].meter
            barLen = meterLen(meter)
        }
        const pv = line.staff.map((st, si) => (st.voices || []).map((v, vi) => splitVoiceIntoMeasures(v, norm, si === 0 && vi === 0)))
        const count = Math.max(0, ...pv.flat().map((ms) => ms.length))
        if (!count) return

        const topV = pv[0] && pv[0][0]
        const open = Boolean(li < lines.length - 1 && topV && topV[count - 1] && !topV[count - 1].barType)
        const nextCarry: typeof carry = open ? pv.map((vs) => vs.map(() => null)) : null

        for (let m = 0; m < count; m++) {
            const top = topV && topV[m]
            if (top && top.change && top.change.meter) {
                meter = top.change.meter
                barLen = meterLen(meter)
            }
            const voices: AlignedVoice[][] = pv.map((stV, si) =>
                stV.map((ms, vi) => {
                    const cur = ms[m]
                    const fb = ms[ms.length - 1]
                    const prev = m === 0 && carry && carry[si] ? carry[si][vi] : null
                    const curIvs = toIvs(cur, norm)
                    const ivs: PitchIv[] = prev ? prev[4].concat(curIvs.map((iv) => [iv[0] + prev[0], iv[1] + prev[0], iv[2], iv[3], iv[4]])) : curIvs
                    if (prev && prev[3] && cur && !cur.leftBarType) cur.leftBarType = prev[3]
                    const s = firstNum(cur && cur.startChar, prev ? prev[1] : undefined, fb && fb.startChar, top && top.startChar)
                    const e = firstNum(cur && cur.endChar, prev ? prev[2] : undefined, fb && fb.endChar, top && top.endChar, s)
                    return [si, vi, (cur ? cur.len : 0) + (prev ? prev[0] : 0), s, e, ivs]
                })
            )
            if (open && m === count - 1 && nextCarry) {
                voices.forEach((stV, si) =>
                    stV.forEach((v, vi) => {
                        const cm = pv[si][vi][m]
                        nextCarry[si][vi] = [v[2], firstNum(cm && cm.startChar, v[3]), firstNum(cm && cm.endChar, v[4]), cm ? cm.leftBarType : undefined, v[5]]
                    })
                )
                continue
            }
            bars.push([mNo + m + 1, li === lines.length - 1 && m === count - 1, meter, barLen, top && top.barType, top && top.leftBarType, line.staff, voices])
        }
        carry = nextCarry
        mNo += open ? Math.max(0, count - 1) : count
    })
    return bars
}

function warningsOf(tune: TuneObject | undefined, mapper: OffsetMapper): AbcProblem[] {
    const raw = tune && (tune as TuneObject & { warnings?: string[] }).warnings
    if (!Array.isArray(raw) || !raw.length) return []

    const starts = getLineStarts(mapper.normalized)
    // Mirror abcjs bookParser's line numbering: directives before X: are prepended to the first tune
    const src = mapper.normalized.split("\n")
    const first = Math.max(
        0,
        src.findIndex((l) => l.trim())
    )
    const xIdx = src.findIndex((l, i) => i >= first && l.startsWith("X:"))
    const lineMap: number[] = []
    for (let i = first; i < src.length; i++) if (xIdx <= first || i >= xIdx || src[i].startsWith("%%")) lineMap.push(i)

    const out: AbcProblem[] = []
    for (const w of raw) {
        if (typeof w !== "string") continue
        const m = /^Music Line:(\d+):(\d+):\s*(.*?)(?:: {2}|$)/.exec(w)
        if (!m) {
            const plain = w.replace(/<[^>]+>/g, "").trim()
            if (plain && !HARMLESS_RE.test(plain)) out.push(makeAbcProblem("syntax", [plain], 0, 0))
            continue
        }
        const msg = m[3].trim()
        if (!msg || HARMLESS_RE.test(msg)) continue
        const tl = Math.max(0, Number(m[1]) - 1)
        const li = clamp(lineMap[tl] !== undefined ? lineMap[tl] : tl, starts.length - 1)
        const ls = starts[li] || 0
        const le = li + 1 < starts.length ? starts[li + 1] - 1 : mapper.normalized.length
        const s = Math.max(ls, Math.min(le, ls + Math.max(0, Number(m[2]) - 1)))
        out.push(makeAbcProblem("syntax", [msg], mapper.toOriginal(s), mapper.toOriginal(Math.min(mapper.normalized.length, s + 1))))
    }
    return out
}

export function checkAbcWarnings(tune: TuneObject | undefined, abc: string): AbcProblem[] {
    return warningsOf(tune, buildOffsetMapper(abc))
}

const nameOf = (parts: AbcPartInfo[], si: number, vi: number) => {
    const f = parts.find((p) => p.staff === si + 1 && p.layer === vi + 1)
    return f ? f.name : `Voice ${vi + 1}`
}

function checkMeasuresOnBars(bars: AlignedBar[], mapper: OffsetMapper, parts: AbcPartInfo[]): AbcProblem[] {
    const out: AbcProblem[] = []
    const splitOk = new Set<number>()
    for (let i = 0; i + 1 < bars.length; i++) {
        const a = bars[i]
        const b = bars[i + 1]
        const aRef = a[7][0] && a[7][0][0] ? a[7][0][0][2] : 0
        const bRef = b[7][0] && b[7][0][0] ? b[7][0][0][2] : 0
        if (((a[4] && SECTION_BARS.has(a[4])) || b[5] === "bar_left_repeat") && a[3] !== null && b[3] === a[3] && aRef > 1e-4 && bRef > 1e-4 && aRef < a[3] - 1e-4 && bRef < a[3] - 1e-4 && Math.abs(aRef + bRef - a[3]) <= 1e-4) {
            splitOk.add(i)
            splitOk.add(i + 1)
        }
    }
    const pushBeats = (kind: string, part: string, barNum: number, got: string, exp: string, s: number, e: number) => out.push(makeAbcProblem(got === "1" ? `${kind}_one` : kind, got === "1" ? [part, String(barNum), exp] : [part, String(barNum), got, exp], mapper.toOriginal(s), mapper.toOriginal(e)))

    bars.forEach(([barNum, isLast, meter, barLen, , , , voices], idx) => {
        const entries = voices.flat()
        if (!entries.length) return
        const ref = entries[0][2]
        const refStr = fmtBeats(ref, meter)
        for (const [si, vi, len, s, e] of entries.slice(1)) {
            if (Math.abs(len - ref) > 1e-4) pushBeats("bar_beats_part", nameOf(parts, si, vi), barNum, fmtBeats(len, meter), refStr, s, e)
        }
        if (splitOk.has(idx) || barLen === null || ref <= 1e-4 || ((barNum === 1 || isLast) && ref < barLen - 1e-4)) return
        if (Math.abs(ref - barLen) > 1e-4) pushBeats("bar_beats_meter", nameOf(parts, 0, 0), barNum, refStr, fmtBeats(barLen, meter), entries[0][3], entries[0][4])
    })
    return out
}

export function checkAbcMeasures(tune: TuneObject, abc: string, parts: AbcPartInfo[] = getAbcParts(tune)): AbcProblem[] {
    const mapper = buildOffsetMapper(abc)
    return checkMeasuresOnBars(collectBars(tune, mapper.normalized), mapper, parts)
}

function pairCrossed(u: PitchIv[], l: PitchIv[]): [boolean, number, number] {
    let i = 0
    let j = 0
    let ov = 0
    let cr = 0
    let s = 0
    let e = 0
    while (i < u.length && j < l.length) {
        const dur = Math.min(u[i][1], l[j][1]) - Math.max(u[i][0], l[j][0])
        if (dur > 1e-6) {
            ov += dur
            if (l[j][2] > u[i][2] + 1e-6) {
                if (!cr) [s, e] = [l[j][3], l[j][4]]
                cr += dur
            }
        }
        if (u[i][1] <= l[j][1]) i++
        else j++
    }
    return [ov > 0 && cr > ov / 2, s, e]
}

function checkVoiceOrderOnBars(bars: AlignedBar[], mapper: OffsetMapper, parts: AbcPartInfo[]): AbcProblem[] {
    const out: AbcProblem[] = []
    for (const [barNum, , , , , , staves, voices] of bars) {
        const bn = String(barNum)
        const flagged = new Set<string>()
        const push = (ls: number, lv: number, hs: number, hv: number, s: number, e: number) => out.push(makeAbcProblem("voice_order", [nameOf(parts, ls, lv), nameOf(parts, hs, hv), bn], mapper.toOriginal(s), mapper.toOriginal(e)))

        voices.forEach((stV, si) => {
            if (stV.length >= 2) {
                const [ok, s, e] = pairCrossed(stV[0][5], stV[1][5])
                if (ok) {
                    flagged.add(`${si}.1`)
                    push(si, 1, si, 0, s, e)
                }
            }
        })
        if (staves.length >= 2 && voices[0].length && !((staves[0].clef && staves[0].clef.type) || "treble").startsWith("bass") && ((staves[1].clef && staves[1].clef.type) || "").startsWith("bass")) {
            const uVi = voices[0].length - 1
            voices[1].forEach((v, vi) => {
                if (flagged.has(`1.${vi}`)) return
                const [ok, s, e] = pairCrossed(voices[0][uVi][5], v[5])
                if (ok) push(1, vi, 0, uVi, s, e)
            })
        }
    }
    return out
}

export function checkAbcVoiceOrder(tune: TuneObject, abc: string, parts: AbcPartInfo[] = getAbcParts(tune)): AbcProblem[] {
    const mapper = buildOffsetMapper(abc)
    return checkVoiceOrderOnBars(collectBars(tune, mapper.normalized), mapper, parts)
}

function tokenizeLyrics(content: string, offset: number): [number, number, number][] {
    const trimmed = content.replace(/(?<!\\)%.*$/, "").replace(/\s+$/, "")
    if (!trimmed.trim()) return []
    const padded = /(?:^|[^\\])(?:\\\\)*-$/.test(trimmed) ? trimmed : `${trimmed} `
    const out: [number, number, number][] = []
    let last = 0
    let esc = false
    const flush = (end: number) => {
        const seg = padded.slice(last, end)
        const body = seg.trim()
        const s = last + seg.indexOf(body)
        last = end + 1
        if (body) out.push([0, offset + s, offset + s + body.length])
        return Boolean(body)
    }
    for (let i = 0; i < padded.length; i++) {
        const ch = padded[i]
        if (ch === " " || ch === "\t") flush(i)
        else if (!esc && ch === "-") {
            if (!flush(i) && out.length) out.push([1, offset + i, offset + i + 1])
        } else if (!esc && (ch === "_" || ch === "*" || ch === "|")) {
            flush(i)
            out.push([ch === "|" ? 2 : 1, offset + i, offset + i + 1])
        }
        esc = ch === "\\" && !esc
    }
    return out
}

function lyricsOf(tune: TuneObject, mapper: OffsetMapper): AbcProblem[] {
    const lines = getStaffLines(tune)
    if (!lines.length) return []
    const src = mapper.normalized.split("\n")
    const starts = getLineStarts(mapper.normalized)
    const checked = new Set<number>()
    const out: AbcProblem[] = []

    for (const line of lines) {
        for (const st of line.staff) {
            for (const voice of st.voices || []) {
                const elems = voice as RawAbcElem[]
                let lastLine = -1
                for (const el of elems) if (el.startChar !== undefined && el.el_type !== "stem") lastLine = Math.max(lastLine, getLineIndexAt(starts, trimCharRange(mapper.normalized, el.startChar, el.endChar).startChar))
                if (lastLine < 0) continue
                const items = elems.filter((el) => (el.el_type === "note" && !el.rest) || el.el_type === "bar")
                const total = items.filter((el) => el.el_type === "note").length
                if (!total) continue

                let verse = 0
                for (let scan = lastLine + 1; scan < src.length; scan++) {
                    const wm = /^(\s*w:\s*)(.*)$/.exec(src[scan])
                    if (!wm) {
                        if (/^\s*%/.test(src[scan])) continue
                        break
                    }
                    if (checked.has(scan)) continue
                    checked.add(scan)
                    verse++
                    const toks = tokenizeLyrics(wm[2], starts[scan] + wm[1].length)
                    if (!toks.length) continue

                    let idx = 0
                    let got = 0
                    let over = 0
                    let oS = -1
                    let oE = -1
                    for (const [kind, s, e] of toks) {
                        if (kind === 2) {
                            while (idx < items.length && items[idx].el_type !== "bar") if (items[idx++].el_type === "note") got++
                            if (idx < items.length) idx++
                        } else {
                            while (idx < items.length && items[idx].el_type !== "note") idx++
                            if (idx < items.length) {
                                got++
                                idx++
                            } else {
                                over++
                                if (oS < 0) oS = s
                                oE = e
                            }
                        }
                    }
                    if (got + over !== total) {
                        out.push(makeAbcProblem("syllables", [String(verse), String(got + over), String(total)], mapper.toOriginal(oS < 0 ? starts[scan] : oS), mapper.toOriginal(oE < 0 ? starts[scan] + src[scan].length : oE)))
                    }
                }
            }
        }
    }
    return out
}

export function checkAbcLyrics(tune: TuneObject, abc: string): AbcProblem[] {
    return lyricsOf(tune, buildOffsetMapper(abc))
}

export function checkAbcTune(tune: TuneObject | undefined, abc: string, converterProblems: AbcProblem[] = []): AbcProblem[] {
    const mapper = buildOffsetMapper(abc)
    const out: AbcProblem[] = []
    if (!tune || !hasAbcNotes(tune)) {
        if (!converterProblems.some((p) => p.severity === "error")) out.push(makeAbcProblem("no_notes", [], 0, Math.min(abc.length, 1), "error"))
        out.push(...warningsOf(tune, mapper), ...converterProblems)
    } else {
        const parts = getAbcParts(tune)
        const bars = collectBars(tune, mapper.normalized)
        out.push(...warningsOf(tune, mapper), ...checkMeasuresOnBars(bars, mapper, parts), ...checkVoiceOrderOnBars(bars, mapper, parts), ...lyricsOf(tune, mapper), ...converterProblems)
    }
    const seen = new Set<string>()
    return out
        .filter((p) => {
            const sig = `${p.severity}|${p.key}|${p.values.join(",")}|${p.startChar}|${p.endChar}`
            if (seen.has(sig)) return false
            seen.add(sig)
            return true
        })
        .sort((a, b) => (a.severity !== b.severity ? (a.severity === "error" ? -1 : 1) : a.startChar - b.startChar))
}

export function checkAbc(abc: string, parseOnly: AbcParseOnly, converterProblems: AbcProblem[] = []): AbcProblem[] {
    const norm = normalizeLineEndings(abc)
    let tune: TuneObject | undefined
    if (norm.trim()) {
        try {
            const p = parseOnly(norm)
            tune = p && p[0]
        } catch {
            tune = undefined
        }
    }
    return checkAbcTune(tune, abc, converterProblems)
}

function sameProblemValues(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false
    }
    return true
}

export function mergeNeighborProblems(problems: AbcProblem[], abc: string): AbcProblem[] {
    if (problems.length <= 1) return problems.map((problem) => ({ ...problem, values: [...problem.values] }))

    const lineStarts = getLineStarts(abc)
    const merged: AbcProblem[] = []
    let previousLine = -1

    for (const problem of problems) {
        const startLine = getLineIndexAt(lineStarts, problem.startChar)
        const endOffset = problem.endChar > problem.startChar ? problem.endChar - 1 : problem.startChar
        const endLine = getLineIndexAt(lineStarts, endOffset)
        const previous = merged[merged.length - 1]

        const canMerge = previous !== undefined && previousLine === startLine && startLine === endLine && previous.severity === problem.severity && previous.key === problem.key && sameProblemValues(previous.values, problem.values)

        if (canMerge) {
            previous.endChar = Math.max(previous.endChar, problem.endChar)
        } else {
            merged.push({ ...problem, values: [...problem.values] })
            previousLine = startLine === endLine ? startLine : -1
        }
    }

    return merged
}
