import abcjs from "abcjs"
import { describe, expect, it } from "vitest"
import { getStyles } from "../components/helpers/style"
import { convertAndCheckAbc } from "../components/slide/views/sheetMusic/abcToMei"
import { MAX_LYRIC_SIZE, MAX_NOTATION_SIZE } from "../components/slide/views/sheetMusic/helpers"
import { EMPTY_LYRICS_PLACEHOLDER, LYRICS_ONLY_ITEM_STYLE, SHEET_MUSIC_ITEM_STYLE, STAGE_TEXT_ITEM_STYLE, STAGE_TEXT_STYLE, buildSheetMusicShow, buildSheetMusicSlidesAndLayout, getFirstSlideVerses, getImportLyricSize } from "./sheetMusic"

function makeSequentialIdFactory(): () => string {
    let counter = 0
    return () => `id_${++counter}`
}

describe("sheet music show building", () => {
    const slide1Mei = convertAndCheckAbc(["T: Sample Hymn", "C: William Monk", "M: 4/4", "L: 1/4", "K: Eb", "[V:S] G2 G F | E4 |", "w: 1.~A-bide with | me;", "w: 2.~Swift to its | close", "w: 3.~Not a brief | glance"].join("\n"), abcjs.parseOnly).mei
    const slide2Mei = convertAndCheckAbc(["T: Sample Hymn", "M: 4/4", "L: 1/4", "K: Eb", "[V:S] c B B A | G4 |", "w: 1.~fast falls the | tide;", "w: 2.~life's lit-tle | day;", "w: 3.~a pass-ing | word;"].join("\n"), abcjs.parseOnly, { hideInitialMeter: true }).mei
    const refrainMei = convertAndCheckAbc(["T: Sample Hymn", "M: 4/4", "L: 1/4", "K: Eb", "[V:S] G F E2 |", "w: Lord, a-bide!"].join("\n"), abcjs.parseOnly, { hideInitialMeter: true }).mei
    const wordlessMei = convertAndCheckAbc(["T: Sample Hymn", "M: 4/4", "L: 1/4", "K: Eb", "[V:S] G F E D |"].join("\n"), abcjs.parseOnly, { hideInitialMeter: true }).mei

    it("builds one group with child slides and no verses filter in 'all' mode", () => {
        const built = buildSheetMusicSlidesAndLayout({
            slides: [
                { mei: slide1Mei, abc: "abc1" },
                { mei: slide2Mei, abc: "abc2" }
            ],
            verseMode: "all",
            verseNumbers: [1, 2, 3],
            parts: "upper",
            label: "Sample Hymn",
            createId: makeSequentialIdFactory()
        })

        expect(built.groupCount).toBe(1)
        expect(built.slideCount).toBe(2)
        expect(built.layoutSlides).toEqual([{ id: "id_1" }])

        const parent = built.slides.id_1
        expect(parent.group).toBe("verse")
        expect(parent.globalGroup).toBe("verse")
        expect(parent.color).toBe("")
        expect(parent.children).toEqual(["id_2"])
        expect(parent.items).toHaveLength(2)

        const [musicItem, textItem] = parent.items
        expect(musicItem.type).toBe("sheet_music")
        expect(musicItem.style).toBe(SHEET_MUSIC_ITEM_STYLE)
        expect(musicItem.sheet_music).toEqual({
            data: slide1Mei,
            abc: "abc1",
            label: "Sample Hymn",
            size: MAX_NOTATION_SIZE,
            lyricSize: MAX_LYRIC_SIZE,
            parts: "upper"
        })

        expect(textItem.type).toBe("text")
        expect(textItem.style).toBe(STAGE_TEXT_ITEM_STYLE)
        expect(textItem.align).toBe("")
        expect(textItem.textFit).toBe("shrinkToFit")
        expect(textItem.bindings).toEqual(["stage"])
        expect(textItem.lines?.map((line) => line.text[0].value)).toEqual(["1. Abide with me;", "2. Swift to its close", "3. Not a brief glance"])
        expect(textItem.lines?.every((line) => line.align === "" && line.text[0].style === STAGE_TEXT_STYLE)).toBe(true)

        const child = built.slides.id_2
        expect(child.group).toBeNull()
        expect(child.color).toBeNull()
        expect(child.items[0].sheet_music?.size).toBe(MAX_NOTATION_SIZE)
        expect(child.items[0].sheet_music?.verses).toBeUndefined()
    })

    it("uses a musical note placeholder instead of an empty text item on a wordless slide", () => {
        const built = buildSheetMusicSlidesAndLayout({
            slides: [{ mei: slide1Mei }, { mei: wordlessMei }, { mei: slide2Mei }],
            verseMode: "all",
            verseNumbers: [1],
            parts: "all",
            label: "Sample Hymn",
            createId: makeSequentialIdFactory()
        })

        const middleChildId = built.slides.id_1.children![0]
        const middleSlide = built.slides[middleChildId]
        expect(middleSlide.items).toHaveLength(2)
        expect(middleSlide.items[1].bindings).toEqual(["stage"])
        expect(middleSlide.items[1].lines?.map((line) => line.text[0].value)).toEqual([EMPTY_LYRICS_PLACEHOLDER])
    })

    it("places notation and words in non-overlapping boxes inside 1920x1080 with max notation size and fitting stage words", () => {
        const musicBox = getStyles(SHEET_MUSIC_ITEM_STYLE, true)
        const textBox = getStyles(STAGE_TEXT_ITEM_STYLE, true)

        expect(Number(musicBox.left)).toBe(50)
        expect(Number(musicBox.top)).toBe(40)
        expect(Number(musicBox.width)).toBe(1820)
        expect(Number(musicBox.height)).toBe(800)
        expect(musicBox.color).toBe("#ffffff")

        expect(Number(textBox.left)).toBe(50)
        expect(Number(textBox.top)).toBe(860)
        expect(Number(textBox.width)).toBe(1820)
        expect(Number(textBox.height)).toBe(180)

        expect(Number(musicBox.top) + Number(musicBox.height)).toBeLessThanOrEqual(Number(textBox.top))
        expect(Number(textBox.top) + Number(textBox.height)).toBeLessThanOrEqual(1080)
        expect(STAGE_TEXT_STYLE).toBe("font-size: 50px;")

        expect(getFirstSlideVerses("per_verse", [1, 2, 3])).toBe("1")
        expect(getFirstSlideVerses("per_verse", [2, 3])).toBe("2")
        expect(getFirstSlideVerses("per_verse", [1])).toBe("")
        expect(getFirstSlideVerses("all", [1, 2, 3])).toBe("")
    })

    it("builds one verse group per verse number with children, verses filter, refrain words and stage binding in 'per_verse' mode", () => {
        const show = buildSheetMusicShow({
            name: "Sample Hymn",
            label: "Sample Hymn",
            category: "hymns",
            layoutName: "Default",
            slides: [
                { mei: slide1Mei, measures: "1-2" },
                { mei: slide2Mei, measures: "3-4" },
                { mei: refrainMei, measures: "5" }
            ],
            verseMode: "per_verse",
            verseNumbers: [1, 2, 3],
            parts: "all",
            metadata: {
                title: "Sample Hymn",
                composer: "William Monk",
                author: "Henry Lyte",
                copyright: "Public domain",
                key: "Eb"
            },
            createId: makeSequentialIdFactory()
        })

        expect(show.name).toBe("Sample Hymn")
        expect(show.category).toBe("hymns")
        expect(show.meta).toEqual({
            title: "Sample Hymn",
            composer: "William Monk",
            author: "Henry Lyte",
            copyright: "Public domain",
            key: "Eb"
        })

        const layoutSlides = show.layouts[show.settings.activeLayout].slides
        expect(layoutSlides).toHaveLength(3)

        const verse3ParentId = layoutSlides[2].id
        const verse3Parent = show.slides[verse3ParentId]
        expect(verse3Parent.group).toBe("verse")
        expect(verse3Parent.globalGroup).toBe("verse")
        expect(verse3Parent.children).toHaveLength(2)

        const verse3SlideIds = [verse3ParentId, ...(verse3Parent.children || [])]
        for (const slideId of verse3SlideIds) {
            const slide = show.slides[slideId]
            expect(slide.items).toHaveLength(2)
            expect(slide.items[0].sheet_music?.size).toBe(MAX_NOTATION_SIZE)
            expect(slide.items[0].sheet_music?.verses).toBe("3")
            expect(slide.items[0].sheet_music?.parts).toBeUndefined()
            expect(slide.items[1].bindings).toEqual(["stage"])
            expect(slide.items[1].textFit).toBe("shrinkToFit")
        }

        expect(show.slides[verse3SlideIds[0]].items[0].sheet_music?.measures).toBe("1-2")
        expect(show.slides[verse3SlideIds[0]].items[1].lines?.map((line) => line.text[0].value)).toEqual(["3. Not a brief glance"])
        expect(show.slides[verse3SlideIds[1]].items[1].lines?.map((line) => line.text[0].value)).toEqual(["3. a passing word;"])
        expect(show.slides[verse3SlideIds[2]].items[1].lines?.map((line) => line.text[0].value)).toEqual(["Lord, abide!"])
    })

    it("imports W: plain-text verses as words-only groups after notation groups in both per_verse and all modes (C)", () => {
        const textVerses = [
            ["4. I need Thy presence every passing hour.", "What but Thy grace can foil the tempter's power?"],
            ["5. Hold Thou Thy cross before my closing eyes;", "Shine through the gloom and point me to the skies."]
        ]

        const perVerseBuilt = buildSheetMusicSlidesAndLayout({
            slides: [{ mei: slide1Mei }, { mei: slide2Mei }],
            verseMode: "per_verse",
            verseNumbers: [1, 2, 3],
            parts: "all",
            label: "Abide With Me",
            textVerses,
            createId: makeSequentialIdFactory()
        })
        expect(perVerseBuilt.groupCount).toBe(5)
        expect(perVerseBuilt.slideCount).toBe(8)
        expect(perVerseBuilt.layoutSlides).toHaveLength(5)

        const firstWordsOnly = perVerseBuilt.slides[perVerseBuilt.layoutSlides[3].id]
        expect(firstWordsOnly.group).toBe("verse")
        expect(firstWordsOnly.globalGroup).toBe("verse")
        expect(firstWordsOnly.children).toBeUndefined()
        expect(firstWordsOnly.items).toHaveLength(1)
        expect(firstWordsOnly.items[0].type).toBe("text")
        expect(firstWordsOnly.items[0].style).toBe(LYRICS_ONLY_ITEM_STYLE)
        expect(firstWordsOnly.items[0].bindings).toBeUndefined()
        expect(firstWordsOnly.items[0].lines?.map((line) => line.text[0].value)).toEqual(textVerses[0])

        const allModeBuilt = buildSheetMusicSlidesAndLayout({
            slides: [{ mei: slide1Mei }, { mei: slide2Mei }],
            verseMode: "all",
            verseNumbers: [1, 2, 3],
            parts: "all",
            label: "Abide With Me",
            textVerses,
            createId: makeSequentialIdFactory()
        })
        expect(allModeBuilt.groupCount).toBe(3)
        expect(allModeBuilt.slideCount).toBe(4)
        expect(allModeBuilt.slides[allModeBuilt.layoutSlides[1].id].items[0].lines?.map((line) => line.text[0].value)).toEqual(textVerses[0])
        expect(allModeBuilt.slides[allModeBuilt.layoutSlides[2].id].items[0].lines?.map((line) => line.text[0].value)).toEqual(textVerses[1])
    })

    it("writes lyricSize 175 on every notation item for Large (default) and omits it for Normal", () => {
        expect(getImportLyricSize("large")).toBe(175)
        expect(getImportLyricSize("normal")).toBeUndefined()

        const baseOptions = {
            name: "Sample Hymn",
            label: "Sample Hymn",
            slides: [{ mei: slide1Mei }, { mei: wordlessMei }, { mei: slide2Mei }],
            verseMode: "per_verse" as const,
            verseNumbers: [1, 2],
            parts: "all" as const,
            textVerses: [["3. Plain text verse line"]],
            createId: makeSequentialIdFactory()
        }

        const defaultShow = buildSheetMusicShow(baseOptions)
        const largeShow = buildSheetMusicShow({ ...baseOptions, words: "large", createId: makeSequentialIdFactory() })
        const normalShow = buildSheetMusicShow({ ...baseOptions, words: "normal", createId: makeSequentialIdFactory() })

        const collectNotationItems = (slides: Record<string, { items: { type?: string; sheet_music?: { lyricSize?: number } }[] }>) => Object.values(slides).flatMap((slide) => slide.items.filter((item) => item.type === "sheet_music"))

        const defaultItems = collectNotationItems(defaultShow.slides)
        const largeItems = collectNotationItems(largeShow.slides)
        const normalItems = collectNotationItems(normalShow.slides)

        expect(defaultItems).toHaveLength(6)
        expect(largeItems).toHaveLength(6)
        expect(normalItems).toHaveLength(6)

        for (const item of [...defaultItems, ...largeItems]) {
            expect(item.sheet_music?.lyricSize).toBe(175)
        }
        for (const item of normalItems) {
            expect(item.sheet_music?.lyricSize).toBeUndefined()
            expect("lyricSize" in (item.sheet_music || {})).toBe(false)
        }
    })

    it("writes the chosen words size on every notation item in 'all' mode", () => {
        const baseOptions = {
            name: "Sample Hymn",
            label: "Sample Hymn",
            slides: [{ mei: slide1Mei }, { mei: wordlessMei }, { mei: slide2Mei }],
            verseMode: "all" as const,
            verseNumbers: [1, 2, 3],
            parts: "all" as const,
            textVerses: [["4. Plain text verse line"]],
            createId: makeSequentialIdFactory()
        }

        const defaultShow = buildSheetMusicShow(baseOptions)
        const largeShow = buildSheetMusicShow({ ...baseOptions, words: "large", createId: makeSequentialIdFactory() })
        const normalShow = buildSheetMusicShow({ ...baseOptions, words: "normal", createId: makeSequentialIdFactory() })

        const collectNotationItems = (slides: Record<string, { items: { type?: string; sheet_music?: { lyricSize?: number } }[] }>) => Object.values(slides).flatMap((slide) => slide.items.filter((item) => item.type === "sheet_music"))

        const defaultItems = collectNotationItems(defaultShow.slides)
        const largeItems = collectNotationItems(largeShow.slides)
        const normalItems = collectNotationItems(normalShow.slides)

        expect(defaultItems).toHaveLength(3)
        expect(largeItems).toHaveLength(3)
        expect(normalItems).toHaveLength(3)

        for (const item of [...defaultItems, ...largeItems]) {
            expect(item.sheet_music?.lyricSize).toBe(175)
        }
        for (const item of normalItems) {
            expect(item.sheet_music?.lyricSize).toBeUndefined()
            expect("lyricSize" in (item.sheet_music || {})).toBe(false)
        }
    })
})
