import { get } from "svelte/store"
import { uid } from "uid"
import type { Chords, Item, Show, Slide } from "../../../../types/Show"
import { activeFocus, activeShow, focusMode, selected, showsCache } from "../../../stores"
import { transposeText } from "../../../utils/chordTranspose"
import { clone } from "../../helpers/array"
import { history } from "../../helpers/history"
import { _show } from "../../helpers/shows"
import { stepSheetMusicTranspose } from "../../slide/views/sheetMusic/helpers"
import { keys } from "../values/chords"

export function createChord(pos: number, key: string, id: string = uid(5)): Chords {
    return { id, pos, key }
}

export function addChords(item: Item, showRef, itemIndex, line = 0, pos = 0, key = keys[0]) {
    const newLines = clone(item.lines || [])
    if (!newLines[line].chords) newLines[line].chords = []
    const id = uid(5)

    // get first empty
    newLines[line]
        .chords!.sort((a, b) => a.pos - b.pos)
        .forEach((chord) => {
            if (chord.pos === pos) pos++
        })

    newLines[line].chords!.push(createChord(pos, key || keys[0], id))

    _show(showRef.showId)
        .slides([showRef.id])
        .items([itemIndex])
        .set({ key: "lines", values: [newLines] })

    selected.set({ id: "chord", data: [{ chord: { id }, index: line, slideId: showRef.id, itemIndex }] })
}

// get all chords in a textbox
export function loadChords(item: Item) {
    const chordsList: string[] = []
    if (!item) return chordsList

    item.lines?.forEach((line) => {
        line.chords?.forEach((chord) => {
            chordsList.push(chord.key)
        })
    })

    return chordsList
}

// get a list of all chords used in a slide
export function getSlideChords(slide: Slide) {
    if (!slide?.items?.length) return []
    return slide.items.reduce((value: string[], item) => [...value, ...loadChords(item)], [])
}

// get a list of unique chords used in a slide
export function getUsedChords(slide: Slide) {
    const chords = getSlideChords(slide)
    if (!chords.length) return []
    return [...new Set(chords)].sort((a, b) => a?.localeCompare(b))
}

// get a list of unique chords used in a show
export function getShowChords(show: Show | null | undefined) {
    if (!show?.slides) return []
    const chords = Object.values(show.slides).flatMap(getSlideChords)
    if (!chords.length) return []
    return [...new Set(chords)].sort((a, b) => a?.localeCompare(b))
}

export function transposeSlides(slides: { [key: string]: Slide }, step: number): { slides: { [key: string]: Slide }; changed: boolean } {
    const nextSlides: { [key: string]: Slide } = clone(slides || {})
    if (!step) return { slides: nextSlides, changed: false }

    let changed = false

    for (const slide of Object.values(nextSlides)) {
        if (!slide?.items?.length) continue
        for (const item of slide.items) {
            if (!item) continue
            if (item.type === "sheet_music") {
                const nextTranspose = stepSheetMusicTranspose(item.sheet_music?.transpose, step)
                if (nextTranspose !== item.sheet_music?.transpose) {
                    if (!item.sheet_music) item.sheet_music = {}
                    item.sheet_music.transpose = nextTranspose
                    changed = true
                }
                continue
            }

            if (!item.lines?.length) continue
            for (const line of item.lines) {
                if (!line?.chords?.length) continue
                for (const chord of line.chords) {
                    if (!chord?.key) continue
                    const nextKey = transposeText("[" + chord.key + "]", step).slice(1, -1)
                    if (nextKey !== chord.key) {
                        chord.key = nextKey
                        changed = true
                    }
                }
            }
        }
    }

    return { slides: nextSlides, changed }
}

function resolveShowId(showId = ""): string {
    if (showId && showId !== "active") return showId
    if (get(focusMode) && get(showsCache)[get(activeFocus).id]) return get(activeFocus).id
    return get(activeShow)?.id || ""
}

export function transposeShow(showId = "", step = 0): boolean {
    const targetShowId = resolveShowId(showId)
    if (!targetShowId || !step) return false

    const show: Show | undefined = get(showsCache)[targetShowId]
    if (!show?.slides || show.locked) return false

    const { slides, changed } = transposeSlides(show.slides, step)
    if (!changed) return false

    history({ id: "UPDATE", newData: { key: "slides", data: slides }, oldData: { id: targetShowId }, location: { page: "show", id: "show_key" } })
    return true
}

// IMPORT CHORD TEXT LINES

export function isChordLine(text: string) {
    const words = text.trim().split(/\s+/)
    return words.every((word) => /^[A-G][#b]?m?\d?(7|9|13)?$/.test(word))
    // text.trim().match(/^[A-G][#b]?m?\d?7?\s+.*$/)
}

export function parseChordLine(text: string) {
    const chords: Chords[] = []
    let chordStart = -1

    for (let i = 0; i <= text.length; i++) {
        const char = text[i]

        if (char !== " " && chordStart === -1) {
            chordStart = i
        } else if ((char === " " || i === text.length) && chordStart !== -1) {
            chords.push({ id: uid(5), key: text.slice(chordStart, i), pos: chordStart })
            chordStart = -1
        }
    }

    return chords
}
