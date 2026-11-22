import { SvgCache, createRenderCacheKey } from "./helpers"

export type LoadMusicSource = { text: string } | { base64: string }

export interface LoadMusicResult {
    mei: string
    title: string
    measures: number
}

interface WorkerSuccessReply<T> {
    id: number
    ok: true
    result: T
}

interface WorkerErrorReply {
    id: number
    ok: false
    error: string
}

type WorkerReply<T> = WorkerSuccessReply<T> | WorkerErrorReply

interface PendingRequest {
    resolve: (value: any) => void
    reject: (reason: Error) => void
}

const WORKER_URL = "./assets/sheet-music/worker.mjs"
const IDLE_TIMEOUT_MS = 60_000

const svgCache = new SvgCache()
const inFlightRenders = new Map<string, Promise<string>>()
const pending = new Map<number, PendingRequest>()
const idleWaiters: (() => void)[] = []

let worker: Worker | null = null
let nextRequestId = 1
let idleTimer: ReturnType<typeof setTimeout> | null = null

function clearIdleTimer(): void {
    if (idleTimer !== null) {
        clearTimeout(idleTimer)
        idleTimer = null
    }
}

function flushIdleWaiters(): void {
    while (idleWaiters.length > 0) {
        const resolve = idleWaiters.shift()
        resolve?.()
    }
}

function scheduleIdleTermination(): void {
    clearIdleTimer()
    if (!worker || pending.size > 0) return

    idleTimer = setTimeout(() => {
        idleTimer = null
        if (worker && pending.size === 0) {
            worker.terminate()
            worker = null
        }
    }, IDLE_TIMEOUT_MS)
}

function failWorker(message: string): void {
    clearIdleTimer()

    if (worker) {
        worker.terminate()
        worker = null
    }

    const error = new Error(message)
    const active = Array.from(pending.values())
    pending.clear()

    for (const entry of active) {
        entry.reject(error)
    }

    flushIdleWaiters()
}

function ensureWorker(): Worker {
    if (worker) return worker

    let created: Worker
    try {
        created = new Worker(WORKER_URL, { type: "module" })
    } catch (err) {
        const detail = err instanceof Error && err.message ? `: ${err.message}` : ""
        throw new Error(`Could not start sheet music worker${detail}`)
    }

    created.onmessage = (event: MessageEvent<WorkerReply<any>>) => {
        const reply = event.data
        if (!reply || typeof reply.id !== "number") return

        const entry = pending.get(reply.id)
        if (!entry) return
        pending.delete(reply.id)

        if (reply.ok) entry.resolve(reply.result)
        else entry.reject(new Error(reply.error || "Sheet music engine error"))

        if (pending.size === 0) {
            flushIdleWaiters()
            scheduleIdleTermination()
        }
    }

    created.onerror = (event: ErrorEvent) => {
        const message = event?.message ? `Sheet music worker failed: ${event.message}` : "Sheet music worker failed"
        failWorker(message)
    }

    created.onmessageerror = () => {
        failWorker("Sheet music worker sent an unreadable message")
    }

    worker = created
    return created
}

function postRequest<T>(payload: Record<string, unknown>): Promise<T> {
    clearIdleTimer()

    let activeWorker: Worker
    try {
        activeWorker = ensureWorker()
    } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error("Could not start sheet music worker"))
    }

    const id = nextRequestId++
    return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try {
            activeWorker.postMessage({ ...payload, id })
        } catch (err) {
            pending.delete(id)
            const message = err instanceof Error && err.message ? err.message : "Could not send message to sheet music worker"
            reject(new Error(message))
            if (pending.size === 0) {
                flushIdleWaiters()
                scheduleIdleTermination()
            }
        }
    })
}

export function loadMusic(source: LoadMusicSource): Promise<LoadMusicResult> {
    return postRequest<LoadMusicResult>({ type: "load", ...source })
}

export function renderMusic(mei: string, pageWidth: number): Promise<string> {
    const key = createRenderCacheKey(mei, pageWidth)
    const cached = svgCache.get(key)
    if (cached !== undefined) return Promise.resolve(cached)

    const existing = inFlightRenders.get(key)
    if (existing) return existing

    const request = postRequest<{ svg: string }>({ type: "render", mei, pageWidth })
        .then((result) => {
            svgCache.set(key, result.svg)
            return result.svg
        })
        .finally(() => {
            inFlightRenders.delete(key)
        })

    inFlightRenders.set(key, request)
    return request
}

export function idle(): Promise<void> {
    if (pending.size === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
        idleWaiters.push(resolve)
    })
}
