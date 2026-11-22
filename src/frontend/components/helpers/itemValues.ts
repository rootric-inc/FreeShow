export function getItemSetValue<T>(values: readonly T[], index: number): T | undefined {
    return index >= 0 && index < values.length ? values[index] : values[0]
}
