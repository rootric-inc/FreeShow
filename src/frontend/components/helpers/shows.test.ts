import { get } from "svelte/store"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../stores", async () => {
    const { writable } = await import("svelte/store")
    return {
        activeFocus: writable({}),
        activeShow: writable({ id: "show-1", type: "show" }),
        focusMode: writable(false),
        showsCache: writable({})
    }
})

vi.mock("../../utils/language", () => ({
    translateText: (text: string) => text
}))

import { showsCache } from "../../stores"
import { _show } from "./shows"

function setSlideItems(items: Record<string, any>[]) {
    showsCache.set({
        "show-1": {
            name: "Test Show",
            slides: { a: { items } },
            layouts: {}
        }
    } as any)
}

function getSlideItems(): Record<string, any>[] {
    return (get(showsCache) as any)["show-1"].slides.a.items
}

describe("_show().slides().items().set", () => {
    beforeEach(() => {
        setSlideItems([{ type: "chart", chart: { type: "bar", data: "A" } }, { type: "chart", chart: { type: "line", data: "B" } }, { type: "chart" }, { type: "chart", chart: { type: "pie", data: "D" } }])
    })

    it("writes one value per chart, restores rootless chart to null on undo, and restores new values on redo", () => {
        const nextValues = [{ type: "pie", data: "A" }, { type: "pie", data: "B" }, { type: "pie" }, { type: "pie", data: "D" }]

        const prev = _show("show-1")
            .slides(["a"])
            .items([0, 1, 2, 3])
            .set({ key: "chart", values: structuredClone(nextValues) })

        expect(getSlideItems().map((item) => item.chart)).toEqual(nextValues)
        expect(prev).toEqual({
            key: "chart",
            values: [{ type: "bar", data: "A" }, { type: "line", data: "B" }, null, { type: "pie", data: "D" }]
        })

        const redo = _show("show-1").slides(["a"]).items([0, 1, 2, 3]).set(structuredClone(prev))

        expect(getSlideItems().map((item) => item.chart)).toEqual([{ type: "bar", data: "A" }, { type: "line", data: "B" }, null, { type: "pie", data: "D" }])

        _show("show-1").slides(["a"]).items([0, 1, 2, 3]).set(structuredClone(redo))

        expect(getSlideItems().map((item) => item.chart)).toEqual(nextValues)
    })

    it("applies a single-value array to every targeted item", () => {
        _show("show-1")
            .slides(["a"])
            .items([0, 1, 2, 3])
            .set({ key: "auto", values: [true] })

        expect(getSlideItems().map((item) => item.auto)).toEqual([true, true, true, true])
    })

    it("deletes the key on every targeted item when given [undefined]", () => {
        const prev = _show("show-1")
            .slides(["a"])
            .items([0, 2, 1])
            .set({ key: "chart", values: [undefined] })

        const after = getSlideItems()
        expect("chart" in after[0]).toBe(false)
        expect("chart" in after[1]).toBe(false)
        expect("chart" in after[2]).toBe(false)
        expect(after[3].chart).toEqual({ type: "pie", data: "D" })

        _show("show-1").slides(["a"]).items([0, 2, 1]).set(structuredClone(prev))

        expect(getSlideItems().map((item) => item.chart)).toEqual([{ type: "bar", data: "A" }, { type: "line", data: "B" }, null, { type: "pie", data: "D" }])
    })

    it("keeps previous values aligned with indexes when an index points to a missing item", () => {
        setSlideItems([
            { type: "chart", chart: { type: "bar", data: "A" } },
            { type: "chart", chart: { type: "line", data: "B" } }
        ])

        const prev = _show("show-1")
            .slides(["a"])
            .items([0, 2, 1])
            .set({
                key: "chart",
                values: [
                    { type: "pie", data: "A" },
                    { type: "pie", data: "missing" },
                    { type: "pie", data: "B" }
                ]
            })

        expect(prev).toEqual({
            key: "chart",
            values: [{ type: "bar", data: "A" }, null, { type: "line", data: "B" }]
        })
        expect(getSlideItems()).toEqual([
            { type: "chart", chart: { type: "pie", data: "A" } },
            { type: "chart", chart: { type: "pie", data: "B" } }
        ])

        _show("show-1").slides(["a"]).items([0, 2, 1]).set(structuredClone(prev))

        const restored = getSlideItems()
        expect(restored).toHaveLength(2)
        expect(2 in restored).toBe(false)
        expect(restored).toEqual([
            { type: "chart", chart: { type: "bar", data: "A" } },
            { type: "chart", chart: { type: "line", data: "B" } }
        ])
    })
})
