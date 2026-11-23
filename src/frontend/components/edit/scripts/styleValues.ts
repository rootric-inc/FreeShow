export type StyleInput = {
    id: string
    type: string
}

export type StylePasteTarget = {
    index: number
    value: any
}

export type StylePastePlan = {
    items: number[]
    values: any[]
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]"
}

function cloneValue<T>(value: T): T {
    if (value === null || typeof value !== "object") return value

    try {
        return structuredClone(value)
    } catch {
        try {
            return JSON.parse(JSON.stringify(value))
        } catch {
            return value
        }
    }
}

export const EXCLUDED_STYLE_LEAVES = ["sheet_music.transpose"] as const

function isExcludedStyleId(id: string): boolean {
    return (EXCLUDED_STYLE_LEAVES as readonly string[]).includes(id)
}

function isStyleInput(input: StyleInput | null | undefined): input is StyleInput {
    // Popup inputs, excluded per-item settings, and fields no input declares count as item content and are never copied.
    return !!input && !!input.id && input.id !== "style" && input.type !== "popup" && !isExcludedStyleId(input.id)
}

export function omitExcludedStyleLeaves(root: string, copied: any): any {
    if (!isPlainObject(copied)) return copied

    const filtered: Record<string, any> = {}
    for (const [leaf, value] of Object.entries(copied)) {
        if (isExcludedStyleId(`${root}.${leaf}`)) continue
        filtered[leaf] = cloneValue(value)
    }
    return filtered
}

export function parseDottedId(id: string): [string, string] | null {
    const dotIndex = id.indexOf(".")
    if (dotIndex <= 0 || dotIndex === id.length - 1) return null
    return [id.slice(0, dotIndex), id.slice(dotIndex + 1)]
}

export function setStyleLeaf(target: any, leaf: string, value: any): Record<string, any> {
    const next: Record<string, any> = isPlainObject(target) ? cloneValue(target) : {}
    next[leaf] = cloneValue(value)
    return next
}

export function getStyleLeafRoots(inputs: readonly StyleInput[]): Set<string> {
    const roots = new Set<string>()

    for (const input of inputs) {
        if (!isStyleInput(input)) continue

        const parts = parseDottedId(input.id)
        if (parts) roots.add(parts[0])
    }

    return roots
}

export const EXTRA_STYLE_LEAVES = ["cropping.type", "sheet_music.customParts"] as const

export function withExtraStyleLeaves(inputs: readonly StyleInput[], extraIds: readonly string[]): StyleInput[] {
    const result = [...inputs]
    const leafRoots = getStyleLeafRoots(inputs)

    for (const id of extraIds) {
        const parts = parseDottedId(id)
        if (!parts || !leafRoots.has(parts[0])) continue
        if (!result.some((input) => input?.id === id)) result.push({ id, type: "extra" })
    }

    return result
}

export function copyStyleValues(item: Record<string, any> | null | undefined, inputs: readonly StyleInput[]): Record<string, any> {
    const keyValues: Record<string, any> = {}
    if (!item) return keyValues

    for (const input of inputs) {
        if (!isStyleInput(input)) continue

        if (input.id.includes(".")) {
            const parts = parseDottedId(input.id)
            if (!parts) continue

            const [root, leaf] = parts
            const rootValue = item[root]

            if (!isPlainObject(keyValues[root])) keyValues[root] = {}
            const leafValue = isPlainObject(rootValue) ? rootValue[leaf] : undefined
            keyValues[root][leaf] = leafValue === undefined || leafValue === null ? null : cloneValue(leafValue)
        } else if (item[input.id] !== undefined) {
            keyValues[input.id] = cloneValue(item[input.id])
        }
    }

    if (item.align) keyValues.align = item.align

    return keyValues
}

export function mergeStyleValues(target: any, copied: any, mergeLeaves = false): any {
    if (mergeLeaves && isPlainObject(copied)) {
        const merged: Record<string, any> = isPlainObject(target) ? cloneValue(target) : {}
        for (const [leaf, value] of Object.entries(copied)) {
            if (value === null || value === undefined) delete merged[leaf]
            else merged[leaf] = cloneValue(value)
        }
        return merged
    }

    return cloneValue(copied)
}

export function getStylePastePlan(targets: readonly StylePasteTarget[], copied: any, mergeLeaves = false): StylePastePlan | null {
    if (!targets.length) return null

    if (!mergeLeaves || !isPlainObject(copied)) {
        return {
            items: targets.map((target) => target.index),
            values: targets.map((target) => mergeStyleValues(target.value, copied, mergeLeaves))
        }
    }

    const items: number[] = []
    const values: any[] = []

    for (const target of targets) {
        const hasRoot = isPlainObject(target.value)
        const merged = mergeStyleValues(target.value, copied, true)
        if (!hasRoot && !Object.keys(merged).length) continue

        items.push(target.index)
        values.push(merged)
    }

    return items.length ? { items, values } : null
}
