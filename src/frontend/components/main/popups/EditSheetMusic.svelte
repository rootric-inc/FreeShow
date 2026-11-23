<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte"
    import { uid } from "uid"
    import type { DropdownOptions } from "../../../../types/Input"
    import { Main } from "../../../../types/IPC/Main"
    import { ToMain } from "../../../../types/IPC/ToMain"
    import type { TabsObj } from "../../../../types/Tabs"
    import { destroyMain, receiveToMain, sendMain } from "../../../IPC/main"
    import { popupData } from "../../../stores"
    import { translateText } from "../../../utils/language"
    import Icon from "../../helpers/Icon.svelte"
    import { getExtension, getFileName, removeExtension } from "../../helpers/media"
    import T from "../../helpers/T.svelte"
    import InputRow from "../../input/InputRow.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import MaterialDropdown from "../../inputs/MaterialDropdown.svelte"
    import type { AbcProblem } from "../../slide/views/sheetMusic/abcChecks"
    import { mergeNeighborProblems } from "../../slide/views/sheetMusic/abcChecks"
    import type { AbcjsGlobal } from "../../slide/views/sheetMusic/abcjs"
    import { getLoadedAbcjs, loadAbcjs } from "../../slide/views/sheetMusic/abcjs"
    import type { AbcHeaderInfo, AbcPartsLayout } from "../../slide/views/sheetMusic/abcSource"
    import { ABC_KEYS, ABC_METERS, adjustCursorForEdit, createAbcTemplate, insertAbcAtCursor, normalizeLineEndings, readAbcHeader, updateAbcHeaderField } from "../../slide/views/sheetMusic/abcSource"
    import type { AbcAnalysisResult, AbcNoteRange } from "../../slide/views/sheetMusic/abcToMei"
    import { convertAndCheckAbc } from "../../slide/views/sheetMusic/abcToMei"
    import { SheetMusicError, getSheetMusicErrorKey, loadMusic, renderMusic } from "../../slide/views/sheetMusic/engine"
    import { calculatePageWidth, decodeBase64Text, getSheetMusicAbc, getSheetMusicData, getSheetMusicLabel, getSheetMusicSize, prefixSvgIds } from "../../slide/views/sheetMusic/helpers"
    import Tabs from "../Tabs.svelte"
    import AbcProblemList from "./sheetMusic/AbcProblemList.svelte"
    import AbcReference from "./sheetMusic/AbcReference.svelte"

    type PopupTab = "type" | "file"

    interface SheetMusicState {
        data?: string
        abc?: string
        label?: string
        size?: number
    }

    interface TaskOptions {
        fallbackError: "load" | "render"
        isAbcTask?: boolean
        existingToken?: number
    }

    class AbcParserLoadError extends Error {
        constructor(cause: unknown) {
            super(cause instanceof Error ? cause.message : "Could not load ABC music parser")
            this.name = "AbcParserLoadError"
        }
    }

    const PICK_ID = uid()
    const CHANNEL = "SHEET_MUSIC"
    const SVG_ID_PREFIX = "sm_popup_"
    // Verovio may append a numeric or named suffix to a prefixed MEI xml:id on child note elements
    const PREVIEW_NOTE_ID_PATTERN = /^sm_popup_c(\d+)(?:-\d+|_\w+)?$/

    const onSave: ((data: SheetMusicState) => void) | undefined = $popupData.trigger

    const popupTabs: TabsObj = {
        type: { name: "sheet_music.tab_type", icon: "edit" },
        file: { name: "sheet_music.tab_file", icon: "folder" }
    }

    function readInitialState(raw: unknown): SheetMusicState {
        const state: SheetMusicState = {}
        const data = getSheetMusicData(raw)
        const abc = getSheetMusicAbc(raw)
        const label = getSheetMusicLabel(raw)
        const size = getSheetMusicSize(raw)

        if (data) state.data = data
        if (abc) state.abc = abc
        if (label) state.label = label
        if (size !== undefined) state.size = size
        return state
    }

    let current: SheetMusicState = readInitialState($popupData.active)
    let activeTab: PopupTab = current.data && !current.abc ? "file" : "type"
    let previousTab: PopupTab = activeTab

    let text = normalizeLineEndings(current.abc || "")
    let lastSavedAbc = text
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
    let previewData = ""
    let truncated = false
    let loading = false
    let error = ""
    let hasAbcError = false
    let problems: AbcProblem[] = []
    let noteRanges: AbcNoteRange[] = []

    let requestToken = 0
    let destroyed = false
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

    $: if (activeTab !== previousTab) {
        previousTab = activeTab
        handleTabChange(activeTab)
    }

    async function loadParser() {
        if (loadedAbcjs) return loadedAbcjs
        try {
            const mod = await loadAbcjs()
            loadedAbcjs = mod
            return mod
        } catch (err) {
            throw new AbcParserLoadError(err)
        }
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

    function setTaskError(err: unknown, options: TaskOptions) {
        if (err instanceof AbcParserLoadError) {
            error = translateText("error.sheet_music_parser")
            if (options.isAbcTask) hasAbcError = true
            return
        }
        if (options.isAbcTask && !(err instanceof SheetMusicError)) {
            error = translateText("error.sheet_music_abc")
            hasAbcError = true
            return
        }
        error = translateText(getSheetMusicErrorKey(err, options.fallbackError))
        if (options.isAbcTask) hasAbcError = true
    }

    async function runTask(task: (signal: AbortSignal, isLive: () => boolean) => Promise<void>, options: TaskOptions) {
        const token = options.existingToken !== undefined ? options.existingToken : ++requestToken
        cancelPending()
        const controller = new AbortController()
        activeController = controller
        loading = true
        error = ""

        const isLive = () => !destroyed && token === requestToken
        try {
            await task(controller.signal, isLive)
        } catch (err) {
            if ((err instanceof SheetMusicError && err.code === "aborted") || !isLive()) return
            console.error("Sheet music popup error:", err)
            setTaskError(err, options)
        } finally {
            if (activeController === controller) activeController = null
            if (isLive()) loading = false
        }
    }

    // Single synchronous save path used by typing, tab switches and popup close
    function saveAbc(source: string, precomputedAnalysis?: AbcAnalysisResult): void {
        if (destroyed) return
        const normalized = normalizeLineEndings(source)
        if (normalized === lastSavedAbc) return

        if (!normalized.trim()) {
            if (!current.abc) return
            const clearedState: SheetMusicState = {}
            if (current.size !== undefined) clearedState.size = current.size
            lastSavedAbc = ""
            current = clearedState
            previewSvg = ""
            previewData = ""
            truncated = false
            hasAbcError = false
            if (onSave) onSave({ ...clearedState })
            return
        }

        let analysis = precomputedAnalysis
        if (!analysis) {
            const abcjs = loadedAbcjs || getLoadedAbcjs()
            if (!abcjs) return
            loadedAbcjs = abcjs
            analysis = convertAndCheckAbc(normalized, abcjs.parseOnly)
        }
        if (!analysis.mei || analysis.hasError) return

        const nextState: SheetMusicState = {
            abc: normalized,
            data: analysis.mei
        }
        if (analysis.title) nextState.label = analysis.title
        if (current.size !== undefined) nextState.size = current.size

        lastSavedAbc = normalized
        current = nextState
        if (onSave) onSave({ ...nextState })
    }

    function flushPendingSave() {
        const normalized = normalizeLineEndings(text)
        if (normalized !== lastSavedAbc) {
            saveAbc(normalized)
        }
    }

    const listenerId = receiveToMain(ToMain.OPEN_FILE2, (data) => {
        if (destroyed || data.id !== PICK_ID || data.channel !== CHANNEL || !data.files || !data.files.length) return
        const filePath = data.files[0]
        const rawBase64 = (data.content && data.content[filePath]) || ""
        handleFile(filePath, rawBase64)
    })

    function preloadParser() {
        void loadParser().catch(() => null)
    }

    onMount(() => {
        if (activeTab === "type") {
            if (text.trim()) runConvert(text, false)
            else preloadParser()
        } else if (activeTab === "file" && current.data) {
            renderFilePreview(current.data)
        }
    })

    onDestroy(() => {
        cancelPending()
        flushPendingSave()
        destroyed = true
        destroyMain(listenerId)
    })

    function handleTabChange(tab: PopupTab) {
        cancelPending()
        requestToken++
        loading = false
        error = ""
        confirmReplace = false

        if (tab === "file") {
            flushPendingSave()
            applyHighlight("")
            if (current.data) {
                if (current.data !== previewData || !previewSvg) renderFilePreview(current.data)
            } else {
                previewSvg = ""
                previewData = ""
                truncated = false
            }
            return
        }

        if (text.trim()) {
            syncHeader(text)
            runConvert(text, false)
        } else {
            previewSvg = ""
            previewData = ""
            problems = []
            noteRanges = []
            hasAbcError = false
            truncated = false
            preloadParser()
        }
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

    function renderMei(mei: string, signal: AbortSignal) {
        return renderMusic(mei, calculatePageWidth(1530, current.size), undefined, signal)
    }

    function renderFilePreview(mei: string) {
        truncated = false
        runTask(
            async (signal, isLive) => {
                const rendered = await renderMei(mei, signal)
                if (!isLive()) return
                previewData = mei
                previewSvg = prefixSvgIds(rendered.svg, SVG_ID_PREFIX)
                truncated = rendered.pages > 1
            },
            { fallbackError: "render" }
        )
    }

    function handleFile(filePath: string, rawBase64: string) {
        if (destroyed) return
        truncated = false
        if (!rawBase64) {
            error = translateText("error.sheet_music_load")
            return
        }

        runTask(
            async (signal, isLive) => {
                const source = getExtension(filePath) === "mxl" ? { base64: rawBase64 } : { text: decodeBase64Text(rawBase64) }
                const loaded = await loadMusic(source, signal)
                if (!isLive()) return

                const rendered = await renderMei(loaded.mei, signal)
                if (!isLive()) return

                const nextState: SheetMusicState = {
                    data: loaded.mei,
                    label: loaded.title || removeExtension(getFileName(filePath))
                }
                if (current.size !== undefined) nextState.size = current.size

                lastSavedAbc = ""
                text = ""
                current = nextState
                previewData = loaded.mei
                previewSvg = prefixSvgIds(rendered.svg, SVG_ID_PREFIX)
                truncated = rendered.pages > 1

                if (!destroyed && onSave) onSave({ ...current })
            },
            { fallbackError: "load" }
        )
    }

    function syncHeader(source: string) {
        if (!source.trim()) return
        const header = readAbcHeader(source)
        selectedKey = header.key
        selectedMeter = header.meter
        selectedParts = header.parts
    }

    function scheduleConvert(source: string, shouldSave: boolean) {
        cancelPending()
        const token = ++requestToken
        debounceTimer = setTimeout(() => {
            debounceTimer = null
            if (!destroyed && token === requestToken) runConvert(source, shouldSave, token)
        }, 300)
    }

    function runConvert(source: string, shouldSave: boolean, existingToken?: number) {
        if (!source.trim()) {
            cancelPending()
            problems = []
            noteRanges = []
            truncated = false
            loading = false
            applyHighlight("")
            if (shouldSave) saveAbc(source)
            hasAbcError = Boolean(previewSvg)
            return
        }

        runTask(
            async (signal, isLive) => {
                const abcjs = await loadParser()
                if (!isLive()) return

                const normalized = normalizeLineEndings(source)
                const analysis = convertAndCheckAbc(normalized, abcjs.parseOnly)

                problems = mergeNeighborProblems(analysis.problems, normalized)
                noteRanges = analysis.noteRanges || []
                hasAbcError = analysis.hasError
                if (analysis.hasError) return

                if (shouldSave) {
                    saveAbc(normalized, analysis)
                }

                const rendered = await renderMei(analysis.mei, signal)
                if (!isLive()) return

                previewSvg = prefixSvgIds(rendered.svg, SVG_ID_PREFIX)
                previewData = analysis.mei
                truncated = rendered.pages > 1
                await tick()
                if (!isLive()) return
                updateHighlight()
            },
            { fallbackError: "render", isAbcTask: true, existingToken }
        )
    }

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
                    return textareaEl.selectionStart
                }
            } finally {
                applyingProgrammaticEdit = false
            }
        }

        text = expected
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
        const nextCursor = textareaEl ? replaceTextareaRange(selectionStart, selectionEnd, snippet) : ((text = fallback.value), fallback.cursor)

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
        const hit = noteId ? previewEl.querySelector(`#${SVG_ID_PREFIX}${noteId}`) : null
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
        if (activeTab !== "type") return
        let element = event.target instanceof Element ? event.target : null
        while (element && element !== previewEl) {
            const match = PREVIEW_NOTE_ID_PATTERN.exec(element.getAttribute("id") || "")
            if (match) {
                const startChar = Number(match[1])
                const noteId = `c${startChar}`
                const matchingRange = noteRanges.find((range) => range.id === noteId)
                const endChar = matchingRange ? matchingRange.endChar : Math.min(text.length, startChar + 1)
                selectRange(startChar, endChar)
                applyHighlight(noteId)
                return
            }
            element = element.parentElement
        }
    }
</script>

<div class="sheetMusicPopup">
    <Tabs tabs={popupTabs} bind:active={activeTab} labels style="font-weight: normal;" />

    {#if activeTab === "type"}
        {#if current.data && !current.abc && !text.trim()}
            <p class="notice"><T id="sheet_music.type_replaces_file" /></p>
        {/if}

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
    {:else}
        <InputRow>
            <MaterialButton variant="outlined" icon="music" disabled={loading} on:click={openFile} style="flex: 1;"><T id="actions.open_file" /></MaterialButton>
        </InputRow>

        {#if current.label}
            <p class="label">{current.label}</p>
        {/if}
    {/if}

    {#if error}
        <p class="error">{error}</p>
    {/if}

    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="preview" class:loading class:stale={activeTab === "type" && hasAbcError && !!previewSvg} bind:this={previewEl} on:click={handlePreviewClick}>
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
</div>

<style>
    .sheetMusicPopup {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: min(820px, calc(100vw - (var(--navigation-width) + 20px) * 2));
        min-width: 460px;
    }

    .notice {
        font-size: 0.85em;
        opacity: 0.8;
        padding: 6px 10px;
        border-radius: 4px;
        background-color: var(--primary-darker);
    }

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

    .label {
        font-size: 0.95em;
        opacity: 0.85;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
