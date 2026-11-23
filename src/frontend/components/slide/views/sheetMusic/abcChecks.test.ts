import abcjs from "abcjs"
import { describe, expect, it } from "vitest"
import type { AbcProblem } from "./abcChecks"
import { checkAbc, getAbcParts, mergeNeighborProblems } from "./abcChecks"
import { createAbcTemplate } from "./abcSource"

const CLEAN_EVENTIDE = ["T: Abide With Me", "M: 4/4", "L: 1/4", "K: Eb", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] G2 G F | E2 B2 | c B B A | G4 |", "w: 1.~A-bide with me; fast falls the e-ven-tide;", "w: 2.~Swift to its close ebbs out life's lit-tle day;", "[V:A] E2 D D | E2 E2 | E D E F | E4 |", "[V:T] B2 B A | G2 E2 | E B B B | B4 |", "[V:B] E2 B, B, | C2 G,2 | A, B, C D | E4 |"].join("\n")

const EVENTIDE_MISTAKES = ["T: Abide With Me", "M: 4/4", "L: 1/4", "K: Eb", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass", "V: B clef=bass", "[V:S] G2 G F | E2 B2 | c B B A | G4 |", "w: 1.~A-bide with me; fast falls the e-ven-tide;", "[V:A] E2 D D | E2 H2 | E D E F | E4 |", "[V:T] B,2 B, A, | G,2 E,2 | E, B, B, | B,4 |", "[V:B] E,2 B,, B,, | C,2 G,,2 | A,, B,, C, D, | E,4 |"].join("\n")

const MORE_MISTAKES = ["T: Abide With Me", "M: 4/4", "L: 1/4", "K: Eb", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass", "V: B clef=bass", "[V:S] G2 G F | E2 B2 | c B B A | G4 |", "w: 1.~A-bide with me; fast falls the e-ven-tide; and more words here", "[V:A] E2 D D | E2 E2 | E D E F | E4 |", "[V:T] B,2 B, A, | G,2 E,2 | E, B, B, B, | B,4 |", "[V:B] E2 B, B, | C2 G,2 | A, B, C D | E4 | E4 |"].join("\n")

describe("abcChecks", () => {
    it("returns no problems on a clean four-part tune", () => {
        expect(checkAbc(CLEAN_EVENTIDE, abcjs.parseOnly)).toEqual([])
    })

    it("detects syntax and beat-count problems in typed-eventide-mistakes.abc and points at their characters", () => {
        const problems = checkAbc(EVENTIDE_MISTAKES, abcjs.parseOnly)

        const syntax = problems.find((p) => p.key === "sheet_music.problem_syntax")
        expect(syntax).toBeDefined()
        expect(syntax!.severity).toBe("warning")
        expect(EVENTIDE_MISTAKES.slice(syntax!.startChar, syntax!.endChar)).toBe("2")
        expect(syntax!.startChar).toBe(EVENTIDE_MISTAKES.indexOf("H2") + 1)

        const tenorBeat = problems.find((p) => p.key === "sheet_music.problem_bar_beats_meter" && p.values[0] === "Tenor")
        expect(tenorBeat).toBeDefined()
        expect(tenorBeat!.values).toEqual(["Tenor", "3", "3", "4"])
        expect(EVENTIDE_MISTAKES.slice(tenorBeat!.startChar, tenorBeat!.endChar)).toBe("E, B, B,")
    })

    it("detects syllable, voice-order and extra-bar problems in typed-more-mistakes.abc", () => {
        const problems = checkAbc(MORE_MISTAKES, abcjs.parseOnly)

        const syllables = problems.find((p) => p.key === "sheet_music.problem_syllables")
        expect(syllables).toBeDefined()
        expect(syllables!.values).toEqual(["1", "14", "10"])
        expect(MORE_MISTAKES.slice(syllables!.startChar, syllables!.endChar)).toBe("and more words here")

        const voiceOrder = problems.filter((p) => p.key === "sheet_music.problem_voice_order")
        expect(voiceOrder.length).toBeGreaterThanOrEqual(2)
        const bar3Order = voiceOrder.find((p) => p.values[2] === "3")
        expect(bar3Order).toBeDefined()
        expect(bar3Order!.values).toEqual(["Bass", "Tenor", "3"])
        expect(MORE_MISTAKES.slice(bar3Order!.startChar, bar3Order!.endChar)).toBe("A,")

        const bar5Missing = problems.filter((p) => p.key === "sheet_music.problem_bar_beats_meter" && p.values[1] === "5")
        expect(bar5Missing.map((p) => p.values[0])).toEqual(["Soprano", "Alto", "Tenor"])
    })

    it("detects fewer syllables than notes and a bass-staff voice sitting a fourth or more above treble", () => {
        const shortLyrics = ["M: 4/4", "L: 1/4", "K: C", "C D E F |", "w: One two"].join("\n")
        const p1 = checkAbc(shortLyrics, abcjs.parseOnly)
        expect(p1).toHaveLength(1)
        expect(p1[0].key).toBe("sheet_music.problem_syllables")
        expect(p1[0].values).toEqual(["1", "2", "4"])

        const bassAboveTreble = ["M: 4/4", "L: 1/4", "K: C", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass", "V: B clef=bass", "[V:S] G G G G |", "[V:A] E E E E |", "[V:T] c c c c |", "[V:B] C, C, C, C, |"].join("\n")
        const p2 = checkAbc(bassAboveTreble, abcjs.parseOnly)
        const cross = p2.find((p) => p.key === "sheet_music.problem_voice_order")
        expect(cross).toBeDefined()
        expect(cross!.values).toEqual(["Tenor", "Alto", "1"])
    })

    it("allows tenor slightly above alto (< 5 semitones) while flagging >= 5 semitones and any same-staff crossing", () => {
        // Tenor E4 above Alto C4 = 4 semitones (major third) -> allowed
        const smallCross = ["M: 4/4", "L: 1/4", "K: C", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass", "V: B clef=bass", "[V:S] G G G G |", "[V:A] C C C C |", "[V:T] E E E E |", "[V:B] C, C, C, C, |"].join("\n")
        expect(checkAbc(smallCross, abcjs.parseOnly)).toEqual([])

        // Tenor F4 above Alto C4 = 5 semitones (perfect fourth) -> flagged
        const fourthCross = ["M: 4/4", "L: 1/4", "K: C", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass", "V: B clef=bass", "[V:S] G G G G |", "[V:A] C C C C |", "[V:T] F F F F |", "[V:B] C, C, C, C, |"].join("\n")
        const fourthProblems = checkAbc(fourthCross, abcjs.parseOnly)
        expect(fourthProblems.some((p) => p.key === "sheet_music.problem_voice_order" && p.values[0] === "Tenor" && p.values[1] === "Alto")).toBe(true)

        // Same-staff crossing of 1 semitone (Alto F4 above Soprano E4, and Bass above Tenor) -> still flagged
        const sameStaffCross = ["M: 4/4", "L: 1/4", "K: C", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] E E E E |", "[V:A] F F F F |", "[V:T] E E E E |", "[V:B] F F F F |"].join("\n")
        const sameStaffProblems = checkAbc(sameStaffCross, abcjs.parseOnly)
        expect(sameStaffProblems.some((p) => p.key === "sheet_music.problem_voice_order" && p.values[0] === "Alto" && p.values[1] === "Soprano")).toBe(true)
        expect(sameStaffProblems.some((p) => p.key === "sheet_music.problem_voice_order" && p.values[0] === "Bass" && p.values[1] === "Tenor")).toBe(true)
    })

    it("blames only the wrong part against a known time signature, and compares parts when there is no time signature", () => {
        const sopranoShort = ["M: 4/4", "L: 1/4", "K: C", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] G2 G F | E2 G | c B B A | G4 |", "[V:A] E2 D D | E2 E2 | E D E F | E4 |", "[V:T] B2 B A | G2 E2 | E B B B | B4 |", "[V:B] E2 B, B, | C2 G,2 | A, B, C D | E4 |"].join("\n")
        const problems = checkAbc(sopranoShort, abcjs.parseOnly)
        const beatProblems = problems.filter((p) => p.key.startsWith("sheet_music.problem_bar_beats_"))
        expect(beatProblems).toHaveLength(1)
        expect(beatProblems[0].key).toBe("sheet_music.problem_bar_beats_meter")
        expect(beatProblems[0].values).toEqual(["Soprano", "2", "3", "4"])
        expect(sopranoShort.slice(beatProblems[0].startChar, beatProblems[0].endChar)).toBe("E2 G")

        const freeMeterMismatch = ["M: none", "L: 1/4", "K: C", "%%score (S A)", "V: S", "V: A", "[V:S] C D E F |", "[V:A] C, D, E, |"].join("\n")
        const freeProblems = checkAbc(freeMeterMismatch, abcjs.parseOnly)
        expect(freeProblems).toHaveLength(1)
        expect(freeProblems[0].key).toBe("sheet_music.problem_bar_beats_part")
        expect(freeProblems[0].values).toEqual(["Voice 2", "1", "3", "4"])
    })

    it("skips beat warnings for completely empty parts and selects a part's own text when it has notes", () => {
        const template = createAbcTemplate({ key: "Eb", meter: "4/4", parts: "four" })
        const sopranoOnly = template.replace("[V:S] ", "[V:S] G2 G F | E2 B2 | c B B A | G4 |")
        expect(checkAbc(sopranoOnly, abcjs.parseOnly)).toEqual([])
    })

    it("warns on a blank line in the tune body followed by music, but not on leading or trailing blank lines", () => {
        const withBlank = ["T: One part", "M: 4/4", "L: 1/4", "K: G", "G A B c | d4 |", "w: one two three four five", "", "B A G A | G4 |]", "w: six sev-en eight nine ten"].join("\n")
        const problems = checkAbc(withBlank, abcjs.parseOnly)
        const blank = problems.find((p) => p.key === "sheet_music.problem_blank_line")
        expect(blank).toBeDefined()
        expect(blank!.severity).toBe("warning")
        const blankLineStart = withBlank.indexOf("\n\n") + 1
        expect(blank!.startChar).toBe(blankLineStart)

        const leadingAndTrailing = ["", "T: Clean", "M: 4/4", "L: 1/4", "K: G", "G A B c | d4 |", "", "% trailing comment", ""].join("\n")
        expect(checkAbc(leadingAndTrailing, abcjs.parseOnly)).toEqual([])
    })

    it("reports an error when a later line has fewer staves or fewer voices than the first line", () => {
        const missingStaff = ["M:4/4", "L:1/4", "K:C", "%%score (S A) (T B)", "V:S", "V:A", "V:T clef=bass octave=-1", "V:B clef=bass octave=-1", "[V:S] c4 | B4 |", "[V:A] E4 | D4 |", "[V:T] G4 | G4 |", "[V:B] C4 | G,4 |", "[V:T] A4 | G4 |]", "[V:B] F,4 | C4 |]"].join("\n")
        const p1 = checkAbc(missingStaff, abcjs.parseOnly)
        const err1 = p1.find((p) => p.key === "sheet_music.problem_missing_parts")
        expect(err1).toBeDefined()
        expect(err1!.severity).toBe("error")
        expect(missingStaff.slice(err1!.startChar, err1!.endChar)).toBe("[V:T] A4 | G4 |]")

        const missingVoice = ["M:4/4", "L:1/4", "K:C", "%%score (S A) (T B)", "V:S", "V:A", "V:T clef=bass octave=-1", "V:B clef=bass octave=-1", "[V:S] c4 | B4 |", "[V:A] E4 | D4 |", "[V:T] G4 | G4 |", "[V:B] C4 | G,4 |", "[V:S] c4 | B4 |", "[V:T] A4 | G4 |]", "[V:B] F,4 | C4 |]"].join("\n")
        const p2 = checkAbc(missingVoice, abcjs.parseOnly)
        const err2 = p2.find((p) => p.key === "sheet_music.problem_missing_parts")
        expect(err2).toBeDefined()
        expect(err2!.severity).toBe("error")
    })

    it("handles multi-bar rests without reporting a beat mismatch", () => {
        const multiRest = ["M: 3/4", "L: 1/4", "K: C", "C3 | Z4 | C3 |"].join("\n")
        expect(checkAbc(multiRest, abcjs.parseOnly)).toEqual([])
    })

    it("counts syllables accurately with bar skips and spaced or doubled hyphens", () => {
        const barSkipOverflow = ["M: 4/4", "L: 1/4", "K: C", "C D E F | G A B c |", "w: one two | three four five six seven"].join("\n")
        const p1 = checkAbc(barSkipOverflow, abcjs.parseOnly)
        expect(p1).toHaveLength(1)
        expect(p1[0].key).toBe("sheet_music.problem_syllables")
        expect(p1[0].values).toEqual(["1", "7", "8"])
        expect(barSkipOverflow.slice(p1[0].startChar, p1[0].endChar)).toBe("seven")

        const barSkipExact = ["M: 4/4", "L: 1/4", "K: C", "C D E F | G A B c |", "w: one two | three four five six"].join("\n")
        expect(checkAbc(barSkipExact, abcjs.parseOnly)).toEqual([])

        const spacedHyphenExact = ["M: 3/4", "L: 1/4", "K: C", "C D E |", "w: two - three"].join("\n")
        expect(checkAbc(spacedHyphenExact, abcjs.parseOnly)).toEqual([])

        const spacedHyphenShort = ["M: 4/4", "L: 1/4", "K: C", "C D E F |", "w: two - three"].join("\n")
        const p2 = checkAbc(spacedHyphenShort, abcjs.parseOnly)
        expect(p2).toHaveLength(1)
        expect(p2[0].values).toEqual(["1", "2", "4"])

        const doubledHyphenShort = ["M: 4/4", "L: 1/4", "K: C", "C D E F |", "w: two-- three"].join("\n")
        const p3 = checkAbc(doubledHyphenShort, abcjs.parseOnly)
        expect(p3).toHaveLength(1)
        expect(p3[0].values).toEqual(["1", "2", "4"])
    })

    it("skips a pickup bar, a short final bar, a mid-bar section break and joins a bar split over two lines", () => {
        const pickupAndShortEnd = ["M: 4/4", "L: 1/4", "K: C", "G | C D E F | G A B |"].join("\n")
        expect(checkAbc(pickupAndShortEnd, abcjs.parseOnly)).toEqual([])

        const splitBar = ["M: 4/4", "L: 1/4", "K: C", "C D E F | G A", "B c | C4 |"].join("\n")
        expect(checkAbc(splitBar, abcjs.parseOnly)).toEqual([])

        const sectionBreak = ["M: 4/4", "L: 1/4", "K: C", "G | C D E F | G3 ||", "G | C D E F | G3 |]"].join("\n")
        expect(checkAbc(sectionBreak, abcjs.parseOnly)).toEqual([])

        const splitBarVoiceCrossing = ["M: 4/4", "L: 1/4", "K: C", "%%score (S A)", "V: S", "V: A", "[V:S] B A G", "[V:A] E E E", "[V:S] A | C4 |", "[V:A] B | C4 |"].join("\n")
        expect(checkAbc(splitBarVoiceCrossing, abcjs.parseOnly)).toEqual([])
    })

    it("preserves full abcjs warning text when the message contains a colon", () => {
        const unknownVoice = ["X:1", "M: 4/4", "L: 1/4", "%%score (S A)", "V: S", "V: A", "V: EXTRA", "K: C", "[V:S] C D E F |", "[V:A] C, D, E, F, |"].join("\n")
        const problems = checkAbc(unknownVoice, abcjs.parseOnly)
        const syntax = problems.find((p) => p.key === "sheet_music.problem_syntax")
        expect(syntax).toBeDefined()
        expect(syntax!.values[0]).toContain("V: id")
    })

    it("drops harmless abcjs warnings from pasted directives and decorations", () => {
        const pasted = ["%%pagewidth 21.6cm", "%%measurebox false", "%%combinevoices 1", "%%postscript /x {} def", "M: 4/4", "L: 1/4", "K: C", "!unknown_deco!C D E F |"].join("\n")
        expect(checkAbc(pasted, abcjs.parseOnly)).toEqual([])
    })

    it("maps warning character offsets accurately when comments and directives precede X:1", () => {
        const withBanner = ["% comment 1", "% comment 2", "%%pagewidth 21cm", "% comment 3", "X:1", "M: 4/4", "L: 1/4", "K: C", "C D H2 F |"].join("\n")
        const problems = checkAbc(withBanner, abcjs.parseOnly)
        const syntax = problems.find((p) => p.key === "sheet_music.problem_syntax")
        expect(syntax).toBeDefined()
        expect(withBanner.slice(syntax!.startChar, syntax!.endChar)).toBe("2")
        expect(syntax!.startChar).toBe(withBanner.indexOf("H2") + 1)
    })

    it("counts an escaped trailing hyphen in w: as a complete syllable", () => {
        const escapedHyphen = ["M: 4/4", "L: 1/4", "K: C", "C D E F |", "w: One two three four\\- "].join("\n")
        expect(checkAbc(escapedHyphen, abcjs.parseOnly)).toEqual([])
    })

    it("returns an error when text has no notes", () => {
        const empty = checkAbc("", abcjs.parseOnly)
        expect(empty.some((p) => p.severity === "error" && p.key === "sheet_music.problem_no_notes")).toBe(true)

        const headerOnly = checkAbc("T: Empty\nM: 4/4\nK: C\n", abcjs.parseOnly)
        expect(headerOnly.some((p) => p.severity === "error" && p.key === "sheet_music.problem_no_notes")).toBe(true)
    })

    it("names parts from voice names or Voice N when not 2x2 SATB", () => {
        const twoVoice = ["M: 4/4", "L: 1/4", "K: C", "%%score (V1 V2)", 'V: V1 name="Lead"', "V: V2", "[V:V1] C D E F |", "[V:V2] C, D, E, F, |"].join("\n")
        const tune = abcjs.parseOnly(twoVoice)[0]
        expect(getAbcParts(tune)).toEqual([
            { staff: 1, layer: 1, name: "Lead" },
            { staff: 1, layer: 2, name: "Voice 2" }
        ])
    })

    describe("mergeNeighborProblems", () => {
        it("merges consecutive unknown-character warnings on one line into a single range", () => {
            const plainWords = "hello this is not music"
            const raw = checkAbc(plainWords, abcjs.parseOnly)
            const rawSyntax = raw.filter((p) => p.key === "sheet_music.problem_syntax")
            expect(rawSyntax.length).toBeGreaterThan(1)

            const merged = mergeNeighborProblems(raw, plainWords)
            const mergedSyntax = merged.filter((p) => p.key === "sheet_music.problem_syntax")
            expect(mergedSyntax).toHaveLength(1)
            expect(mergedSyntax[0].startChar).toBe(rawSyntax[0].startChar)
            expect(mergedSyntax[0].endChar).toBe(rawSyntax[rawSyntax.length - 1].endChar)
            expect(plainWords.slice(mergedSyntax[0].startChar, mergedSyntax[0].endChar)).toBe("hello this is not musi")
        })

        it("does not merge matching problems across different lines", () => {
            const twoLines = "hello this is not music\nstill not music here"
            const raw = checkAbc(twoLines, abcjs.parseOnly)
            const merged = mergeNeighborProblems(raw, twoLines)
            const mergedSyntax = merged.filter((p) => p.key === "sheet_music.problem_syntax")

            expect(mergedSyntax).toHaveLength(2)
            expect(mergedSyntax[0].endChar).toBeLessThanOrEqual(twoLines.indexOf("\n"))
            expect(mergedSyntax[1].startChar).toBeGreaterThan(twoLines.indexOf("\n"))
        })

        it("keeps non-consecutive, different-key, different-value and different-severity entries separate without mutating inputs", () => {
            const line = "abcdefghij"
            const input: AbcProblem[] = [
                { severity: "warning", key: "sheet_music.problem_syntax", values: ["Unknown character ignored"], startChar: 0, endChar: 1 },
                { severity: "warning", key: "sheet_music.problem_syntax", values: ["Unknown character ignored"], startChar: 1, endChar: 2 },
                { severity: "warning", key: "sheet_music.problem_syntax", values: ["Other warning"], startChar: 3, endChar: 4 },
                { severity: "warning", key: "sheet_music.problem_syntax", values: ["Unknown character ignored"], startChar: 5, endChar: 6 },
                { severity: "warning", key: "sheet_music.problem_grace_notes", values: ["Unknown character ignored"], startChar: 6, endChar: 7 },
                { severity: "error", key: "sheet_music.problem_grace_notes", values: ["Unknown character ignored"], startChar: 7, endChar: 8 }
            ]
            const snapshot = input.map((p) => ({ ...p, values: [...p.values] }))

            const merged = mergeNeighborProblems(input, line)
            expect(merged).toEqual([
                { severity: "warning", key: "sheet_music.problem_syntax", values: ["Unknown character ignored"], startChar: 0, endChar: 2 },
                { severity: "warning", key: "sheet_music.problem_syntax", values: ["Other warning"], startChar: 3, endChar: 4 },
                { severity: "warning", key: "sheet_music.problem_syntax", values: ["Unknown character ignored"], startChar: 5, endChar: 6 },
                { severity: "warning", key: "sheet_music.problem_grace_notes", values: ["Unknown character ignored"], startChar: 6, endChar: 7 },
                { severity: "error", key: "sheet_music.problem_grace_notes", values: ["Unknown character ignored"], startChar: 7, endChar: 8 }
            ])
            expect(input).toEqual(snapshot)
            expect(mergeNeighborProblems([], "")).toEqual([])
        })
    })
})
