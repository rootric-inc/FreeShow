import abcjs from "abcjs"
import { describe, expect, it } from "vitest"
import { extractAbcMetadata, extractAbcTextVerses, sliceAbcIntoSystems, splitAbcIntoSystemTexts } from "./abcSlice"
import { compareMeiSlicesToWhole } from "./abcSliceCompare"
import { convertAndCheckAbc } from "./abcToMei"
import { hasHiddenInitialMeter } from "./helpers"
import { summarizeMei } from "./meiParts"
import { extractSlideLyrics } from "./meiRead"

const ABIDE_WITH_ME_ABC = [
    "T: Abide With Me",
    "C: Words: Henry F. Lyte",
    "C: Music: William H. Monk",
    "M: 4/4",
    "L: 1/4",
    "K: Eb",
    "%%score (S A) (T B)",
    "V: S",
    "V: A",
    "V: T clef=bass octave=-1",
    "V: B clef=bass octave=-1",
    "[V:S] G2 G F | E2 B2 | c B B A | G4 |",
    "w: 1.~A-bide with me; fast falls the e-ven-tide;",
    "w: 2.~Swift to its close ebbs out life's lit-tle day;",
    "[V:A] E2 D D | E2 E2 | E D E F | E4 |",
    "[V:T] B2 B A | G2 E2 | E B B B | B4 |",
    "[V:B] E2 B, B, | C2 G,2 | A, B, C D | E4 |",
    "[V:S] G2 A B | c2 B2 | A F G =A | B4 |",
    "w: The dark-ness deep-ens; Lord, with me a-bide.",
    "w: Earth's joys grow dim; its glo-ries pass a-way;",
    "[V:A] E2 E E | E2 E2 | F D E E | D4 |",
    "[V:T] B2 c B | A2 G2 | c B B c | B4 |",
    "[V:B] E2 C G, | A,2 E2 | F, B, E C | B,4 |"
].join("\n")

const ABIDE_WITH_ME_EXTENDED_ABC = [
    "%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%",
    "% Public domain hymn preamble comment",
    "% Second comment line",
    "%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%",
    "",
    "% PAGE LAYOUT",
    "%%pagewidth 21.6cm",
    "X: 1",
    "T: Abide With Me",
    "C: Words: Henry F. Lyte, 1847.  Music: 'Eventide' William H. Monk, 1861.  Setting: William H. Monk, 1861.",
    "C: copyright: public domain.  This score is a part of the Open Hymnal Project.",
    "M: 4/4",
    "L: 1/4",
    "%%staves (S A) | (T B)",
    "V: S clef=treble",
    "V: A",
    "V: T clef=bass octave=-1",
    "V: B clef=bass octave=-1",
    "K: Eb",
    "% 1",
    "[V:S] G2 G F | E2 B2 | c B B A | G4 |",
    "w: 1.~A-bide with me; fast falls the e-ven-tide;",
    "w: 2.~Swift to its close ebbs out life's lit-tle day;",
    "w: 3.~Thou on my head didst smile; And, though re-",
    "[V:A] E2 D D | E2 E2 | E D E F | E4 |",
    "[V:T] B2 B A | G2 E2 | E B B B | B4 |",
    "[V:B] E2 B, B, | C2 G,2 | A, B, C D | E4 |",
    "% 5",
    "[V:S] G2 A B | c2 B2 | A F G =A | B4 |",
    "w: The dark-ness deep-ens; Lord, with me a-bide.",
    "w: Earth's joys grow dim; its glo-ries pass a-way;",
    "w: bell-ious and per-verse, Lord, bide with me.",
    "[V:A] E2 E E | E2 E2 | F D E E | D4 |",
    "[V:T] B2 c B | A2 G2 | c B B c | B4 |",
    "[V:B] E2 C G, | A,2 E2 | F, B, E C | B,4 |",
    "% 9",
    "[V:S] G2 G F | E2 B2 | B A A G | F4 |]",
    "w: When o-ther help-ers fail, O bide with me.",
    "w: Change and de-cay I see; O bide with me.",
    "w: On to the close, O Lord, a-bide with me.",
    "[V:A] E2 D D | E2 E2 | E E =E =E | F4 |]",
    "[V:T] B2 B A | G2 E2 | c c c B | A4 |]",
    "[V:B] E2 B, B, | C2 G,2 | A, B, C C | F,4 |]",
    "W: 4. I need Thy presence every passing hour.",
    "W: What but Thy grace can foil the tempter's power?",
    "W:",
    "W: 5. Hold Thou Thy cross before my closing eyes;",
    "W: Shine through the gloom and point me to the skies."
].join("\n")

function assertSlicesMatchWhole(abc: string) {
    const whole = convertAndCheckAbc(abc, abcjs.parseOnly)
    expect(whole.hasError).toBe(false)
    const slices = sliceAbcIntoSystems(abc, abcjs.parseOnly)
    expect(slices.length).toBeGreaterThan(0)
    for (const slice of slices) {
        expect(slice.analysis.hasError).toBe(false)
    }
    expect(
        compareMeiSlicesToWhole(
            whole.mei,
            slices.map((slice) => slice.analysis.mei)
        )
    ).toEqual([])
    return { whole, slices }
}

describe("ABC metadata and W: verse extraction", () => {
    it("extracts Words, Music, copyright and fallback composer from ABC C: lines", () => {
        expect(extractAbcMetadata(ABIDE_WITH_ME_ABC)).toEqual({
            title: "Abide With Me",
            author: "Henry F. Lyte",
            composer: "William H. Monk",
            key: "Eb"
        })

        expect(extractAbcMetadata(ABIDE_WITH_ME_EXTENDED_ABC)).toEqual({
            title: "Abide With Me",
            author: "Henry F. Lyte, 1847.",
            composer: "'Eventide' William H. Monk, 1861.",
            copyright: "public domain.  This score is a part of the Open Hymnal Project.",
            key: "Eb"
        })

        const separateOpenHymnal = ["X: 1", "T: Separate C Lines", "C: Words: Henry F. Lyte, 1847.", "C: Music: 'Eventide' William H. Monk, 1861.", "C: Setting: William H. Monk, 1861.", "C: COPYRIGHT: Public Domain.", "C: Open Hymnal Project credit line.", "M: 4/4", "L: 1/4", "K: Eb", "G4 |"].join("\n")
        expect(extractAbcMetadata(separateOpenHymnal)).toEqual({
            title: "Separate C Lines",
            author: "Henry F. Lyte, 1847.",
            composer: "'Eventide' William H. Monk, 1861.",
            copyright: "Public Domain.",
            key: "Eb"
        })

        const plainComposer = ["X: 1", "T: Plain", "C: William H. Monk", "C: Second Credit", "K: C", "C4 |"].join("\n")
        expect(extractAbcMetadata(plainComposer)).toEqual({
            title: "Plain",
            composer: "William H. Monk",
            key: "C"
        })

        // Same-line Words + Music and Setting, separate Music and Setting, Text, Tune, and pre-X: blocks/stray text
        const sameLineMusicAndSetting = ["X: 1", "T: It Is Well", "C: Words: Horatio G. Spafford, 1873.  Music and Setting: 'It Is Well' Philip P. Bliss, 1876.", "C: copyright: public domain.", "K: Db", "D4 |"].join("\n")
        expect(extractAbcMetadata(sameLineMusicAndSetting)).toEqual({
            title: "It Is Well",
            author: "Horatio G. Spafford, 1873.",
            composer: "'It Is Well' Philip P. Bliss, 1876.",
            copyright: "public domain.",
            key: "Db"
        })

        const separateMusicAndSetting = ["%%beginps", "/opnot { 0 0 moveto } def", "%%endps", "X: 1", "T: In The Bleak MidWinter", "C: Words: Christina Georgina Rossetti, 1872, alt.", "C: Music and Setting: 'Cranham' Gustav Theodore Holst, 1906, alt.", "C: copyright: public domain.", "K: F", "F4 |"].join("\n")
        expect(extractAbcMetadata(separateMusicAndSetting)).toEqual({
            title: "In The Bleak MidWinter",
            author: "Christina Georgina Rossetti, 1872, alt.",
            composer: "'Cranham' Gustav Theodore Holst, 1906, alt.",
            copyright: "public domain.",
            key: "F"
        })

        const textAndTuneLabels = ["l%%%%", "X: 1", "T: Kingsfold", "C: Text: Anthony Robertson, 2010.  Tune: 'Kingsfold' traditional English.  Setting: Ralph Vaughan Williams, 1906.", "C: copyright: music and setting public domain. Words: Copyright 2010.", "K: G", "G4 |"].join("\n")
        expect(extractAbcMetadata(textAndTuneLabels)).toEqual({
            title: "Kingsfold",
            author: "Anthony Robertson, 2010.",
            composer: "'Kingsfold' traditional English.",
            copyright: "music and setting public domain. Words: Copyright 2010.",
            key: "G"
        })
    })

    it("extracts plain-text verses separated by empty W: lines or leading verse numbers", () => {
        expect(extractAbcTextVerses(ABIDE_WITH_ME_EXTENDED_ABC)).toEqual([
            ["4. I need Thy presence every passing hour.", "What but Thy grace can foil the tempter's power?"],
            ["5. Hold Thou Thy cross before my closing eyes;", "Shine through the gloom and point me to the skies."]
        ])
        expect(extractAbcTextVerses(ABIDE_WITH_ME_ABC)).toEqual([])

        const numberedWithoutBlank = ["K: C", "C4 |", "W: 2. Line a", "W: Line b", "W: 3. Line c", "W: 4) Line d", "W: Line e"].join("\n")
        expect(extractAbcTextVerses(numberedWithoutBlank)).toEqual([["2. Line a", "Line b"], ["3. Line c"], ["4) Line d", "Line e"]])
    })
})

describe("ABC cutting into system slices (with real abcjs)", () => {
    it("cuts embedded Abide With Me into matching systems without single-% comments or W: blocks", () => {
        const { whole, slices } = assertSlicesMatchWhole(ABIDE_WITH_ME_EXTENDED_ABC)
        const wholeMeasures = summarizeMei(whole.mei).measures
        expect(slices).toHaveLength(3)

        let totalMeasures = 0
        slices.forEach((slice, index) => {
            expect(slice.abc).toContain("T: Abide With Me")
            expect(slice.abc).toContain("K: Eb")
            expect(slice.abc).toContain("L: 1/4")
            expect(slice.abc).toContain("%%staves")
            expect(slice.abc).toContain("%%pagewidth")
            expect(slice.abc).not.toContain("Public domain hymn preamble comment")
            expect(slice.abc).not.toContain("%%%%")
            expect(slice.abc).not.toContain("W:")

            if (index === 0) {
                expect(hasHiddenInitialMeter(slice.analysis.mei)).toBe(false)
            } else {
                expect(hasHiddenInitialMeter(slice.analysis.mei)).toBe(true)
            }

            totalMeasures += summarizeMei(slice.analysis.mei).measures
        })

        expect(totalMeasures).toBe(wholeMeasures)
    })

    it("cuts voice-by-voice ABC into the same musical slices as system-by-system ABC", () => {
        const systemBySystem = ["T: Two Systems", "M: 4/4", "L: 1/4", "K: Eb", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] G2 G F | E2 B2 |", "w: A-bide with me;", "[V:A] E2 D D | E2 E2 |", "[V:T] B2 B A | G2 E2 |", "[V:B] E2 B, B, | C2 G,2 |", "[V:S] c B B A | G4 |", "w: fast falls the tide;", "[V:A] E D E F | E4 |", "[V:T] E B B B | B4 |", "[V:B] A, B, C D | E4 |"].join("\n")

        const voiceByVoice = ["T: Two Systems", "M: 4/4", "L: 1/4", "K: Eb", "%%score (S A) (T B)", "V: S", "G2 G F | E2 B2 |", "w: A-bide with me;", "c B B A | G4 |", "w: fast falls the tide;", "V: A", "E2 D D | E2 E2 |", "E D E F | E4 |", "V: T clef=bass octave=-1", "B2 B A | G2 E2 |", "E B B B | B4 |", "V: B clef=bass octave=-1", "E2 B, B, | C2 G,2 |", "A, B, C D | E4 |"].join("\n")

        const sysSlices = assertSlicesMatchWhole(systemBySystem).slices
        const voiceSlices = assertSlicesMatchWhole(voiceByVoice).slices

        expect(sysSlices).toHaveLength(2)
        expect(voiceSlices).toHaveLength(2)

        const stripIds = (mei: string) => mei.replace(/\s+xml:id="[^"]*"/g, "")
        for (let i = 0; i < 2; i++) {
            expect(stripIds(voiceSlices[i].analysis.mei)).toBe(stripIds(sysSlices[i].analysis.mei))
        }
    })

    it("maps each text row to one system when a line starts with [K:], [M:] or [K:clef=] (A1)", () => {
        const keyAtLineStart = ["X:1", "T:Key at line start", "M:4/4", "L:1/4", "K:C", "C D E F | G4 |", "[K:G] G A B c | d4 |", "d c B A | G4 |]"].join("\n")
        const keySlices = assertSlicesMatchWhole(keyAtLineStart).slices
        expect(keySlices).toHaveLength(3)
        expect(keySlices[0].abc).not.toContain("[K:G]")
        expect(keySlices[1].abc).toContain("[K:G] G A B c | d4 |")
        expect(keySlices[2].abc).toMatch(/K:\s*G/)
        expect(keySlices[2].abc).not.toContain("[K:G]")

        const meterAtLineStart = ["X:1", "M:4/4", "L:1/4", "K:C", "C D E F | G4 |", "[M:3/4] G A B | d3 |", "c B A | G3 |]"].join("\n")
        const meterSlices = assertSlicesMatchWhole(meterAtLineStart).slices
        expect(meterSlices).toHaveLength(3)
        expect(meterSlices[0].abc).not.toContain("[M:3/4]")
        expect(hasHiddenInitialMeter(meterSlices[1].analysis.mei)).toBe(false)
        expect(hasHiddenInitialMeter(meterSlices[2].analysis.mei)).toBe(true)

        const clefAtLineStart = ["X:1", "M:4/4", "L:1/4", "K:C", "C D E F | G4 |", "[K:C clef=bass] C, D, E, F, | G,4 |", "G, F, E, D, | C,4 |]"].join("\n")
        const clefSlices = assertSlicesMatchWhole(clefAtLineStart).slices
        expect(clefSlices).toHaveLength(3)
        expect(clefSlices[0].abc).not.toContain("clef=bass")
        expect(clefSlices[2].abc).toContain("clef=bass")
    })

    it("writes carried accidentals and tied accidentals into the next slice and drops incoming ties (A2)", () => {
        const checkCarriedSlice = (abc: string) => {
            const whole = convertAndCheckAbc(abc, abcjs.parseOnly)
            expect(whole.hasError).toBe(false)
            const slices = sliceAbcIntoSystems(abc, abcjs.parseOnly)
            expect(slices).toHaveLength(2)
            for (const slice of slices) expect(slice.analysis.hasError).toBe(false)
            const issues = compareMeiSlicesToWhole(
                whole.mei,
                slices.map((slice) => slice.analysis.mei)
            )
            // The slice intentionally draws the restated accidental at the start of slide 2 while the whole score implies it
            expect(issues.length).toBeGreaterThan(0)
            expect(issues.every((issue) => issue.kind === "notes" && issue.sliceIndex === 1 && issue.measureNumber === 2)).toBe(true)
            return slices
        }

        const unfinishedBar = ["M:4/4", "L:1/4", "K:F", "C F ^G", "G | B4 |"].join("\n")
        const barSlices = checkCarriedSlice(unfinishedBar)
        expect(barSlices[1].abc).toContain("^G | B4 |")
        expect(barSlices[1].analysis.mei).toContain('pname="g" oct="4" accid="s"')

        const multiVoiceUnfinishedBar = ["M: 3/4", "L: 1/4", "K: F", "%%staves (S1V1 S1V2) | (S2V1 S2V2)", "V: S1V1 clef=treble", "V: S1V2", "V: S2V1 clef=bass", "V: S2V2", "[V: S1V1] F E3/2", "[V: S1V2] C =B,3/2", "[V: S2V1] A, _A,3/2", "[V: S2V2] F, F,3/2", "[V: S1V1] D/ | G3 |", "[V: S1V2] B,/ | C3 |", "[V: S2V1] A,/ | G,3 |", "[V: S2V2] F,/ | E,3 |"].join("\n")
        const mvSlices = checkCarriedSlice(multiVoiceUnfinishedBar)
        expect(mvSlices[1].abc).toContain("=B,/ | C3 |")
        expect(mvSlices[1].abc).toContain("_A,/ | G,3 |")

        const tiedAccidental = ["M:4/4", "L:1/4", "K:C", "^F4-|", "F4|"].join("\n")
        const tieSlices = checkCarriedSlice(tiedAccidental)
        expect(tieSlices[1].abc).toContain("^F4|")
        expect(tieSlices[1].analysis.mei).toContain('pname="f" oct="4" accid="s"')
        expect(tieSlices[1].analysis.mei).not.toContain('tie="t"')

        const tiedThenSecondNote = ["M:4/4", "L:1/4", "K:C", "^F4-|", "F2 F2 |"].join("\n")
        const tieTwoSlices = checkCarriedSlice(tiedThenSecondNote)
        expect(tieTwoSlices[1].abc).toContain("^F2 =F2 |")
    })

    it("carries note length, explicit default L:, clef, and voice settings into later slices (A3)", () => {
        const lengthChange = ["M:4/4", "L:1/4", "K:C", "C D E F |", "L:1/8", "C2 D2 E2 F2 |", "G2 A2 B2 c2 |"].join("\n")
        const lengthSlices = assertSlicesMatchWhole(lengthChange).slices
        expect(lengthSlices).toHaveLength(3)
        expect(lengthSlices[0].abc).toContain("L:1/4")
        expect(lengthSlices[1].abc).toContain("L:1/8")
        expect(lengthSlices[2].abc).toContain("L:1/8")

        const noLengthWithMeterChange = ["M:4/4", "K:C", "C2 D2 E2 F2 |", "M:3/8", "G A B |"].join("\n")
        const noLengthSlices = assertSlicesMatchWhole(noLengthWithMeterChange).slices
        expect(noLengthSlices).toHaveLength(2)
        expect(noLengthSlices[0].abc).toContain("L: 1/8")
        expect(noLengthSlices[1].abc).toContain("L: 1/8")

        const clefChangeLine = ["M:4/4", "L:1/4", "K:C", "C D E F |", "K:C clef=bass", "C, D, E, F, |", "G, A, B, C |"].join("\n")
        const clefSlices = assertSlicesMatchWhole(clefChangeLine).slices
        expect(clefSlices).toHaveLength(3)
        expect(clefSlices[1].abc).toContain("clef=bass")
        expect(clefSlices[2].abc).toContain("clef=bass")

        const voiceSettingsChange = ["M:4/4", "L:1/4", "K:C", "%%score S B", "V: S", "V: B clef=bass octave=-1", "[V:S] C D E F |", "[V:B] C D E F |", "V: B clef=treble octave=0", "[V:S] G A B c |", "[V:B] C D E F |"].join("\n")
        const voiceSlices = assertSlicesMatchWhole(voiceSettingsChange).slices
        expect(voiceSlices).toHaveLength(2)
        expect(voiceSlices[1].abc).toContain("V: B clef=treble octave=0")
    })

    it("hides the initial meter on a later slice only when it equals the meter at the end of the slice before (A4)", () => {
        const inlineMidLineChange = ["T: Modulating Hymn", "M: 4/4", "L: 1/4", "K: C", "[V:S] C D E F | [K:G] [M:3/4] G A B |", "[V:S] c B A | G3 |", "[V:S] d c B | A3 |"].join("\n")

        const inlineTexts = splitAbcIntoSystemTexts(inlineMidLineChange, abcjs.parseOnly)
        expect(inlineTexts).toHaveLength(3)
        expect(inlineTexts[0]).toContain("K: C")
        expect(inlineTexts[0]).toContain("M: 4/4")
        expect(inlineTexts[1]).toContain("K: G")
        expect(inlineTexts[1]).toContain("M: 3/4")
        expect(inlineTexts[2]).toContain("K: G")
        expect(inlineTexts[2]).toContain("M: 3/4")

        const inlineSlices = assertSlicesMatchWhole(inlineMidLineChange).slices
        expect(inlineSlices[1].analysis.mei).toContain('keysig="1s"')
        expect(inlineSlices[1].analysis.mei).toContain('meter.count="3" meter.unit="4" meter.visible="false"')

        const standaloneChanges = ["T: Standalone Change", "M: 4/4", "L: 1/4", "K: C", "C D E F | G4 |", "K: Eb", "M: 3/4", "G A B | c3 |"].join("\n")
        const standaloneSlices = assertSlicesMatchWhole(standaloneChanges).slices
        expect(standaloneSlices).toHaveLength(2)
        expect(standaloneSlices[1].abc).toContain("K: Eb")
        expect(standaloneSlices[1].abc).toContain("M: 3/4")
        expect(standaloneSlices[1].analysis.mei).toContain('keysig="3f"')
        expect(standaloneSlices[1].analysis.mei).toContain('meter.count="3" meter.unit="4"')
        expect(hasHiddenInitialMeter(standaloneSlices[1].analysis.mei)).toBe(false)

        const voiceInlineMeterChange = ["T: Voice Inline Change", "M: 4/4", "L: 1/4", "K: C", "V: S", "[V:S] C D E F | G4 |", "[V:S] [M:3/4] G A B | c3 |", "[V:S] d c B | A3 |"].join("\n")
        const voiceMeterSlices = assertSlicesMatchWhole(voiceInlineMeterChange).slices
        expect(voiceMeterSlices).toHaveLength(3)
        expect(hasHiddenInitialMeter(voiceMeterSlices[1].analysis.mei)).toBe(false)
        expect(hasHiddenInitialMeter(voiceMeterSlices[2].analysis.mei)).toBe(true)
    })

    it("keeps w: words when a %% directive sits between the music row and the w: row (A5)", () => {
        const withDirective = ["M: 4/4", "L: 1/4", "K: C", "C D E F |", "%%vskip 10", "w: One two three four", "G A B c |", "w: Five six sev'n eight"].join("\n")
        const slices = assertSlicesMatchWhole(withDirective).slices
        expect(slices).toHaveLength(2)
        expect(extractSlideLyrics(slices[0].analysis.mei)).toEqual(["One two three four"])
        expect(extractSlideLyrics(slices[1].analysis.mei)).toEqual(["Five six sev'n eight"])
    })

    it("supports the invisible meter option on convertAndCheckAbc and detects it with hasHiddenInitialMeter", () => {
        const abc = ["M: 4/4", "L: 1/4", "K: C", "C D E F |"].join("\n")
        const visible = convertAndCheckAbc(abc, abcjs.parseOnly)
        const hidden = convertAndCheckAbc(abc, abcjs.parseOnly, { hideInitialMeter: true })

        expect(visible.mei).not.toContain('meter.visible="false"')
        expect(hasHiddenInitialMeter(visible.mei)).toBe(false)

        expect(hidden.mei).toContain('meter.count="4" meter.unit="4" meter.visible="false"')
        expect(hasHiddenInitialMeter(hidden.mei)).toBe(true)
    })

    it("keeps K:, M: and L: exactly once before the first music row even when fields appear after K:", () => {
        const lengthAfterKey = ["M:4/4", "K:C", "L:1/4", "C D E F |", "L:1/8", "G2 A2 B2 c2 |"].join("\n")
        const lengthSlices = assertSlicesMatchWhole(lengthAfterKey).slices
        expect(lengthSlices).toHaveLength(2)
        expect(lengthSlices[1].abc.match(/^L:/gm)).toHaveLength(1)
        expect(lengthSlices[1].abc.match(/^M:/gm)).toHaveLength(1)
        expect(lengthSlices[1].abc.match(/^K:/gm)).toHaveLength(1)
        expect(lengthSlices[1].abc).toContain("L: 1/8")
        expect(lengthSlices[1].abc).not.toContain("L:1/4")

        const meterAndKeyAfterKey = ["M:4/4", "K:C", "M:3/4", "K:G", "L:1/4", "G A B |", "c B A |"].join("\n")
        const mkSlices = assertSlicesMatchWhole(meterAndKeyAfterKey).slices
        expect(mkSlices).toHaveLength(2)
        for (const slice of mkSlices) {
            expect(slice.abc.match(/^K:/gm)).toHaveLength(1)
            expect(slice.abc.match(/^M:/gm)).toHaveLength(1)
            expect(slice.abc.match(/^L:/gm)).toHaveLength(1)
            expect(slice.abc).toContain("K:G")
            expect(slice.abc).toContain("M:3/4")
        }
    })

    it("preserves extra key accidentals and clears earlier ones when the key changes", () => {
        const inlineExp = ["M:4/4", "L:1/4", "K:C", "F2 B2 |", "[K:D exp _b] B2 F2 |", "F2 B2 |"].join("\n")
        const inlineExpSlices = assertSlicesMatchWhole(inlineExp).slices
        expect(inlineExpSlices).toHaveLength(3)
        expect(inlineExpSlices[2].abc).toContain("K:D exp _b")
        expect(inlineExpSlices[2].analysis.mei).toContain('pname="b" oct="4" accid.ges="f"')

        const headerExpThenG = ["M:4/4", "L:1/4", "K:D exp _b", "B2 F2 |", "[K:G] F2 B2 |"].join("\n")
        const headerExpSlices = assertSlicesMatchWhole(headerExpThenG).slices
        expect(headerExpSlices).toHaveLength(2)
        expect(headerExpSlices[1].abc).toContain("K:G")
        expect(headerExpSlices[1].abc).not.toContain("exp _b")
        expect(headerExpSlices[1].analysis.mei).toContain('pname="b" oct="4">')

        const bodyExtraAcc = ["M:4/4", "L:1/4", "K:Eb", "B2 F2 |", "K:C ^f", "F2 B2 |"].join("\n")
        const bodyExtraSlices = assertSlicesMatchWhole(bodyExtraAcc).slices
        expect(bodyExtraSlices).toHaveLength(2)
        expect(bodyExtraSlices[1].abc).toContain("K:C ^f")
        expect(bodyExtraSlices[1].analysis.mei).toContain('pname="f" oct="4" accid.ges="s"')
    })

    it("ends an open bar when the next row starts with a bar line and leaves the next note fresh", () => {
        const leadingBar = ["M:4/4", "L:1/4", "K:C", "C D E ^F", "| F G A B |"].join("\n")
        const { whole, slices } = assertSlicesMatchWhole(leadingBar)
        expect(whole.problems).toEqual([])
        expect(slices).toHaveLength(2)
        expect(whole.mei.match(/<measure\b/g)).toHaveLength(2)
        expect(whole.mei).not.toContain('right="invis"')
        expect(slices[1].abc).toContain("| F G A B |")
        expect(slices[1].abc).not.toContain("^F")
        const slice2Notes = slices[1].analysis.mei.match(/<note\b[^>]*>/g) || []
        expect(slice2Notes[0]).not.toContain("accid")
    })

    it("tracks a standalone [V:...] voice switch line before or between music rows", () => {
        const standaloneVoice = ["%%score S A", "V:S", "V:A", "[V:S]", "C D E F |", "[V:A]", "C D E F |", "[V:S]", "G A B c |", "[V:A]", "G A B c |"].join("\n")
        const { slices } = assertSlicesMatchWhole(standaloneVoice)
        expect(slices).toHaveLength(2)
        expect(slices[0].abc).toContain("V: S")
        expect(slices[0].abc).toContain("V: A")
        expect(slices[1].abc).toContain("V: S")
        expect(slices[1].abc).toContain("V: A")

        const withKey = ["M:4/4", "L:1/4", "K:C", standaloneVoice].join("\n")
        const withKeySlices = assertSlicesMatchWhole(withKey).slices
        expect(withKeySlices).toHaveLength(2)
    })

    it("detects drawn vs implied accidental differences and bar line differences in compareMeiSlicesToWhole", () => {
        const makeScore = (measureAttrs: string, noteAttrs: string) => `<mei><music><body><mdiv><score><scoreDef keysig="0" meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section><measure n="1"${measureAttrs}><staff n="1"><layer n="1"><note dur="1" ${noteAttrs}/></layer></staff></measure></section></score></mdiv></body></music></mei>`

        const impliedSharp = makeScore("", 'pname="f" oct="4" accid.ges="s"')
        const drawnSharp = makeScore("", 'pname="f" oct="4" accid="s"')
        const naturalNote = makeScore("", 'pname="f" oct="4"')
        const invisBar = makeScore(' right="invis"', 'pname="f" oct="4"')

        expect(compareMeiSlicesToWhole(impliedSharp, [impliedSharp])).toEqual([])
        expect(compareMeiSlicesToWhole(impliedSharp, [drawnSharp]).map((i) => i.kind)).toEqual(["notes"])
        expect(compareMeiSlicesToWhole(drawnSharp, [naturalNote]).map((i) => i.kind)).toEqual(["notes"])
        expect(compareMeiSlicesToWhole(naturalNote, [invisBar]).map((i) => i.kind)).toEqual(["barline"])
    })
})
