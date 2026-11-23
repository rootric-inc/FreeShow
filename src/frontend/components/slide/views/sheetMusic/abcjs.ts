import type { AbcVisualParams, TuneObjectArray } from "abcjs"

export type AbcParseOnly = (abc: string, params?: AbcVisualParams) => TuneObjectArray

export interface AbcjsGlobal {
    parseOnly: AbcParseOnly
}

interface WindowWithAbcjs extends Window {
    ABCJS?: AbcjsGlobal
}

const ABCJS_SCRIPT_SRC = "./assets/sheet-music/abcjs-basic-min.js"

let loadPromise: Promise<AbcjsGlobal> | null = null

export function getLoadedAbcjs(): AbcjsGlobal | null {
    if (typeof window === "undefined") return null
    const win = window as WindowWithAbcjs
    return win.ABCJS && typeof win.ABCJS.parseOnly === "function" ? win.ABCJS : null
}

export function loadAbcjs(): Promise<AbcjsGlobal> {
    if (typeof window === "undefined" || typeof document === "undefined") return Promise.reject(new Error("No window"))
    const loaded = getLoadedAbcjs()
    if (loaded) return Promise.resolve(loaded)
    if (loadPromise) return loadPromise
    const win = window as WindowWithAbcjs

    loadPromise = new Promise<AbcjsGlobal>((resolve, reject) => {
        const script = document.createElement("script")
        script.src = ABCJS_SCRIPT_SRC
        script.async = true
        const fail = (message: string) => {
            script.remove()
            loadPromise = null
            reject(new Error(message))
        }
        script.onload = () => (win.ABCJS && typeof win.ABCJS.parseOnly === "function" ? resolve(win.ABCJS) : fail("Missing ABCJS"))
        script.onerror = () => fail("Load failed")
        document.head.appendChild(script)
    })

    return loadPromise
}
