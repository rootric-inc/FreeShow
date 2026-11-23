import { describe, expect, it, vi } from "vitest"
import type { Item } from "../../../types/Show"

// stage.ts pulls in stores and UI collaborators; stub them so the pure helper can run in node.
vi.mock("../../stores", () => ({}))
vi.mock("../../utils/common", () => ({ isOutputWindow: () => false }))
vi.mock("../../utils/language", () => ({ translateText: (key: string) => key }))
vi.mock("../../utils/sendData", () => ({ arrayToObject: () => ({}), filterObjectArray: () => [] }))
vi.mock("../edit/scripts/autoPosition", () => ({ getLikelyPosition: () => "" }))
vi.mock("../edit/scripts/itemHelpers", () => ({ updateSortedStageItems: () => undefined }))
vi.mock("../edit/scripts/textStyle", () => ({ getItemText: () => "" }))
vi.mock("../helpers/output", () => ({ getActiveOutputs: () => [] }))
vi.mock("../helpers/show", () => ({ getLayoutRef: () => [] }))

import { isItemVisibleOnStage } from "./stage"

const makeItem = (overrides: Partial<Item> = {}): Item => ({ style: "", ...overrides })

describe("isItemVisibleOnStage", () => {
    it("shows items with no bindings", () => {
        expect(isItemVisibleOnStage(makeItem())).toBe(true)
        expect(isItemVisibleOnStage(makeItem({ bindings: [] }))).toBe(true)
    })

    it("shows items bound to stage", () => {
        expect(isItemVisibleOnStage(makeItem({ bindings: ["stage"] }))).toBe(true)
        expect(isItemVisibleOnStage(makeItem({ bindings: ["output-1", "stage"] }))).toBe(true)
    })

    it("hides items bound only to outputs", () => {
        expect(isItemVisibleOnStage(makeItem({ bindings: ["output-1"] }))).toBe(false)
        expect(isItemVisibleOnStage(makeItem({ bindings: ["output-1", "output-2"] }))).toBe(false)
    })

    it("applies the same binding rule to non-text items", () => {
        expect(isItemVisibleOnStage(makeItem({ type: "media" }))).toBe(true)
        expect(isItemVisibleOnStage(makeItem({ type: "media", bindings: ["stage"] }))).toBe(true)
        expect(isItemVisibleOnStage(makeItem({ type: "media", bindings: ["output-1"] }))).toBe(false)
    })

    it("returns false for undefined items", () => {
        expect(isItemVisibleOnStage(undefined)).toBe(false)
    })

    it("filters out output-only items from a slide item list", () => {
        const items = [makeItem({ id: "unbound" }), makeItem({ id: "output-only", bindings: ["some-output-id"] }), makeItem({ id: "stage-bound", bindings: ["stage"] })]
        expect(items.filter(isItemVisibleOnStage).map((item) => item.id)).toEqual(["unbound", "stage-bound"])
    })
})
