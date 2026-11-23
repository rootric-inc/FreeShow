import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import abcjs from "abcjs"
import { beforeAll, describe, expect, it } from "vitest"
import { normalizeMei } from "../../../../../../public/assets/sheet-music/mei.mjs"
import { convertAndCheckAbc } from "./abcToMei"

const verovioModulePath = fileURLToPath(new URL("../../../../../../public/assets/sheet-music/verovio-module.mjs", import.meta.url))
const verovioPath = fileURLToPath(new URL("../../../../../../public/assets/sheet-music/verovio.mjs", import.meta.url))
const workerModuleHref = new URL("../../../../../../public/assets/sheet-music/worker.mjs", import.meta.url).href
const hasVerovio = existsSync(verovioModulePath) && existsSync(verovioPath)

const ABIDE_WITH_ME = ["T: Abide With Me", "M: 4/4", "L: 1/4", "K: Eb", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] G2 G F | E2 B2 | c B B A | G4 |", "w: 1.~A-bide with me; fast falls the e-ven-tide;", "w: 2.~Swift to its close ebbs out life's lit-tle day;", "[V:A] E2 D D | E2 E2 | E D E F | E4 |", "[V:T] B2 B A | G2 E2 | E B B B | B4 |", "[V:B] E2 B, B, | C2 G,2 | A, B, C D | E4 |"].join("\n")

function findDuplicateXmlAttributes(xml: string): string[] {
    const duplicates: string[] = []
    const tagPattern = /<([A-Za-z_][\w:.-]*)\b([^<>]*?)>/g
    const attrPattern = /\b([A-Za-z_][\w:.-]*)\s*=/g
    let tagMatch: RegExpExecArray | null
    while ((tagMatch = tagPattern.exec(xml)) !== null) {
        const tagName = tagMatch[1]
        const attrText = tagMatch[2]
        const seen = new Set<string>()
        let attrMatch: RegExpExecArray | null
        attrPattern.lastIndex = 0
        while ((attrMatch = attrPattern.exec(attrText)) !== null) {
            const attrName = attrMatch[1]
            if (seen.has(attrName)) duplicates.push(`<${tagName}> duplicate attribute "${attrName}"`)
            seen.add(attrName)
        }
    }
    return duplicates
}

function expectNoDuplicateAttributes(mei: string) {
    expect(findDuplicateXmlAttributes(mei)).toEqual([])
}

describe("convertAndCheckAbc", () => {
    it("converts the four-part Abide With Me example with two staves, brace, bar.thru=false, four layers, verses, title and octave=-1", () => {
        const result = convertAndCheckAbc(ABIDE_WITH_ME, abcjs.parseOnly)
        expectNoDuplicateAttributes(result.mei)

        expect(result.title).toBe("Abide With Me")
        expect(result.hasError).toBe(false)
        expect(result.problems).toEqual([])
        expect(result.parts).toEqual([
            { staff: 1, layer: 1, name: "Soprano" },
            { staff: 1, layer: 2, name: "Alto" },
            { staff: 2, layer: 1, name: "Tenor" },
            { staff: 2, layer: 2, name: "Bass" }
        ])

        expect(result.mei.match(/<staffDef\b/g)).toHaveLength(2)
        expect(result.mei).toContain('<staffGrp symbol="brace" bar.thru="false">')
        expect(result.mei).toContain('clef.shape="G" clef.line="2"')
        expect(result.mei).toContain('clef.shape="F" clef.line="4"')
        expect(result.mei).toContain('keysig="3f"')
        expect(result.mei).toContain('meter.count="4" meter.unit="4"')
        expect(result.mei).not.toContain("<meiHead")
        expect(normalizeMei(result.mei)).toBe(result.mei)

        const measures = result.mei.match(/<measure\b[\s\S]*?<\/measure>/g) || []
        expect(measures).toHaveLength(4)
        for (const measure of measures) {
            expect(measure.match(/<staff\b/g)).toHaveLength(2)
            expect(measure.match(/<layer n="1">/g)).toHaveLength(2)
            expect(measure.match(/<layer n="2">/g)).toHaveLength(2)
        }

        // Upper voices have stems up and lower voices have stems down
        expect(result.mei).toContain('stem.dir="up"')
        expect(result.mei).toContain('stem.dir="down"')

        // Both verses appear under soprano
        expect(result.mei).toContain('<verse n="1">')
        expect(result.mei).toContain('<verse n="2">')
        expect(result.mei).toContain("A</syl>")
        expect(result.mei).toContain("bide</syl>")

        // Tenor has octave=-1, so its first note B2 lands on B flat below middle C (oct="3")
        const tenorOffset = ABIDE_WITH_ME.indexOf("[V:T] ") + 6
        expect(result.mei).toContain(`<note xml:id="c${tenorOffset}" dur="2" pname="b" oct="3" accid.ges="f" stem.dir="up">`)

        // Bass has octave=-1, so its first note E2 lands on E flat 3
        const bassOffset = ABIDE_WITH_ME.indexOf("[V:B] ") + 6
        expect(result.mei).toContain(`<note xml:id="c${bassOffset}" dur="2" pname="e" oct="3" accid.ges="f" stem.dir="down">`)
    })

    it("maps chords, dotted lengths, ties, rests and accidentals in K:Bb", () => {
        const abc = ["M: 4/4", "L: 1/4", "K: Bb", "[DG]3/2 [FA]/ [GB] [Ac] | [Bd]2- [Bd]/ z/ [=EB] |"].join("\n")
        const result = convertAndCheckAbc(abc, abcjs.parseOnly)
        expectNoDuplicateAttributes(result.mei)

        expect(result.problems).toEqual([])
        expect((result.mei.match(/<chord\b/g) || []).length).toBe(7)
        expect(result.mei).toContain('dur="4" dots="1"')
        expect(result.mei).toContain('tie="i"')
        expect(result.mei).toContain('tie="t"')
        expect(result.mei).toContain("<rest ")
        expect(result.mei).toContain('pname="e" oct="4" accid="n"')
        expect(result.mei).toContain('pname="b" oct="4" accid.ges="f"')
    })

    it("sets accid.ges for key signature and carried bar accidentals, including across line breaks, and resets at bar lines", () => {
        const keyAndCarry = ["T: Carry", "M: 4/4", "L: 1/4", "K: Eb", "=A A B c | A4 |]"].join("\n")
        const res1 = convertAndCheckAbc(keyAndCarry, abcjs.parseOnly)
        expectNoDuplicateAttributes(res1.mei)
        expect(res1.problems).toEqual([])
        const notes1 = res1.mei.match(/<note\b[^>]*>/g) || []
        expect(notes1).toHaveLength(5)
        expect(notes1[0]).toContain('pname="a" oct="4" accid="n"')
        expect(notes1[1]).not.toContain("accid")
        expect(notes1[2]).toContain('pname="b" oct="4" accid.ges="f"')
        expect(notes1[4]).toContain('pname="a" oct="4" accid.ges="f"')

        const sharpCarry = ["M: 4/4", "L: 1/4", "K: C", "^F F G A | F4 |]"].join("\n")
        const res2 = convertAndCheckAbc(sharpCarry, abcjs.parseOnly)
        expectNoDuplicateAttributes(res2.mei)
        expect(res2.problems).toEqual([])
        const notes2 = res2.mei.match(/<note\b[^>]*>/g) || []
        expect(notes2[0]).toContain('pname="f" oct="4" accid="s"')
        expect(notes2[1]).toContain('pname="f" oct="4" accid.ges="s"')
        expect(notes2[4]).not.toContain("accid")

        const tiedBarCarry = ["M: 4/4", "L: 1/4", "K: C", "C D E ^F- | F F G2 |]"].join("\n")
        const res3 = convertAndCheckAbc(tiedBarCarry, abcjs.parseOnly)
        expectNoDuplicateAttributes(res3.mei)
        expect(res3.problems).toEqual([])
        const notes3 = res3.mei.match(/<note\b[^>]*>/g) || []
        expect(notes3[3]).toContain('pname="f" oct="4" accid="s" tie="i"')
        expect(notes3[4]).toContain('pname="f" oct="4" accid.ges="s" tie="t"')
        expect(notes3[5]).not.toContain("accid")

        const acrossLineBreak = ["M: 4/4", "L: 1/4", "K: C", "^F F", "F F | F4 |]"].join("\n")
        const res4 = convertAndCheckAbc(acrossLineBreak, abcjs.parseOnly)
        expectNoDuplicateAttributes(res4.mei)
        expect(res4.problems).toEqual([])
        const notes4 = res4.mei.match(/<note\b[^>]*>/g) || []
        expect(notes4).toHaveLength(5)
        expect(notes4[0]).toContain('pname="f" oct="4" accid="s"')
        expect(notes4[1]).toContain('pname="f" oct="4" accid.ges="s"')
        expect(notes4[2]).toContain('pname="f" oct="4" accid.ges="s"')
        expect(notes4[3]).toContain('pname="f" oct="4" accid.ges="s"')
        expect(notes4[4]).not.toContain("accid")
    })

    it("writes accidentals for mid-bar key changes up to the bar line, deduplicates scoreDef changes, and warns", () => {
        const midBarKey = ["M: 4/4", "L: 1/4", "K: C", "F F [K:G] F F | F4 |]"].join("\n")
        const res = convertAndCheckAbc(midBarKey, abcjs.parseOnly)
        expectNoDuplicateAttributes(res.mei)
        const notes = res.mei.match(/<note\b[^>]*>/g) || []
        expect(notes).toHaveLength(5)
        expect(notes[0]).not.toContain("accid")
        expect(notes[1]).not.toContain("accid")
        expect(notes[2]).toContain('accid="s"')
        expect(notes[2]).not.toContain("accid.ges")
        expect(notes[3]).toContain('accid.ges="s"')
        expect(notes[3]).not.toContain('accid="s"')
        expect(notes[4]).toContain('accid.ges="s"')
        expect(res.mei).toContain('<scoreDef keysig="1s"/><measure n="2"')
        const warning = res.problems.find((p) => p.key === "sheet_music.problem_midbar_change")
        expect(warning).toBeDefined()
        expect(midBarKey.slice(warning!.startChar, warning!.endChar)).toBe("[K:G]")

        // Removing a sharp inside a bar writes a natural on the first affected note only
        const midBarKeyNatural = ["M: 4/4", "L: 1/4", "K: G", "F F [K:C] F F | F4 |]"].join("\n")
        const resNat = convertAndCheckAbc(midBarKeyNatural, abcjs.parseOnly)
        expectNoDuplicateAttributes(resNat.mei)
        const natNotes = resNat.mei.match(/<note\b[^>]*>/g) || []
        expect(natNotes).toHaveLength(5)
        expect(natNotes[0]).toContain('accid.ges="s"')
        expect(natNotes[1]).toContain('accid.ges="s"')
        expect(natNotes[2]).toContain('accid="n"')
        expect(natNotes[3]).not.toContain("accid")
        expect(natNotes[4]).not.toContain("accid")
        expect(resNat.mei).toContain('<scoreDef keysig="0"/><measure n="2"')

        // Mid-bar key change followed by another key change at the bar line: latest wins, single keysig attribute
        const midBarThenBarLine = ["M:4/4", "L:1/4", "K:C", "F F [K:G] F F | [K:F] F4 |"].join("\n")
        const resBoth = convertAndCheckAbc(midBarThenBarLine, abcjs.parseOnly)
        expectNoDuplicateAttributes(resBoth.mei)
        expect(resBoth.mei).toContain('<scoreDef keysig="1f"/><measure n="2"')
        expect(resBoth.mei).not.toContain('keysig="1s"')

        // Mid-bar key change before a line break: single scoreDef with one keysig attribute
        const midBarThenLineBreak = ["X:1", "T:t", "M:4/4", "L:1/4", "K:C", "C D E F | G A [K:G] B c |", "F G A B |"].join("\n")
        const resLineBreak = convertAndCheckAbc(midBarThenLineBreak, abcjs.parseOnly)
        expectNoDuplicateAttributes(resLineBreak.mei)
        expect(resLineBreak.mei).toContain('<scoreDef keysig="1s"/><measure n="3"')
        const lineBreakNotes = resLineBreak.mei.match(/<note\b[^>]*>/g) || []
        expect(lineBreakNotes[8]).toContain('pname="f" oct="4" accid.ges="s"')

        const barLineKey = ["M: 4/4", "L: 1/4", "K: C", "F4 | [K:G] F4 |]"].join("\n")
        const resBarLine = convertAndCheckAbc(barLineKey, abcjs.parseOnly)
        expectNoDuplicateAttributes(resBarLine.mei)
        expect(resBarLine.problems).toEqual([])
        const barLineNotes = resBarLine.mei.match(/<note\b[^>]*>/g) || []
        expect(barLineNotes[0]).not.toContain("accid")
        expect(barLineNotes[1]).toContain('accid.ges="s"')
        expect(resBarLine.mei).toContain('<scoreDef keysig="1s"/><measure n="2"')

        const midBarMeterAndClef = ["M: 4/4", "L: 1/4", "K: C", "C C [M:3/4] C C | C3 | C C [K:clef=bass] C | C3 |]"].join("\n")
        const resMc = convertAndCheckAbc(midBarMeterAndClef, abcjs.parseOnly)
        expectNoDuplicateAttributes(resMc.mei)
        const mcWarnings = resMc.problems.filter((p) => p.key === "sheet_music.problem_midbar_change")
        expect(mcWarnings).toHaveLength(2)
        expect(resMc.mei).toContain('<scoreDef meter.count="3" meter.unit="4"/><measure n="2"')
        expect(resMc.mei).toContain('<clef clef.shape="F" clef.line="4"/>')
    })

    it("uses rest.text for multi-bar rest count", () => {
        const abc = ["M: 3/4", "L: 1/4", "K: C", "C3 | Z4 | Z1 | C3 |"].join("\n")
        const result = convertAndCheckAbc(abc, abcjs.parseOnly)
        expectNoDuplicateAttributes(result.mei)
        expect(result.problems).toEqual([])
        expect(result.mei).toContain('num="4"')
        expect(result.mei).toContain("<multiRest ")
        expect(result.mei).toContain("<mRest ")
    })

    it("draws lyric extenders for both spaced and attached underscores, but not stars", () => {
        const spaced = ["M: 4/4", "L: 1/4", "K: C", "C D E F |", "w: One _ two three"].join("\n")
        const resSpaced = convertAndCheckAbc(spaced, abcjs.parseOnly)
        expectNoDuplicateAttributes(resSpaced.mei)
        expect(resSpaced.mei).toContain('<syl con="u">One</syl>')

        const attached = ["M: 4/4", "L: 1/4", "K: C", "C D E F |", "w: One_ two three"].join("\n")
        const resAttached = convertAndCheckAbc(attached, abcjs.parseOnly)
        expectNoDuplicateAttributes(resAttached.mei)
        expect(resAttached.mei).toContain('<syl con="u">One</syl>')

        const star = ["M: 4/4", "L: 1/4", "K: C", "C D E F |", "w: One * two three"].join("\n")
        const resStar = convertAndCheckAbc(star, abcjs.parseOnly)
        expectNoDuplicateAttributes(resStar.mei)
        expect(resStar.mei).not.toContain('con="u"')
    })

    it("does not create empty bars for consecutive bar lines and preserves repeat marks", () => {
        const doubleBar = "M: 4/4\nL: 1/4\nK: C\nC D E F | | G A B c |]"
        const r1 = convertAndCheckAbc(doubleBar, abcjs.parseOnly)
        expectNoDuplicateAttributes(r1.mei)
        expect(r1.mei.match(/<measure\b/g)).toHaveLength(2)

        const repeatAndDouble = "M: 4/4\nL: 1/4\nK: C\nC D E F :|] [| G A B c |]"
        const r2 = convertAndCheckAbc(repeatAndDouble, abcjs.parseOnly)
        expectNoDuplicateAttributes(r2.mei)
        expect(r2.mei.match(/<measure\b/g)).toHaveLength(2)
        expect(r2.mei).toContain('<measure n="1" right="rptend">')
        expect(r2.mei).toContain('<measure n="2" left="dbl" right="end">')

        const trailingDouble = "M: 4/4\nL: 1/4\nK: C\nC D E F |] |"
        const r3 = convertAndCheckAbc(trailingDouble, abcjs.parseOnly)
        expectNoDuplicateAttributes(r3.mei)
        expect(r3.mei.match(/<measure\b/g)).toHaveLength(1)
        expect(r3.mei).toContain('<measure n="1" right="end">')

        const repeatBackToBack = "M: 4/4\nL: 1/4\nK: C\nC D E F :| |: G A B c |]"
        const r4 = convertAndCheckAbc(repeatBackToBack, abcjs.parseOnly)
        expectNoDuplicateAttributes(r4.mei)
        expect(r4.mei.match(/<measure\b/g)).toHaveLength(2)
        expect(r4.mei).toContain('<measure n="1" right="rptend">')
        expect(r4.mei).toContain('<measure n="2" left="rptstart" right="end">')
    })

    it("handles Open Hymnal style header comments and staves directives", () => {
        const openHymnal = ["X:1", "T:Test Hymn", "M: 4/4 % time signature", "L: 1/4", "%%staves (S1 S2) | (S3 S4)", "V: S1", "V: S2", "V: S3 clef=bass", "V: S4 clef=bass", "K: D % key signature", "[V:S1] D2 F2 | A4 |", "[V:S2] A,2 D2 | D4 |", "[V:S3] F,2 A,2 | F,4 |", "[V:S4] D,2 D,2 | D,4 |"].join("\n")
        const result = convertAndCheckAbc(openHymnal, abcjs.parseOnly)
        expectNoDuplicateAttributes(result.mei)
        expect(result.problems).toEqual([])
        expect(result.title).toBe("Test Hymn")
        expect(result.mei).toContain('keysig="2s"')
        expect(result.mei).toContain('meter.count="4" meter.unit="4"')
        expect(result.mei.match(/<staffDef\b/g)).toHaveLength(2)
    })

    it("maps triplets, ties across bar lines, beams, slurs and fermatas", () => {
        const abc = ["T: Features", "M: 3/4", "L: 1/4", "K: F", "F3/2 G/ A- | A (3c/B/A/ G | (F G) !fermata!F |]"].join("\n")
        const result = convertAndCheckAbc(abc, abcjs.parseOnly)
        expectNoDuplicateAttributes(result.mei)

        expect(result.problems).toEqual([])
        expect(result.mei).toContain('<tuplet num="3" numbase="2">')
        expect(result.mei).toContain("</tuplet>")
        expect(result.mei).toContain("<beam>")
        expect(result.mei).toContain('fermata="above"')
        expect(result.mei).toContain("<slur ")

        const measures = result.mei.match(/<measure\b[\s\S]*?<\/measure>/g) || []
        expect(measures[0]).toContain('tie="i"')
        expect(measures[1]).toContain('tie="t"')
    })

    it("handles M:none and does not emit manual system breaks", () => {
        const freeMeter = ["M: none", "L: 1/4", "K: C", "C D E F |", "G A B c |"].join("\n")
        const resFree = convertAndCheckAbc(freeMeter, abcjs.parseOnly)
        expectNoDuplicateAttributes(resFree.mei)
        expect(resFree.problems).toEqual([])
        expect(resFree.mei).not.toContain("meter.count")
        expect(resFree.mei).toContain('metcon="false"')
        expect(resFree.mei).not.toContain("<sb/>")
    })

    it("assigns xml:id=c<n> matching where each note starts in the ABC text", () => {
        const result = convertAndCheckAbc(ABIDE_WITH_ME, abcjs.parseOnly)
        expectNoDuplicateAttributes(result.mei)
        const idMatches = Array.from(result.mei.matchAll(/<(?:note|chord|rest|space) xml:id="c(\d+)"/g))
        expect(idMatches.length).toBeGreaterThan(20)

        for (const match of idMatches) {
            const offset = Number(match[1])
            const ch = ABIDE_WITH_ME[offset]
            expect(/[A-Ga-gzx^_=[\](]/.test(ch)).toBe(true)
        }

        const ranges = result.noteRanges || []
        expect(ranges[0].startChar).toBe(ABIDE_WITH_ME.indexOf("G2"))
        expect(ABIDE_WITH_ME.slice(ranges[0].startChar, ranges[0].endChar)).toBe("G2")
    })

    it("reports warnings for repeat endings, grace notes, chord symbols, text annotations and non-fermata decorations, and draws voice overlays cleanly", () => {
        const repeatEnding = "M: 4/4\nL: 1/4\nK: C\nC D E F |1 G A B c :|2 c B A G |]"
        const r1 = convertAndCheckAbc(repeatEnding, abcjs.parseOnly)
        expectNoDuplicateAttributes(r1.mei)
        expect(r1.problems.some((p) => p.severity === "warning" && p.key === "sheet_music.problem_repeat_ending")).toBe(true)

        const graceNote = "M: 4/4\nL: 1/4\nK: C\n{g}A B c d |"
        const r2 = convertAndCheckAbc(graceNote, abcjs.parseOnly)
        expectNoDuplicateAttributes(r2.mei)
        expect(r2.problems.some((p) => p.severity === "warning" && p.key === "sheet_music.problem_grace_notes")).toBe(true)

        const chordSymbol = 'M: 4/4\nL: 1/4\nK: C\n"C" C D E F |'
        const r3 = convertAndCheckAbc(chordSymbol, abcjs.parseOnly)
        expectNoDuplicateAttributes(r3.mei)
        expect(r3.problems.some((p) => p.severity === "warning" && p.key === "sheet_music.problem_chord_symbols")).toBe(true)
        expect(r3.problems.some((p) => p.key === "sheet_music.problem_text_annotations")).toBe(false)

        const annotation = 'M: 4/4\nL: 1/4\nK: C\n"^Refrain" C D E F |'
        const rAnnot = convertAndCheckAbc(annotation, abcjs.parseOnly)
        expectNoDuplicateAttributes(rAnnot.mei)
        expect(rAnnot.problems.some((p) => p.severity === "warning" && p.key === "sheet_music.problem_text_annotations")).toBe(true)
        expect(rAnnot.problems.some((p) => p.key === "sheet_music.problem_chord_symbols")).toBe(false)

        const decorations = "M: 4/4\nL: 1/4\nK: C\n!p!C .D !accent!E !trill!F |"
        const rDeco = convertAndCheckAbc(decorations, abcjs.parseOnly)
        expectNoDuplicateAttributes(rDeco.mei)
        const decoProblems = rDeco.problems.filter((p) => p.key === "sheet_music.problem_decorations")
        expect(decoProblems).toHaveLength(1)

        const overlay = "M: 4/4\nL: 1/4\nK: C\nc d e f & C D E F |"
        const r4 = convertAndCheckAbc(overlay, abcjs.parseOnly)
        expectNoDuplicateAttributes(r4.mei)
        expect(r4.problems).toEqual([])
        expect(r4.mei).toContain('<layer n="1">')
        expect(r4.mei).toContain('<layer n="2">')
    })

    it("combines conversion and checks in convertAndCheckAbc", () => {
        const clean = convertAndCheckAbc(ABIDE_WITH_ME, abcjs.parseOnly)
        expectNoDuplicateAttributes(clean.mei)
        expect(clean.hasError).toBe(false)
        expect(clean.problems).toEqual([])
        expect(clean.title).toBe("Abide With Me")

        const empty = convertAndCheckAbc("T: Empty\nM: 4/4\nK: C\n", abcjs.parseOnly)
        expect(empty.hasError).toBe(true)
        expect(empty.problems.some((p) => p.severity === "error")).toBe(true)
    })
})

describe.skipIf(!hasVerovio)("convertAndCheckAbc rendered through Verovio worker (requires public/assets/sheet-music/verovio-module.mjs from preBuild)", () => {
    let handleMessage: (message: Record<string, unknown>) => Promise<any>

    beforeAll(async () => {
        const mod = await import(/* @vite-ignore */ workerModuleHref)
        handleMessage = mod.handleMessage
    })

    it("renders the already-normalized Abide With Me MEI directly in Verovio", async () => {
        const converted = convertAndCheckAbc(ABIDE_WITH_ME, abcjs.parseOnly)
        expectNoDuplicateAttributes(converted.mei)
        expect(converted.problems).toEqual([])
        expect(converted.mei.length).toBeGreaterThan(500)
        expect(normalizeMei(converted.mei)).toBe(converted.mei)

        // Direct preview render keeps xml:id attributes for click-to-find
        const preview = await handleMessage({ type: "render", mei: converted.mei, pageWidth: 1840 })
        expect(preview.svg).toContain("<svg")
        expect(preview.pages).toBe(1)
        expect(preview.fits).toBe(true)
        const firstOffset = ABIDE_WITH_ME.indexOf("G2")
        expect(preview.svg).toContain(`id="c${firstOffset}"`)

        // Worker load still accepts the converter's normalized MEI
        const loaded = await handleMessage({ type: "load", text: converted.mei })
        expect(loaded.measures).toBe(4)
        expect(loaded.mei).toContain('bar.thru="false"')
        expect(loaded.mei).not.toContain("<meiHead")
    })
})
