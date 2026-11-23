import type { KeySignature, Meter, NotePitch, Staff, TuneObject } from "abcjs"
import type { AbcPartInfo, AbcProblem, OffsetMapper, RawAbcElem } from "./abcChecks"
import { buildOffsetMapper, getAbcParts, getLineIndexAt, getLineStarts, getStaffLines, hasAbcNotes, makeAbcProblem, splitVoiceIntoMeasures, trimCharRange } from "./abcChecks"
import type { AbcParseOnly } from "./abcjs"

export interface AbcToMeiOptions {
    omitMeter?: boolean
}

export interface AbcNoteRange {
    id: string
    startChar: number
    endChar: number
}

export interface AbcToMeiResult {
    mei: string
    title: string
    problems: AbcProblem[]
    parts: AbcPartInfo[]
    noteRanges?: AbcNoteRange[]
}

interface RawNotePitch extends NotePitch {
    startTie?: unknown
    endTie?: unknown
    startSlur?: ({ label?: number } | number)[]
    endSlur?: ({ label?: number } | number)[]
}

const PN = "cdefgab"
const ACC: Record<string, string> = { sharp: "s", flat: "f", natural: "n", dblsharp: "x", dblflat: "ff" }
const RBAR: Record<string, string> = { bar_thin_thin: "dbl", bar_thin_thick: "end", bar_right_repeat: "rptend", bar_dbl_repeat: "rptboth", bar_invisible: "invis" }
const CLEFS: Record<string, string> = { bass: `F" clef.line="4`, alto: `C" clef.line="3`, tenor: `C" clef.line="4`, perc: `perc" clef.line="3` }
const IGNORED = new Set(["stem", "style", "tempo", "part", "scale", "midi", "transpose", "break"])
const DURS = ["breve", "1", "2", "4", "8", "16", "32", "64", "128"]
const OVERLAY_RE = /%.*$|"(?:\\.|[^"])*"|![^!]*!|\+[^+]*\+|\[[A-Za-z]:[^\]]*\]|(&)/g

const escXml = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function durOf(v: number): [string, number] | null {
    if (!Number.isFinite(v) || v <= 0) return null
    for (let dots = 0; dots <= 3; dots++) {
        const sc = 2 - 1 / 2 ** dots
        for (let i = 0; i < DURS.length; i++) if (Math.abs((2 / 2 ** i) * sc - v) < 1e-6) return [DURS[i], dots]
    }
    return null
}

function restDursOf(v: number): [string, number][] | null {
    const one = durOf(v)
    if (one) return [one]
    if (!Number.isFinite(v) || v <= 0) return null
    const segs: [string, number][] = []
    let rem = v
    for (let i = 0; i < 3 && rem > 1e-6; i++) {
        const ex = durOf(rem)
        if (ex) return [...segs, ex]
        const bi = DURS.findIndex((_, k) => 2 / 2 ** k <= rem + 1e-6)
        if (bi < 0) return null
        segs.push([DURS[bi], 0])
        rem -= 2 / 2 ** bi
    }
    return rem < 1e-6 && segs.length ? segs : null
}

const durAttr = (d: [string, number]) => `dur="${d[0]}"${d[1] ? ` dots="${d[1]}"` : ""}`
const keySig = (key: KeySignature | undefined) => {
    const sig = (key && key.accidentals ? key.accidentals : []).filter((a) => a.acc === "flat" || a.acc === "sharp")
    return sig.length ? `${sig.length}${sig[0].acc === "flat" ? "f" : "s"}` : "0"
}
const meterAttrs = (m: Meter | undefined) => (!m ? "" : m.type === "common_time" ? ` meter.count="4" meter.unit="4" meter.sym="common"` : m.type === "cut_time" ? ` meter.count="2" meter.unit="2" meter.sym="cut"` : m.value && m.value[0] && m.value[0].num && m.value[0].den ? ` meter.count="${escXml(m.value[0].num)}" meter.unit="${escXml(m.value[0].den)}"` : "")
const clefAttrs = (ct = "treble") => {
    const dm = /([+-])8$/.exec(ct)
    const b = dm ? ct.slice(0, -2) : ct
    return `clef.shape="${CLEFS[b] || `G" clef.line="2`}"${dm ? ` clef.dis="8" clef.dis.place="${dm[1] === "+" ? "above" : "below"}"` : ""}${b === "none" ? ` clef.visible="false"` : ""}`
}
const slurLbl = (e: { label?: number } | number): string | null => (typeof e === "number" ? String(e) : e && typeof e.label === "number" ? String(e.label) : null)

function detectOverlays(norm: string, tune: TuneObject, mapper: OffsetMapper): AbcProblem[] {
    const src = norm.split("\n")
    const starts = getLineStarts(norm)
    const idxs = new Set<number>()
    for (const l of getStaffLines(tune)) for (const st of l.staff) for (const v of st.voices || []) for (const el of v as RawAbcElem[]) if (el.startChar !== undefined && el.el_type !== "stem") idxs.add(getLineIndexAt(starts, trimCharRange(norm, el.startChar, el.endChar).startChar))
    const out: AbcProblem[] = []
    for (const li of Array.from(idxs).sort((a, b) => a - b)) {
        const base = starts[li] || 0
        OVERLAY_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = OVERLAY_RE.exec(src[li] || ""))) {
            if (m[1]) out.push(makeAbcProblem("voice_overlay", [], mapper.toOriginal(base + m.index), mapper.toOriginal(base + m.index + 1)))
        }
    }
    return out
}

export function collectAbcNoteRanges(tune: TuneObject | undefined, abc: string): AbcNoteRange[] {
    const mapper = buildOffsetMapper(abc)
    const ranges: AbcNoteRange[] = []
    const seen = new Set<string>()
    for (const l of getStaffLines(tune)) {
        for (const st of l.staff) {
            for (const v of st.voices || []) {
                for (const el of v as RawAbcElem[]) {
                    if (el.el_type !== "note" || el.startChar === undefined) continue
                    const r = trimCharRange(mapper.normalized, el.startChar, el.endChar)
                    const sc = mapper.toOriginal(r.startChar)
                    const id = `c${sc}`
                    if (!seen.has(id)) {
                        seen.add(id)
                        ranges.push({ id, startChar: sc, endChar: mapper.toOriginal(r.endChar) })
                    }
                }
            }
        }
    }
    return ranges.sort((a, b) => a.startChar - b.startChar)
}

export function convertTuneToMei(tune: TuneObject | undefined, abc: string, options: AbcToMeiOptions = {}): AbcToMeiResult {
    const mapper = buildOffsetMapper(abc)
    const norm = mapper.normalized
    const meta = tune && (tune as TuneObject & { metaText?: { title?: string } }).metaText
    const title = meta && meta.title ? meta.title.trim() : ""
    if (!tune || !hasAbcNotes(tune)) return { mei: "", title, problems: [makeAbcProblem("no_notes", [], 0, Math.min(abc.length, 1), "error")], parts: [], noteRanges: [] }

    const lines = getStaffLines(tune)
    const parts = getAbcParts(tune)
    const problems = detectOverlays(norm, tune, mapper)
    const first: Staff[] = lines[0].staff

    let curKey = ""
    let keyAcc: Record<string, string> = {}
    const setKey = (key: KeySignature | undefined) => {
        keyAcc = {}
        if (key && key.accidentals) for (const a of key.accidentals) keyAcc[a.note.toLowerCase()] = a.acc === "flat" ? "f" : a.acc === "sharp" ? "s" : "n"
        curKey = keySig(key)
    }
    setKey(first[0] && first[0].key)

    let curMeter = first[0] && first[0].meter
    let curMeterStr = meterAttrs(curMeter)
    const curClefs = first.map((s) => (s.clef && s.clef.type) || "treble")
    const staffDefs = first.map((s, si) => `<staffDef n="${si + 1}" lines="5" ${clefAttrs(s.clef && s.clef.type)}/>`).join("")
    const out: string[] = [`<scoreDef keysig="${curKey}"${options.omitMeter ? "" : curMeterStr}><staffGrp${first.length > 1 ? ` symbol="brace"` : ""} bar.thru="false">${staffDefs}</staffGrp></scoreDef><section>`]

    const inWord: Record<string, boolean> = {}
    const openSlurs: Record<string, [string, number]> = {}
    const controls: Record<number, string[]> = {}
    const tiedAcc: Record<string, Record<string, string>> = {}
    const usedIds = new Set<string>()
    const noteRanges: AbcNoteRange[] = []
    const mBufs: string[][] = []
    let mNo = 0

    const allocId = (sc: number) => {
        let id = `c${sc}`
        for (let n = 2; usedIds.has(id); n++) id = `c${sc}_${n}`
        usedIds.add(id)
        return id
    }
    const warn = (k: string, v: string[], el: RawAbcElem) => {
        const r = trimCharRange(norm, el.startChar, el.endChar)
        problems.push(makeAbcProblem(k, v, mapper.toOriginal(r.startChar), mapper.toOriginal(r.endChar)))
    }
    const closeSlur = (k: string, endid: string) => {
        const o = openSlurs[k]
        if (!o) return
        delete openSlurs[k]
        ;(controls[o[1]] = controls[o[1]] || []).push(`<slur startid="#${o[0]}" endid="#${endid}"/>`)
    }
    const lyricXml = (el: RawAbcElem, si: number, vi: number) =>
        (el.lyric || [])
            .map((ly, n) => {
                if (!ly || (ly.syllable === "" && ly.divider === " ")) return ""
                const k = `${si}.${vi}.${n}`
                const prev = Boolean(inWord[k])
                const dash = ly.divider === "-"
                inWord[k] = dash
                const wp = prev && dash ? "m" : prev ? "t" : dash ? "i" : ""
                const con = dash ? "d" : ly.divider === "_" ? "u" : ""
                return `<verse n="${n + 1}"><syl${wp ? ` wordpos="${wp}"` : ""}${con ? ` con="${con}"` : ""}>${escXml(ly.syllable)}</syl></verse>`
            })
            .join("")

    const slur = (list: ({ label?: number } | number)[] | undefined, isStart: boolean, si: number, vi: number, nid: string, mIndex: number) => {
        for (const s of list || []) {
            const l = slurLbl(s)
            if (l === null) continue
            const k = `${si}.${vi}.${l}`
            if (isStart) openSlurs[k] = [nid, mIndex]
            else closeSlur(k, nid)
        }
    }
    const scoreChange = (key: KeySignature | undefined, meter: Meter | undefined, target: string[], onlyDiff: boolean) => {
        if (key && (!onlyDiff || keySig(key) !== curKey)) {
            setKey(key)
            target.push(` keysig="${curKey}"`)
        }
        if (meter && (!onlyDiff || meterAttrs(meter) !== curMeterStr)) {
            curMeter = meter
            curMeterStr = meterAttrs(curMeter)
            target.push(curMeterStr)
        }
    }

    lines.forEach((line, li) => {
        const lineChanges: string[] = []
        if (li > 0 && line.staff[0]) scoreChange(line.staff[0].key, line.staff[0].meter, lineChanges, true)

        const pv = line.staff.map((st, si) =>
            (st.voices || []).map((v, vi) =>
                splitVoiceIntoMeasures(
                    v,
                    norm,
                    si === 0 && vi === 0,
                    (el) => {
                        if (el.startEnding) warn("repeat_ending", [], el)
                        if (el.gracenotes && el.gracenotes.length) warn("grace_notes", [], el)
                        if (el.chord && el.chord.length) warn("chord_symbols", [], el)
                    },
                    (el) => {
                        if (!IGNORED.has(el.el_type)) warn("unsupported_element", [String(el.el_type || "unknown")], el)
                    },
                    vi === 0
                )
            )
        )
        const count = Math.max(0, ...pv.flat().map((ms) => ms.length))
        if (!count) return

        for (let m = 0; m < count; m++) {
            const xml: string[] = []
            const top = pv[0] && pv[0][0] && pv[0][0][m]
            const sc = m === 0 ? [...lineChanges] : []
            if (top && top.change) scoreChange(top.change.key, top.change.meter, sc, false)
            if (sc.length) xml.push(`<scoreDef${sc.join("")}/>`)

            const right = top && top.barType ? RBAR[top.barType] || "" : "invis"
            const left = top && top.leftBarType === "bar_left_repeat" ? "rptstart" : top && top.leftBarType === "bar_thick_thin" ? "dbl" : ""
            xml.push(`<measure n="${mNo + m + 1}"${left ? ` left="${left}"` : ""}${right ? ` right="${right}"` : ""}${curMeter ? "" : ` metcon="false"`}>`)

            const mIndex = mBufs.length
            pv.forEach((voices, si) => {
                xml.push(`<staff n="${si + 1}">`)
                const lineClef = m === 0 && li > 0 && line.staff[si] && line.staff[si].clef ? line.staff[si].clef.type : undefined
                const v0m = voices[0] && voices[0][m]
                const newClef = (v0m && v0m.change && v0m.change.clef && v0m.change.clef.type) || (lineClef && lineClef !== curClefs[si] ? lineClef : undefined)

                voices.forEach((ms, vi) => {
                    const vKey = `${si}.${vi}`
                    const barAcc: Record<string, string> = {}
                    const prevTied = tiedAcc[vKey] || {}
                    const nextTied: Record<string, string> = {}
                    const stem = voices.length >= 2 ? ` stem.dir="${vi ? "down" : "up"}"` : ""
                    xml.push(`<layer n="${vi + 1}">`)
                    if (vi === 0 && newClef) {
                        curClefs[si] = newClef
                        xml.push(`<clef ${clefAttrs(newClef)}/>`)
                    }

                    const tags: string[] = []
                    const closeTag = (tag: string) => {
                        const idx = tags.lastIndexOf(tag)
                        if (idx === -1) return
                        const reopen: string[] = []
                        while (tags.length - 1 > idx) {
                            const t = tags.pop()!
                            xml.push(`</${t}>`)
                            reopen.push(t)
                        }
                        tags.pop()
                        xml.push(`</${tag}>`)
                        while (reopen.length) {
                            if (reopen.pop() === "beam") {
                                xml.push("<beam>")
                                tags.push("beam")
                            }
                        }
                    }

                    for (const el of ms[m] ? ms[m].events : []) {
                        if (el.gracenotes && el.gracenotes.length) warn("grace_notes", [], el)
                        if (el.chord && el.chord.length) warn("chord_symbols", [], el)

                        const tr = trimCharRange(norm, el.startChar, el.endChar)
                        const origS = mapper.toOriginal(tr.startChar)
                        const id = allocId(origS)
                        if (el.startChar !== undefined && id === `c${origS}`) noteRanges.push({ id, startChar: origS, endChar: mapper.toOriginal(tr.endChar) })
                        const rawD = Array.isArray(el.duration) ? el.duration[0] : el.duration
                        const isWhole = Boolean(el.rest && (el.rest.type === "whole" || el.rest.type === "multimeasure"))
                        const d = typeof rawD === "number" ? durOf(rawD) : null
                        const rds = el.rest && !isWhole && typeof rawD === "number" ? restDursOf(rawD) : null
                        if (!isWhole && !d && !rds) {
                            warn("unsupported_duration", [], el)
                            continue
                        }

                        if (el.startTriplet && !tags.includes("tuplet")) {
                            xml.push(`<tuplet num="${el.startTriplet}" numbase="${Math.max(1, Math.round(el.startTriplet * (el.tripletMultiplier || 2 / 3)))}">`)
                            tags.push("tuplet")
                        }
                        if (el.startBeam && !el.endBeam && !tags.includes("beam")) {
                            xml.push("<beam>")
                            tags.push("beam")
                        }

                        const deco = el.decoration || []
                        const ferm = deco.includes("invertedfermata") ? ` fermata="below"` : deco.includes("fermata") ? ` fermata="${vi === 1 ? "below" : "above"}"` : ""

                        if (el.rest) {
                            if (el.rest.type === "multimeasure" && typeof rawD === "number" && rawD > 1) xml.push(`<multiRest xml:id="${id}" num="${Math.round(rawD)}"/>`)
                            else if (el.rest.type === "whole") xml.push(`<mRest xml:id="${id}"${ferm}/>`)
                            else {
                                const tag = el.rest.type === "invisible" || el.rest.type === "spacer" ? "space" : "rest"
                                ;(rds || [d!]).forEach((seg, idx) => xml.push(`<${tag} xml:id="${idx ? `${id}_p${idx + 1}` : id}" ${durAttr(seg)}${tag === "rest" && !idx ? ferm : ""}/>`))
                            }
                        } else {
                            const ps = (el.pitches || []) as RawNotePitch[]
                            if (!ps.length) continue
                            const notes = ps.map((p, pi) => {
                                // abcjs already shifts p.pitch by any voice octave= setting
                                const step = ((p.pitch % 7) + 7) % 7
                                const oct = 4 + Math.floor(p.pitch / 7)
                                const nid = ps.length > 1 ? `${id}-${pi}` : id
                                const pk = `${step}.${oct}`
                                const tie = p.startTie && p.endTie ? ` tie="m"` : p.startTie ? ` tie="i"` : p.endTie ? ` tie="t"` : ""
                                const wr = p.accidental && ACC[p.accidental]
                                if (wr) barAcc[pk] = wr
                                const snd = wr || barAcc[pk] || (p.endTie && prevTied[pk]) || keyAcc[PN[step]] || "n"
                                if (p.startTie) nextTied[pk] = snd
                                else delete nextTied[pk]
                                const acc = (wr ? ` accid="${wr}"` : "") + (!wr && snd !== "n" ? ` accid.ges="${snd}"` : "")
                                slur(p.startSlur, true, si, vi, nid, mIndex)
                                slur(p.endSlur, false, si, vi, nid, mIndex)
                                return [nid, `pname="${PN[step]}" oct="${oct}"${acc}${tie}`] as const
                            })
                            slur(el.startSlur, true, si, vi, notes[0][0], mIndex)
                            const verses = lyricXml(el, si, vi)
                            xml.push(notes.length === 1 ? `<note xml:id="${notes[0][0]}" ${durAttr(d!)} ${notes[0][1]}${stem}${ferm}>${verses}</note>` : `<chord xml:id="${id}" ${durAttr(d!)}${stem}${ferm}>${notes.map(([nid, a], i) => `<note xml:id="${nid}" ${a}>${i === notes.length - 1 ? verses : ""}</note>`).join("")}</chord>`)
                            slur(el.endSlur, false, si, vi, notes[notes.length - 1][0], mIndex)
                        }

                        if (el.endBeam && !el.startBeam) closeTag("beam")
                        if (el.endTriplet) closeTag("tuplet")
                    }

                    while (tags.length) xml.push(`</${tags.pop()!}>`)
                    tiedAcc[vKey] = nextTied
                    xml.push("</layer>")
                })
                xml.push("</staff>")
            })
            xml.push("</measure>")
            mBufs.push(xml)
        }
        mBufs[mBufs.length - 1].push("<sb/>")
        mNo += count
    })

    out.push(mBufs.map((xml, idx) => xml.join("").replace("</measure>", `${(controls[idx] || []).join("")}</measure>`)).join(""), "</section>")
    return {
        mei: `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><meiHead><fileDesc><titleStmt><title>${escXml(title)}</title></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score>${out.join("")}</score></mdiv></body></music></mei>`,
        title,
        problems,
        parts,
        noteRanges: noteRanges.sort((a, b) => a.startChar - b.startChar)
    }
}

export function abcToMei(abc: string, parseOnly: AbcParseOnly, options: AbcToMeiOptions = {}): AbcToMeiResult {
    const norm = buildOffsetMapper(abc).normalized
    let tune: TuneObject | undefined
    if (norm.trim()) {
        try {
            tune = parseOnly(norm)?.[0]
        } catch {
            tune = undefined
        }
    }
    return convertTuneToMei(tune, abc, options)
}
