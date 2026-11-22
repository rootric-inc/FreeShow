export type StyleInput = {
    id: string
    type: string
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

export function copyStyleValues(item: Record<string, any> | null | undefined, inputs: readonly StyleInput[]): Record<string, any> {
    const keyValues: Record<string, any> = {}
    if (!item) return keyValues

    for (const input of inputs) {
        if (!input || !input.id || input.id === "style" || input.type === "popup") continue

        if (input.id.includes(".")) {
            const dotIndex = input.id.indexOf(".")
            const root = input.id.slice(0, dotIndex)
            const leaf = input.id.slice(dotIndex + 1)
            if (!root || !leaf) continue

            const rootValue = item[root]
            if (!isPlainObject(rootValue) || rootValue[leaf] === undefined) continue

            if (!isPlainObject(keyValues[root])) keyValues[root] = {}
            keyValues[root][leaf] = cloneValue(rootValue[leaf])
        } else if (item[input.id] !== undefined) {
            keyValues[input.id] = cloneValue(item[input.id])
        }
    }

    if (item.align) keyValues.align = item.align

    return keyValues
}

export function mergeStyleValues(target: any, copied: any): any {
    if (isPlainObject(copied)) {
        if (isPlainObject(target)) return { ...cloneValue(target), ...cloneValue(copied) }
        return cloneValue(copied)
    }

    return cloneValue(copied)
}
