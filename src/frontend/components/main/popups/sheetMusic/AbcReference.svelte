<script lang="ts">
    import { createEventDispatcher } from "svelte"
    import { translateText } from "../../../../utils/language"
    import T from "../../../helpers/T.svelte"

    type ReferenceEntry = { insertText: string; pitchLabel: string } | { insertText: string; labelKey: string }

    interface ReferenceRow {
        subtitleKey?: string
        entries: ReferenceEntry[]
    }

    interface ReferenceGroup {
        headingKeys: string[]
        rows: ReferenceRow[]
    }

    const REFERENCE_GROUPS: ReferenceGroup[] = [
        {
            headingKeys: ["sheet_music.treble_staff"],
            rows: [
                {
                    subtitleKey: "sheet_music.lines",
                    entries: [
                        { insertText: "E", pitchLabel: "E4" },
                        { insertText: "G", pitchLabel: "G4" },
                        { insertText: "B", pitchLabel: "B4" },
                        { insertText: "d", pitchLabel: "D5" },
                        { insertText: "f", pitchLabel: "F5" }
                    ]
                },
                {
                    subtitleKey: "sheet_music.spaces",
                    entries: [
                        { insertText: "F", pitchLabel: "F4" },
                        { insertText: "A", pitchLabel: "A4" },
                        { insertText: "c", pitchLabel: "C5" },
                        { insertText: "e", pitchLabel: "E5" },
                        { insertText: "C", labelKey: "sheet_music.middle_c" }
                    ]
                }
            ]
        },
        {
            headingKeys: ["sheet_music.bass_staff"],
            rows: [
                {
                    subtitleKey: "sheet_music.lines",
                    entries: [
                        { insertText: "G,", pitchLabel: "G2" },
                        { insertText: "B,", pitchLabel: "B2" },
                        { insertText: "D", pitchLabel: "D3" },
                        { insertText: "F", pitchLabel: "F3" },
                        { insertText: "A", pitchLabel: "A3" }
                    ]
                },
                {
                    subtitleKey: "sheet_music.spaces",
                    entries: [
                        { insertText: "A,", pitchLabel: "A2" },
                        { insertText: "C", pitchLabel: "C3" },
                        { insertText: "E", pitchLabel: "E3" },
                        { insertText: "G", pitchLabel: "G3" },
                        { insertText: "c", labelKey: "sheet_music.middle_c" }
                    ]
                }
            ]
        },
        {
            headingKeys: ["sheet_music.lengths"],
            rows: [
                {
                    entries: [
                        { insertText: "4", labelKey: "sheet_music.length_whole" },
                        { insertText: "3", labelKey: "sheet_music.length_dotted_half" },
                        { insertText: "2", labelKey: "sheet_music.length_half" },
                        { insertText: "3/2", labelKey: "sheet_music.length_dotted_quarter" },
                        { insertText: "/", labelKey: "sheet_music.length_eighth" },
                        { insertText: "/4", labelKey: "sheet_music.length_sixteenth" }
                    ]
                }
            ]
        },
        {
            headingKeys: ["sheet_music.accidentals", "sheet_music.marks", "sheet_music.lyrics"],
            rows: [
                {
                    entries: [
                        { insertText: "^", labelKey: "sheet_music.sharp" },
                        { insertText: "_", labelKey: "sheet_music.flat" },
                        { insertText: "=", labelKey: "sheet_music.natural" },
                        { insertText: "z", labelKey: "sheet_music.rest" },
                        { insertText: "|", labelKey: "sheet_music.bar_line" },
                        { insertText: "-", labelKey: "sheet_music.tie" },
                        { insertText: "-", labelKey: "sheet_music.split_syllable" },
                        { insertText: "_", labelKey: "sheet_music.hold_syllable" }
                    ]
                }
            ]
        }
    ]

    export let disabled = false

    const dispatch = createEventDispatcher<{ insert: string }>()

    function getEntryTitle(entry: ReferenceEntry): string {
        return "labelKey" in entry ? translateText(entry.labelKey) : entry.pitchLabel
    }
</script>

<details class="cheatSheet">
    <summary class="toggle"><T id="sheet_music.cheat_sheet" /></summary>
    <div class="cheatRows">
        <p class="note"><T id="sheet_music.reference_note" /></p>
        {#each REFERENCE_GROUPS as group}
            <div class="heading">
                {#each group.headingKeys as key, index}
                    {#if index > 0}
                        /
                    {/if}<T id={key} />
                {/each}
            </div>
            {#each group.rows as row}
                <div class="row">
                    {#if row.subtitleKey}
                        <span class="sub"><T id={row.subtitleKey} /></span>
                    {/if}
                    {#each row.entries as entry}
                        <button type="button" class="chip" {disabled} title={getEntryTitle(entry)} on:click={() => !disabled && dispatch("insert", entry.insertText)}>
                            <code>{entry.insertText}</code>
                            {#if "labelKey" in entry}
                                <span><T id={entry.labelKey} /></span>
                            {/if}
                        </button>
                    {/each}
                </div>
            {/each}
        {/each}
    </div>
</details>

<style>
    .cheatSheet {
        background-color: var(--primary-darker);
        border-radius: 4px;
        padding: 4px 8px;
    }

    .toggle {
        color: var(--text);
        font-size: 0.85em;
        opacity: 0.85;
        cursor: pointer;
        padding: 4px 2px;
        user-select: none;
    }

    .toggle:hover {
        opacity: 1;
    }

    .cheatRows {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 2px 2px 6px;
    }

    .note {
        font-size: 0.75em;
        opacity: 0.65;
        margin-bottom: 2px;
    }

    .heading {
        font-size: 0.72em;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.65;
        margin-top: 4px;
    }

    .heading:first-child {
        margin-top: 0;
    }

    .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
    }

    .sub {
        font-size: 0.75em;
        opacity: 0.6;
        margin-inline-end: 2px;
    }

    .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        border-radius: 3px;
        border: 1px solid var(--primary-lighter);
        background-color: var(--primary-darkest);
        color: var(--text);
        font: inherit;
        font-size: 0.78em;
        cursor: pointer;
    }

    .chip:hover {
        background-color: var(--hover);
        border-color: var(--secondary);
    }

    .chip code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        color: var(--secondary);
        font-weight: 600;
    }

    .chip span {
        opacity: 0.85;
    }
</style>
