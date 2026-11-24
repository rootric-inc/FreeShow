<script lang="ts">
    import { onDestroy } from "svelte"
    import { get } from "svelte/store"
    import { uid } from "uid"
    import type { DropdownOptions } from "../../../../types/Input"
    import { Main } from "../../../../types/IPC/Main"
    import { ToMain } from "../../../../types/IPC/ToMain"
    import type { TabsObj } from "../../../../types/Tabs"
    import { setTempShows } from "../../../converters/importHelpers"
    import type { SheetMusicImportParts, SheetMusicImportSlide, SheetMusicMetadata, SheetMusicVerseMode, SheetMusicWordsSize } from "../../../converters/sheetMusic"
    import { SHEET_MUSIC_ITEM_STYLE, buildSheetMusicShow, getFirstSlideVerses, getImportLyricSize } from "../../../converters/sheetMusic"
    import { destroyMain, receiveToMain, sendMain } from "../../../IPC/main"
    import { drawerTabsData } from "../../../stores"
    import { translateText } from "../../../utils/language"
    import Icon from "../../helpers/Icon.svelte"
    import { getExtension, getFileName, removeExtension } from "../../helpers/media"
    import { checkName } from "../../helpers/show"
    import T from "../../helpers/T.svelte"
    import InputRow from "../../input/InputRow.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import MaterialDropdown from "../../inputs/MaterialDropdown.svelte"
    import { getLoadedAbcjs } from "../../slide/views/sheetMusic/abcjs"
    import type { AbcSystemSlice } from "../../slide/views/sheetMusic/abcSlice"
    import { extractAbcMetadata, extractAbcTextVerses, sliceAbcIntoSystems } from "../../slide/views/sheetMusic/abcSlice"
    import type { AbcPartsLayout } from "../../slide/views/sheetMusic/abcSource"
    import { normalizeLineEndings } from "../../slide/views/sheetMusic/abcSource"
    import type { AbcAnalysisResult } from "../../slide/views/sheetMusic/abcToMei"
    import { SheetMusicError, getSheetMusicErrorKey, loadMusic, renderMusic, sliceMusic } from "../../slide/views/sheetMusic/engine"
    import { MAX_NOTATION_SIZE, decodeBase64Text, getItemRatioFromStyle, getPageWidthFromStyle, prefixSvgIds } from "../../slide/views/sheetMusic/helpers"
    import { filterMei, getMeasureNumbers, summarizeMei } from "../../slide/views/sheetMusic/meiParts"
    import type { MeasureSliceRange, SheetMusicSlideGrouping } from "../../slide/views/sheetMusic/meiRead"
    import { extractKeyFromMei, getFileSlideRanges, hasMeiLineBreaks } from "../../slide/views/sheetMusic/meiRead"
    import { formatMeasureRange, resolvePartsSelection, resolveVersesSelection } from "../../slide/views/sheetMusic/parts"
    import Tabs from "../Tabs.svelte"
    import AbcEditor from "./sheetMusic/AbcEditor.svelte"
    import type { AbcEditorResultEvent } from "./sheetMusic/AbcEditor.svelte"

    type ImportTab = "type" | "file"

    const PICK_ID = uid()
    const CHANNEL = "IMPORT_SHEET_MUSIC"
    const FIRST_SLIDE_SVG_PREFIX = "sm_import_first_"
    const FIRST_SLIDE_PAGE_WIDTH = getPageWidthFromStyle(SHEET_MUSIC_ITEM_STYLE, MAX_NOTATION_SIZE)
    const FIRST_SLIDE_RATIO = getItemRatioFromStyle(SHEET_MUSIC_ITEM_STYLE)

    $: popupTabs = {
        type: { name: "sheet_music.tab_type_or_paste", icon: "edit", disabled: importing },
        file: { name: "sheet_music.tab_file", icon: "folder", disabled: importing }
    } as TabsObj

    const partsOptions: DropdownOptions = [
        { value: "all", label: translateText("sheet_music.parts_all") },
        { value: "upper", label: translateText("sheet_music.parts_upper") },
        { value: "lower", label: translateText("sheet_music.parts_lower") },
        { value: "melody", label: translateText("sheet_music.parts_melody") }
    ]

    const versesOptions: DropdownOptions = [
        { value: "per_verse", label: translateText("sheet_music.import_verses_per_group") },
        { value: "all", label: translateText("sheet_music.import_verses_all") }
    ]

    const wordsOptions: DropdownOptions = [
        { value: "large", label: translateText("sheet_music.import_words_large") },
        { value: "normal", label: translateText("sheet_music.import_words_normal") }
    ]

    let activeTab: ImportTab = "type"
    let text = ""
    let abcKey = "Eb"
    let abcMeter = "4/4"
    let abcParts: AbcPartsLayout = "four"
    let abcFileName = ""
    let abcAnalysis: AbcAnalysisResult | null = null
    let abcSlices: AbcSystemSlice[] = []
    let abcVerses: number[] = []
    let abcTextVerses: string[][] = []
    let abcPending = false

    let openedFileMei = ""
    let openedFileTitle = ""
    let openedFileComposer = ""
    let openedFileLyricist = ""
    let openedFileCopyright = ""
    let openedFileName = ""
    let openedFileMeasures = 0
    let openedFileVerses: number[] = []
    let fileHasLineBreaks = false
    let loadingFile = false
    let fileError = ""

    let selectedParts: SheetMusicImportParts = "all"
    let verseMode: SheetMusicVerseMode = "all"
    let verseModeTouched = false
    let selectedWords: SheetMusicWordsSize = "large"
    let slideGrouping: SheetMusicSlideGrouping = "4"

    let firstSlidePreviewSvg = ""
    let firstSlidePreviewLoading = false
    let firstSlidePreviewError = ""
    let importing = false
    let importError = ""

    let destroyed = false
    let fileRequestToken = 0
    let fileController: AbortController | null = null
    let previewRequestToken = 0
    let previewController: AbortController | null = null
    let importController: AbortController | null = null
    const slicedRangeCache = new Map<string, string>()

    $: slideOptions = buildSlideOptions(fileHasLineBreaks)
    $: fileRanges = openedFileMei ? getFileSlideRanges(openedFileMei, openedFileMeasures, slideGrouping) : []

    $: hasValidAbc = Boolean(abcAnalysis && !abcAnalysis.hasError && !abcPending && abcSlices.length > 0 && abcSlices.every((slice) => !slice.analysis.hasError && Boolean(slice.analysis.mei)))
    $: hasValidFile = Boolean(openedFileMei && !loadingFile && fileRanges.length > 0)
    $: hasValidMusic = activeTab === "type" ? hasValidAbc : hasValidFile
    $: activeVerses = activeTab === "type" ? (hasValidAbc ? abcVerses : []) : hasValidFile ? openedFileVerses : []
    $: activeTextVerses = activeTab === "type" && hasValidAbc ? abcTextVerses : []
    $: slidesPerGroup = activeTab === "type" ? (hasValidAbc ? abcSlices.length : 0) : hasValidFile ? fileRanges.length : 0
    $: notationGroupCount = hasValidMusic ? (verseMode === "per_verse" && activeVerses.length > 1 ? activeVerses.length : 1) : 0
    $: effectiveGroupCount = hasValidMusic ? notationGroupCount + activeTextVerses.length : 0
    $: totalSlideCount = hasValidMusic ? slidesPerGroup * notationGroupCount + activeTextVerses.length : 0

    $: if (!verseModeTouched && hasValidMusic) {
        verseMode = activeVerses.length > 1 ? "per_verse" : "all"
    }

    $: firstSlideVerses = getFirstSlideVerses(verseMode, activeVerses)

    $: updateFirstSlidePreview(activeTab, hasValidAbc ? abcSlices[0]?.analysis.mei || "" : "", hasValidFile ? openedFileMei : "", hasValidFile ? fileRanges[0] || null : null, selectedParts, firstSlideVerses, selectedWords)

    function buildSlideOptions(includeBreaks: boolean): DropdownOptions {
        const options: DropdownOptions = []
        if (includeBreaks) {
            options.push({ value: "breaks", label: translateText("sheet_music.import_slides_breaks") })
        }
        options.push({ value: "2", label: translateText("sheet_music.import_slides_measures", null, ["2"]) }, { value: "4", label: translateText("sheet_music.import_slides_measures", null, ["4"]) }, { value: "8", label: translateText("sheet_music.import_slides_measures", null, ["8"]) })
        return options
    }

    function cancelFileLoad() {
        if (fileController) {
            fileController.abort()
            fileController = null
        }
    }

    function cancelFirstSlidePreview() {
        if (previewController) {
            previewController.abort()
            previewController = null
        }
    }

    function cancelImport() {
        if (importController) {
            importController.abort()
            importController = null
        }
    }

    const listenerId = receiveToMain(ToMain.OPEN_FILE2, (data) => {
        if (destroyed || data.id !== PICK_ID || data.channel !== CHANNEL || !data.files || !data.files.length) return
        const filePath = data.files[0]
        const rawBase64 = (data.content && data.content[filePath]) || ""
        handleFile(filePath, rawBase64)
    })

    onDestroy(() => {
        destroyed = true
        cancelFileLoad()
        cancelFirstSlidePreview()
        cancelImport()
        destroyMain(listenerId)
    })

    function openFile() {
        if (loadingFile || importing) return
        sendMain(Main.OPEN_FILE, {
            channel: CHANNEL,
            id: PICK_ID,
            filter: { name: translateText("items.sheet_music"), extensions: ["musicxml", "xml", "mxl", "mei", "abc"] },
            multiple: false,
            read: "base64"
        })
    }

    function clearOpenedFile() {
        openedFileMei = ""
        openedFileTitle = ""
        openedFileComposer = ""
        openedFileLyricist = ""
        openedFileCopyright = ""
        openedFileName = ""
        openedFileMeasures = 0
        openedFileVerses = []
        fileHasLineBreaks = false
        fileError = ""
        slicedRangeCache.clear()
    }

    function handleAbcPending() {
        abcPending = true
        importError = ""
    }

    function handleAbcResult(event: CustomEvent<AbcEditorResultEvent>) {
        abcPending = false
        importError = ""
        const { text: convertedText, analysis } = event.detail
        abcAnalysis = analysis

        if (!convertedText.trim() || !analysis || analysis.hasError || !analysis.mei) {
            abcSlices = []
            abcVerses = []
            abcTextVerses = []
            return
        }

        const abcjs = getLoadedAbcjs()
        if (!abcjs) {
            abcSlices = []
            abcVerses = []
            abcTextVerses = []
            return
        }

        abcSlices = sliceAbcIntoSystems(convertedText, abcjs.parseOnly)
        abcVerses = summarizeMei(analysis.mei).verses
        abcTextVerses = extractAbcTextVerses(convertedText)
    }

    async function handleFile(filePath: string, rawBase64: string) {
        if (destroyed) return
        fileError = ""
        importError = ""
        if (!rawBase64) {
            fileError = translateText("error.sheet_music_load")
            return
        }

        const extension = getExtension(filePath)
        const baseName = removeExtension(getFileName(filePath))

        if (extension === "abc") {
            cancelFileLoad()
            loadingFile = false
            clearOpenedFile()
            abcFileName = baseName
            verseModeTouched = false
            text = normalizeLineEndings(decodeBase64Text(rawBase64))
            activeTab = "type"
            return
        }

        cancelFileLoad()
        const token = ++fileRequestToken
        const controller = new AbortController()
        fileController = controller
        loadingFile = true

        const isLive = () => !destroyed && token === fileRequestToken
        try {
            const source = extension === "mxl" ? { base64: rawBase64 } : { text: decodeBase64Text(rawBase64) }
            const loaded = await loadMusic(source, controller.signal)
            if (!isLive()) return

            const summary = summarizeMei(loaded.mei)
            const hasBreaks = hasMeiLineBreaks(loaded.mei)

            slicedRangeCache.clear()
            openedFileMei = loaded.mei
            openedFileTitle = loaded.title || ""
            openedFileComposer = loaded.composer || ""
            openedFileLyricist = loaded.lyricist || ""
            openedFileCopyright = loaded.copyright || ""
            openedFileName = baseName
            openedFileMeasures = loaded.measures
            openedFileVerses = summary.verses
            fileHasLineBreaks = hasBreaks
            slideGrouping = hasBreaks ? "breaks" : "4"
            verseModeTouched = false
            verseMode = summary.verses.length > 1 ? "per_verse" : "all"
        } catch (err) {
            if ((err instanceof SheetMusicError && err.code === "aborted") || !isLive()) return
            console.error("Sheet music import file error:", err)
            fileError = translateText(getSheetMusicErrorKey(err, "load"))
        } finally {
            if (fileController === controller) fileController = null
            if (isLive()) loadingFile = false
        }
    }

    function applyFiltersForPreview(mei: string, parts: SheetMusicImportParts, verses: string): string {
        if (!mei || (parts === "all" && !verses)) return mei
        const summary = summarizeMei(mei)
        const resolvedParts = resolvePartsSelection(parts, undefined, summary)
        const resolvedVerses = resolveVersesSelection(verses, summary.verses)
        return filterMei(mei, { parts: resolvedParts.parts, verses: resolvedVerses, highestNoteOnly: resolvedParts.highestNoteOnly })
    }

    async function updateFirstSlidePreview(tab: ImportTab, abcFirstMei: string, fileMei: string, firstRange: MeasureSliceRange | null, parts: SheetMusicImportParts, verses: string, words: SheetMusicWordsSize) {
        cancelFirstSlidePreview()
        const token = ++previewRequestToken
        firstSlidePreviewError = ""

        const hasSource = tab === "type" ? Boolean(abcFirstMei) : Boolean(fileMei && firstRange)
        if (!hasSource) {
            firstSlidePreviewSvg = ""
            firstSlidePreviewLoading = false
            return
        }

        const controller = new AbortController()
        previewController = controller
        firstSlidePreviewLoading = true

        const isLive = () => !destroyed && token === previewRequestToken
        try {
            let rawFirstSlideMei = abcFirstMei
            if (tab === "file" && firstRange) {
                const cacheKey = `${fileMei}:${firstRange.first}-${firstRange.last}`
                const cached = slicedRangeCache.get(cacheKey)
                if (cached) {
                    rawFirstSlideMei = cached
                } else {
                    const sliced = await sliceMusic(fileMei, firstRange.first, firstRange.last, controller.signal)
                    if (!isLive()) return
                    rawFirstSlideMei = sliced.mei
                    slicedRangeCache.set(cacheKey, sliced.mei)
                }
            }

            const filteredMei = applyFiltersForPreview(rawFirstSlideMei, parts, verses)
            const previewLyricSize = getImportLyricSize(words)
            const renderOptions = previewLyricSize !== undefined ? { lyricSize: previewLyricSize } : undefined
            const rendered = await renderMusic(filteredMei, FIRST_SLIDE_PAGE_WIDTH, FIRST_SLIDE_RATIO, controller.signal, renderOptions)
            if (!isLive()) return

            firstSlidePreviewSvg = prefixSvgIds(rendered.svg, FIRST_SLIDE_SVG_PREFIX)
        } catch (err) {
            if ((err instanceof SheetMusicError && err.code === "aborted") || !isLive()) return
            console.error("Sheet music first-slide preview error:", err)
            firstSlidePreviewSvg = ""
            firstSlidePreviewError = translateText(getSheetMusicErrorKey(err, "render"))
        } finally {
            if (previewController === controller) previewController = null
            if (isLive()) firstSlidePreviewLoading = false
        }
    }

    async function handleImport() {
        if (!hasValidMusic || importing || loadingFile) return
        cancelImport()
        const controller = new AbortController()
        importController = controller
        importing = true
        importError = ""

        // Snapshot every user choice once when Import is pressed so later UI changes cannot alter the show
        const snapshotTab = activeTab
        const snapshotParts = selectedParts
        const snapshotVerseMode = verseMode
        const snapshotWords = selectedWords
        const snapshotVerses = [...activeVerses]
        const snapshotTextVerses = snapshotTab === "type" ? abcTextVerses.map((verse) => [...verse]) : []
        const snapshotAbcSlices = abcSlices.map((slice) => ({ mei: slice.analysis.mei, abc: slice.abc }))
        const snapshotAbcText = text
        const snapshotAbcTitle = abcAnalysis?.title || ""
        const snapshotAbcFileName = abcFileName
        const snapshotFileMei = openedFileMei
        const snapshotFileRanges = fileRanges.map((range) => ({ ...range }))
        const snapshotFileTitle = openedFileTitle
        const snapshotFileComposer = openedFileComposer
        const snapshotFileLyricist = openedFileLyricist
        const snapshotFileCopyright = openedFileCopyright
        const snapshotFileName = openedFileName

        try {
            let importSlides: SheetMusicImportSlide[] = []
            let metadata: SheetMusicMetadata = {}
            let title = ""
            let fallbackFileName = ""

            if (snapshotTab === "type") {
                importSlides = snapshotAbcSlices
                metadata = extractAbcMetadata(snapshotAbcText)
                title = (snapshotAbcTitle || metadata.title || "").trim()
                fallbackFileName = snapshotAbcFileName
            } else {
                for (const range of snapshotFileRanges) {
                    const cacheKey = `${snapshotFileMei}:${range.first}-${range.last}`
                    let slicedMei = slicedRangeCache.get(cacheKey)
                    if (!slicedMei) {
                        const sliced = await sliceMusic(snapshotFileMei, range.first, range.last, controller.signal)
                        if (destroyed) return
                        slicedMei = sliced.mei
                        slicedRangeCache.set(cacheKey, sliced.mei)
                    }
                    const numbers = getMeasureNumbers(slicedMei)
                    const measuresLabel = numbers.length > 0 ? formatMeasureRange(numbers[0], numbers[numbers.length - 1]) : formatMeasureRange(range.first, range.last)
                    importSlides.push({
                        mei: slicedMei,
                        measures: measuresLabel
                    })
                }

                if (snapshotFileTitle) metadata.title = snapshotFileTitle
                if (snapshotFileComposer) metadata.composer = snapshotFileComposer
                if (snapshotFileLyricist) metadata.author = snapshotFileLyricist
                if (snapshotFileCopyright) metadata.copyright = snapshotFileCopyright
                const detectedKey = extractKeyFromMei(snapshotFileMei)
                if (detectedKey) metadata.key = detectedKey

                title = snapshotFileTitle
                fallbackFileName = snapshotFileName
            }

            if (destroyed || !importSlides.length) return

            const label = title || fallbackFileName || ""
            const rawName = title || fallbackFileName || translateText("items.sheet_music")
            let category = get(drawerTabsData).shows?.activeSubTab || null
            if (category === "all" || category === "unlabeled") category = null

            const show = buildSheetMusicShow({
                name: checkName(rawName),
                label,
                category,
                layoutName: translateText("example.default"),
                slides: importSlides,
                verseMode: snapshotVerseMode,
                verseNumbers: snapshotVerses,
                parts: snapshotParts,
                words: snapshotWords,
                textVerses: snapshotTextVerses,
                metadata
            })

            setTempShows([{ id: uid(), show }])
        } catch (err) {
            if (err instanceof SheetMusicError && err.code === "aborted") return
            if (destroyed) return
            console.error("Sheet music import error:", err)
            importError = translateText(getSheetMusicErrorKey(err, "load"))
        } finally {
            if (importController === controller) importController = null
            if (!destroyed) importing = false
        }
    }
</script>

<div class="importSheetMusicPopup">
    <Tabs tabs={popupTabs} bind:active={activeTab} labels style="font-weight: normal;" />

    {#if activeTab === "type"}
        <AbcEditor bind:text bind:selectedKey={abcKey} bind:selectedMeter={abcMeter} bind:selectedParts={abcParts} disabled={importing} svgIdPrefix="sm_import_abc_" on:result={handleAbcResult} on:pending={handleAbcPending} />
    {:else}
        <InputRow>
            <MaterialButton variant="outlined" icon="music" disabled={loadingFile || importing} on:click={openFile} style="flex: 1;">
                <T id="actions.open_file" />
            </MaterialButton>
        </InputRow>

        {#if openedFileTitle || openedFileName}
            <p class="fileLabel">{openedFileTitle || openedFileName}</p>
        {/if}

        {#if fileError}
            <p class="error">{fileError}</p>
        {/if}
    {/if}

    <div class="showOptions">
        <InputRow>
            <MaterialDropdown label="sheet_music.parts" value={selectedParts} options={partsOptions} disabled={importing} on:change={(e) => (selectedParts = e.detail)} />
            <MaterialDropdown
                label="sheet_music.verses"
                value={verseMode}
                options={versesOptions}
                disabled={importing}
                on:change={(e) => {
                    verseModeTouched = true
                    verseMode = e.detail
                }}
            />
            <MaterialDropdown label="sheet_music.import_words" value={selectedWords} options={wordsOptions} disabled={importing} on:change={(e) => (selectedWords = e.detail)} />
            {#if activeTab === "file"}
                <MaterialDropdown label="sheet_music.import_slides" value={slideGrouping} options={slideOptions} disabled={importing} on:change={(e) => (slideGrouping = e.detail)} />
            {/if}
        </InputRow>

        {#if hasValidMusic}
            <p class="summary">
                {#if totalSlideCount === 1 && effectiveGroupCount === 1}
                    <T id="sheet_music.import_summary_one_slide" />
                {:else if effectiveGroupCount === 1}
                    <T id="sheet_music.import_summary_one_group" replace={[String(totalSlideCount)]} />
                {:else if totalSlideCount === 1}
                    <T id="sheet_music.import_summary_one_slide_groups" replace={[String(effectiveGroupCount)]} />
                {:else}
                    <T id="sheet_music.import_summary" replace={[String(totalSlideCount), String(effectiveGroupCount)]} />
                {/if}
            </p>
        {/if}

        <div class="firstSlideSection">
            <p class="previewHeading"><T id="sheet_music.import_preview_first_slide" /></p>
            {#if firstSlidePreviewError}
                <p class="error">{firstSlidePreviewError}</p>
            {/if}
            <div class="preview firstSlidePreview" class:loading={firstSlidePreviewLoading}>
                {#if firstSlidePreviewSvg}
                    {@html firstSlidePreviewSvg}
                {:else if firstSlidePreviewLoading || loadingFile}
                    <p class="status"><T id="remote.loading" /></p>
                {:else}
                    <div class="empty"><Icon id="music" size={2.5} white /></div>
                {/if}
            </div>
        </div>
    </div>

    {#if importError}
        <p class="error">{importError}</p>
    {/if}

    <div class="actions">
        <MaterialButton variant="contained" icon="import" disabled={!hasValidMusic || importing || loadingFile} on:click={handleImport} style="flex: 1;">
            {#if importing}
                <T id="popup.importing" />
            {:else}
                <T id="actions.import" />
            {/if}
        </MaterialButton>
    </div>
</div>

<style>
    .importSheetMusicPopup {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: min(820px, calc(100vw - (var(--navigation-width) + 20px) * 2));
        min-width: 460px;
    }

    .fileLabel {
        font-size: 0.95em;
        opacity: 0.85;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .showOptions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-top: 6px;
        border-top: 1px solid var(--primary-lighter);
    }

    .summary {
        font-size: 0.9em;
        opacity: 0.85;
    }

    .firstSlideSection {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .previewHeading {
        font-size: 0.82em;
        opacity: 0.7;
    }

    .preview {
        width: 100%;
        aspect-ratio: 1820 / 800;
        overflow: hidden;
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

    .preview :global(svg) {
        width: 100%;
        height: 100%;
        fill: currentColor;
    }

    .preview :global(.definition-scale) {
        color: inherit;
    }

    .error {
        color: #ff6b6b;
        font-size: 0.9em;
    }

    .status {
        opacity: 0.7;
    }

    .empty {
        opacity: 0.3;
    }

    .actions {
        display: flex;
        gap: 8px;
        padding-top: 4px;
    }
</style>
