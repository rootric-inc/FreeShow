import { uid } from "uid"
import type { Item, Line, Show, Slide, SlideData } from "../../types/Show"
import { MAX_NOTATION_SIZE } from "../components/slide/views/sheetMusic/helpers"
import { extractSlideLyrics } from "../components/slide/views/sheetMusic/meiRead"

export type SheetMusicImportParts = "all" | "upper" | "lower" | "melody"
export type SheetMusicVerseMode = "per_verse" | "all"

export interface SheetMusicMetadata {
    title?: string
    composer?: string
    author?: string
    copyright?: string
    key?: string
}

export interface SheetMusicImportSlide {
    mei: string
    abc?: string
    measures?: string
}

export interface BuildSheetMusicSlidesOptions {
    slides: readonly SheetMusicImportSlide[]
    verseMode: SheetMusicVerseMode
    verseNumbers: readonly number[]
    parts: SheetMusicImportParts
    label: string
    textVerses?: readonly (readonly string[])[]
    createId?: () => string
}

export interface BuiltSheetMusicSlides {
    slides: { [key: string]: Slide }
    layoutSlides: SlideData[]
    groupCount: number
    slideCount: number
}

export interface BuildSheetMusicShowOptions {
    name: string
    label: string
    category?: string | null
    layoutName?: string
    slides: readonly SheetMusicImportSlide[]
    verseMode: SheetMusicVerseMode
    verseNumbers: readonly number[]
    parts: SheetMusicImportParts
    textVerses?: readonly (readonly string[])[]
    metadata?: SheetMusicMetadata
    created?: number
    createId?: () => string
}

export const SHEET_MUSIC_ITEM_STYLE = "left:50px;top:40px;width:1820px;height:800px;color:#ffffff;"
export const STAGE_TEXT_ITEM_STYLE = "left:50px;top:860px;width:1820px;height:180px;"
export const STAGE_TEXT_STYLE = "font-size: 50px;"
export const LYRICS_ONLY_ITEM_STYLE = "top:88px;left:50px;height:904px;width:1820px;"
export const EMPTY_LYRICS_PLACEHOLDER = "♪"

export function getFirstSlideVerses(verseMode: SheetMusicVerseMode, verseNumbers: readonly number[]): string {
    return verseMode === "per_verse" && verseNumbers.length > 1 ? String(verseNumbers[0]) : ""
}

function createSlideItems(slide: SheetMusicImportSlide, label: string, parts: SheetMusicImportParts, verseNumber?: number): Item[] {
    const sheetMusic: NonNullable<Item["sheet_music"]> = {
        data: slide.mei,
        size: MAX_NOTATION_SIZE
    }
    if (slide.abc) sheetMusic.abc = slide.abc
    if (label) sheetMusic.label = label
    if (slide.measures) sheetMusic.measures = slide.measures
    if (parts !== "all") sheetMusic.parts = parts
    if (verseNumber !== undefined) sheetMusic.verses = String(verseNumber)

    const sheetMusicItem: Item = {
        type: "sheet_music",
        style: SHEET_MUSIC_ITEM_STYLE,
        sheet_music: sheetMusic
    }

    const extractedLyrics = extractSlideLyrics(slide.mei, verseNumber)
    const lyricValues = extractedLyrics.length > 0 ? extractedLyrics : [EMPTY_LYRICS_PLACEHOLDER]
    const lyricLines: Line[] = lyricValues.map((value) => ({
        align: "",
        text: [{ value, style: STAGE_TEXT_STYLE }]
    }))

    const textItem: Item = {
        type: "text",
        style: STAGE_TEXT_ITEM_STYLE,
        align: "",
        textFit: "shrinkToFit",
        bindings: ["stage"],
        lines: lyricLines
    }

    return [sheetMusicItem, textItem]
}

function createTextVerseSlide(verseLines: readonly string[]): Slide {
    const textItem: Item = {
        type: "text",
        style: LYRICS_ONLY_ITEM_STYLE,
        lines: verseLines.map((value) => ({
            align: "",
            text: [{ value, style: "" }]
        }))
    }

    return {
        group: "verse",
        color: "",
        globalGroup: "verse",
        settings: {},
        notes: "",
        items: [textItem]
    }
}

export function buildSheetMusicSlidesAndLayout(options: BuildSheetMusicSlidesOptions): BuiltSheetMusicSlides {
    const createId = options.createId || uid
    const slidesMap: { [key: string]: Slide } = {}
    const layoutSlides: SlideData[] = []

    if (!options.slides.length) {
        return { slides: slidesMap, layoutSlides, groupCount: 0, slideCount: 0 }
    }

    const usePerVerseGroups = options.verseMode === "per_verse" && options.verseNumbers.length > 1
    const groupVerses: (number | undefined)[] = usePerVerseGroups ? [...options.verseNumbers] : [undefined]

    let totalSlideCount = 0
    let totalGroupCount = 0

    for (const verseNumber of groupVerses) {
        const parentId = createId()
        const childIds: string[] = []

        options.slides.forEach((slideSource, slideIndex) => {
            const items = createSlideItems(slideSource, options.label, options.parts, verseNumber)
            totalSlideCount++

            if (slideIndex === 0) {
                slidesMap[parentId] = {
                    group: "verse",
                    color: "",
                    globalGroup: "verse",
                    settings: {},
                    notes: "",
                    items
                }
                return
            }

            const childId = createId()
            childIds.push(childId)
            slidesMap[childId] = {
                group: null,
                color: null,
                settings: {},
                notes: "",
                items
            }
        })

        if (childIds.length > 0) {
            slidesMap[parentId].children = childIds
        }
        layoutSlides.push({ id: parentId })
        totalGroupCount++
    }

    for (const verseLines of options.textVerses || []) {
        const cleanedLines = verseLines.map((line) => line.trim()).filter(Boolean)
        if (!cleanedLines.length) continue
        const slideId = createId()
        slidesMap[slideId] = createTextVerseSlide(cleanedLines)
        layoutSlides.push({ id: slideId })
        totalSlideCount++
        totalGroupCount++
    }

    return {
        slides: slidesMap,
        layoutSlides,
        groupCount: totalGroupCount,
        slideCount: totalSlideCount
    }
}

export function buildSheetMusicShow(options: BuildSheetMusicShowOptions): Show {
    const createId = options.createId || uid
    const layoutId = createId()
    const created = options.created ?? Date.now()
    const built = buildSheetMusicSlidesAndLayout({
        slides: options.slides,
        verseMode: options.verseMode,
        verseNumbers: options.verseNumbers,
        parts: options.parts,
        label: options.label,
        textVerses: options.textVerses,
        createId
    })

    const meta: Show["meta"] = {}
    if (options.metadata?.title?.trim()) meta.title = options.metadata.title.trim()
    if (options.metadata?.composer?.trim()) meta.composer = options.metadata.composer.trim()
    if (options.metadata?.author?.trim()) meta.author = options.metadata.author.trim()
    if (options.metadata?.copyright?.trim()) meta.copyright = options.metadata.copyright.trim()
    if (options.metadata?.key?.trim()) meta.key = options.metadata.key.trim()

    return {
        name: options.name,
        private: false,
        category: options.category ?? null,
        settings: {
            activeLayout: layoutId,
            template: null
        },
        timestamps: {
            created,
            modified: null,
            used: null
        },
        quickAccess: {},
        meta,
        slides: built.slides,
        layouts: {
            [layoutId]: {
                name: options.layoutName || "Default",
                notes: "",
                slides: built.layoutSlides
            }
        },
        media: {}
    }
}
