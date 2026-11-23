import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { MeiSummary } from "./meiParts"
import { formatMeasureRange, getPartNames, parseMeasureRange, parseVersesFilter, resolvePartsSelection } from "./parts"

const SATB_SUMMARY: MeiSummary = {
    staves: [
        { n: "1", layers: ["1", "2"] },
        { n: "2", layers: ["5", "6"] }
    ],
    verses: [1, 2, 3, 4],
    measures: 16
}

const TWO_STAFF_CHORD_SUMMARY: MeiSummary = {
    staves: [
        { n: "1", layers: ["1"] },
        { n: "2", layers: ["1"] }
    ],
    verses: [1],
    measures: 8
}

function getNestedValue(obj: Record<string, any>, dottedKey: string): unknown {
    return dottedKey.split(".").reduce<any>((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), obj)
}

describe("resolvePartsSelection", () => {
    it("resolves all, upper, lower, melody and custom presets for a four-part hymn", () => {
        expect(resolvePartsSelection(undefined, undefined, SATB_SUMMARY)).toEqual({ parts: "all", highestNoteOnly: false })
        expect(resolvePartsSelection("all", undefined, SATB_SUMMARY)).toEqual({ parts: "all", highestNoteOnly: false })
        expect(resolvePartsSelection("upper", undefined, SATB_SUMMARY)).toEqual({ parts: ["1.1", "1.2"], highestNoteOnly: false })
        expect(resolvePartsSelection("lower", undefined, SATB_SUMMARY)).toEqual({ parts: ["2.5", "2.6"], highestNoteOnly: false })
        expect(resolvePartsSelection("melody", undefined, SATB_SUMMARY)).toEqual({ parts: ["1.1"], highestNoteOnly: false })
        expect(resolvePartsSelection("custom", ["1.1", "2.6", "9.9", "1.1"], SATB_SUMMARY)).toEqual({ parts: ["1.1", "2.6"], highestNoteOnly: false })
    })

    it("enables highestNoteOnly for melody when the first staff has one layer", () => {
        expect(resolvePartsSelection("melody", undefined, TWO_STAFF_CHORD_SUMMARY)).toEqual({
            parts: ["1.1"],
            highestNoteOnly: true
        })
    })

    it("keeps everything when a custom selection would keep nothing or keeps all parts", () => {
        expect(resolvePartsSelection("custom", [], SATB_SUMMARY)).toEqual({ parts: "all", highestNoteOnly: false })
        expect(resolvePartsSelection("custom", ["9.9"], SATB_SUMMARY)).toEqual({ parts: "all", highestNoteOnly: false })
        expect(resolvePartsSelection("custom", ["1.1", "1.2", "2.5", "2.6"], SATB_SUMMARY)).toEqual({ parts: "all", highestNoteOnly: false })
    })
})

describe("getPartNames", () => {
    it("names two staves of two layers as Soprano, Alto, Tenor, Bass and backs every key in en.json", () => {
        const enPath = fileURLToPath(new URL("../../../../../../public/lang/en.json", import.meta.url))
        const en = JSON.parse(readFileSync(enPath, "utf8")) as Record<string, any>

        const satb = getPartNames(SATB_SUMMARY)
        expect(satb).toEqual([
            { key: "1.1", staff: "1", layer: "1", labelKey: "sheet_music.part_soprano", values: [] },
            { key: "1.2", staff: "1", layer: "2", labelKey: "sheet_music.part_alto", values: [] },
            { key: "2.5", staff: "2", layer: "5", labelKey: "sheet_music.part_tenor", values: [] },
            { key: "2.6", staff: "2", layer: "6", labelKey: "sheet_music.part_bass", values: [] }
        ])

        for (const entry of satb) {
            expect(typeof getNestedValue(en, entry.labelKey)).toBe("string")
        }
        expect(getNestedValue(en, "sheet_music.part_staff")).toBe("Staff $1")
        expect(getNestedValue(en, "sheet_music.part_staff_voice")).toBe("Staff $1, voice $2")
    })

    it("names non-SATB layouts by staff and voice position", () => {
        expect(getPartNames(TWO_STAFF_CHORD_SUMMARY)).toEqual([
            { key: "1.1", staff: "1", layer: "1", labelKey: "sheet_music.part_staff", values: ["1"] },
            { key: "2.1", staff: "2", layer: "1", labelKey: "sheet_music.part_staff", values: ["2"] }
        ])

        const threeStaves: MeiSummary = {
            staves: [
                { n: "1", layers: ["1", "2"] },
                { n: "2", layers: ["1"] },
                { n: "3", layers: ["5", "6"] }
            ],
            verses: [],
            measures: 4
        }
        expect(getPartNames(threeStaves)).toEqual([
            { key: "1.1", staff: "1", layer: "1", labelKey: "sheet_music.part_staff_voice", values: ["1", "1"] },
            { key: "1.2", staff: "1", layer: "2", labelKey: "sheet_music.part_staff_voice", values: ["1", "2"] },
            { key: "2.1", staff: "2", layer: "1", labelKey: "sheet_music.part_staff", values: ["2"] },
            { key: "3.5", staff: "3", layer: "5", labelKey: "sheet_music.part_staff_voice", values: ["3", "1"] },
            { key: "3.6", staff: "3", layer: "6", labelKey: "sheet_music.part_staff_voice", values: ["3", "2"] }
        ])
    })
})

describe("parseVersesFilter", () => {
    it("parses missing, none and comma-separated verse numbers while ignoring non-numbers", () => {
        expect(parseVersesFilter(undefined)).toBe("all")
        expect(parseVersesFilter("")).toBe("all")
        expect(parseVersesFilter("all")).toBe("all")
        expect(parseVersesFilter("none")).toBe("none")
        expect(parseVersesFilter(" NONE ")).toBe("none")
        expect(parseVersesFilter("2")).toEqual([2])
        expect(parseVersesFilter("1,3")).toEqual([1, 3])
        expect(parseVersesFilter(" 3 , 1 , bogus , 0 , -2 , 1 ")).toEqual([1, 3])
        expect(parseVersesFilter("bogus")).toBe("all")
    })
})

describe("parseMeasureRange and formatMeasureRange", () => {
    it("parses ranges, single measures and open-ended ranges, clamping to total measures", () => {
        expect(parseMeasureRange("5-8", 16)).toEqual({ first: 5, last: 8 })
        expect(parseMeasureRange("5", 16)).toEqual({ first: 5, last: 5 })
        expect(parseMeasureRange("5-", 16)).toEqual({ first: 5, last: 16 })
        expect(parseMeasureRange(" 5 - 8 ", 16)).toEqual({ first: 5, last: 8 })
        expect(parseMeasureRange("5-99", 16)).toEqual({ first: 5, last: 16 })
        expect(parseMeasureRange("20-25", 16)).toEqual({ first: 16, last: 16 })
        expect(formatMeasureRange(5, 8)).toBe("5-8")
        expect(formatMeasureRange(5, 5)).toBe("5")
    })

    it("returns null for non-ranges or reversed ranges", () => {
        expect(parseMeasureRange("", 16)).toBeNull()
        expect(parseMeasureRange("   ", 16)).toBeNull()
        expect(parseMeasureRange("8-5", 16)).toBeNull()
        expect(parseMeasureRange("0", 16)).toBeNull()
        expect(parseMeasureRange("0-4", 16)).toBeNull()
        expect(parseMeasureRange("-5", 16)).toBeNull()
        expect(parseMeasureRange("abc", 16)).toBeNull()
        expect(parseMeasureRange("1-2-3", 16)).toBeNull()
        expect(parseMeasureRange("20-", 16)).toBeNull()
        expect(parseMeasureRange("1-4", 0)).toBeNull()
    })
})
