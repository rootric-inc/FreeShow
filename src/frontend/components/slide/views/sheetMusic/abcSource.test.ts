import { describe, expect, it } from "vitest"
import { createAbcTemplate, insertAbcAtCursor, readAbcHeader, updateAbcHeaderField } from "./abcSource"
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

        const withExtraMeterParam = ["M: 3/4 extra=1", "K: C clef=bass octave=-1", "C3 |"].join("\n")
        expect(readAbcHeader(withExtraMeterParam)).toEqual({ key: "C", meter: "3/4", parts: "one" })
    })

    it("rewrites only the key or meter token and preserves extra parameters and comments", () => {
        const src = ["T: Abide With Me", "M: 4/4 % time signature", "L: 1/4", "K: Eb", "[V:S] G2 G F |"].join("\n")
        const changedKey = updateAbcHeaderField(src, "K", "F")
        expect(changedKey).toBe(["T: Abide With Me", "M: 4/4 % time signature", "L: 1/4", "K: F", "[V:S] G2 G F |"].join("\n"))

        const changedMeter = updateAbcHeaderField(src, "M", "3/4")
        expect(changedMeter).toBe(["T: Abide With Me", "M: 3/4 % time signature", "L: 1/4", "K: Eb", "[V:S] G2 G F |"].join("\n"))

        const bassKey = ["M: 4/4", "K:C clef=bass octave=-1", "C4 |"].join("\n")
        expect(updateAbcHeaderField(bassKey, "K", "F")).toBe(["M: 4/4", "K:F clef=bass octave=-1", "C4 |"].join("\n"))

        const spacedMode = ["M: 4/4 extra=1 % time", "K: C major clef=bass % key", "C4 |"].join("\n")
        expect(updateAbcHeaderField(spacedMode, "K", "Am")).toBe(["M: 4/4 extra=1 % time", "K: Am clef=bass % key", "C4 |"].join("\n"))
        expect(updateAbcHeaderField(spacedMode, "M", "6/8")).toBe(["M: 6/8 extra=1 % time", "K: C major clef=bass % key", "C4 |"].join("\n"))

        const clefOnlyKey = ["M: 4/4", "K: clef=bass octave=-1", "C4 |"].join("\n")
        expect(updateAbcHeaderField(clefOnlyKey, "K", "G")).toBe(["M: 4/4", "K: G clef=bass octave=-1", "C4 |"].join("\n"))
    })

    it("inserts text at cursor position or replaces a selection", () => {
        expect(insertAbcAtCursor("C D F", "E ", 4)).toEqual({ value: "C D E F", cursor: 6 })
        expect(insertAbcAtCursor("C D E F", "G", 2, 3)).toEqual({ value: "C G E F", cursor: 3 })
        expect(insertAbcAtCursor("CD", "A", -5, -1)).toEqual({ value: "ACD", cursor: 1 })
        expect(insertAbcAtCursor("CD", "A", 99)).toEqual({ value: "CDA", cursor: 3 })
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
