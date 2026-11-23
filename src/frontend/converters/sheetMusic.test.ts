import { readFileSync } from "node:fs"
import abcjs from "abcjs"
import { describe, expect, it } from "vitest"
import { convertAndCheckAbc } from "../components/slide/views/sheetMusic/abcToMei"
import { MAX_NOTATION_SIZE, hasHiddenInitialMeter } from "../components/slide/views/sheetMusic/helpers"
import { summarizeMei } from "../components/slide/views/sheetMusic/meiParts"
import { getStyles } from "../components/helpers/style"
import { SHEET_MUSIC_ITEM_STYLE, STAGE_TEXT_ITEM_STYLE, STAGE_TEXT_STYLE, buildMeasureSliceRanges, buildSheetMusicShow, buildSheetMusicSlidesAndLayout, extractAbcMetadata, extractKeyFromMei, extractSlideLyrics, getFileSlideRanges, getFirstSlideVerses, getFixedMeasureSlideStarts, getLineBreakSlideStarts, hasMeiLineBreaks, sliceAbcIntoSystems, splitAbcIntoSystemTexts } from "./sheetMusic"

const ABIDE_WITH_ME_FIXTURE = "/Users/daniel/.local/state/rstack/plans/rootric-inc-freeshow/sheet-music-assets/fixtures/openhymnal-abide-with-me.abc"

function makeSequentialIdFactory(): () => string {
    let counter = 0
    return () => `id_${++counter}`
}

describe("sheet music slide starts and measure ranges", () => {
    it("finds slide starts from <sb/> and <pb/> elements and ignores a leading <pb/> before measure 1", () => {
        const mei = `<mei><section><pb/><measure n="1"/><measure n="2"/><measure n="3"/><measure n="4"/><sb/><measure n="5"/><measure n="6"/><pb/><sb/><measure n="7"/><measure n="8"/><sb/></section></mei>`

        expect(getLineBreakSlideStarts(mei)).toEqual([1, 5, 7])
        expect(hasMeiLineBreaks(mei)).toBe(true)
        expect(getFileSlideRanges(mei, 8, "breaks")).toEqual([
            { first: 1, last: 4 },
            { first: 5, last: 6 },
            { first: 7, last: 8 }
        ])
    })

    it("reports no line breaks when only a leading <pb/> exists", () => {
        const mei = `<mei><section><pb/><measure n="1"/><measure n="2"/><measure n="3"/><measure n="4"/></section></mei>`
        expect(getLineBreakSlideStarts(mei)).toEqual([1])
        expect(hasMeiLineBreaks(mei)).toBe(false)
    })

    it("computes slide starts and ranges for fixed measure intervals", () => {
        expect(getFixedMeasureSlideStarts(10, 4)).toEqual([1, 5, 9])
        expect(buildMeasureSliceRanges(10, [1, 5, 9])).toEqual([
            { first: 1, last: 4 },
            { first: 5, last: 8 },
            { first: 9, last: 10 }
        ])
        expect(getFileSlideRanges("<mei/>", 7, "2")).toEqual([
            { first: 1, last: 2 },
            { first: 3, last: 4 },
            { first: 5, last: 6 },
            { first: 7, last: 7 }
        ])
        expect(getFileSlideRanges("<mei/>", 16, "8")).toEqual([
            { first: 1, last: 8 },
            { first: 9, last: 16 }
        ])
    })
})

describe("sheet music lyric extraction and refrain rule", () => {
    const multiVerseAbc = ["T: Four-Part Hymn", "M: 4/4", "L: 1/4", "K: Bb", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] d e d c | d c B c |", "w: 1.~Praise God from whom | all bless-ings flow,", "w: 2.~Praise Him a-bove, | ye heav'n-ly host,", "w: 3.~Praise Fa-ther, Son, | and Ho-ly Ghost,", "[V:A] B G F F | F F G A |", "[V:T] f e d c | B A d c |", "[V:B] D C B, F | B, F G F |"].join("\n")

    const refrainSlideAbc = ["T: Hymn With Refrain", "M: 4/4", "L: 1/4", "K: C", "[V:S] C D E F | G4 |", "w: Yes, Je-sus loves | me!"].join("\n")

    const mixedVerseAndRefrainAbc = ["T: Mixed Slide", "M: 4/4", "L: 1/4", "K: C", "[V:S] C D E F | G A B c |", "w: 1.~A-bide with me | Hal-le-lu-jah!", "w: 2.~Stay close to me", "w: 3.~Walk near to me"].join("\n")

    it("joins syllables marked with con=d without spaces and returns one line per verse", () => {
        const mei = convertAndCheckAbc(multiVerseAbc, abcjs.parseOnly).mei

        expect(extractSlideLyrics(mei)).toEqual(["1. Praise God from whom all blessings flow,", "2. Praise Him above, ye heav'nly host,", "3. Praise Father, Son, and Holy Ghost,"])
        expect(extractSlideLyrics(mei, 2)).toEqual(["2. Praise Him above, ye heav'nly host,"])
        expect(extractSlideLyrics(mei, 3)).toEqual(["3. Praise Father, Son, and Holy Ghost,"])
    })

    it("keeps refrain words stored only on verse 1 for every verse group", () => {
        const refrainMei = convertAndCheckAbc(refrainSlideAbc, abcjs.parseOnly).mei
        expect(extractSlideLyrics(refrainMei, 1)).toEqual(["Yes, Jesus loves me!"])
        expect(extractSlideLyrics(refrainMei, 3)).toEqual(["Yes, Jesus loves me!"])

        const mixedMei = convertAndCheckAbc(mixedVerseAndRefrainAbc, abcjs.parseOnly).mei
        expect(extractSlideLyrics(mixedMei, 3)).toEqual(["3. Walk near to me Hallelujah!"])
    })
})

describe("sheet music show building and metadata", () => {
    const slide1Mei = convertAndCheckAbc(["T: Sample Hymn", "C: William Monk", "M: 4/4", "L: 1/4", "K: Eb", "[V:S] G2 G F | E4 |", "w: 1.~A-bide with | me;", "w: 2.~Swift to its | close", "w: 3.~Not a brief | glance"].join("\n"), abcjs.parseOnly).mei
    const slide2Mei = convertAndCheckAbc(["T: Sample Hymn", "M: 4/4", "L: 1/4", "K: Eb", "[V:S] c B B A | G4 |", "w: 1.~fast falls the | tide;", "w: 2.~life's lit-tle | day;", "w: 3.~a pass-ing | word;"].join("\n"), abcjs.parseOnly, { hideInitialMeter: true }).mei
    const refrainMei = convertAndCheckAbc(["T: Sample Hymn", "M: 4/4", "L: 1/4", "K: Eb", "[V:S] G F E2 |", "w: Lord, a-bide!"].join("\n"), abcjs.parseOnly, { hideInitialMeter: true }).mei

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

        // Check group 3 (verse 3)
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
        // Refrain slide holds refrain words even in verse 3 group
        expect(show.slides[verse3SlideIds[2]].items[1].lines?.map((line) => line.text[0].value)).toEqual(["Lord, abide!"])
    })

    it("extracts metadata from ABC headers and key from MEI", () => {
        const abc = ["X: 1", "T: Abide With Me", "C: Henry F. Lyte", "C: William H. Monk", "M: 4/4", "L: 1/4", "K: Eb", "[V:S] G4 |"].join("\n")
        expect(extractAbcMetadata(abc)).toEqual({
            title: "Abide With Me",
            composer: "Henry F. Lyte William H. Monk",
            key: "Eb"
        })

        expect(extractKeyFromMei('<mei><scoreDef keysig="3f"><staffGrp/></scoreDef></mei>')).toBe("Eb")
        expect(extractKeyFromMei('<mei><scoreDef><staffGrp><staffDef n="1"><keySig sig="2s" mode="minor"/></staffDef></staffGrp></scoreDef></mei>')).toBe("Bm")
        expect(extractKeyFromMei("<mei><scoreDef/></mei>")).toBe("")
    })
})

describe("ABC cutting into system slices (with real abcjs)", () => {
    it("cuts openhymnal-abide-with-me.abc into its 3 systems with headers, hidden meter after slide 1, no W: block, and matching measure count", () => {
        const abc = readFileSync(ABIDE_WITH_ME_FIXTURE, "utf8")
        const whole = convertAndCheckAbc(abc, abcjs.parseOnly)
        expect(whole.hasError).toBe(false)
        const wholeMeasures = summarizeMei(whole.mei).measures

        const slices = sliceAbcIntoSystems(abc, abcjs.parseOnly)
        expect(slices).toHaveLength(3)

        let totalMeasures = 0
        slices.forEach((slice, index) => {
            expect(slice.analysis.hasError).toBe(false)
            expect(slice.abc).toContain("T: Abide With Me")
            expect(slice.abc).toContain("K: Eb")
            expect(slice.abc).toContain("%%staves")
            expect(slice.abc).not.toContain("W:")

            if (index === 0) {
                expect(hasHiddenInitialMeter(slice.analysis.mei)).toBe(false)
            } else {
                expect(hasHiddenInitialMeter(slice.analysis.mei)).toBe(true)
            }

            totalMeasures += summarizeMei(slice.analysis.mei).measures
        })

        expect(totalMeasures).toBe(wholeMeasures)
    })

    it("cuts voice-by-voice ABC into the same musical slices as system-by-system ABC", () => {
        const systemBySystem = ["T: Two Systems", "M: 4/4", "L: 1/4", "K: Eb", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] G2 G F | E2 B2 |", "w: A-bide with me;", "[V:A] E2 D D | E2 E2 |", "[V:T] B2 B A | G2 E2 |", "[V:B] E2 B, B, | C2 G,2 |", "[V:S] c B B A | G4 |", "w: fast falls the tide;", "[V:A] E D E F | E4 |", "[V:T] E B B B | B4 |", "[V:B] A, B, C D | E4 |"].join("\n")

        const voiceByVoice = ["T: Two Systems", "M: 4/4", "L: 1/4", "K: Eb", "%%score (S A) (T B)", "V: S", "G2 G F | E2 B2 |", "w: A-bide with me;", "c B B A | G4 |", "w: fast falls the tide;", "V: A", "E2 D D | E2 E2 |", "E D E F | E4 |", "V: T clef=bass octave=-1", "B2 B A | G2 E2 |", "E B B B | B4 |", "V: B clef=bass octave=-1", "E2 B, B, | C2 G,2 |", "A, B, C D | E4 |"].join("\n")

        const sysSlices = sliceAbcIntoSystems(systemBySystem, abcjs.parseOnly)
        const voiceSlices = sliceAbcIntoSystems(voiceByVoice, abcjs.parseOnly)

        expect(sysSlices).toHaveLength(2)
        expect(voiceSlices).toHaveLength(2)

        const stripIds = (mei: string) => mei.replace(/\s+xml:id="[^"]*"/g, "")
        for (let i = 0; i < 2; i++) {
            expect(sysSlices[i].analysis.hasError).toBe(false)
            expect(voiceSlices[i].analysis.hasError).toBe(false)
            expect(stripIds(voiceSlices[i].analysis.mei)).toBe(stripIds(sysSlices[i].analysis.mei))
        }
    })

    it("carries an earlier key or time change into later slices' headers", () => {
        const inlineChanges = ["T: Modulating Hymn", "M: 4/4", "L: 1/4", "K: C", "[V:S] C D E F | [K:G] [M:3/4] G A B |", "[V:S] c B A | G3 |", "[V:S] d c B | A3 |"].join("\n")

        const inlineTexts = splitAbcIntoSystemTexts(inlineChanges, abcjs.parseOnly)
        expect(inlineTexts).toHaveLength(3)
        expect(inlineTexts[0]).toContain("K: C")
        expect(inlineTexts[0]).toContain("M: 4/4")
        expect(inlineTexts[1]).toContain("K: G")
        expect(inlineTexts[1]).toContain("M: 3/4")
        expect(inlineTexts[2]).toContain("K: G")
        expect(inlineTexts[2]).toContain("M: 3/4")

        const inlineSlices = sliceAbcIntoSystems(inlineChanges, abcjs.parseOnly)
        expect(inlineSlices[1].analysis.hasError).toBe(false)
        expect(inlineSlices[1].analysis.mei).toContain('keysig="1s"')
        expect(inlineSlices[1].analysis.mei).toContain('meter.count="3" meter.unit="4" meter.visible="false"')

        const standaloneChanges = ["T: Standalone Change", "M: 4/4", "L: 1/4", "K: C", "C D E F | G4 |", "K: Eb", "M: 3/4", "G A B | c3 |"].join("\n")

        const standaloneSlices = sliceAbcIntoSystems(standaloneChanges, abcjs.parseOnly)
        expect(standaloneSlices).toHaveLength(2)
        expect(standaloneSlices[1].abc).toContain("K: Eb")
        expect(standaloneSlices[1].abc).toContain("M: 3/4")
        expect(standaloneSlices[1].analysis.hasError).toBe(false)
        expect(standaloneSlices[1].analysis.mei).toContain('keysig="3f"')
        expect(standaloneSlices[1].analysis.mei).toContain('meter.count="3" meter.unit="4" meter.visible="false"')
    })

    it("supports the invisible meter option on convertAndCheckAbc and detects it with hasHiddenInitialMeter", () => {
        const abc = ["M: 4/4", "L: 1/4", "K: C", "C D E F |"].join("\n")
        const visible = convertAndCheckAbc(abc, abcjs.parseOnly)
        const hidden = convertAndCheckAbc(abc, abcjs.parseOnly, { hideInitialMeter: true })

        expect(visible.mei).not.toContain('meter.visible="false"')
        expect(hasHiddenInitialMeter(visible.mei)).toBe(false)

        expect(hidden.mei).toContain('meter.count="4" meter.unit="4" meter.visible="false"')
        expect(hasHiddenInitialMeter(hidden.mei)).toBe(true)
    })
})
