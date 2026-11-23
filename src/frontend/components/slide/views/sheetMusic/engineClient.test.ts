import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface PostedMessage {
    id: number
    type: string
    mei?: string
    pageWidth?: number
    ratio?: number
    text?: string
}

class FakeWorker {
    static instances: FakeWorker[] = []

    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    onmessageerror: ((event: MessageEvent) => void) | null = null
    posted: PostedMessage[] = []
    terminated = false

    constructor(_url: string, _options?: WorkerOptions) {
        FakeWorker.instances.push(this)
    }

    postMessage(data: PostedMessage): void {
        this.posted.push(data)
    }

    terminate(): void {
        this.terminated = true
    }

    emitMessage(data: unknown): void {
        this.onmessage?.({ data } as MessageEvent)
    }

    emitError(message: string): void {
        this.onerror?.({ message } as ErrorEvent)
    }
}

describe("sheetMusic engine client", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.resetModules()
        FakeWorker.instances = []
        vi.stubGlobal("Worker", FakeWorker)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    it("matches replies by id and ignores replies with unknown ids", async () => {
        const { renderMusic } = await import("./engine")

        const p1 = renderMusic("<mei>1</mei>", 1840, 0.31)
        const p2 = renderMusic("<mei>2</mei>", 1840, 0.31)

        expect(FakeWorker.instances).toHaveLength(1)
        const worker = FakeWorker.instances[0]
        expect(worker.posted).toHaveLength(1)

        const firstId = worker.posted[0].id
        // Wrong id must not resolve the active request
        worker.emitMessage({ id: firstId + 999, ok: true, result: { svg: "<svg>wrong</svg>", truncated: false } })

        worker.emitMessage({ id: firstId, ok: true, result: { svg: "<svg>one</svg>", truncated: false } })
        await expect(p1).resolves.toEqual({ svg: "<svg>one</svg>", truncated: false })

        expect(worker.posted).toHaveLength(2)
        const secondId = worker.posted[1].id
        expect(secondId).not.toBe(firstId)
        worker.emitMessage({ id: secondId, ok: true, result: { svg: "<svg>two</svg>", truncated: true } })
        await expect(p2).resolves.toEqual({ svg: "<svg>two</svg>", truncated: true })
    })

    it("shares one worker request between two callers of the same key", async () => {
        const { renderMusic } = await import("./engine")

        const p1 = renderMusic("<mei>same</mei>", 1840, 0.31)
        const p2 = renderMusic("<mei>same</mei>", 1840, 0.31)

        const worker = FakeWorker.instances[0]
        expect(worker.posted).toHaveLength(1)

        worker.emitMessage({ id: worker.posted[0].id, ok: true, result: { svg: "<svg>shared</svg>", truncated: false } })
        await expect(Promise.all([p1, p2])).resolves.toEqual([
            { svg: "<svg>shared</svg>", truncated: false },
            { svg: "<svg>shared</svg>", truncated: false }
        ])
    })

    it("drops a queued render when all its callers cancel and lets an already running render finish", async () => {
        const { renderMusic, SheetMusicError } = await import("./engine")

        const activeCtrl = new AbortController()
        const queuedCtrl = new AbortController()
        const finalCtrl = new AbortController()

        const pActive = renderMusic("<mei>A</mei>", 1000, 0.5, activeCtrl.signal)
        const pQueued = renderMusic("<mei>B</mei>", 1000, 0.5, queuedCtrl.signal)
        const pFinal = renderMusic("<mei>C</mei>", 1000, 0.5, finalCtrl.signal)

        const worker = FakeWorker.instances[0]
        expect(worker.posted.map((m) => m.mei)).toEqual(["<mei>A</mei>"])

        // Cancel the queued job before it starts and also cancel the already running job
        queuedCtrl.abort()
        activeCtrl.abort()

        await expect(pQueued).rejects.toBeInstanceOf(SheetMusicError)
        await expect(pActive).rejects.toMatchObject({ code: "aborted" })

        // Worker finishes A and skips B straight to C
        worker.emitMessage({ id: worker.posted[0].id, ok: true, result: { svg: "<svg>A</svg>", truncated: false } })
        expect(worker.posted.map((m) => m.mei)).toEqual(["<mei>A</mei>", "<mei>C</mei>"])

        worker.emitMessage({ id: worker.posted[1].id, ok: true, result: { svg: "<svg>C</svg>", truncated: false } })
        await expect(pFinal).resolves.toEqual({ svg: "<svg>C</svg>", truncated: false })

        // A finished in the worker and populated the cache, so requesting A again hits the cache
        await expect(renderMusic("<mei>A</mei>", 1000, 0.5)).resolves.toEqual({ svg: "<svg>A</svg>", truncated: false })
        expect(worker.posted).toHaveLength(2)
    })

    it("times out renders after 20s, terminates the worker, rejects immediately on the same key, and creates a new worker for other keys", async () => {
        const { renderMusic, RENDER_TIMEOUT_MS, SheetMusicError } = await import("./engine")

        const pSlow = renderMusic("<mei>slow</mei>", 1840, 0.31)
        const pWaiting = renderMusic("<mei>waiting</mei>", 1840, 0.31)

        expect(FakeWorker.instances).toHaveLength(1)
        const firstWorker = FakeWorker.instances[0]

        vi.advanceTimersByTime(RENDER_TIMEOUT_MS)

        await expect(pSlow).rejects.toBeInstanceOf(SheetMusicError)
        await expect(pSlow).rejects.toMatchObject({ code: "timeout" })
        await expect(pWaiting).rejects.toMatchObject({ code: "timeout" })
        expect(firstWorker.terminated).toBe(true)

        // Same key rejects immediately without creating a new worker
        const pRepeat = renderMusic("<mei>slow</mei>", 1840, 0.31)
        await expect(pRepeat).rejects.toMatchObject({ code: "timeout" })
        expect(FakeWorker.instances).toHaveLength(1)

        // Different key starts a fresh worker and succeeds
        const pFresh = renderMusic("<mei>fresh</mei>", 1840, 0.31)
        expect(FakeWorker.instances).toHaveLength(2)
        const secondWorker = FakeWorker.instances[1]
        secondWorker.emitMessage({ id: secondWorker.posted[0].id, ok: true, result: { svg: "<svg>fresh</svg>", truncated: false } })
        await expect(pFresh).resolves.toEqual({ svg: "<svg>fresh</svg>", truncated: false })
    })

    it("uses the 30s timeout for load requests", async () => {
        const { loadMusic, LOAD_TIMEOUT_MS, RENDER_TIMEOUT_MS } = await import("./engine")

        const pLoad = loadMusic({ text: "<score-partwise/>" })
        const worker = FakeWorker.instances[0]

        vi.advanceTimersByTime(RENDER_TIMEOUT_MS)
        expect(worker.terminated).toBe(false)

        vi.advanceTimersByTime(LOAD_TIMEOUT_MS - RENDER_TIMEOUT_MS)
        await expect(pLoad).rejects.toMatchObject({ code: "timeout" })
        expect(worker.terminated).toBe(true)
    })

    it("rejects pending requests on worker error events and stops the worker after the idle timeout", async () => {
        const { renderMusic, IDLE_TIMEOUT_MS } = await import("./engine")

        const p1 = renderMusic("<mei>err1</mei>", 1840)
        const p2 = renderMusic("<mei>err2</mei>", 1840)
        const firstWorker = FakeWorker.instances[0]

        firstWorker.emitError("boom")
        await expect(p1).rejects.toMatchObject({ code: "render_failed" })
        await expect(p2).rejects.toMatchObject({ code: "render_failed" })
        expect(firstWorker.terminated).toBe(true)

        const p3 = renderMusic("<mei>ok</mei>", 1840)
        const secondWorker = FakeWorker.instances[1]
        secondWorker.emitMessage({ id: secondWorker.posted[0].id, ok: true, result: { svg: "<svg>ok</svg>", truncated: false } })
        await expect(p3).resolves.toEqual({ svg: "<svg>ok</svg>", truncated: false })

        vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1)
        expect(secondWorker.terminated).toBe(false)
        vi.advanceTimersByTime(1)
        expect(secondWorker.terminated).toBe(true)
    })
})
