import { describe, expect, it } from "vitest"
import { copyStyleValues, mergeStyleValues, type StyleInput } from "./styleValues"

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

    it("copies falsy leaf values and omits roots with no copied leaves", () => {
        const withZero = { chart: { holeSize: 0, data: "a,b\n1,2" } }
        expect(copyStyleValues(withZero, chartInputs)).toEqual({
            chart: { holeSize: 0 }
        })

        const dataOnly = { chart: { data: "a,b\n1,2" } }
        expect(copyStyleValues(dataOnly, chartInputs)).toEqual({})
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

describe("mergeStyleValues", () => {
    it("merges copied leaves into the target root while keeping uncopied leaves", () => {
        const target = { type: "bar", holeSize: 0, data: "target-data" }
        const copied = { type: "pie", holeSize: 40 }

        const merged = mergeStyleValues(target, copied)

        expect(merged).toEqual({ type: "pie", holeSize: 40, data: "target-data" })
        expect(target).toEqual({ type: "bar", holeSize: 0, data: "target-data" })
    })

    it("creates a new object with just the copied leaves when target has no root object", () => {
        const copied = { type: "pie", holeSize: 40 }

        expect(mergeStyleValues(undefined, copied)).toEqual({ type: "pie", holeSize: 40 })
        expect(mergeStyleValues(null, copied)).toEqual({ type: "pie", holeSize: 40 })
    })

    it("clones nested copied leaf values so targets do not share references", () => {
        const copied = { parts: ["Soprano", "Alto"] }
        const targetA = mergeStyleValues({ music: "song-a" }, copied)
        const targetB = mergeStyleValues({ music: "song-b" }, copied)

        targetA.parts.push("Tenor")

        expect(targetA).toEqual({ music: "song-a", parts: ["Soprano", "Alto", "Tenor"] })
        expect(targetB).toEqual({ music: "song-b", parts: ["Soprano", "Alto"] })
        expect(copied.parts).toEqual(["Soprano", "Alto"])
    })

    it("returns plain copied values directly", () => {
        expect(mergeStyleValues("none", "shrinkToFit")).toBe("shrinkToFit")
        expect(mergeStyleValues(true, false)).toBe(false)
        expect(mergeStyleValues(1, 0)).toBe(0)
        expect(mergeStyleValues(undefined, "align-items: center;")).toBe("align-items: center;")
    })
})
