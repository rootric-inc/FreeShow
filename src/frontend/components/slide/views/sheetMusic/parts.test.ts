import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { MeiSummary } from "./meiParts"
import { formatMeasureRange, getDisplayedVersesValue, getPartNames, hasPartsOptions, parseMeasureRange, parseVersesFilter, resolveCustomPartsKeys, resolveMeasureRange, resolvePartsSelection, resolveVersesSelection, toggleCustomPartKey } from "./parts"

const SATB_SUMMARY: MeiSummary = {
    staves: [
        { n: "1", layers: ["1", "2"], hasChords: false },
        { n: "2", layers: ["5", "6"], hasChords: false }
    ],
    verses: [1, 2, 3, 4],
    measures: 16,
    hasTwoLayersPerStaffInEveryBar: true
}

const TWO_STAFF_CHORD_SUMMARY: MeiSummary = {
    staves: [
        { n: "1", layers: ["1"], hasChords: true },
        { n: "2", layers: ["1"], hasChords: true }
    ],
    verses: [1],
    measures: 8,
    hasTwoLayersPerStaffInEveryBar: false
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
        expect(resolvePartsSelection("melody", undefined, SATB_SUMMARY)).toEqual({ parts: ["1.1"], highestNoteOnly: true })
        expect(resolvePartsSelection("custom", ["1.1", "2.6", "9.9", "1.1"], SATB_SUMMARY)).toEqual({ parts: ["1.1", "2.6"], highestNoteOnly: false })
    })

    it("always enables highestNoteOnly for melody, including one-staff chorded scores", () => {
        expect(resolvePartsSelection("melody", undefined, TWO_STAFF_CHORD_SUMMARY)).toEqual({
            parts: ["1.1"],
            highestNoteOnly: true
        })

        const singleStaffChord: MeiSummary = {
            staves: [{ n: "1", layers: ["1"], hasChords: true }],
            verses: [],
            measures: 2,
            hasTwoLayersPerStaffInEveryBar: false
        }
        expect(resolvePartsSelection("melody", undefined, singleStaffChord)).toEqual({
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

describe("hasPartsOptions and custom part toggling", () => {
    it("shows Parts for multi-staff, multi-layer, or single-staff chorded music only", () => {
        expect(hasPartsOptions(SATB_SUMMARY)).toBe(true)
        expect(hasPartsOptions({ staves: [{ n: "1", layers: ["1", "2"], hasChords: false }], verses: [], measures: 2, hasTwoLayersPerStaffInEveryBar: false })).toBe(true)
        expect(hasPartsOptions({ staves: [{ n: "1", layers: ["1"], hasChords: true }], verses: [], measures: 2, hasTwoLayersPerStaffInEveryBar: false })).toBe(true)
        expect(hasPartsOptions({ staves: [{ n: "1", layers: ["1"], hasChords: false }], verses: [], measures: 2, hasTwoLayersPerStaffInEveryBar: false })).toBe(false)
    })

    it("prevents unticking the last remaining custom part", () => {
        const allKeys = ["1.1", "1.2", "2.1", "2.2"]
        expect(resolveCustomPartsKeys(undefined, allKeys)).toEqual(allKeys)
        expect(resolveCustomPartsKeys([], allKeys)).toEqual(allKeys)
        expect(resolveCustomPartsKeys(["9.9"], allKeys)).toEqual(allKeys)
        expect(resolveCustomPartsKeys(["2.1", "1.1"], allKeys)).toEqual(["1.1", "2.1"])

        expect(toggleCustomPartKey(["1.1", "2.1"], allKeys, "2.1", false)).toEqual(["1.1"])
        expect(toggleCustomPartKey(["1.1"], allKeys, "1.1", false)).toBeNull()
        expect(toggleCustomPartKey(["1.1"], allKeys, "2.2", true)).toEqual(["1.1", "2.2"])
    })
})

describe("getPartNames", () => {
    it("names two staves of two layers in every bar as Soprano, Alto, Tenor, Bass and backs every key in en.json", () => {
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

    it("names two-staff two-layer music by position when either staff lacks two layers in some bar", () => {
        const sparseTwoLayer: MeiSummary = {
            ...SATB_SUMMARY,
            hasTwoLayersPerStaffInEveryBar: false
        }
        expect(getPartNames(sparseTwoLayer)).toEqual([
            { key: "1.1", staff: "1", layer: "1", labelKey: "sheet_music.part_staff_voice", values: ["1", "1"] },
            { key: "1.2", staff: "1", layer: "2", labelKey: "sheet_music.part_staff_voice", values: ["1", "2"] },
            { key: "2.5", staff: "2", layer: "5", labelKey: "sheet_music.part_staff_voice", values: ["2", "1"] },
            { key: "2.6", staff: "2", layer: "6", labelKey: "sheet_music.part_staff_voice", values: ["2", "2"] }
        ])
    })

    it("names non-SATB layouts by staff and voice position", () => {
        expect(getPartNames(TWO_STAFF_CHORD_SUMMARY)).toEqual([
            { key: "1.1", staff: "1", layer: "1", labelKey: "sheet_music.part_staff", values: ["1"] },
            { key: "2.1", staff: "2", layer: "1", labelKey: "sheet_music.part_staff", values: ["2"] }
        ])

        const threeStaves: MeiSummary = {
            staves: [
                { n: "1", layers: ["1", "2"], hasChords: false },
                { n: "2", layers: ["1"], hasChords: false },
                { n: "3", layers: ["5", "6"], hasChords: false }
            ],
            verses: [],
            measures: 4,
            hasTwoLayersPerStaffInEveryBar: false
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

describe("parseVersesFilter, resolveVersesSelection and getDisplayedVersesValue", () => {
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

    it("falls back to all verses and displays All verses when none of the chosen verses exist", () => {
        expect(resolveVersesSelection("4", [1, 2])).toBe("all")
        expect(resolveVersesSelection("3,4", [1, 2])).toBe("all")
        expect(resolveVersesSelection("2,4", [1, 2])).toEqual([2])
        expect(resolveVersesSelection("none", [1, 2])).toBe("none")

        expect(getDisplayedVersesValue("4", [1, 2])).toBe("")
        expect(getDisplayedVersesValue("2", [1, 2])).toBeNull()
        expect(getDisplayedVersesValue("none", [1, 2])).toBeNull()
        expect(getDisplayedVersesValue("", [1, 2])).toBeNull()
    })
})

describe("parseMeasureRange, resolveMeasureRange and formatMeasureRange", () => {
    it("parses ranges, single measures and open-ended ranges, clamping the end only", () => {
        expect(parseMeasureRange("5-8", 16)).toEqual({ first: 5, last: 8 })
        expect(parseMeasureRange("5", 16)).toEqual({ first: 5, last: 5 })
        expect(parseMeasureRange("5-", 16)).toEqual({ first: 5, last: 16 })
        expect(parseMeasureRange(" 5 - 8 ", 16)).toEqual({ first: 5, last: 8 })
        expect(parseMeasureRange("5-99", 16)).toEqual({ first: 5, last: 16 })
        expect(formatMeasureRange(5, 8)).toBe("5-8")
        expect(formatMeasureRange(5, 5)).toBe("5")
    })

    it("returns null for non-ranges, reversed ranges, or starts past the last bar", () => {
        expect(parseMeasureRange("", 16)).toBeNull()
        expect(parseMeasureRange("   ", 16)).toBeNull()
        expect(parseMeasureRange("8-5", 16)).toBeNull()
        expect(parseMeasureRange("0", 16)).toBeNull()
        expect(parseMeasureRange("0-4", 16)).toBeNull()
        expect(parseMeasureRange("-5", 16)).toBeNull()
        expect(parseMeasureRange("abc", 16)).toBeNull()
        expect(parseMeasureRange("1-2-3", 16)).toBeNull()
        expect(parseMeasureRange("20-", 16)).toBeNull()
        expect(parseMeasureRange("20-25", 16)).toBeNull()
        expect(parseMeasureRange("1-4", 0)).toBeNull()
    })

    it("maps printed measure numbers (pickup bar 0 and split bars) to 1-based positions", () => {
        const withPickup = [0, 1, 2, 3, 4, 5, 6, 7, 8]
        expect(resolveMeasureRange("0", withPickup)).toEqual({ first: 1, last: 1, firstNumber: 0, lastNumber: 0 })
        expect(resolveMeasureRange("0-2", withPickup)).toEqual({ first: 1, last: 3, firstNumber: 0, lastNumber: 2 })
        expect(resolveMeasureRange("2-3", withPickup)).toEqual({ first: 3, last: 4, firstNumber: 2, lastNumber: 3 })
        expect(resolveMeasureRange("6-", withPickup)).toEqual({ first: 7, last: 9, firstNumber: 6, lastNumber: 8 })
        expect(resolveMeasureRange("9-10", withPickup)).toBeNull()

        const withSplit = [1, 2, 3, 4, 4, 5]
        expect(resolveMeasureRange("4", withSplit)).toEqual({ first: 4, last: 5, firstNumber: 4, lastNumber: 4 })
        expect(resolveMeasureRange("3-4", withSplit)).toEqual({ first: 3, last: 5, firstNumber: 3, lastNumber: 4 })
        expect(resolveMeasureRange("0", withSplit)).toBeNull()
        expect(resolveMeasureRange("6-8", withSplit)).toBeNull()
    })
})
