import { describe, expect, it } from "vitest"
import { getItemSetValue } from "./itemValues"

describe("getItemSetValue", () => {
    it("uses the single entry for every index when values has one element", () => {
        const values = ["only"]

        expect(getItemSetValue(values, 0)).toBe("only")
        expect(getItemSetValue(values, 1)).toBe("only")
        expect(getItemSetValue(values, 4)).toBe("only")
    })

    it("returns each index's own entry when values covers all indexes", () => {
        const values = [
            { type: "pie", data: "A" },
            { type: "pie", data: "B" }
        ]

        expect(getItemSetValue(values, 0)).toEqual({ type: "pie", data: "A" })
        expect(getItemSetValue(values, 1)).toEqual({ type: "pie", data: "B" })
    })

    it("keeps falsy entries at index 1 instead of falling back to index 0", () => {
        expect(getItemSetValue([{ type: "bar", data: "A" }, null], 1)).toBeNull()
        expect(getItemSetValue([true, false], 1)).toBe(false)
        expect(getItemSetValue([10, 0], 1)).toBe(0)
        expect(getItemSetValue(["color: red;", ""], 1)).toBe("")
        expect(getItemSetValue(["keep", undefined], 1)).toBeUndefined()
    })

    it("falls back to index 0 when the index is past the end of values", () => {
        const values = ["first", "second"]

        expect(getItemSetValue(values, 2)).toBe("first")
        expect(getItemSetValue(values, 5)).toBe("first")
    })
})
