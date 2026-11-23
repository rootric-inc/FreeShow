<script lang="ts">
    import { createEventDispatcher } from "svelte"
    import Icon from "../../../helpers/Icon.svelte"
    import T from "../../../helpers/T.svelte"
    import type { AbcProblem } from "../../../slide/views/sheetMusic/abcChecks"

    export let problems: AbcProblem[] = []

    const dispatch = createEventDispatcher<{ select: AbcProblem }>()
</script>

{#if problems.length}
    <div class="problems">
        {#each problems as problem}
            <button type="button" class="problem {problem.severity}" on:click={() => dispatch("select", problem)}>
                <Icon id={problem.severity === "error" ? "remove_circle" : "warning"} size={0.85} white />
                {#key problem.key}
                    <span><T id={problem.key} replace={problem.values} /></span>
                {/key}
            </button>
        {/each}
    </div>
{/if}

<style>
    .problems {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 120px;
        overflow-y: auto;
    }

    .problem {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border: none;
        border-radius: 4px;
        background-color: var(--primary-darker);
        font: inherit;
        font-size: 0.82em;
        text-align: left;
        cursor: pointer;
    }

    .problem:hover {
        background-color: var(--hover);
    }

    .problem.error {
        color: #ff6b6b;
    }

    .problem.warning {
        color: #f5b942;
    }
</style>
