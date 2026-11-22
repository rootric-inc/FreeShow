<script context="module" lang="ts">
    let nextInstanceId = 0
</script>

<script lang="ts">
    import { onDestroy } from "svelte"
    import type { Item } from "../../../../types/Show"
    import Icon from "../../helpers/Icon.svelte"
    import { renderMusic } from "./sheetMusic/engine"
    import { getPageWidthFromStyle, prefixSvgIds } from "./sheetMusic/helpers"

    export let item: Item
    export let edit = false
    export let isOutput = false

    const instancePrefix = `sm${++nextInstanceId}_`

    let svg = ""
    let hasRendered = false
    let renderToken = 0
    let destroyed = false

    onDestroy(() => {
        destroyed = true
    })

    $: data = item?.sheet_music?.data || ""
    $: pageWidth = getPageWidthFromStyle(item?.style, item?.sheet_music?.size)
    $: updateSvg(data, pageWidth)

    async function updateSvg(mei: string, width: number) {
        const token = ++renderToken
        if (!mei) {
            svg = ""
            hasRendered = false
            return
        }

        try {
            const rawSvg = await renderMusic(mei, width)
            if (destroyed || token !== renderToken) return

            svg = prefixSvgIds(rawSvg, instancePrefix)
            hasRendered = true
        } catch (err) {
            if (destroyed || token !== renderToken) return

            console.error("Failed to render sheet music:", err)
            svg = ""
            hasRendered = false
        }
    }
</script>

<div class="sheetMusic" class:pending={isOutput && !!data && !hasRendered}>
    {#if svg}
        {@html svg}
    {:else if edit}
        <div class="emptySheetMusic">
            <Icon id="music" white />
        </div>
    {/if}
</div>

<style>
    .sheetMusic {
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

    .sheetMusic :global(svg) {
        width: 100%;
        height: 100%;
        fill: currentColor;
    }

    .sheetMusic :global(.definition-scale) {
        color: inherit;
    }

    .emptySheetMusic {
        width: 100%;
        height: 100%;
        opacity: 0.3;
    }
</style>
