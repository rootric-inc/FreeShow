<script context="module" lang="ts">
    let nextInstanceId = 0
</script>

<script lang="ts">
    import { onDestroy } from "svelte"
    import type { Item } from "../../../../types/Show"
    import Icon from "../../helpers/Icon.svelte"
    import T from "../../helpers/T.svelte"
    import { SheetMusicError, renderMusic } from "./sheetMusic/engine"
    import { createRenderCacheKey, getItemRatioFromStyle, getPageWidthFromStyle, getSheetMusicCustomParts, getSheetMusicData, getSheetMusicParts, getSheetMusicSize, getSheetMusicVerses, prefixSvgIds } from "./sheetMusic/helpers"
    import type { SheetMusicPartsPreset } from "./sheetMusic/helpers"
    import { filterMei, summarizeMei } from "./sheetMusic/meiParts"
    import type { MeiSummary } from "./sheetMusic/meiParts"
    import { resolvePartsSelection, resolveVersesSelection } from "./sheetMusic/parts"

    export let item: Item
    export let edit = false
    export let isOutput = false

    const RESIZE_DEBOUNCE_MS = 150
    const instancePrefix = `sm${++nextInstanceId}_`

    let svg = ""
    let hasRendered = false
    let truncated = false
    let renderError = false
    let renderToken = 0
    let destroyed = false
    let lastData = ""
    let lastKey = ""
    let lastSummaryData = ""
    let cachedSummary: MeiSummary | null = null
    let lastFilterData = ""
    let lastFilterParts: SheetMusicPartsPreset | undefined = undefined
    let lastFilterCustomKey = ""
    let lastFilterVerses = ""
    let filteredMei = ""
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let activeController: AbortController | null = null

    function cancelPending() {
        if (debounceTimer !== null) {
            clearTimeout(debounceTimer)
            debounceTimer = null
        }
        if (activeController) {
            activeController.abort()
            activeController = null
        }
    }

    onDestroy(() => {
        destroyed = true
        cancelPending()
    })

    function getFilteredMei(rawMei: string, partsPreset: SheetMusicPartsPreset | undefined, customParts: string[] | undefined, customKey: string, versesRaw: string): string {
        if (!rawMei) return ""
        if ((!partsPreset || partsPreset === "all") && !versesRaw) return rawMei

        if (rawMei === lastFilterData && partsPreset === lastFilterParts && customKey === lastFilterCustomKey && versesRaw === lastFilterVerses) {
            return filteredMei
        }

        if (rawMei !== lastSummaryData || !cachedSummary) {
            lastSummaryData = rawMei
            cachedSummary = summarizeMei(rawMei)
        }

        const resolvedParts = resolvePartsSelection(partsPreset, customParts, cachedSummary)
        const resolvedVerses = resolveVersesSelection(versesRaw, cachedSummary.verses)
        const result = filterMei(rawMei, {
            parts: resolvedParts.parts,
            verses: resolvedVerses,
            highestNoteOnly: resolvedParts.highestNoteOnly
        })

        lastFilterData = rawMei
        lastFilterParts = partsPreset
        lastFilterCustomKey = customKey
        lastFilterVerses = versesRaw
        filteredMei = result
        return result
    }

    $: data = getSheetMusicData(item?.sheet_music)
    $: partsPreset = getSheetMusicParts(item?.sheet_music)
    $: customParts = getSheetMusicCustomParts(item?.sheet_music)
    $: customPartsKey = customParts ? customParts.join(",") : ""
    $: versesRaw = getSheetMusicVerses(item?.sheet_music)
    $: displayMei = getFilteredMei(data, partsPreset, customParts, customPartsKey, versesRaw)
    $: pageWidth = getPageWidthFromStyle(item?.style, getSheetMusicSize(item?.sheet_music))
    $: ratio = getItemRatioFromStyle(item?.style)
    $: scheduleRender(displayMei, pageWidth, ratio)

    function scheduleRender(mei: string, width: number, boxRatio: number) {
        const musicChanged = mei !== lastData
        const key = mei ? createRenderCacheKey(mei, width, boxRatio) : ""

        if (musicChanged) {
            lastData = mei
            svg = ""
            hasRendered = false
            truncated = false
            renderError = false
        } else if (key === lastKey) {
            return
        }

        lastKey = key
        cancelPending()

        if (!mei) {
            renderToken++
            return
        }

        const token = ++renderToken
        if (musicChanged || (!svg && !hasRendered && !renderError)) {
            runRender(mei, width, boxRatio, token)
            return
        }

        debounceTimer = setTimeout(() => {
            debounceTimer = null
            if (destroyed || token !== renderToken) return
            runRender(mei, width, boxRatio, token)
        }, RESIZE_DEBOUNCE_MS)
    }

    async function runRender(mei: string, width: number, boxRatio: number, token: number) {
        const controller = new AbortController()
        activeController = controller

        try {
            const result = await renderMusic(mei, width, boxRatio, controller.signal)
            if (destroyed || token !== renderToken) return

            svg = prefixSvgIds(result.svg, instancePrefix)
            truncated = !result.fits || result.pages > 1 || result.scale < 0.5
            hasRendered = true
            renderError = false
        } catch (err) {
            if (err instanceof SheetMusicError && err.code === "aborted") return
            if (destroyed || token !== renderToken) return

            console.error("Failed to render sheet music:", err)
            svg = ""
            truncated = false
            hasRendered = false
            renderError = true
        } finally {
            if (activeController === controller) activeController = null
        }
    }
</script>

<div class="sheetMusic" class:pending={isOutput && !!data && !hasRendered}>
    {#if svg}
        <div class="score">
            {@html svg}
        </div>
        {#if edit && !isOutput && truncated}
            <div class="truncatedBadge">
                <Icon id="warning" size={0.9} white />
                <span><T id="error.sheet_music_truncated" /></span>
            </div>
        {/if}
    {:else if edit}
        <div class="emptySheetMusic">
            <div class="emptyIcon">
                <Icon id="music" size={renderError ? 2.5 : 4} white />
            </div>
            {#if renderError}
                <p class="errorMessage"><T id="error.sheet_music_render" /></p>
            {/if}
        </div>
    {/if}
</div>

<style>
    .sheetMusic {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    }

    .sheetMusic.pending {
        opacity: 0;
    }

    .score {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .score :global(svg) {
        width: 100%;
        height: 100%;
        fill: currentColor;
    }

    .score :global(.definition-scale) {
        color: inherit;
    }

    .truncatedBadge {
        position: absolute;
        bottom: 8px;
        right: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 4px;
        background-color: rgba(0, 0, 0, 0.78);
        color: #f5b942;
        font-size: 16px;
        line-height: 1.2;
        pointer-events: none;
    }

    .emptySheetMusic {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 12px;
        text-align: center;
    }

    .emptyIcon {
        opacity: 0.3;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .errorMessage {
        font-size: 20px;
        line-height: 1.3;
        opacity: 0.8;
    }
</style>
