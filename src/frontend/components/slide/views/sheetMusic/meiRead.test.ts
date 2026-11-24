import abcjs from "abcjs"
import { describe, expect, it } from "vitest"
import { sliceAbcIntoSystems } from "./abcSlice"
import { convertAndCheckAbc } from "./abcToMei"
import { buildMeasureSliceRanges, extractKeyFromMei, extractSlideLyrics, getFileSlideRanges, getFixedMeasureSlideStarts, getLineBreakSlideStarts, hasMeiLineBreaks } from "./meiRead"

describe("MEI slide starts, ranges, and key extraction", () => {
    it("finds slide starts from <sb/> and <pb/> elements and ignores a leading <pb/> before measure 1", () => {
        const mei = `<mei><section><pb/><measure n="1"/><measure n="2"/><measure n="3"/><measure n="4"/><sb/><measure n="5"/><measure n="6"/><pb/><sb/><measure n="7"/><measure n="8"/><sb/></section></mei>`

        expect(getLineBreakSlideStarts(mei)).toEqual([1, 5, 7])
        expect(hasMeiLineBreaks(mei)).toBe(true)
        expect(getFileSlideRanges(mei, 8, "breaks")).toEqual([
            { first: 1, last: 4 },
            { first: 5, last: 6 },
            { first: 7, last: 8 }
        ])
    })

    it("reports no line breaks when only a leading <pb/> exists", () => {
        const mei = `<mei><section><pb/><measure n="1"/><measure n="2"/><measure n="3"/><measure n="4"/></section></mei>`
        expect(getLineBreakSlideStarts(mei)).toEqual([1])
        expect(hasMeiLineBreaks(mei)).toBe(false)
    })

    it("computes slide starts and ranges for fixed measure intervals", () => {
        expect(getFixedMeasureSlideStarts(10, 4)).toEqual([1, 5, 9])
        expect(buildMeasureSliceRanges(10, [1, 5, 9])).toEqual([
            { first: 1, last: 4 },
            { first: 5, last: 8 },
            { first: 9, last: 10 }
        ])
        expect(getFileSlideRanges("<mei/>", 7, "2")).toEqual([
            { first: 1, last: 2 },
            { first: 3, last: 4 },
            { first: 5, last: 6 },
            { first: 7, last: 7 }
        ])
        expect(getFileSlideRanges("<mei/>", 16, "8")).toEqual([
            { first: 1, last: 8 },
            { first: 9, last: 16 }
        ])
    })

    it("extracts major and minor keys from MEI scoreDef and keySig", () => {
        expect(extractKeyFromMei('<mei><scoreDef keysig="3f"><staffGrp/></scoreDef></mei>')).toBe("Eb")
        expect(extractKeyFromMei('<mei><scoreDef><staffGrp><staffDef n="1"><keySig sig="2s" mode="minor"/></staffDef></staffGrp></scoreDef></mei>')).toBe("Bm")
        expect(extractKeyFromMei("<mei><scoreDef/></mei>")).toBe("")
    })
})

describe("MEI slide lyric extraction and refrain rule", () => {
    const multiVerseAbc = ["T: Four-Part Hymn", "M: 4/4", "L: 1/4", "K: Bb", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] d e d c | d c B c |", "w: 1.~Praise God from whom | all bless-ings flow,", "w: 2.~Praise Him a-bove, | ye heav'n-ly host,", "w: 3.~Praise Fa-ther, Son, | and Ho-ly Ghost,", "[V:A] B G F F | F F G A |", "[V:T] f e d c | B A d c |", "[V:B] D C B, F | B, F G F |"].join("\n")

    const refrainSlideAbc = ["T: Hymn With Refrain", "M: 4/4", "L: 1/4", "K: C", "[V:S] C D E F | G4 |", "w: Yes, Je-sus loves | me!"].join("\n")

    const mixedVerseAndRefrainAbc = ["T: Mixed Slide", "M: 4/4", "L: 1/4", "K: C", "[V:S] C D E F | G A B c |", "w: 1.~A-bide with me | Hal-le-lu-jah!", "w: 2.~Stay close to me", "w: 3.~Walk near to me"].join("\n")

    it("joins syllables marked with con=d without spaces and returns one line per verse", () => {
        const mei = convertAndCheckAbc(multiVerseAbc, abcjs.parseOnly).mei

        expect(extractSlideLyrics(mei)).toEqual(["1. Praise God from whom all blessings flow,", "2. Praise Him above, ye heav'nly host,", "3. Praise Father, Son, and Holy Ghost,"])
        expect(extractSlideLyrics(mei, 2)).toEqual(["2. Praise Him above, ye heav'nly host,"])
        expect(extractSlideLyrics(mei, 3)).toEqual(["3. Praise Father, Son, and Holy Ghost,"])
    })

    it("keeps a trailing hyphen when a slide's last syllable continues onto the next slide (E3)", () => {
        const splitWordAbc = ["M: 4/4", "L: 1/4", "K: C", "[V:S] C D E F |", "w: And, though re-", "[V:S] G A B c |", "w: bell-ious per-verse"].join("\n")
        const slices = sliceAbcIntoSystems(splitWordAbc, abcjs.parseOnly)

        expect(extractSlideLyrics(slices[0].analysis.mei, 1)).toEqual(["And, though re-"])
        expect(extractSlideLyrics(slices[1].analysis.mei, 1)).toEqual(["bellious perverse"])
    })

    it("keeps refrain words stored only on verse 1 for every verse group", () => {
        const refrainMei = convertAndCheckAbc(refrainSlideAbc, abcjs.parseOnly).mei
        expect(extractSlideLyrics(refrainMei, 1)).toEqual(["Yes, Jesus loves me!"])
        expect(extractSlideLyrics(refrainMei, 3)).toEqual(["Yes, Jesus loves me!"])

        const mixedMei = convertAndCheckAbc(mixedVerseAndRefrainAbc, abcjs.parseOnly).mei
        expect(extractSlideLyrics(mixedMei, 3)).toEqual(["3. Walk near to me Hallelujah!"])
    })
})
