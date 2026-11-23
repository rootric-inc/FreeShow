import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { getItemSetValue } from "../../helpers/itemValues"
import { EXTRA_STYLE_LEAVES, copyStyleValues, getStyleLeafRoots, getStylePastePlan, mergeStyleValues, parseDottedId, setStyleLeaf, withExtraStyleLeaves } from "./styleValues"
import type { StyleInput, StylePastePlan } from "./styleValues"

const chartInputs: StyleInput[] = [
    { id: "chart.type", type: "dropdown" },
    { id: "chart.holeSize", type: "number" },
    { id: "chart.data", type: "popup" }
]

const cameraInputs: StyleInput[] = [
    { id: "device", type: "popup" },
    { id: "fit", type: "dropdown" },
    { id: "flipped", type: "checkbox" },
    { id: "flippedY", type: "checkbox" },
    { id: "cropping.top", type: "number" },
    { id: "filter", type: "number" }
]

const croppingInputs: StyleInput[] = [
    { id: "cropping.top", type: "number" },
    { id: "cropping.right", type: "number" },
    { id: "cropping.bottom", type: "number" },
    { id: "cropping.left", type: "number" }
]

const specialStyleInputs: StyleInput[] = [
    { id: "specialStyle.lineGap", type: "number" },
    { id: "specialStyle.lineBg", type: "color" },
    { id: "specialStyle.lineRadius", type: "number" }
]

const qrCodeInputs: StyleInput[] = [
    { id: "qr_code.text", type: "string" },
    { id: "qr_code.color", type: "color" },
    { id: "qr_code.background", type: "color" }
]

const sheetMusicInputs: StyleInput[] = [
    { id: "sheet_music", type: "popup" },
    { id: "style", type: "color" },
    { id: "sheet_music.size", type: "number" }
]

describe("copyStyleValues", () => {
    it("copies only dotted leaves and skips dotted popup inputs", () => {
        const item = {
            type: "chart",
            style: "left: 0px;",
            chart: { type: "pie", holeSize: 40, data: "a,b\n1,2" }
        }

        expect(copyStyleValues(item, chartInputs)).toEqual({
            chart: { type: "pie", holeSize: 40 }
        })
    })

    it("copies falsy leaf values and marks unset declared leaves as null when the root exists", () => {
        const withZero = { chart: { holeSize: 0, data: "a,b\n1,2" } }
        expect(copyStyleValues(withZero, chartInputs)).toEqual({
            chart: { type: null, holeSize: 0 }
        })

        const dataOnly = { chart: { data: "a,b\n1,2" } }
        expect(copyStyleValues(dataOnly, chartInputs)).toEqual({
            chart: { type: null, holeSize: null }
        })
    })

    it("records declared leaves as null when the source has no root object", () => {
        expect(copyStyleValues({ type: "chart" }, chartInputs)).toEqual({
            chart: { type: null, holeSize: null }
        })
        expect(copyStyleValues({ chart: undefined }, chartInputs)).toEqual({
            chart: { type: null, holeSize: null }
        })
        expect(copyStyleValues({ chart: null }, chartInputs)).toEqual({
            chart: { type: null, holeSize: null }
        })
        expect(copyStyleValues({ type: "camera" }, cameraInputs)).toEqual({
            cropping: { top: null }
        })
    })

    it("treats a null source leaf as unset", () => {
        const item = { chart: { type: "pie", holeSize: null, data: "x" } }

        expect(copyStyleValues(item, chartInputs)).toEqual({
            chart: { type: "pie", holeSize: null }
        })
    })

    it("skips plain popup inputs while copying other plain ids", () => {
        const camera = {
            type: "camera",
            device: { id: "cam-1", name: "Front Camera" },
            fit: "cover",
            flipped: false,
            filter: "blur(2px)",
            cropping: { top: 10, bottom: 25 }
        }

        expect(copyStyleValues(camera, cameraInputs)).toEqual({
            fit: "cover",
            flipped: false,
            cropping: { top: 10 },
            filter: "blur(2px)"
        })
    })

    it("skips style and empty ids while copying plain ids like textFit", () => {
        const inputs: StyleInput[] = [
            { id: "style", type: "color" },
            { id: "", type: "tip" },
            { id: "textFit", type: "dropdown" }
        ]
        const item = { style: "color: red;", textFit: "shrinkToFit" }

        expect(copyStyleValues(item, inputs)).toEqual({ textFit: "shrinkToFit" })
    })

    it("keeps item.align when set", () => {
        const item = { style: "color: white;", textFit: "growToFit", align: "align-items: flex-start;" }
        const inputs: StyleInput[] = [{ id: "textFit", type: "dropdown" }]

        expect(copyStyleValues(item, inputs)).toEqual({
            textFit: "growToFit",
            align: "align-items: flex-start;"
        })
    })

    it("copies qr_code text, color, and background as before", () => {
        const item = {
            type: "qr_code",
            qr_code: {
                text: "https://freeshow.app",
                color: "#111111",
                background: "#ffffff"
            }
        }

        expect(copyStyleValues(item, qrCodeInputs)).toEqual({
            qr_code: {
                text: "https://freeshow.app",
                color: "#111111",
                background: "#ffffff"
            }
        })
    })

    it("does not copy unreferenced content leaves on the same root object", () => {
        const inputs: StyleInput[] = [
            { id: "table.borderColor", type: "color" },
            { id: "table.borderWidth", type: "number" }
        ]
        const item = {
            table: {
                borderColor: "#ffffff",
                borderWidth: 2,
                rows: [{ cells: [{ text: "Cell A" }] }]
            }
        }

        expect(copyStyleValues(item, inputs)).toEqual({
            table: { borderColor: "#ffffff", borderWidth: 2 }
        })
    })

    it("skips the sheet_music popup input and copies only sheet_music.size", () => {
        const source = {
            type: "sheet_music",
            style: "color: #ffffff;",
            sheet_music: { data: "<mei>source</mei>", label: "Amazing Grace", size: 125 }
        }

        const copied = copyStyleValues(source, sheetMusicInputs)
        expect(copied).toEqual({
            sheet_music: { size: 125 }
        })

        const target = { data: "<mei>target</mei>", label: "Be Thou My Vision", size: 100 }
        expect(mergeStyleValues(target, copied.sheet_music, true)).toEqual({
            data: "<mei>target</mei>",
            label: "Be Thou My Vision",
            size: 125
        })
    })
})

describe("getStyleLeafRoots", () => {
    it("returns roots of non-popup dotted inputs only", () => {
        const inputs: StyleInput[] = [
            { id: "style", type: "color" },
            { id: "textFit", type: "dropdown" },
            { id: "device", type: "popup" },
            { id: "chart.type", type: "dropdown" },
            { id: "chart.holeSize", type: "number" },
            { id: "chart.data", type: "popup" },
            { id: "contentOnly.music", type: "popup" },
            { id: ".leading", type: "string" },
            { id: "trailing.", type: "string" }
        ]

        expect(getStyleLeafRoots(inputs)).toEqual(new Set(["chart"]))
    })
})

describe("withExtraStyleLeaves", () => {
    it("appends cropping.type when cropping inputs exist without mutating the source list", () => {
        const original = [...croppingInputs]
        const expanded = withExtraStyleLeaves(croppingInputs, ["cropping.type"])

        expect(croppingInputs).toEqual(original)
        expect(expanded.map((a) => a.id)).toEqual(["cropping.top", "cropping.right", "cropping.bottom", "cropping.left", "cropping.type"])
        expect(withExtraStyleLeaves(expanded, ["cropping.type"]).map((a) => a.id)).toEqual(expanded.map((a) => a.id))
    })

    it("does not append extra leaves when their root has no non-popup dotted input", () => {
        expect(withExtraStyleLeaves(chartInputs, ["cropping.type"])).toEqual(chartInputs)
        expect(withExtraStyleLeaves([{ id: "cropping.mode", type: "popup" }], ["cropping.type"])).toEqual([{ id: "cropping.mode", type: "popup" }])
    })

    it("preserves cropping.type when copying a clipped media item onto an uncropped item", () => {
        const inputs = withExtraStyleLeaves(croppingInputs, ["cropping.type"])
        const source = { cropping: { left: 20, right: 20, top: 0, bottom: 0, type: "clip" } }
        const copied = copyStyleValues(source, inputs)

        expect(copied).toEqual({
            cropping: { top: 0, right: 20, bottom: 0, left: 20, type: "clip" }
        })

        const merged = mergeStyleValues(undefined, copied.cropping, true)
        expect(merged).toEqual({ top: 0, right: 20, bottom: 0, left: 20, type: "clip" })
        expect(copyStyleValues({ cropping: merged }, inputs)).toEqual(copied)
    })
})

describe("mergeStyleValues", () => {
    it("merges copied leaves into the target root while keeping uncopied leaves", () => {
        const target = { type: "bar", holeSize: 0, data: "target-data" }
        const copied = { type: "pie", holeSize: 40 }

        const merged = mergeStyleValues(target, copied, true)

        expect(merged).toEqual({ type: "pie", holeSize: 40, data: "target-data" })
        expect(target).toEqual({ type: "bar", holeSize: 0, data: "target-data" })
    })

    it("resets unset source leaves on the target while keeping target content", () => {
        const copied = copyStyleValues({ chart: { type: "pie", data: "x" } }, chartInputs)
        expect(copied).toEqual({ chart: { type: "pie", holeSize: null } })

        const target = { type: "pie", holeSize: 50, data: "y" }
        const merged = mergeStyleValues(target, copied.chart, true)

        expect(merged).toEqual({ type: "pie", data: "y" })
        expect("holeSize" in merged).toBe(false)
        expect(copyStyleValues({ chart: merged }, chartInputs)).toEqual(copied)
    })

    it("resets unset cropping leaves and matches clipboard after paste", () => {
        const inputs = withExtraStyleLeaves(croppingInputs, ["cropping.type"])
        const copied = copyStyleValues({ cropping: { top: 10 } }, inputs)
        expect(copied).toEqual({
            cropping: { top: 10, right: null, bottom: null, left: null, type: null }
        })

        const merged = mergeStyleValues({ left: 20, type: "clip" }, copied.cropping, true)

        expect(merged).toEqual({ top: 10 })
        expect(copyStyleValues({ cropping: merged }, inputs)).toEqual(copied)
    })

    it("clears unset specialStyle leaves on the target and matches clipboard after paste", () => {
        const copied = copyStyleValues({ specialStyle: { lineBg: "#112233" } }, specialStyleInputs)
        const merged = mergeStyleValues({ lineBg: "#000000", lineGap: 12 }, copied.specialStyle, true)

        expect(merged).toEqual({ lineBg: "#112233" })
        expect(copyStyleValues({ specialStyle: merged }, specialStyleInputs)).toEqual(copied)
    })

    it("clears target specialStyle when copying from a new text box with no specialStyle", () => {
        const copied = copyStyleValues({ type: "text" }, specialStyleInputs)
        expect(copied).toEqual({
            specialStyle: { lineGap: null, lineBg: null, lineRadius: null }
        })

        const merged = mergeStyleValues({ lineGap: 12 }, copied.specialStyle, true)

        expect(merged).toEqual({})
        expect("lineGap" in merged).toBe(false)
        expect(copyStyleValues({ specialStyle: merged }, specialStyleInputs)).toEqual(copied)
    })

    it("clears target cropping and crop mode when copying from an uncropped image", () => {
        const inputs = withExtraStyleLeaves(croppingInputs, ["cropping.type"])
        const copied = copyStyleValues({ type: "media" }, inputs)
        expect(copied).toEqual({
            cropping: { top: null, right: null, bottom: null, left: null, type: null }
        })

        const merged = mergeStyleValues({ left: 20, type: "clip" }, copied.cropping, true)

        expect(merged).toEqual({})
        expect("left" in merged).toBe(false)
        expect("type" in merged).toBe(false)
        expect(copyStyleValues({ cropping: merged }, inputs)).toEqual(copied)
    })

    it("clears target leaves when the source leaf is null", () => {
        const copied = copyStyleValues({ chart: { type: "pie", holeSize: null, data: "x" } }, chartInputs)
        const merged = mergeStyleValues({ type: "bar", holeSize: 50, data: "y" }, copied.chart, true)

        expect(merged).toEqual({ type: "pie", data: "y" })
        expect(copyStyleValues({ chart: merged }, chartInputs)).toEqual(copied)
    })

    it("creates a new object with just the set copied leaves when target has no root object", () => {
        const copied = { type: "pie", holeSize: 40 }

        expect(mergeStyleValues(undefined, copied, true)).toEqual({ type: "pie", holeSize: 40 })
        expect(mergeStyleValues(null, copied, true)).toEqual({ type: "pie", holeSize: 40 })
        expect(mergeStyleValues(undefined, { type: "pie", holeSize: null }, true)).toEqual({ type: "pie" })
    })

    it("clones nested copied leaf values so targets do not share references", () => {
        const copied = { parts: ["Soprano", "Alto"] }
        const targetA = mergeStyleValues({ music: "song-a" }, copied, true)
        const targetB = mergeStyleValues({ music: "song-b" }, copied, true)

        targetA.parts.push("Tenor")

        expect(targetA).toEqual({ music: "song-a", parts: ["Soprano", "Alto", "Tenor"] })
        expect(targetB).toEqual({ music: "song-b", parts: ["Soprano", "Alto"] })
        expect(copied.parts).toEqual(["Soprano", "Alto"])
    })

    it("replaces object values whole when the key is a plain id instead of a leaf root", () => {
        const target = { a: 1, b: 2 }
        const copied = { a: 3 }

        const replaced = mergeStyleValues(target, copied, false)
        replaced.a = 99

        expect(replaced).toEqual({ a: 99 })
        expect(copied).toEqual({ a: 3 })
        expect(target).toEqual({ a: 1, b: 2 })
        expect(mergeStyleValues(target, copied, true)).toEqual({ a: 3, b: 2 })
    })

    it("returns plain copied values directly", () => {
        expect(mergeStyleValues("none", "shrinkToFit")).toBe("shrinkToFit")
        expect(mergeStyleValues(true, false)).toBe(false)
        expect(mergeStyleValues(1, 0)).toBe(0)
        expect(mergeStyleValues(undefined, "align-items: center;")).toBe("align-items: center;")
    })
})

function applyItemsSetter(slideItems: Record<string, any>[], key: string, plan: StylePastePlan): StylePastePlan {
    const previousValues: any[] = []
    plan.items.forEach((index, i) => {
        const value = getItemSetValue(plan.values, i)
        const current = slideItems[index][key]
        previousValues.push(current ? structuredClone(current) : null)
        if (value === undefined) delete slideItems[index][key]
        else slideItems[index][key] = structuredClone(value)
    })
    return { items: [...plan.items], values: previousValues }
}

describe("getStylePastePlan", () => {
    it("skips rootless chart targets on all-null paste so undo never copies another chart's data", () => {
        const copied = copyStyleValues({ chart: { data: "source" } }, chartInputs)
        const slideItems: Record<string, any>[] = [{ chart: { type: "pie", holeSize: 50, data: "A" } }, {}]
        const targets = slideItems.map((item, index) => ({ index, value: item.chart }))

        const plan = getStylePastePlan(targets, copied.chart, true)

        expect(plan).toEqual({ items: [0], values: [{ data: "A" }] })

        const undo = applyItemsSetter(slideItems, "chart", plan!)
        expect(slideItems[0]).toEqual({ chart: { data: "A" } })
        expect(slideItems[1]).toEqual({})

        applyItemsSetter(slideItems, "chart", undo)

        expect(slideItems[0]).toEqual({ chart: { type: "pie", holeSize: 50, data: "A" } })
        expect(slideItems[1]).toEqual({})
    })

    it("skips uncropped cameras on empty-crop paste so undo does not crop them", () => {
        const inputs = withExtraStyleLeaves(cameraInputs, ["cropping.type"])
        const copied = copyStyleValues({ type: "camera" }, inputs)
        const slideItems: Record<string, any>[] = [{ type: "camera", cropping: { top: 15, type: "clip" } }, { type: "camera" }]
        const targets = slideItems.map((item, index) => ({ index, value: item.cropping }))

        const plan = getStylePastePlan(targets, copied.cropping, true)

        expect(plan).toEqual({ items: [0], values: [{}] })

        const undo = applyItemsSetter(slideItems, "cropping", plan!)
        expect(slideItems[0].cropping).toEqual({})
        expect(slideItems[1].cropping).toBeUndefined()
        expect(copyStyleValues(slideItems[0], inputs)).toEqual(copied)
        expect(copyStyleValues(slideItems[1], inputs)).toEqual(copied)

        applyItemsSetter(slideItems, "cropping", undo)

        expect(slideItems[0].cropping).toEqual({ top: 15, type: "clip" })
        expect(slideItems[1].cropping).toBeUndefined()
    })

    it("keeps targets with and without a root in one plan and restores rootless targets to null on undo", () => {
        const copied = copyStyleValues({ chart: { type: "bar", data: "source" } }, chartInputs)
        const slideItems: Record<string, any>[] = [{ chart: { type: "pie", holeSize: 50, data: "A" } }, {}, { chart: { type: "line", data: "C" } }, { chart: null }]
        const targets = slideItems.map((item, index) => ({ index, value: item.chart }))

        const plan = getStylePastePlan(targets, copied.chart, true)

        expect(plan).toEqual({
            items: [0, 1, 2, 3],
            values: [{ type: "bar", data: "A" }, { type: "bar" }, { type: "bar", data: "C" }, { type: "bar" }]
        })

        const undo = applyItemsSetter(slideItems, "chart", plan!)
        expect(slideItems).toEqual([{ chart: { type: "bar", data: "A" } }, { chart: { type: "bar" } }, { chart: { type: "bar", data: "C" } }, { chart: { type: "bar" } }])

        applyItemsSetter(slideItems, "chart", undo)

        expect(slideItems[0]).toEqual({ chart: { type: "pie", holeSize: 50, data: "A" } })
        expect(slideItems[1]).toEqual({ chart: null })
        expect(slideItems[2]).toEqual({ chart: { type: "line", data: "C" } })
        expect(slideItems[3]).toEqual({ chart: null })
    })

    it("returns null when an all-null leaf paste only targets rootless items", () => {
        const copied = copyStyleValues({ type: "text" }, specialStyleInputs)
        const targets = [
            { index: 2, value: undefined },
            { index: 5, value: null }
        ]

        expect(getStylePastePlan(targets, copied.specialStyle, true)).toBeNull()
    })

    it("returns one plan with every target when the key is not a leaf root", () => {
        const targets = [
            { index: 1, value: "none" },
            { index: 4, value: undefined }
        ]

        expect(getStylePastePlan(targets, "shrinkToFit", false)).toEqual({ items: [1, 4], values: ["shrinkToFit", "shrinkToFit"] })
        expect(getStylePastePlan([], "shrinkToFit", false)).toBeNull()
    })
})

describe("parseDottedId", () => {
    it("splits valid root.leaf ids and rejects plain or edge-dot ids", () => {
        expect(parseDottedId("chart.type")).toEqual(["chart", "type"])
        expect(parseDottedId("textFit")).toBeNull()
        expect(parseDottedId(".leading")).toBeNull()
        expect(parseDottedId("trailing.")).toBeNull()
    })
})

describe("setStyleLeaf", () => {
    it("keeps each target's own content when setting one leaf on two targets", () => {
        const first = { type: "bar", data: "A" }
        const second = { type: "line", data: "B" }

        const nextFirst = setStyleLeaf(first, "type", "pie")
        const nextSecond = setStyleLeaf(second, "type", "pie")

        expect(nextFirst).toEqual({ type: "pie", data: "A" })
        expect(nextSecond).toEqual({ type: "pie", data: "B" })
        expect(first).toEqual({ type: "bar", data: "A" })
        expect(second).toEqual({ type: "line", data: "B" })
    })

    it("creates an object with just the leaf when the target has no root object", () => {
        expect(setStyleLeaf(undefined, "type", "pie")).toEqual({ type: "pie" })
        expect(setStyleLeaf(null, "type", "pie")).toEqual({ type: "pie" })
        expect(setStyleLeaf("invalid", "type", "pie")).toEqual({ type: "pie" })
    })

    it("preserves null and falsy leaf values", () => {
        expect(setStyleLeaf({ type: "bar", data: "A" }, "type", null)).toEqual({ type: null, data: "A" })
        expect(setStyleLeaf({ type: "pie", data: "A" }, "holeSize", 0)).toEqual({ type: "pie", data: "A", holeSize: 0 })
        expect(setStyleLeaf({ enabled: true }, "enabled", false)).toEqual({ enabled: false })
        expect(setStyleLeaf({ lineBg: "#ffffff" }, "lineBg", "")).toEqual({ lineBg: "" })
    })

    it("clones object leaf values so targets do not share references", () => {
        const parts = ["Soprano"]
        const first = setStyleLeaf({ music: "A" }, "parts", parts)
        const second = setStyleLeaf({ music: "B" }, "parts", parts)

        first.parts.push("Alto")

        expect(first).toEqual({ music: "A", parts: ["Soprano", "Alto"] })
        expect(second).toEqual({ music: "B", parts: ["Soprano"] })
    })

    it("keeps two sheet music items' own music and choices when updating parts, verses or customParts", () => {
        const congregation = { data: "<mei>hymnA</mei>", label: "Hymn A", parts: "all", verses: "1" }
        const musicians = { data: "<mei>hymnB</mei>", label: "Hymn B", parts: "upper", verses: "none", measures: "5-8" }

        const nextCongregation = setStyleLeaf(congregation, "parts", "melody")
        const nextMusicians = setStyleLeaf(musicians, "parts", "melody")

        expect(nextCongregation).toEqual({ data: "<mei>hymnA</mei>", label: "Hymn A", parts: "melody", verses: "1" })
        expect(nextMusicians).toEqual({ data: "<mei>hymnB</mei>", label: "Hymn B", parts: "melody", verses: "none", measures: "5-8" })

        const custom = ["1.1", "2.1"]
        const withCustomA = setStyleLeaf(nextCongregation, "customParts", custom)
        const withCustomB = setStyleLeaf(nextMusicians, "customParts", custom)
        withCustomA.customParts.push("1.2")

        expect(withCustomA.data).toBe("<mei>hymnA</mei>")
        expect(withCustomB.data).toBe("<mei>hymnB</mei>")
        expect(withCustomB.customParts).toEqual(["1.1", "2.1"])
    })
})

describe("sheet_music copy style (boxes.ts + EXTRA_STYLE_LEAVES)", () => {
    it("copies size, parts, customParts and verses and never copies data, abc, label or measures", () => {
        const boxesSource = readFileSync(fileURLToPath(new URL("../values/boxes.ts", import.meta.url)), "utf8")
        const sheetMusicBlock = boxesSource.slice(boxesSource.indexOf("sheet_music: {"))
        expect(sheetMusicBlock).toContain('type: "popup", id: "sheet_music"')
        expect(sheetMusicBlock).toContain('id: "sheet_music.size"')
        expect(sheetMusicBlock).toContain('id: "sheet_music.parts"')
        expect(sheetMusicBlock).toContain('id: "sheet_music.verses"')

        const declaredSheetMusicInputs: StyleInput[] = [
            { id: "sheet_music", type: "popup" },
            { id: "style", type: "color" },
            { id: "sheet_music.size", type: "number" },
            { id: "sheet_music.parts", type: "dropdown" },
            { id: "sheet_music.verses", type: "dropdown" }
        ]
        const inputs = withExtraStyleLeaves(declaredSheetMusicInputs, EXTRA_STYLE_LEAVES)

        const source = {
            type: "sheet_music" as const,
            style: "left: 100px; width: 1500px; color: #ffeedd;",
            sheet_music: {
                data: "<mei>source</mei>",
                abc: "M: 4/4\nK: C\nC4 |",
                label: "Amazing Grace",
                measures: "5-8",
                size: 130,
                parts: "custom" as const,
                customParts: ["1.1", "2.1"],
                verses: "2"
            }
        }

        const copied = copyStyleValues(source, inputs)
        expect(copied).toEqual({
            sheet_music: {
                size: 130,
                parts: "custom",
                customParts: ["1.1", "2.1"],
                verses: "2"
            }
        })
        expect("data" in copied.sheet_music).toBe(false)
        expect("abc" in copied.sheet_music).toBe(false)
        expect("label" in copied.sheet_music).toBe(false)
        expect("measures" in copied.sheet_music).toBe(false)

        const target = {
            data: "<mei>target</mei>",
            abc: "M: 3/4\nK: G\nG3 |",
            label: "Holy, Holy, Holy",
            measures: "1-4",
            size: 100,
            parts: "all"
        }
        expect(mergeStyleValues(target, copied.sheet_music, true)).toEqual({
            data: "<mei>target</mei>",
            abc: "M: 3/4\nK: G\nG3 |",
            label: "Holy, Holy, Holy",
            measures: "1-4",
            size: 130,
            parts: "custom",
            customParts: ["1.1", "2.1"],
            verses: "2"
        })
    })
})
