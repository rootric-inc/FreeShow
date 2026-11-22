<script lang="ts">
    import { onDestroy } from "svelte"
    import { uid } from "uid"
    import { Main } from "../../../../types/IPC/Main"
    import { ToMain } from "../../../../types/IPC/ToMain"
    import { destroyMain, receiveToMain, sendMain } from "../../../IPC/main"
    import { popupData } from "../../../stores"
    import { translateText } from "../../../utils/language"
    import Icon from "../../helpers/Icon.svelte"
    import { getExtension, getFileName, removeExtension } from "../../helpers/media"
    import T from "../../helpers/T.svelte"
    import InputRow from "../../input/InputRow.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import { loadMusic, renderMusic } from "../../slide/views/sheetMusic/engine"
    import { calculatePageWidth, decodeBase64ToUtf8, prefixSvgIds } from "../../slide/views/sheetMusic/helpers"

    const PICK_ID = uid()
    const CHANNEL = "SHEET_MUSIC"
    const PREVIEW_ITEM_WIDTH = 1530

    let current: { data?: string; label?: string; size?: number } = $popupData.active && typeof $popupData.active === "object" ? { ...$popupData.active } : {}
    let previewSvg = ""
    let loading = false
    let error = ""
    let requestToken = 0
    let destroyed = false

    const listenerId = receiveToMain(ToMain.OPEN_FILE2, (data) => {
        if (data.id !== PICK_ID || data.channel !== CHANNEL || !data.files?.length) return
        handleFile(data.files[0], data.content?.[data.files[0]] || "")
    })

    onDestroy(() => {
        destroyed = true
        destroyMain(listenerId)
    })

    if (current.data) {
        renderPreview(current.data, current.size)
    }

    function openFile() {
        if (loading) return

        sendMain(Main.OPEN_FILE, {
            channel: CHANNEL,
            id: PICK_ID,
            filter: { name: translateText("items.sheet_music"), extensions: ["musicxml", "xml", "mxl", "mei"] },
            multiple: false,
            read: "base64"
        })
    }

    async function renderPreview(mei: string, size: number | undefined) {
        const token = ++requestToken
        loading = true
        error = ""

        try {
            const svg = await renderMusic(mei, calculatePageWidth(PREVIEW_ITEM_WIDTH, size))
            if (destroyed || token !== requestToken) return
            previewSvg = prefixSvgIds(svg, "sm_popup_")
        } catch (err) {
            if (destroyed || token !== requestToken) return
            console.error("Failed to preview sheet music:", err)
            error = err instanceof Error && err.message ? err.message : translateText("error.sheet_music_load")
        } finally {
            if (!destroyed && token === requestToken) loading = false
        }
    }

    async function handleFile(filePath: string, rawBase64: string) {
        const token = ++requestToken
        error = ""

        if (!rawBase64) {
            error = translateText("error.sheet_music_load")
            return
        }

        loading = true

        try {
            const ext = getExtension(filePath)
            const source = ext === "mxl" ? { base64: rawBase64 } : { text: decodeBase64ToUtf8(rawBase64) }
            const loaded = await loadMusic(source)
            if (destroyed || token !== requestToken) return

            const svg = await renderMusic(loaded.mei, calculatePageWidth(PREVIEW_ITEM_WIDTH, current.size))
            if (destroyed || token !== requestToken) return

            const label = loaded.title || removeExtension(getFileName(filePath))
            current = { ...current, data: loaded.mei, label }
            previewSvg = prefixSvgIds(svg, "sm_popup_")

            if ($popupData.trigger) {
                $popupData.trigger({ ...current })
            }
        } catch (err) {
            if (destroyed || token !== requestToken) return
            console.error("Failed to load sheet music file:", err)
            error = err instanceof Error && err.message ? err.message : translateText("error.sheet_music_load")
        } finally {
            if (!destroyed && token === requestToken) loading = false
        }
    }
</script>

<div class="sheetMusicPopup">
    <InputRow>
        <MaterialButton variant="outlined" icon="music" disabled={loading} on:click={openFile} style="flex: 1;">
            <T id="actions.open_file" />
        </MaterialButton>
    </InputRow>

    {#if current.label}
        <p class="label">{current.label}</p>
    {/if}

    {#if error}
        <p class="error">{error}</p>
    {/if}

    <div class="preview" class:loading>
        {#if previewSvg}
            {@html previewSvg}
        {:else if loading}
            <p class="status"><T id="remote.loading" /></p>
        {:else}
            <div class="empty">
                <Icon id="music" size={3} white />
            </div>
        {/if}
    </div>
</div>

<style>
    .sheetMusicPopup {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: min(760px, calc(100vw - (var(--navigation-width) + 20px) * 2));
        min-width: 420px;
    }

    .label {
        font-size: 0.95em;
        opacity: 0.85;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .error {
        color: #ff6b6b;
        font-size: 0.9em;
    }

    .preview {
        min-height: 220px;
        max-height: 55vh;
        overflow: auto;
        padding: 12px;
        border-radius: 6px;
        background-color: var(--primary-darkest);
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .preview.loading {
        opacity: 0.6;
    }

    .preview :global(svg) {
        width: 100%;
        height: auto;
        fill: currentColor;
    }

    .preview :global(.definition-scale) {
        color: inherit;
    }

    .status {
        opacity: 0.7;
    }

    .empty {
        opacity: 0.3;
    }
</style>
