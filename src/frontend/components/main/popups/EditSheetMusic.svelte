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
    import { SheetMusicError, getSheetMusicErrorKey, loadMusic, renderMusic } from "../../slide/views/sheetMusic/engine"
    import { calculatePageWidth, decodeBase64Text, getSheetMusicData, getSheetMusicLabel, getSheetMusicSize, prefixSvgIds } from "../../slide/views/sheetMusic/helpers"

    const PICK_ID = uid()
    const CHANNEL = "SHEET_MUSIC"
    const PREVIEW_ITEM_WIDTH = 1530

    function sanitizeInitial(raw: unknown): { data?: string; label?: string; size?: number } {
        const data = getSheetMusicData(raw)
        const label = getSheetMusicLabel(raw)
        const size = getSheetMusicSize(raw)
        return {
            ...(data ? { data } : {}),
            ...(label ? { label } : {}),
            ...(size !== undefined ? { size } : {})
        }
    }

    let current: { data?: string; label?: string; size?: number } = sanitizeInitial($popupData.active)
    let previewSvg = ""
    let truncated = false
    let loading = false
    let error = ""
    let requestToken = 0
    let destroyed = false
    let activeController: AbortController | null = null

    function resetController(): AbortController {
        if (activeController) activeController.abort()
        const controller = new AbortController()
        activeController = controller
        return controller
    }

    const listenerId = receiveToMain(ToMain.OPEN_FILE2, (data) => {
        if (data.id !== PICK_ID || data.channel !== CHANNEL || !data.files?.length) return
        handleFile(data.files[0], data.content?.[data.files[0]] || "")
    })

    onDestroy(() => {
        destroyed = true
        if (activeController) {
            activeController.abort()
            activeController = null
        }
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
        const controller = resetController()
        loading = true
        error = ""
        truncated = false

        try {
            const result = await renderMusic(mei, calculatePageWidth(PREVIEW_ITEM_WIDTH, size), undefined, controller.signal)
            if (destroyed || token !== requestToken) return
            previewSvg = prefixSvgIds(result.svg, "sm_popup_")
            truncated = result.pages > 1
        } catch (err) {
            if (err instanceof SheetMusicError && err.code === "aborted") return
            if (destroyed || token !== requestToken) return
            console.error("Failed to preview sheet music:", err)
            error = translateText(getSheetMusicErrorKey(err, "render"))
        } finally {
            if (activeController === controller) activeController = null
            if (!destroyed && token === requestToken) loading = false
        }
    }

    async function handleFile(filePath: string, rawBase64: string) {
        const token = ++requestToken
        const controller = resetController()
        error = ""
        truncated = false

        if (!rawBase64) {
            error = translateText("error.sheet_music_load")
            return
        }

        loading = true

        try {
            const ext = getExtension(filePath)
            const source = ext === "mxl" ? { base64: rawBase64 } : { text: decodeBase64Text(rawBase64) }
            const loaded = await loadMusic(source, controller.signal)
            if (destroyed || token !== requestToken) return

            const rendered = await renderMusic(loaded.mei, calculatePageWidth(PREVIEW_ITEM_WIDTH, current.size), undefined, controller.signal)
            if (destroyed || token !== requestToken) return

            const label = loaded.title || removeExtension(getFileName(filePath))
            current = { ...current, data: loaded.mei, label }
            previewSvg = prefixSvgIds(rendered.svg, "sm_popup_")
            truncated = rendered.pages > 1

            if ($popupData.trigger) {
                $popupData.trigger({ ...current })
            }
        } catch (err) {
            if (err instanceof SheetMusicError && err.code === "aborted") return
            if (destroyed || token !== requestToken) return
            console.error("Failed to load sheet music file:", err)
            error = translateText(getSheetMusicErrorKey(err, "load"))
        } finally {
            if (activeController === controller) activeController = null
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

    {#if truncated}
        <p class="warning"><T id="error.sheet_music_truncated" /></p>
    {/if}
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

    .warning {
        color: #f5b942;
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
