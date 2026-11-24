import abcjs from "abcjs"
import { describe, expect, it, vi } from "vitest"
import type { Show } from "../../../types/Show"

const hoisted = vi.hoisted(() => {
    const state: { show: Show | null; history: any[] } = { show: null, history: [] }
    const makeStore = (initial: unknown) => {
        let value = initial
        return {
            set: (next: unknown) => (value = next),
            update: (updater: (current: any) => any) => (value = updater(value)),
            subscribe: (fn: (current: unknown) => void) => {
                fn(value)
                return () => undefined
            }
        }
    }
    return { state, makeStore }
})

vi.mock("../../stores", () => ({
    activeShow: hoisted.makeStore({ id: "show_1" }),
    groups: hoisted.makeStore({ verse: { name: "Verse" }, chorus: { name: "Chorus" } })
}))

vi.mock("../../utils/language", () => ({
    translateText: (value: string) => value
}))

vi.mock("../helpers/array", () => ({
    clone: (value: any) => (value == null ? value : structuredClone(value)),
    keysToID: (obj: any) => (obj ? Object.entries(obj).map(([id, item]: [string, any]) => ({ ...item, id })) : []),
    removeDuplicates: (list: any[]) => Array.from(new Set(list))
}))

vi.mock("../../show/slides", () => ({
    VIRTUAL_BREAK_CHAR: "[_VB]"
}))

vi.mock("../edit/scripts/chords", () => ({
    createChord: () => ({})
}))

vi.mock("../helpers/history", () => ({
    history: (entry: any) => hoisted.state.history.push(entry)
}))

vi.mock("../helpers/output", () => ({
    isEmpty: (item: any) => !(item?.lines || []).map((line: any) => (line.text || []).map((txt: any) => txt.value || "").join("")).join("").length
}))

vi.mock("../edit/scripts/textStyle", () => {
    const getItemText = (item: any) => (item?.lines || []).map((line: any) => (line.text || []).map((txt: any) => txt.value || "").join("")).join("")
    return {
        getItemText,
        getSlideText: (slide: any) => (slide?.items || []).reduce((acc: string, item: any) => acc + getItemText(item), "")
    }
})

vi.mock("../helpers/show", () => ({
    getGlobalGroup: (group: string) => {
        const lower = group.toLowerCase()
        if (lower === "verse" || lower === "chorus") return lower
        return ""
    },
    getLayoutRef: () => {
        const show = hoisted.state.show
        if (!show) return []
        const out: { id: string; parent?: string }[] = []
        for (const layoutSlide of show.layouts[show.settings.activeLayout].slides) {
            out.push({ id: layoutSlide.id })
            for (const childId of show.slides[layoutSlide.id]?.children || []) {
                out.push({ id: childId, parent: layoutSlide.id })
            }
        }
        return out
    }
}))

vi.mock("../helpers/shows", () => ({
    _show: () => ({
        get: (key?: string) => {
            const show = hoisted.state.show
            if (!key) return show
            return key.split(".").reduce((acc: any, part) => acc?.[part], show)
        }
    })
}))

import { EMPTY_LYRICS_PLACEHOLDER, buildSheetMusicShow } from "../../converters/sheetMusic"
import { sliceAbcIntoSystems } from "../slide/views/sheetMusic/abcSlice"
import { convertAndCheckAbc } from "../slide/views/sheetMusic/abcToMei"
import { summarizeMei } from "../slide/views/sheetMusic/meiParts"
import { formatText } from "./formatTextEditor"
import { getPlainEditorText } from "./getTextEditor"

const TWO_VERSE_HYMN = [
    "T: Abide With Me",
    "M: 4/4",
    "L: 1/4",
    "K: Eb",
    "%%score (S A) (T B)",
    "V: S",
    "V: A",
    "V: T clef=bass octave=-1",
    "V: B clef=bass octave=-1",
    "[V:S] G2 G F | E2 B2 | c B B A | G4 |",
    "w: 1.~A-bide with me; fast falls the e-ven-tide;",
    "w: 2.~Swift to its close ebbs out life's lit-tle day;",
    "[V:A] E2 D D | E2 E2 | E D E F | E4 |",
    "[V:T] B2 B A | G2 E2 | E B B B | B4 |",
    "[V:B] E2 B, B, | C2 G,2 | A, B, C D | E4 |",
    "[V:S] G2 A B | c2 B2 | A F G =A | B4 |",
    "w: The dark-ness deep-ens; Lord, with me a-bide.",
    "w: Earth's joys grow dim; its glo-ries pass a-way;",
    "[V:A] E2 E E | E2 E2 | F D E E | D4 |",
    "[V:T] B2 c B | A2 G2 | c B B c | B4 |",
    "[V:B] E2 C G, | A,2 E2 | F, B, E C | B,4 |"
].join("\n")

function getGroupSlideLists(show: Show) {
    return show.layouts[show.settings.activeLayout].slides.map((layoutSlide) => {
        const parent = show.slides[layoutSlide.id]
        const ids = [layoutSlide.id, ...(parent?.children || [])]
        return ids.map((id) => show.slides[id])
    })
}

describe("formatText on shows with non-text items and imported sheet music", () => {
    it("does not duplicate sheet_music items on unchanged slides when another verse is edited (B1)", () => {
        const whole = convertAndCheckAbc(TWO_VERSE_HYMN, abcjs.parseOnly)
        const slices = sliceAbcIntoSystems(TWO_VERSE_HYMN, abcjs.parseOnly)
        const verses = summarizeMei(whole.mei).verses

        hoisted.state.show = buildSheetMusicShow({
            name: "Abide With Me",
            label: "Abide With Me",
            slides: slices.map((slice) => ({ mei: slice.analysis.mei, abc: slice.abc })),
            verseMode: "per_verse",
            verseNumbers: verses,
            parts: "all",
            created: 1
        })
        hoisted.state.history = []

        const editedText = getPlainEditorText("show_1").replace("Swift", "Quick")
        formatText(editedText, "show_1")

        const after: Show = hoisted.state.history[0]?.newData?.data
        expect(after).toBeDefined()

        const groups = getGroupSlideLists(after)
        expect(groups).toHaveLength(2)

        // Verse 1 was unchanged: every slide must still hold [sheet_music, text] once
        expect(groups[0]).toHaveLength(2)
        for (const slide of groups[0]) {
            expect(slide.items.map((item) => item.type || "text")).toEqual(["sheet_music", "text"])
            expect(slide.items[1].bindings).toEqual(["stage"])
        }

        // Verse 2 was edited: keeps [sheet_music, text] with stage binding and updated text
        expect(groups[1]).toHaveLength(2)
        for (const slide of groups[1]) {
            expect(slide.items.map((item) => item.type || "text")).toEqual(["sheet_music", "text"])
            expect(slide.items[1].bindings).toEqual(["stage"])
        }
        expect(groups[1][0].items[1].lines?.[0].text[0].value).toContain("Quick to its close")
    })

    it("does not duplicate a media item on an unchanged slide in a plain show (B1)", () => {
        const makeText = (value: string) => ({ type: "text" as const, style: "x", lines: [{ align: "", text: [{ value, style: "" }] }] })
        const mediaItem = { type: "media" as const, src: "bg.png", style: "y" }

        hoisted.state.show = {
            name: "Plain",
            private: false,
            category: null,
            settings: { activeLayout: "L", template: null },
            timestamps: { created: 1, modified: null, used: null },
            quickAccess: {},
            meta: {},
            media: {},
            layouts: { L: { name: "Default", notes: "", slides: [{ id: "A" }, { id: "B" }] } },
            slides: {
                A: { group: "Verse", globalGroup: "verse", color: "", settings: {}, notes: "", items: [mediaItem, makeText("one")] },
                B: { group: "Chorus", globalGroup: "chorus", color: "", settings: {}, notes: "", items: [mediaItem, makeText("two")] }
            }
        }
        hoisted.state.history = []

        const editedText = getPlainEditorText("show_1").replace("two", "three")
        formatText(editedText, "show_1")

        const after: Show = hoisted.state.history[0]?.newData?.data
        expect(after.slides.A.items.map((item) => item.type || "text")).toEqual(["media", "text"])
        const chorusId = after.layouts.L.slides[1].id
        expect(after.slides[chorusId].items.map((item) => item.type || "text")).toEqual(["media", "text"])
    })

    it("demonstrates that a child slide without a text item is dropped by formatText, while the placeholder keeps every notation slide in place (B2)", () => {
        const line1 = convertAndCheckAbc(["M:4/4", "L:1/4", "K:C", "C D E F |", "w: First line words"].join("\n"), abcjs.parseOnly).mei
        const interlude = convertAndCheckAbc(["M:4/4", "L:1/4", "K:C", "G A B c |"].join("\n"), abcjs.parseOnly).mei
        const line3 = convertAndCheckAbc(["M:4/4", "L:1/4", "K:C", "c B A G |", "w: Third line words"].join("\n"), abcjs.parseOnly).mei

        // Case 1: removing the text item completely from the wordless middle child slide causes formatText to drop a slide
        const bareShow = buildSheetMusicShow({
            name: "Bare",
            label: "Bare",
            slides: [{ mei: line1 }, { mei: interlude }, { mei: line3 }],
            verseMode: "all",
            verseNumbers: [1],
            parts: "all",
            created: 1
        })
        const bareParentId = bareShow.layouts[bareShow.settings.activeLayout].slides[0].id
        const bareMiddleId = bareShow.slides[bareParentId].children![0]
        bareShow.slides[bareMiddleId].items = [bareShow.slides[bareMiddleId].items[0]]

        hoisted.state.show = bareShow
        hoisted.state.history = []
        formatText(getPlainEditorText("show_1").replace("Third", "Final"), "show_1")
        const bareAfter: Show = hoisted.state.history[0]?.newData?.data
        expect(getGroupSlideLists(bareAfter)[0]).toHaveLength(2)

        // Case 2: our imported show gives the wordless slide the musical note placeholder so all 3 notation slides stay intact
        hoisted.state.show = buildSheetMusicShow({
            name: "With Placeholder",
            label: "With Placeholder",
            slides: [
                { mei: line1, abc: "abc-1" },
                { mei: interlude, abc: "abc-2" },
                { mei: line3, abc: "abc-3" }
            ],
            verseMode: "all",
            verseNumbers: [1],
            parts: "all",
            created: 1
        })
        hoisted.state.history = []

        const edited = getPlainEditorText("show_1").replace("Third", "Final")
        expect(edited).toContain(EMPTY_LYRICS_PLACEHOLDER)
        formatText(edited, "show_1")

        const after: Show = hoisted.state.history[0]?.newData?.data
        const slidesAfter = getGroupSlideLists(after)[0]
        expect(slidesAfter).toHaveLength(3)
        expect(slidesAfter.map((slide) => slide.items[0].sheet_music?.abc)).toEqual(["abc-1", "abc-2", "abc-3"])
        expect(slidesAfter.map((slide) => slide.items.map((item) => item.type || "text"))).toEqual([
            ["sheet_music", "text"],
            ["sheet_music", "text"],
            ["sheet_music", "text"]
        ])
        expect(slidesAfter[1].items[1].lines?.[0].text[0].value).toBe(EMPTY_LYRICS_PLACEHOLDER)
        expect(slidesAfter[2].items[1].lines?.[0].text[0].value).toBe("Final line words")
    })
})
