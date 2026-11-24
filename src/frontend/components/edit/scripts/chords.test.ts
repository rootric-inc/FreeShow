import { get } from "svelte/store"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Slide } from "../../../../types/Show"
import { transposeText } from "../../../utils/chordTranspose"

const historyCalls: any[] = []

vi.mock("../../../stores", async () => {
    const { writable } = await import("svelte/store")
    return {
        activeFocus: writable({ id: "" }),
        activeShow: writable({ id: "show-1", type: "show" }),
        focusMode: writable(false),
        selected: writable({ id: null, data: [] }),
        showsCache: writable({})
    }
})

vi.mock("../../../utils/language", () => ({
    translateText: (text: string) => text
}))

vi.mock("../../helpers/history", () => ({
    history: (entry: any) => {
        historyCalls.push(entry)
    }
}))

import { activeFocus, activeShow, focusMode, showsCache } from "../../../stores"
import { getShowChords, transposeShow, transposeSlides } from "./chords"

function makeSlide(items: any[], extra: Partial<Slide> = {}): Slide {
    return {
        group: "Verse",
        color: null,
        settings: {},
        notes: "",
        items,
        ...extra
    }
}

describe("transposeSlides", () => {
    it("keeps a slide's sheet music item once when another slide has chords", () => {
        const slides: { [key: string]: Slide } = {
            s1: makeSlide(
                [
                    { type: "text", style: "", lines: [{ align: "", text: [{ value: "No chords here", style: "" }] }] },
                    { type: "sheet_music", style: "", sheet_music: { data: "<mei>hymn</mei>", label: "Hymn" } }
                ],
                { group: "Intro" }
            ),
            s2: makeSlide([{ type: "text", style: "", lines: [{ align: "", text: [{ value: "Praise", style: "" }], chords: [{ id: "c1", pos: 0, key: "D" }] }] }], { group: "Verse" })
        }

        const { slides: next, changed } = transposeSlides(slides, 1)

        expect(changed).toBe(true)
        expect(Object.keys(next)).toEqual(["s1", "s2"])
        expect(next.s1.items).toHaveLength(2)
        expect(next.s1.items.filter((item) => item.type === "sheet_music")).toHaveLength(1)
        expect(next.s1.items[0].lines?.[0].text[0].value).toBe("No chords here")
        expect(next.s1.items[1].sheet_music?.transpose).toBe(1)
        expect(next.s2.items[0].lines?.[0].chords?.[0].key).toBe("D#")

        // Input slides are not mutated
        expect(slides.s1.items[1].sheet_music?.transpose).toBeUndefined()
        expect(slides.s2.items[0].lines?.[0].chords?.[0].key).toBe("D")
    })

    it("keeps a child slide holding only a sheet music item and moves its transpose", () => {
        const slides: { [key: string]: Slide } = {
            parent: makeSlide([{ type: "text", style: "", lines: [{ align: "", text: [{ value: "Verse line", style: "" }], chords: [{ id: "c1", pos: 0, key: "G" }] }] }], {
                group: "Verse",
                children: ["child"]
            }),
            child: makeSlide([{ type: "sheet_music", style: "", sheet_music: { data: "<mei>child</mei>" } }], { group: null })
        }

        const { slides: next, changed } = transposeSlides(slides, 1)

        expect(changed).toBe(true)
        expect(next.parent.children).toEqual(["child"])
        expect(next.parent.items[0].lines?.[0].chords?.[0].key).toBe("G#")
        expect(next.child).toBeDefined()
        expect(next.child.items).toHaveLength(1)
        expect(next.child.items[0].type).toBe("sheet_music")
        expect(next.child.items[0].sheet_music?.transpose).toBe(1)
    })

    it("transposes every slide in place regardless of which layout references it", () => {
        const slides: { [key: string]: Slide } = {
            shared: makeSlide([
                { type: "text", style: "", lines: [{ align: "", text: [{ value: "Shared", style: "" }], chords: [{ id: "c1", pos: 0, key: "Eb" }] }] },
                { type: "sheet_music", style: "", sheet_music: { data: "<mei>shared</mei>", transpose: 2 } }
            ]),
            otherLayoutOnly: makeSlide([{ type: "text", style: "", lines: [{ align: "", text: [{ value: "Alt", style: "" }], chords: [{ id: "c2", pos: 0, key: "Bb" }] }] }])
        }

        const { slides: next, changed } = transposeSlides(slides, 1)

        expect(changed).toBe(true)
        expect(Object.keys(next)).toEqual(["shared", "otherLayoutOnly"])
        expect(next.shared.items[0].lines?.[0].chords?.[0].key).toBe("E")
        expect(next.shared.items[1].sheet_music?.transpose).toBe(3)
        expect(next.otherLayoutOnly.items[0].lines?.[0].chords?.[0].key).toBe("B")
    })

    it("handles a chord-only show, a music-only show, and a show with neither", () => {
        const chordOnly = {
            s1: makeSlide([{ type: "text", style: "", lines: [{ align: "", text: [{ value: "Grace", style: "" }], chords: [{ id: "c1", pos: 0, key: "C" }] }] }])
        }
        const chordResult = transposeSlides(chordOnly, -1)
        expect(chordResult.changed).toBe(true)
        expect(chordResult.slides.s1.items[0].lines?.[0].chords?.[0].key).toBe("B")

        const musicOnly = {
            s1: makeSlide([{ type: "sheet_music", style: "", sheet_music: { data: "<mei>m</mei>", transpose: 6 } }])
        }
        const musicResult = transposeSlides(musicOnly, 1)
        expect(musicResult.changed).toBe(true)
        expect(musicResult.slides.s1.items[0].sheet_music?.transpose).toBe(-5)

        const neither = {
            s1: makeSlide([{ type: "text", style: "", lines: [{ align: "", text: [{ value: "Plain words", style: "" }] }] }])
        }
        const neitherResult = transposeSlides(neither, 1)
        expect(neitherResult.changed).toBe(false)
        expect(neitherResult.slides).toEqual(neither)
    })

    it("matches transposeText for chord keys with steps 1 and -1", () => {
        const keys = ["Eb", "Bb", "F#m7", "G/B", "Csus4", "Am", "D7", "Bbmaj7/G", "Chorus", "Coda", "Bridge", "Ending", "Fine", "Capo 2", "D.S. al Coda", "C6/9/E", "Cm7b5", "1", "iv", ""]
        const unchangedKeys = ["Chorus", "Coda", "Bridge", "Ending", "Fine", "Capo 2", "D.S. al Coda", "C6/9/E", ""]
        const slides: { [key: string]: Slide } = {
            s1: makeSlide([
                {
                    type: "text",
                    style: "",
                    lines: [
                        {
                            align: "",
                            text: [{ value: "Lyrics", style: "" }],
                            chords: keys.map((key, index) => ({ id: `c${index}`, pos: index, key }))
                        }
                    ]
                }
            ])
        }

        for (const step of [1, -1]) {
            const { slides: next, changed } = transposeSlides(slides, step)
            expect(changed).toBe(true)
            const actual = next.s1.items[0].lines?.[0].chords?.map((chord) => chord.key)
            const expected = keys.map((key) => transposeText("[" + key + "]", step).slice(1, -1))
            expect(actual).toEqual(expected)

            for (const key of unchangedKeys) {
                const index = keys.indexOf(key)
                expect(actual?.[index]).toBe(key)
            }
        }
    })
})

describe("transposeShow", () => {
    beforeEach(() => {
        historyCalls.length = 0
        focusMode.set(false)
        activeFocus.set({ id: "" })
        activeShow.set({ id: "show-1", type: "show" } as any)
        showsCache.set({
            "show-1": {
                name: "Hymn",
                slides: {
                    s1: makeSlide([
                        {
                            type: "text",
                            style: "",
                            lines: [
                                {
                                    align: "",
                                    text: [{ value: "Amazing grace", style: "" }],
                                    chords: [
                                        { id: "c1", pos: 0, key: "Eb" },
                                        { id: "c2", pos: 8, key: "Bb" }
                                    ]
                                }
                            ]
                        },
                        { type: "sheet_music", style: "", sheet_music: { data: "<mei>1</mei>", label: "Hymn 1" } }
                    ]),
                    s2: makeSlide([
                        { type: "sheet_music", style: "", sheet_music: { data: "<mei>2</mei>", transpose: 6 } },
                        { type: "sheet_music", style: "", sheet_music: { data: "<mei>3</mei>", transpose: -5 } }
                    ])
                },
                layouts: {
                    l1: { name: "Default", notes: "", slides: [{ id: "s1" }, { id: "s2" }] },
                    l2: { name: "Short", notes: "", slides: [{ id: "s1" }] }
                }
            },
            "focused-show": {
                name: "Focused",
                slides: {
                    f1: makeSlide([{ type: "text", style: "", lines: [{ align: "", text: [{ value: "Focus", style: "" }], chords: [{ id: "cf1", pos: 0, key: "G" }] }] }])
                },
                layouts: {}
            }
        } as any)
    })

    it("transposes chords and sheet music across all slides in one history entry without touching layouts", () => {
        const changed = transposeShow("", 1)

        expect(changed).toBe(true)
        expect(historyCalls).toHaveLength(1)
        expect(historyCalls[0]).toMatchObject({
            id: "UPDATE",
            oldData: { id: "show-1" },
            location: { page: "show", id: "show_key" }
        })
        expect(historyCalls[0].newData.key).toBe("slides")

        const nextSlides = historyCalls[0].newData.data
        expect(nextSlides.s1.items[0].lines[0].chords.map((c: any) => c.key)).toEqual(["E", "B"])
        expect(nextSlides.s1.items[1].sheet_music.transpose).toBe(1)
        expect(nextSlides.s1.items[1].sheet_music.data).toBe("<mei>1</mei>")
        expect(nextSlides.s2.items[0].sheet_music.transpose).toBe(-5)
        expect(nextSlides.s2.items[1].sheet_music.transpose).toBe(-4)

        // Original show in store was cloned and not mutated in place
        const originalShow = (get(showsCache) as any)["show-1"]
        expect(originalShow.slides.s1.items[0].lines[0].chords[0].key).toBe("Eb")
        expect(originalShow.slides.s1.items[1].sheet_music.transpose).toBeUndefined()
        expect(originalShow.layouts.l2.slides).toEqual([{ id: "s1" }])
    })

    it("targets the focused show in focus mode when no id is given", () => {
        focusMode.set(true)
        activeFocus.set({ id: "focused-show" })

        expect(transposeShow("", 1)).toBe(true)
        expect(historyCalls).toHaveLength(1)
        expect(historyCalls[0].oldData.id).toBe("focused-show")
        expect(historyCalls[0].newData.data.f1.items[0].lines[0].chords[0].key).toBe("G#")
    })

    it("does nothing for a locked show or a show with neither chords nor sheet music", () => {
        showsCache.update((cache: any) => {
            cache["show-1"].locked = true
            cache["plain-show"] = {
                name: "Plain",
                slides: {
                    p1: makeSlide([{ type: "text", style: "", lines: [{ align: "", text: [{ value: "Hi", style: "" }] }] }])
                },
                layouts: {}
            }
            return cache
        })

        expect(transposeShow("show-1", 1)).toBe(false)
        expect(transposeShow("plain-show", 1)).toBe(false)
        expect(transposeShow("show-1", 0)).toBe(false)
        expect(historyCalls).toHaveLength(0)
    })

    it("reports chord presence via getShowChords", () => {
        expect(getShowChords((get(showsCache) as any)["show-1"]).length > 0).toBe(true)
        expect(getShowChords({ slides: {} } as any).length > 0).toBe(false)
        expect(
            getShowChords({
                slides: {
                    s1: makeSlide([{ type: "sheet_music", style: "", sheet_music: { data: "<mei/>" } }])
                }
            } as any).length > 0
        ).toBe(false)
        expect(
            getShowChords({
                slides: {
                    s1: makeSlide([{ type: "text", style: "", lines: [{ align: "", text: [{ value: "Hi", style: "" }], chords: [] }] }])
                }
            } as any).length > 0
        ).toBe(false)
    })
})
