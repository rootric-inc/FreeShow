import abcjs from "abcjs"
import { describe, expect, it } from "vitest"
import { createAbcTemplate, insertAbcAtCursor, readAbcHeader, sliceAbcByLine, updateAbcHeaderField } from "./abcSource"
import { getSheetMusicAbc } from "./helpers"

describe("abcSource templates and header helpers", () => {
    it("builds four-part, two-part and one-part templates", () => {
        const four = createAbcTemplate({ key: "Eb", meter: "4/4", parts: "four" })
        expect(four).toContain("M: 4/4")
        expect(four).toContain("L: 1/4")
        expect(four).toContain("K: Eb")
        expect(four).toContain("%%score (S A) (T B)")
        expect(four).toContain("V: T clef=bass octave=-1")
        expect(four).toContain("V: B clef=bass octave=-1")
        expect(four).toContain("[V:S] ")
        expect(four).toContain("[V:B] ")

        const two = createAbcTemplate({ key: "G", meter: "3/4", parts: "two" })
        expect(two).toContain("%%score (S A)")
        expect(two).toContain("K: G")
        expect(two).toContain("M: 3/4")
        expect(two).not.toContain("clef=bass")

        const one = createAbcTemplate({ key: "C", meter: "6/8", parts: "one" })
        expect(one).toContain("M: 6/8")
        expect(one).toContain("K: C")
        expect(one).not.toContain("%%score")
    })

    it("reads key, meter and parts layout back out of existing ABC text", () => {
        const four = createAbcTemplate({ key: "Eb", meter: "3/4", parts: "four" })
        expect(readAbcHeader(four)).toEqual({ key: "Eb", meter: "3/4", parts: "four" })

        const openHymnal = ["X:1", "T:Test", "M: 4/4 % time signature", "L: 1/4", "%%staves (S1 S2) | (S3 S4)", "K: D % key signature", "[V:S1] D4 |"].join("\n")
        expect(readAbcHeader(openHymnal)).toEqual({ key: "D", meter: "4/4", parts: "four" })

        const commonAndTwo = ["M: C", "K: Gm", "%%score (A B)", "[V:A] G4 |", "[V:B] D4 |"].join("\n")
        expect(readAbcHeader(commonAndTwo)).toEqual({ key: "Gm", meter: "4/4", parts: "two" })

        const freeMeterOne = ["M: none", "K: F", "F G A B |"].join("\n")
        expect(readAbcHeader(freeMeterOne)).toEqual({ key: "F", meter: "none", parts: "one" })
    })

    it("rewrites only the key or meter header line without touching other lines", () => {
        const src = ["T: Abide With Me", "M: 4/4 % time signature", "L: 1/4", "K: Eb", "[V:S] G2 G F |"].join("\n")
        const changedKey = updateAbcHeaderField(src, "K", "F")
        expect(changedKey).toBe(["T: Abide With Me", "M: 4/4 % time signature", "L: 1/4", "K: F", "[V:S] G2 G F |"].join("\n"))

        const changedMeter = updateAbcHeaderField(src, "M", "3/4")
        expect(changedMeter).toBe(["T: Abide With Me", "M: 3/4 % time signature", "L: 1/4", "K: Eb", "[V:S] G2 G F |"].join("\n"))
    })

    it("inserts text at cursor position or replaces a selection", () => {
        expect(insertAbcAtCursor("C D F", "E ", 4)).toEqual({ value: "C D E F", cursor: 6 })
        expect(insertAbcAtCursor("C D E F", "G", 2, 3)).toEqual({ value: "C G E F", cursor: 3 })
        expect(insertAbcAtCursor("CD", "A", -5, -1)).toEqual({ value: "ACD", cursor: 1 })
        expect(insertAbcAtCursor("CD", "A", 99)).toEqual({ value: "CDA", cursor: 3 })
    })

    it("slices a three-line tune into three standalone ABC texts with the header", () => {
        const threeLines = ["T: Three Lines", "M: 4/4", "L: 1/4", "K: C", "%%score (S A)", "V: S", "V: A", "[V:S] C D E F |", "w: Line one words here", "[V:A] C, D, E, F, |", "[V:S] G A B c |", "w: Line two words here", "[V:A] G, A, B, C |", "[V:S] c B A G |", "w: Line three words here", "[V:A] C B, A, G, |"].join("\n")

        const slices = sliceAbcByLine(threeLines, abcjs.parseOnly)
        expect(slices).toHaveLength(3)

        for (const slice of slices) {
            expect(slice).toContain("T: Three Lines")
            expect(slice).toContain("%%score (S A)")
            expect(slice).toContain("K: C")
        }

        expect(slices[0]).toContain("[V:S] C D E F |")
        expect(slices[0]).toContain("w: Line one words here")
        expect(slices[0]).not.toContain("Line two")

        expect(slices[1]).toContain("[V:S] G A B c |")
        expect(slices[1]).toContain("w: Line two words here")
        expect(slices[1]).not.toContain("Line one")

        expect(slices[2]).toContain("[V:S] c B A G |")
        expect(slices[2]).toContain("w: Line three words here")
        expect(slices[2]).not.toContain("Line two")

        const withFooter = ["T: Lyrics", "M: 4/4", "L: 1/4", "K: C", "C D E F |", "w: One two three four", "W: Printed verse footer"].join("\n")
        const lyricSlices = sliceAbcByLine(withFooter, abcjs.parseOnly)
        expect(lyricSlices).toHaveLength(1)
        expect(lyricSlices[0]).toContain("w: One two three four")
        expect(lyricSlices[0]).not.toContain("W: Printed verse footer")
    })
})

describe("getSheetMusicAbc", () => {
    it("reads abc safely and treats wrong types as missing", () => {
        expect(getSheetMusicAbc({ abc: "K:C\nC4 |" })).toBe("K:C\nC4 |")
        expect(getSheetMusicAbc({ abc: 123 })).toBe("")
        expect(getSheetMusicAbc(null)).toBe("")
        expect(getSheetMusicAbc(undefined)).toBe("")
    })
})
