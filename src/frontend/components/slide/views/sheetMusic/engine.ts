import { SVG_CACHE_MAX_BYTES, SvgCache, createRenderCacheKey } from "./helpers"

export type LoadMusicSource = { text: string } | { base64: string }

export interface LoadMusicResult {
    mei: string
    title: string
    measures: number
}

export interface RenderMusicResult {
    svg: string
    truncated: boolean
}

export type SheetMusicErrorCode = "load_failed" | "empty_music" | "render_failed" | "timeout" | "aborted"

export class SheetMusicError extends Error {
    readonly code: SheetMusicErrorCode

    constructor(code: SheetMusicErrorCode, message: string) {
        super(message)
        this.name = "SheetMusicError"
        this.code = code
    }
}

export function getSheetMusicErrorKey(err: unknown, fallback: "load" | "render" = "load"): string {
    const code = err instanceof SheetMusicError ? err.code : undefined
    if (code === "empty_music") return "error.sheet_music_empty"
    if (code === "timeout") return "error.sheet_music_timeout"
    if (code === "render_failed") return "error.sheet_music_render"
    if (code === "load_failed") return "error.sheet_music_load"
    return fallback === "render" ? "error.sheet_music_render" : "error.sheet_music_load"
}

interface WorkerSuccessReply<T> {
    id: number
    ok: true
    result: T
}

interface WorkerErrorReply {
    id: number
    ok: false
    code?: string
    error: string
}

type WorkerReply<T> = WorkerSuccessReply<T> | WorkerErrorReply

interface Waiter<T> {
    resolve: (value: T) => void
    reject: (reason: Error) => void
    cleanup: () => void
}

interface QueuedJob<T = any> {
    id: number | null
    type: "load" | "render"
    payload: Record<string, unknown>
    timeoutMs: number
    cacheKey: string | null
    waiters: Set<Waiter<T>>
}

const WORKER_URL = "./assets/sheet-music/worker.mjs"
export const RENDER_TIMEOUT_MS = 20_000
export const LOAD_TIMEOUT_MS = 30_000
export const IDLE_TIMEOUT_MS = 60_000
const MAX_TIMED_OUT_KEYS = 64

const svgCache = new SvgCache<RenderMusicResult>(SVG_CACHE_MAX_BYTES, (entry) => entry.svg.length)
const inFlightRenders = new Map<string, QueuedJob<RenderMusicResult>>()
const timedOutKeys = new Set<string>()
const queue: QueuedJob[] = []

let worker: Worker | null = null
let activeJob: QueuedJob | null = null
let activeTimer: ReturnType<typeof setTimeout> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let nextRequestId = 1

function normalizeErrorCode(code: string | undefined, type: "load" | "render"): SheetMusicErrorCode {
    if (code === "load_failed" || code === "empty_music" || code === "render_failed" || code === "timeout") return code
    return type === "render" ? "render_failed" : "load_failed"
}

function clearIdleTimer(): void {
    if (idleTimer !== null) {
        clearTimeout(idleTimer)
        idleTimer = null
    }
}

function clearActiveTimer(): void {
    if (activeTimer !== null) {
        clearTimeout(activeTimer)
        activeTimer = null
    }
}

function rememberTimedOutKey(key: string): void {
    if (timedOutKeys.has(key)) {
        timedOutKeys.delete(key)
    } else if (timedOutKeys.size >= MAX_TIMED_OUT_KEYS) {
        const oldest = timedOutKeys.values().next().value
        if (oldest !== undefined) timedOutKeys.delete(oldest)
    }
    timedOutKeys.add(key)
}

function scheduleIdleTermination(): void {
    clearIdleTimer()
    if (!worker || activeJob !== null || queue.length > 0) return

    idleTimer = setTimeout(() => {
        idleTimer = null
        if (worker && activeJob === null && queue.length === 0) {
            worker.terminate()
            worker = null
        }
    }, IDLE_TIMEOUT_MS)
}

function settleJobSuccess<T>(job: QueuedJob<T>, value: T): void {
    const waiters = Array.from(job.waiters)
    job.waiters.clear()
    for (const waiter of waiters) {
        waiter.cleanup()
        waiter.resolve(value)
    }
}

function settleJobError(job: QueuedJob, error: Error): void {
    const waiters = Array.from(job.waiters)
    job.waiters.clear()
    for (const waiter of waiters) {
        waiter.cleanup()
        waiter.reject(error)
    }
}

function releaseInFlight(job: QueuedJob): void {
    if (job.cacheKey && inFlightRenders.get(job.cacheKey) === job) {
        inFlightRenders.delete(job.cacheKey)
    }
}

function failWorker(error: SheetMusicError): void {
    clearIdleTimer()
    clearActiveTimer()

    if (worker) {
        worker.terminate()
        worker = null
    }

    const jobs: QueuedJob[] = []
    if (activeJob) {
        jobs.push(activeJob)
        activeJob = null
    }
    if (queue.length > 0) {
        jobs.push(...queue)
        queue.length = 0
    }

    for (const job of jobs) {
        releaseInFlight(job)
        settleJobError(job, error)
    }
}

function ensureWorker(): Worker {
    if (worker) return worker

    let created: Worker
    try {
        created = new Worker(WORKER_URL, { type: "module" })
    } catch (err) {
        const detail = err instanceof Error && err.message ? `: ${err.message}` : ""
        throw new SheetMusicError("load_failed", `Could not start sheet music worker${detail}`)
    }

    created.onmessage = (event: MessageEvent<WorkerReply<any>>) => {
        if (worker !== created) return
        const reply = event.data
        if (!reply || typeof reply.id !== "number") return
        if (!activeJob || activeJob.id !== reply.id) return

        const finished = activeJob
        activeJob = null
        clearActiveTimer()
        releaseInFlight(finished)

        if (reply.ok) {
            if (finished.type === "render" && finished.cacheKey) {
                const renderResult: RenderMusicResult = { svg: reply.result.svg, truncated: Boolean(reply.result.truncated) }
                svgCache.set(finished.cacheKey, renderResult)
                settleJobSuccess(finished, renderResult)
            } else {
                settleJobSuccess(finished, reply.result)
            }
        } else {
            const code = normalizeErrorCode(reply.code, finished.type)
            settleJobError(finished, new SheetMusicError(code, reply.error || "Sheet music engine error"))
        }

        pumpQueue()
    }

    created.onerror = (event: ErrorEvent) => {
        if (worker !== created) return
        const message = event?.message ? `Sheet music worker failed: ${event.message}` : "Sheet music worker failed"
        const code: SheetMusicErrorCode = activeJob?.type === "load" ? "load_failed" : "render_failed"
        failWorker(new SheetMusicError(code, message))
    }

    created.onmessageerror = () => {
        if (worker !== created) return
        const code: SheetMusicErrorCode = activeJob?.type === "load" ? "load_failed" : "render_failed"
        failWorker(new SheetMusicError(code, "Sheet music worker sent an unreadable message"))
    }

    worker = created
    return created
}

function pumpQueue(): void {
    if (activeJob !== null) return

    while (queue.length > 0) {
        const next = queue.shift()!
        if (next.waiters.size === 0) {
            releaseInFlight(next)
            continue
        }

        clearIdleTimer()

        let activeWorker: Worker
        try {
            activeWorker = ensureWorker()
        } catch (err) {
            const code: SheetMusicErrorCode = next.type === "load" ? "load_failed" : "render_failed"
            const message = err instanceof Error && err.message ? err.message : "Could not start sheet music worker"
            const workerError = err instanceof SheetMusicError ? err : new SheetMusicError(code, message)
            releaseInFlight(next)
            settleJobError(next, workerError)
            continue
        }

        const id = nextRequestId++
        next.id = id
        activeJob = next

        activeTimer = setTimeout(() => {
            activeTimer = null
            if (activeJob !== next) return
            if (next.cacheKey) rememberTimedOutKey(next.cacheKey)
            failWorker(new SheetMusicError("timeout", "Sheet music engine timed out"))
        }, next.timeoutMs)

        try {
            activeWorker.postMessage({ ...next.payload, id })
            return
        } catch (err) {
            clearActiveTimer()
            activeJob = null
            releaseInFlight(next)
            const code: SheetMusicErrorCode = next.type === "load" ? "load_failed" : "render_failed"
            const message = err instanceof Error && err.message ? err.message : "Could not send message to sheet music worker"
            settleJobError(next, new SheetMusicError(code, message))
        }
    }

    scheduleIdleTermination()
}

function attachWaiter<T>(job: QueuedJob<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
        return Promise.reject(new SheetMusicError("aborted", "Sheet music request cancelled"))
    }

    return new Promise<T>((resolve, reject) => {
        const waiter: Waiter<T> = {
            resolve,
            reject,
            cleanup: () => {
                if (signal) signal.removeEventListener("abort", onAbort)
            }
        }

        const onAbort = () => {
            if (!job.waiters.delete(waiter)) return
            waiter.cleanup()
            reject(new SheetMusicError("aborted", "Sheet music request cancelled"))

            if (job.waiters.size === 0 && job !== activeJob) {
                const index = queue.indexOf(job)
                if (index !== -1) queue.splice(index, 1)
                releaseInFlight(job)
                if (activeJob === null && queue.length === 0) scheduleIdleTermination()
            }
        }

        job.waiters.add(waiter)
        if (signal) signal.addEventListener("abort", onAbort, { once: true })
    })
}

export function loadMusic(source: LoadMusicSource, signal?: AbortSignal): Promise<LoadMusicResult> {
    if (signal?.aborted) {
        return Promise.reject(new SheetMusicError("aborted", "Sheet music request cancelled"))
    }

    const job: QueuedJob<LoadMusicResult> = {
        id: null,
        type: "load",
        payload: { type: "load", ...source },
        timeoutMs: LOAD_TIMEOUT_MS,
        cacheKey: null,
        waiters: new Set()
    }

    const promise = attachWaiter(job, signal)
    queue.push(job)
    pumpQueue()
    return promise
}

export function renderMusic(mei: string, pageWidth: number, ratio?: number, signal?: AbortSignal): Promise<RenderMusicResult> {
    if (signal?.aborted) {
        return Promise.reject(new SheetMusicError("aborted", "Sheet music request cancelled"))
    }

    const validRatio = typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : undefined
    const key = createRenderCacheKey(mei, pageWidth, validRatio)

    if (timedOutKeys.has(key)) {
        return Promise.reject(new SheetMusicError("timeout", "Sheet music render timed out"))
    }

    const cached = svgCache.get(key)
    if (cached !== undefined) return Promise.resolve(cached)

    const existing = inFlightRenders.get(key)
    if (existing) return attachWaiter(existing, signal)

    const payload: Record<string, unknown> = validRatio !== undefined ? { type: "render", mei, pageWidth, ratio: validRatio } : { type: "render", mei, pageWidth }
    const job: QueuedJob<RenderMusicResult> = {
        id: null,
        type: "render",
        payload,
        timeoutMs: RENDER_TIMEOUT_MS,
        cacheKey: key,
        waiters: new Set()
    }

    const promise = attachWaiter(job, signal)
    inFlightRenders.set(key, job)
    queue.push(job)
    pumpQueue()
    return promise
}
