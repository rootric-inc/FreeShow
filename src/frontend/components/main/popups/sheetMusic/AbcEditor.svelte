<script context="module" lang="ts">
    import type { AbcAnalysisResult } from "../../../slide/views/sheetMusic/abcToMei"

    export interface AbcEditorResultEvent {
        text: string
        analysis: AbcAnalysisResult | null
        userEdit: boolean
    }
</script>

<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount, tick } from "svelte"
    import type { DropdownOptions } from "../../../../../types/Input"
    import { translateText } from "../../../../utils/language"
    import Icon from "../../../helpers/Icon.svelte"
    import T from "../../../helpers/T.svelte"
    import InputRow from "../../../input/InputRow.svelte"
    import MaterialButton from "../../../inputs/MaterialButton.svelte"
    import MaterialDropdown from "../../../inputs/MaterialDropdown.svelte"
    import type { AbcProblem } from "../../../slide/views/sheetMusic/abcChecks"
    import { mergeNeighborProblems } from "../../../slide/views/sheetMusic/abcChecks"
    import type { AbcjsGlobal } from "../../../slide/views/sheetMusic/abcjs"
    import { getLoadedAbcjs, loadAbcjs } from "../../../slide/views/sheetMusic/abcjs"
    import type { AbcHeaderInfo, AbcPartsLayout } from "../../../slide/views/sheetMusic/abcSource"
    import { ABC_KEYS, ABC_METERS, adjustCursorForEdit, createAbcTemplate, insertAbcAtCursor, normalizeLineEndings, readAbcHeader, updateAbcHeaderField } from "../../../slide/views/sheetMusic/abcSource"
    import type { AbcNoteRange } from "../../../slide/views/sheetMusic/abcToMei"
    import { convertAndCheckAbc } from "../../../slide/views/sheetMusic/abcToMei"
    import { SheetMusicError, getSheetMusicErrorKey, renderMusic } from "../../../slide/views/sheetMusic/engine"
    import { calculatePageWidth, prefixSvgIds } from "../../../slide/views/sheetMusic/helpers"
    import AbcProblemList from "./AbcProblemList.svelte"
    import AbcReference from "./AbcReference.svelte"

    class AbcParserLoadError extends Error {
        constructor(cause: unknown) {
            super(cause instanceof Error ? cause.message : "Could not load ABC music parser")
            this.name = "AbcParserLoadError"
        }
    }

    export let text = ""
    export let pageWidth = calculatePageWidth(1530, undefined)
    export let hideInitialMeter = false
    export let svgIdPrefix = "sm_popup_"

    const NOTE_ID_SUFFIX_PATTERN = /^c(\d+)(?:-\d+|_\w+)?$/

    const dispatch = createEventDispatcher<{
        result: AbcEditorResultEvent
        pending: void
    }>()

    let loadedAbcjs: AbcjsGlobal | null = getLoadedAbcjs()
    let applyingProgrammaticEdit = false

    const initialHeader: AbcHeaderInfo = text.trim() ? readAbcHeader(text) : { key: "Eb", meter: "4/4", parts: "four" }
    let selectedKey = initialHeader.key
    let selectedMeter = initialHeader.meter
    let selectedParts: AbcPartsLayout = initialHeader.parts
    let confirmReplace = false

    let textareaEl: HTMLTextAreaElement | null = null
    let previewEl: HTMLDivElement | null = null
    let previewSvg = ""
    let truncated = false
    let loading = false
    let error = ""
    let hasAbcError = false
    let problems: AbcProblem[] = []
    let noteRanges: AbcNoteRange[] = []

    let requestToken = 0
    let destroyed = false
    let mounted = false
    let lastHandledText = text
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let activeController: AbortController | null = null

    function buildDropdownOptions(values: readonly string[], currentValue: string, noneLabel = ""): DropdownOptions {
        const options = values.map((value) => ({
            value,
            label: value === "none" && noneLabel ? noneLabel : value
        }))
        if (currentValue && !values.includes(currentValue)) {
            options.unshift({ value: currentValue, label: currentValue })
        }
        return options
    }

    $: keyOptions = buildDropdownOptions(ABC_KEYS, selectedKey)
    $: meterOptions = buildDropdownOptions(ABC_METERS, selectedMeter, translateText("sheet_music.meter_none"))
    const partsOptions: DropdownOptions = [
        { value: "four", label: translateText("sheet_music.parts_four") },
        { value: "two", label: translateText("sheet_music.parts_two") },
        { value: "one", label: translateText("sheet_music.parts_one") }
    ]

    $: if (mounted && text !== lastHandledText) {
        lastHandledText = text
        confirmReplace = false
        syncHeader(text)
        runConvert(text, false)
    }

    async function loadParser(): Promise<AbcjsGlobal> {
        if (loadedAbcjs) return loadedAbcjs
        try {
            const mod = await loadAbcjs()
            loadedAbcjs = mod
            return mod
        } catch (err) {
            throw new AbcParserLoadError(err)
        }
    }

    function preloadParser() {
        void loadParser().catch(() => null)
    }

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

    function setTaskError(err: unknown) {
        if (err instanceof AbcParserLoadError) {
            error = translateText("error.sheet_music_parser")
            hasAbcError = true
            return
        }
        if (!(err instanceof SheetMusicError)) {
            error = translateText("error.sheet_music_abc")
            hasAbcError = true
            return
        }
        error = translateText(getSheetMusicErrorKey(err, "render"))
        hasAbcError = true
    }

    function syncHeader(source: string) {
        if (!source.trim()) return
        const header = readAbcHeader(source)
        selectedKey = header.key
        selectedMeter = header.meter
        selectedParts = header.parts
    }

    function scheduleConvert(source: string, userEdit: boolean) {
        cancelPending()
        dispatch("pending")
        const token = ++requestToken
        debounceTimer = setTimeout(() => {
            debounceTimer = null
            if (!destroyed && token === requestToken) runConvert(source, userEdit, token)
        }, 300)
    }

    async function runConvert(source: string, userEdit: boolean, existingToken?: number) {
        if (!source.trim()) {
            cancelPending()
            requestToken++
            problems = []
            noteRanges = []
            truncated = false
            loading = false
            error = ""
            previewSvg = ""
            hasAbcError = false
            applyHighlight("")
            dispatch("result", { text: "", analysis: null, userEdit })
            return
        }

        const token = existingToken !== undefined ? existingToken : ++requestToken
        cancelPending()
        const controller = new AbortController()
        activeController = controller
        loading = true
        error = ""

        const isLive = () => !destroyed && token === requestToken
        try {
            const abcjs = await loadParser()
            if (!isLive()) return

            const normalized = normalizeLineEndings(source)
            const analysis = convertAndCheckAbc(normalized, abcjs.parseOnly, { hideInitialMeter })

            problems = mergeNeighborProblems(analysis.problems, normalized)
            noteRanges = analysis.noteRanges || []
            hasAbcError = analysis.hasError
            dispatch("result", { text: normalized, analysis, userEdit })
            if (analysis.hasError) return

            const rendered = await renderMusic(analysis.mei, pageWidth, undefined, controller.signal)
            if (!isLive()) return

            previewSvg = prefixSvgIds(rendered.svg, svgIdPrefix)
            truncated = rendered.pages > 1
            await tick()
            if (!isLive()) return
            updateHighlight()
        } catch (err) {
            if ((err instanceof SheetMusicError && err.code === "aborted") || !isLive()) return
            console.error("Sheet music popup error:", err)
            setTaskError(err)
            dispatch("result", { text: normalizeLineEndings(source), analysis: null, userEdit })
        } finally {
            if (activeController === controller) activeController = null
            if (isLive()) loading = false
        }
    }

    onMount(() => {
        mounted = true
        lastHandledText = text
        if (text.trim()) {
            syncHeader(text)
            runConvert(text, false)
        } else {
            preloadParser()
        }
    })

    onDestroy(() => {
        destroyed = true
        cancelPending()
    })

    // Apply edits via execCommand("insertText") so the textarea keeps its native Ctrl+Z undo stack
    function replaceTextareaRange(start: number, end: number, replacement: string, preventScroll = false): number {
        const clampedStart = Math.max(0, Math.min(text.length, Math.floor(start)))
        const clampedEnd = Math.max(clampedStart, Math.min(text.length, Math.floor(end)))
        const expected = text.slice(0, clampedStart) + replacement + text.slice(clampedEnd)
        const nextCursor = clampedStart + replacement.length

        if (textareaEl) {
            applyingProgrammaticEdit = true
            try {
                textareaEl.focus(preventScroll ? { preventScroll: true } : undefined)
                textareaEl.setSelectionRange(clampedStart, clampedEnd)
                const inserted = typeof document !== "undefined" && typeof document.execCommand === "function" && document.execCommand("insertText", false, replacement)
                if (inserted && textareaEl.value === expected) {
                    text = textareaEl.value
                    lastHandledText = text
                    return textareaEl.selectionStart
                }
            } finally {
                applyingProgrammaticEdit = false
            }
        }

        text = expected
        lastHandledText = text
        return nextCursor
    }

    function replaceTextareaDiff(updated: string) {
        if (updated === text) return
        let start = 0
        while (start < text.length && start < updated.length && text[start] === updated[start]) start++
        let endOld = text.length
        let endNew = updated.length
        while (endOld > start && endNew > start && text[endOld - 1] === updated[endNew - 1]) {
            endOld--
            endNew--
        }

        const replacement = updated.slice(start, endNew)
        const savedStart = textareaEl ? textareaEl.selectionStart : 0
        const savedEnd = textareaEl ? textareaEl.selectionEnd : 0
        const savedDirection = textareaEl ? textareaEl.selectionDirection : null
        const savedScrollTop = textareaEl ? textareaEl.scrollTop : 0
        const savedScrollLeft = textareaEl ? textareaEl.scrollLeft : 0
        const previousFocus = typeof document !== "undefined" ? document.activeElement : null

        replaceTextareaRange(start, endOld, replacement, true)

        if (!textareaEl) return
        const nextStart = adjustCursorForEdit(savedStart, start, endOld, replacement.length)
        const nextEnd = adjustCursorForEdit(savedEnd, start, endOld, replacement.length)
        const restoreViewport = () => {
            if (!textareaEl) return
            textareaEl.setSelectionRange(nextStart, nextEnd, savedDirection || undefined)
            textareaEl.scrollTop = savedScrollTop
            textareaEl.scrollLeft = savedScrollLeft
            if (previousFocus instanceof HTMLElement && previousFocus !== textareaEl && previousFocus.isConnected) {
                previousFocus.focus({ preventScroll: true })
            }
            updateHighlight()
        }
        restoreViewport()
        void tick().then(() => {
            if (!destroyed) restoreViewport()
        })
    }

    function changeHeader(field: "K" | "M", value: string) {
        if (field === "K") selectedKey = value
        else selectedMeter = value

        if (!text.trim()) return
        replaceTextareaDiff(updateAbcHeaderField(text, field, value))
        scheduleConvert(text, true)
    }

    function handleNewHymnClick() {
        if (text.trim()) confirmReplace = true
        else applyNewHymn()
    }

    async function applyNewHymn() {
        confirmReplace = false
        const template = createAbcTemplate({ key: selectedKey, meter: selectedMeter, parts: selectedParts })
        replaceTextareaRange(0, text.length, template)
        scheduleConvert(text, false)
        await tick()

        if (textareaEl) {
            const sopranoMarker = "[V:S] "
            const markerIndex = text.indexOf(sopranoMarker)
            const cursor = markerIndex >= 0 ? markerIndex + sopranoMarker.length : text.length
            textareaEl.focus()
            textareaEl.setSelectionRange(cursor, cursor)
        }
    }

    function handleTextInput() {
        if (applyingProgrammaticEdit) return
        lastHandledText = text
        confirmReplace = false
        syncHeader(text)
        scheduleConvert(text, true)
        updateHighlight()
    }

    async function handleInsertSnippet(event: CustomEvent<string>) {
        const snippet = event.detail
        if (!snippet) return

        const selectionStart = textareaEl ? textareaEl.selectionStart : text.length
        const selectionEnd = textareaEl ? textareaEl.selectionEnd : text.length
        const fallback = insertAbcAtCursor(text, snippet, selectionStart, selectionEnd)
        const nextCursor = textareaEl ? replaceTextareaRange(selectionStart, selectionEnd, snippet) : ((text = fallback.value), (lastHandledText = text), fallback.cursor)

        confirmReplace = false
        syncHeader(text)
        scheduleConvert(text, true)
        await tick()

        if (textareaEl) {
            textareaEl.focus()
            textareaEl.setSelectionRange(nextCursor, nextCursor)
            updateHighlight()
        }
    }

    function handleSelectProblem(event: CustomEvent<AbcProblem>) {
        const problem = event.detail
        selectRange(problem.startChar, problem.endChar)
    }

    function selectRange(startChar: number, endChar: number) {
        if (!textareaEl) return
        const start = Math.max(0, Math.min(text.length, startChar))
        const end = Math.max(start, Math.min(text.length, endChar))
        textareaEl.focus()
        textareaEl.setSelectionRange(start, end)
        updateHighlight()
    }

    function applyHighlight(noteId: string) {
        if (!previewEl) return
        previewEl.querySelectorAll(".sm-selected").forEach((element) => element.classList.remove("sm-selected"))
        const hit = noteId ? previewEl.querySelector(`#${svgIdPrefix}${noteId}`) : null
        if (hit) hit.classList.add("sm-selected")
    }

    function updateHighlight() {
        if (!textareaEl || !noteRanges.length) {
            applyHighlight("")
            return
        }
        const cursor = textareaEl.selectionStart
        const matchingRange = noteRanges.find((range) => cursor >= range.startChar && cursor <= range.endChar)
        applyHighlight(matchingRange ? matchingRange.id : "")
    }

    function handlePreviewClick(event: MouseEvent) {
        let element = event.target instanceof Element ? event.target : null
        while (element && element !== previewEl) {
            const rawId = element.getAttribute("id") || ""
            if (rawId.startsWith(svgIdPrefix)) {
                const match = NOTE_ID_SUFFIX_PATTERN.exec(rawId.slice(svgIdPrefix.length))
                if (match) {
                    const startChar = Number(match[1])
                    const noteId = `c${startChar}`
                    const matchingRange = noteRanges.find((range) => range.id === noteId)
                    const endChar = matchingRange ? matchingRange.endChar : Math.min(text.length, startChar + 1)
                    selectRange(startChar, endChar)
                    applyHighlight(noteId)
                    return
                }
            }
            element = element.parentElement
        }
    }
</script>

<slot />

<InputRow>
    <MaterialDropdown label="sheet_music.key" value={selectedKey} options={keyOptions} on:change={(e) => changeHeader("K", e.detail)} />
    <MaterialDropdown label="sheet_music.time" value={selectedMeter} options={meterOptions} on:change={(e) => changeHeader("M", e.detail)} />
    <MaterialDropdown label="sheet_music.parts" value={selectedParts} options={partsOptions} on:change={(e) => (selectedParts = e.detail)} />
    <MaterialButton variant="outlined" icon="add" on:click={handleNewHymnClick} style="flex: 0 0 auto;"><T id="sheet_music.new_hymn" /></MaterialButton>
</InputRow>

{#if confirmReplace}
    <div class="confirmBar">
        <span><T id="sheet_music.replace_confirm" /></span>
        <div class="confirmActions">
            <MaterialButton variant="outlined" small on:click={() => (confirmReplace = false)}>
                <Icon id="close" style="fill: #ff5454;" size={1.1} white />
                <T id="main.no" />
            </MaterialButton>
            <MaterialButton variant="outlined" small on:click={applyNewHymn}>
                <Icon id="check" style="fill: #b7ffac;" size={1.1} white />
                <T id="main.yes" />
            </MaterialButton>
        </div>
    </div>
{/if}

<div class="textfield">
    <div class="background" />
    <textarea bind:this={textareaEl} bind:value={text} class="input edit abcInput" rows={10} wrap="off" spellcheck={false} placeholder={translateText("sheet_music.abc_placeholder")} on:input={handleTextInput} on:click={updateHighlight} on:keyup={updateHighlight} on:select={updateHighlight} />
    <span class="underline" />
</div>

<AbcReference on:insert={handleInsertSnippet} />

<AbcProblemList {problems} on:select={handleSelectProblem} />

{#if error}
    <p class="error">{error}</p>
{/if}

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="preview" class:loading class:stale={hasAbcError && !!previewSvg} bind:this={previewEl} on:click={handlePreviewClick}>
    {#if previewSvg}
        {@html previewSvg}
    {:else if loading}
        <p class="status"><T id="remote.loading" /></p>
    {:else}
        <div class="empty"><Icon id="music" size={3} white /></div>
    {/if}
</div>

{#if truncated}
    <p class="warning"><T id="error.sheet_music_truncated" /></p>
{/if}

<style>
    .confirmBar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 6px 10px;
        border-radius: 4px;
        background-color: var(--primary-darker);
        border: 1px solid var(--secondary);
        font-size: 0.88em;
    }

    .confirmActions {
        display: flex;
        gap: 6px;
    }

    /* Matches MaterialTextarea styling while exposing the native textarea element for selection and cursor tracking */
    .textfield {
        position: relative;
        width: 100%;
        color: var(--text);
        border-bottom: 1.2px solid var(--primary-lighter);
        display: flex;
    }

    .background {
        position: absolute;
        inset: 0;
        background-color: var(--primary-darkest);
        border-radius: 4px 4px 0 0;
    }

    .abcInput {
        position: relative;
        z-index: 1;
        width: 100%;
        border: none;
        outline: none;
        background: transparent;
        padding: 0.65rem 0.75rem;
        color: var(--text);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.85em;
        line-height: 1.45;
        white-space: pre;
        overflow: auto;
        resize: vertical;
        tab-size: 4;
    }

    .abcInput::placeholder {
        color: var(--text);
        opacity: 0.35;
    }

    .underline {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 1.2px;
        width: 100%;
        background-color: var(--secondary);
        transform: scaleX(0);
        transition: transform 0.2s ease;
        transform-origin: left;
        z-index: 2;
        pointer-events: none;
    }

    .abcInput:focus ~ .underline {
        transform: scaleX(1);
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
        min-height: 200px;
        max-height: 45vh;
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
        opacity: 0.65;
    }

    .preview.stale {
        opacity: 0.4;
    }

    .preview :global(svg) {
        width: 100%;
        height: auto;
        fill: currentColor;
    }

    .preview :global(.definition-scale) {
        color: inherit;
    }

    .preview :global(.note),
    .preview :global(.chord),
    .preview :global(.rest) {
        cursor: pointer;
    }

    .preview :global(.sm-selected),
    .preview :global(.sm-selected *) {
        color: var(--secondary);
        fill: var(--secondary);
        stroke: var(--secondary);
    }

    .status {
        opacity: 0.7;
    }

    .empty {
        opacity: 0.3;
    }
</style>
