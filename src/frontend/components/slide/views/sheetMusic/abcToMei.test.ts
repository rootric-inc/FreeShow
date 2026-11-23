import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import abcjs from "abcjs"
import { beforeAll, describe, expect, it } from "vitest"
import { abcToMei, collectAbcNoteRanges } from "./abcToMei"

const verovioModulePath = fileURLToPath(new URL("../../../../../../public/assets/sheet-music/verovio-module.mjs", import.meta.url))
const verovioPath = fileURLToPath(new URL("../../../../../../public/assets/sheet-music/verovio.mjs", import.meta.url))
const workerModuleHref = new URL("../../../../../../public/assets/sheet-music/worker.mjs", import.meta.url).href
const hasVerovio = existsSync(verovioModulePath) && existsSync(verovioPath)

const ABIDE_WITH_ME = ["T: Abide With Me", "M: 4/4", "L: 1/4", "K: Eb", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] G2 G F | E2 B2 | c B B A | G4 |", "w: 1.~A-bide with me; fast falls the e-ven-tide;", "w: 2.~Swift to its close ebbs out life's lit-tle day;", "[V:A] E2 D D | E2 E2 | E D E F | E4 |", "[V:T] B2 B A | G2 E2 | E B B B | B4 |", "[V:B] E2 B, B, | C2 G,2 | A, B, C D | E4 |"].join("\n")

describe("abcToMei", () => {
    it("converts the four-part Abide With Me example with two staves, brace, bar.thru=false, four layers, verses, title and octave=-1", () => {
        const result = abcToMei(ABIDE_WITH_ME, abcjs.parseOnly)

        expect(result.title).toBe("Abide With Me")
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
        const result = abcToMei(abc, abcjs.parseOnly)

        expect(result.problems).toEqual([])
        expect((result.mei.match(/<chord\b/g) || []).length).toBe(7)
        expect(result.mei).toContain('dur="4" dots="1"')
        expect(result.mei).toContain('tie="i"')
        expect(result.mei).toContain('tie="t"')
        expect(result.mei).toContain("<rest ")
        expect(result.mei).toContain('pname="e" oct="4" accid="n"')
        expect(result.mei).toContain('pname="b" oct="4" accid.ges="f"')
    })

    it("sets accid.ges for key signature and carried bar accidentals, and resets at bar lines", () => {
        const keyAndCarry = ["T: Carry", "M: 4/4", "L: 1/4", "K: Eb", "=A A B c | A4 |]"].join("\n")
        const res1 = abcToMei(keyAndCarry, abcjs.parseOnly)
        expect(res1.problems).toEqual([])
        const notes1 = res1.mei.match(/<note\b[^>]*>/g) || []
        expect(notes1).toHaveLength(5)
        // =A written natural
        expect(notes1[0]).toContain('pname="a" oct="4" accid="n"')
        // second A in same bar sounds natural (no accid.ges="f")
        expect(notes1[1]).not.toContain("accid")
        // B sounds flat from K:Eb
        expect(notes1[2]).toContain('pname="b" oct="4" accid.ges="f"')
        // A in bar 2 returns to key signature flat
        expect(notes1[4]).toContain('pname="a" oct="4" accid.ges="f"')

        const sharpCarry = ["M: 4/4", "L: 1/4", "K: C", "^F F G A | F4 |]"].join("\n")
        const res2 = abcToMei(sharpCarry, abcjs.parseOnly)
        expect(res2.problems).toEqual([])
        const notes2 = res2.mei.match(/<note\b[^>]*>/g) || []
        expect(notes2[0]).toContain('pname="f" oct="4" accid="s"')
        expect(notes2[1]).toContain('pname="f" oct="4" accid.ges="s"')
        expect(notes2[4]).not.toContain("accid")

        const tiedBarCarry = ["M: 4/4", "L: 1/4", "K: C", "C D E ^F- | F F G2 |]"].join("\n")
        const res3 = abcToMei(tiedBarCarry, abcjs.parseOnly)
        expect(res3.problems).toEqual([])
        const notes3 = res3.mei.match(/<note\b[^>]*>/g) || []
        expect(notes3[3]).toContain('pname="f" oct="4" accid="s" tie="i"')
        expect(notes3[4]).toContain('pname="f" oct="4" accid.ges="s" tie="t"')
        expect(notes3[5]).not.toContain("accid")
    })

    it("handles Open Hymnal style header comments and staves directives", () => {
        const openHymnal = ["X:1", "T:Test Hymn", "M: 4/4 % time signature", "L: 1/4", "%%staves (S1 S2) | (S3 S4)", "V: S1", "V: S2", "V: S3 clef=bass", "V: S4 clef=bass", "K: D % key signature", "[V:S1] D2 F2 | A4 |", "[V:S2] A,2 D2 | D4 |", "[V:S3] F,2 A,2 | F,4 |", "[V:S4] D,2 D,2 | D,4 |"].join("\n")
        const result = abcToMei(openHymnal, abcjs.parseOnly)
        expect(result.problems).toEqual([])
        expect(result.title).toBe("Test Hymn")
        expect(result.mei).toContain('keysig="2s"')
        expect(result.mei).toContain('meter.count="4" meter.unit="4"')
        expect(result.mei.match(/<staffDef\b/g)).toHaveLength(2)
    })

    it("maps triplets, ties across bar lines, beams, slurs and fermatas", () => {
        const abc = ["T: Features", "M: 3/4", "L: 1/4", "K: F", "F3/2 G/ A- | A (3c/B/A/ G | (F G) !fermata!F |]"].join("\n")
        const result = abcToMei(abc, abcjs.parseOnly)

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

    it("handles M:none, omitMeter option and one system break per line of music", () => {
        const freeMeter = ["M: none", "L: 1/4", "K: C", "C D E F |", "G A B c |"].join("\n")
        const resFree = abcToMei(freeMeter, abcjs.parseOnly)
        expect(resFree.problems).toEqual([])
        expect(resFree.mei).not.toContain("meter.count")
        expect(resFree.mei).toContain('metcon="false"')
        expect(resFree.mei.match(/<sb\/>/g)).toHaveLength(2)

        const omitted = abcToMei(ABIDE_WITH_ME, abcjs.parseOnly, { omitMeter: true })
        expect(omitted.mei).not.toContain("meter.count")
        expect(omitted.mei).not.toContain("meter.unit")
        expect(omitted.mei.match(/<sb\/>/g)).toHaveLength(1)
    })

    it("assigns xml:id=c<n> matching where each note starts in the ABC text", () => {
        const result = abcToMei(ABIDE_WITH_ME, abcjs.parseOnly)
        const idMatches = Array.from(result.mei.matchAll(/<(?:note|chord|rest|space) xml:id="c(\d+)"/g))
        expect(idMatches.length).toBeGreaterThan(20)

        for (const match of idMatches) {
            const offset = Number(match[1])
            const ch = ABIDE_WITH_ME[offset]
            expect(/[A-Ga-gzx^_=[\](]/.test(ch)).toBe(true)
        }

        const tune = abcjs.parseOnly(ABIDE_WITH_ME)[0]
        const ranges = collectAbcNoteRanges(tune, ABIDE_WITH_ME)
        expect(ranges[0].startChar).toBe(ABIDE_WITH_ME.indexOf("G2"))
        expect(ABIDE_WITH_ME.slice(ranges[0].startChar, ranges[0].endChar)).toBe("G2")
    })

    it("reports warning problems for repeat endings, grace notes, chord symbols and voice overlays", () => {
        const repeatEnding = "M: 4/4\nL: 1/4\nK: C\nC D E F |1 G A B c :|2 c B A G |]"
        const r1 = abcToMei(repeatEnding, abcjs.parseOnly)
        expect(r1.problems.some((p) => p.severity === "warning" && p.key === "sheet_music.problem_repeat_ending")).toBe(true)

        const graceNote = "M: 4/4\nL: 1/4\nK: C\n{g}A B c d |"
        const r2 = abcToMei(graceNote, abcjs.parseOnly)
        expect(r2.problems.some((p) => p.severity === "warning" && p.key === "sheet_music.problem_grace_notes")).toBe(true)

        const chordSymbol = 'M: 4/4\nL: 1/4\nK: C\n"C" C D E F |'
        const r3 = abcToMei(chordSymbol, abcjs.parseOnly)
        expect(r3.problems.some((p) => p.severity === "warning" && p.key === "sheet_music.problem_chord_symbols")).toBe(true)

        const overlay = "M: 4/4\nL: 1/4\nK: C\nC D E F & G, A, B, C |"
        const r4 = abcToMei(overlay, abcjs.parseOnly)
        expect(r4.problems.some((p) => p.severity === "warning" && p.key === "sheet_music.problem_voice_overlay")).toBe(true)
    })
})

describe.skipIf(!hasVerovio)("abcToMei rendered through Verovio worker (requires public/assets/sheet-music/verovio-module.mjs from preBuild)", () => {
    let handleMessage: (message: Record<string, unknown>) => Promise<any>

    beforeAll(async () => {
        const mod = await import(/* @vite-ignore */ workerModuleHref)
        handleMessage = mod.handleMessage
    })

    it("loads and renders the converted Abide With Me MEI in Verovio", async () => {
        const converted = abcToMei(ABIDE_WITH_ME, abcjs.parseOnly)
        expect(converted.problems).toEqual([])
        expect(converted.mei.length).toBeGreaterThan(500)

        // Direct preview render keeps xml:id attributes for click-to-find
        const preview = await handleMessage({ type: "render", mei: converted.mei, pageWidth: 1840 })
        expect(preview.svg).toContain("<svg")
        expect(preview.pages).toBe(1)
        const firstOffset = ABIDE_WITH_ME.indexOf("G2")
        expect(preview.svg).toContain(`id="c${firstOffset}"`)

        // Load produces cleaned MEI for storage
        const loaded = await handleMessage({ type: "load", text: converted.mei })
        expect(loaded.title).toBe("Abide With Me")
        expect(loaded.measures).toBe(4)
        expect(loaded.mei).toContain('bar.thru="false"')
        expect(loaded.mei).not.toContain("<meiHead")

        const renderedClean = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 1840 })
        expect(renderedClean.svg).toContain("<svg")
        expect(renderedClean.fits).toBe(true)
    })
})
