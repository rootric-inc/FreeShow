import { describe, expect, it } from "vitest"
import { copyStyleValues, getStyleLeafRoots, mergeStyleValues, withExtraStyleLeaves } from "./styleValues"
import type { StyleInput } from "./styleValues"

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

    it("copies nothing for a root when the source has no root object", () => {
        expect(copyStyleValues({ type: "chart" }, chartInputs)).toEqual({})
        expect(copyStyleValues({ chart: undefined }, chartInputs)).toEqual({})
        expect(copyStyleValues({ chart: null }, chartInputs)).toEqual({})
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
