import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface PostedMessage {
    id: number
    type: string
    mei?: string
    pageWidth?: number
    ratio?: number
    showMeasureNumbers?: boolean
    transpose?: number
    text?: string
    first?: number
    last?: number
}

class FakeWorker {
    static instances: FakeWorker[] = []
    static throwOnCreate = false

    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    onmessageerror: ((event: MessageEvent) => void) | null = null
    posted: PostedMessage[] = []
    terminated = false

    constructor(_url: string, _options?: WorkerOptions) {
        if (FakeWorker.throwOnCreate) {
            throw new Error("worker unavailable")
        }
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

function getNestedValue(obj: Record<string, any>, dottedKey: string): unknown {
    return dottedKey.split(".").reduce<any>((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), obj)
}

describe("sheetMusic engine client", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.resetModules()
        FakeWorker.instances = []
        FakeWorker.throwOnCreate = false
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
        worker.emitMessage({ id: firstId + 999, ok: true, result: { svg: "<svg>wrong</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })

        worker.emitMessage({ id: firstId, ok: true, result: { svg: "<svg>one</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })
        await expect(p1).resolves.toEqual({ svg: "<svg>one</svg>", scale: 1, fits: true, pages: 1 })

        expect(worker.posted).toHaveLength(2)
        const secondId = worker.posted[1].id
        expect(secondId).not.toBe(firstId)
        worker.emitMessage({ id: secondId, ok: true, result: { svg: "<svg>two</svg>", pageWidth: 3680, scale: 0.5, fits: false, pages: 2 } })
        await expect(p2).resolves.toEqual({ svg: "<svg>two</svg>", scale: 0.5, fits: false, pages: 2 })
    })

    it("shares one worker request between two callers of the same key", async () => {
        const { renderMusic } = await import("./engine")

        const p1 = renderMusic("<mei>same</mei>", 1840, 0.31)
        const p2 = renderMusic("<mei>same</mei>", 1840, 0.31)

        const worker = FakeWorker.instances[0]
        expect(worker.posted).toHaveLength(1)

        worker.emitMessage({ id: worker.posted[0].id, ok: true, result: { svg: "<svg>shared</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })
        await expect(Promise.all([p1, p2])).resolves.toEqual([
            { svg: "<svg>shared</svg>", scale: 1, fits: true, pages: 1 },
            { svg: "<svg>shared</svg>", scale: 1, fits: true, pages: 1 }
        ])
    })

    it("keeps renders with measure numbers separate from default renders in flight and in cache", async () => {
        const { renderMusic } = await import("./engine")

        const pPlain = renderMusic("<mei>same</mei>", 1840)
        const pNumbered = renderMusic("<mei>same</mei>", 1840, undefined, undefined, { showMeasureNumbers: true })

        const worker = FakeWorker.instances[0]
        expect(worker.posted).toHaveLength(1)
        expect(worker.posted[0].showMeasureNumbers).toBeUndefined()

        worker.emitMessage({ id: worker.posted[0].id, ok: true, result: { svg: "<svg>plain</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })
        await expect(pPlain).resolves.toEqual({ svg: "<svg>plain</svg>", scale: 1, fits: true, pages: 1 })

        expect(worker.posted).toHaveLength(2)
        expect(worker.posted[1].showMeasureNumbers).toBe(true)
        worker.emitMessage({ id: worker.posted[1].id, ok: true, result: { svg: "<svg>numbered</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })
        await expect(pNumbered).resolves.toEqual({ svg: "<svg>numbered</svg>", scale: 1, fits: true, pages: 1 })

        // Subsequent calls hit their own cache entries without posting again
        await expect(renderMusic("<mei>same</mei>", 1840)).resolves.toEqual({ svg: "<svg>plain</svg>", scale: 1, fits: true, pages: 1 })
        await expect(renderMusic("<mei>same</mei>", 1840, undefined, undefined, { showMeasureNumbers: true })).resolves.toEqual({ svg: "<svg>numbered</svg>", scale: 1, fits: true, pages: 1 })
        expect(worker.posted).toHaveLength(2)
    })

    it("passes transpose to the worker and keeps different transpose values separate in flight and in cache", async () => {
        const { renderMusic } = await import("./engine")

        const pOriginal = renderMusic("<mei>hymn</mei>", 1840, 0.31)
        const pUp2 = renderMusic("<mei>hymn</mei>", 1840, 0.31, undefined, { transpose: 2 })
        const pDown3 = renderMusic("<mei>hymn</mei>", 1840, 0.31, undefined, { transpose: -3 })

        const worker = FakeWorker.instances[0]
        expect(worker.posted).toHaveLength(1)
        expect(worker.posted[0].transpose).toBeUndefined()

        worker.emitMessage({ id: worker.posted[0].id, ok: true, result: { svg: "<svg>orig</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })
        await expect(pOriginal).resolves.toEqual({ svg: "<svg>orig</svg>", scale: 1, fits: true, pages: 1 })

        expect(worker.posted).toHaveLength(2)
        expect(worker.posted[1].transpose).toBe(2)
        worker.emitMessage({ id: worker.posted[1].id, ok: true, result: { svg: "<svg>up2</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })
        await expect(pUp2).resolves.toEqual({ svg: "<svg>up2</svg>", scale: 1, fits: true, pages: 1 })

        expect(worker.posted).toHaveLength(3)
        expect(worker.posted[2].transpose).toBe(-3)
        worker.emitMessage({ id: worker.posted[2].id, ok: true, result: { svg: "<svg>down3</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })
        await expect(pDown3).resolves.toEqual({ svg: "<svg>down3</svg>", scale: 1, fits: true, pages: 1 })

        // Subsequent calls hit their own cache entries; transpose 0 and out-of-range share the original entry
        await expect(renderMusic("<mei>hymn</mei>", 1840, 0.31, undefined, { transpose: 0 })).resolves.toEqual({ svg: "<svg>orig</svg>", scale: 1, fits: true, pages: 1 })
        await expect(renderMusic("<mei>hymn</mei>", 1840, 0.31, undefined, { transpose: 15 })).resolves.toEqual({ svg: "<svg>orig</svg>", scale: 1, fits: true, pages: 1 })
        await expect(renderMusic("<mei>hymn</mei>", 1840, 0.31, undefined, { transpose: 2 })).resolves.toEqual({ svg: "<svg>up2</svg>", scale: 1, fits: true, pages: 1 })
        await expect(renderMusic("<mei>hymn</mei>", 1840, 0.31, undefined, { transpose: -3 })).resolves.toEqual({ svg: "<svg>down3</svg>", scale: 1, fits: true, pages: 1 })
        expect(worker.posted).toHaveLength(3)
    })

    it("surfaces ok:false worker errors with their code and maps every worker code to a real en.json key", async () => {
        const { loadMusic, renderMusic, SheetMusicError, getSheetMusicErrorKey } = await import("./engine")
        const enPath = fileURLToPath(new URL("../../../../../../public/lang/en.json", import.meta.url))
        const en = JSON.parse(readFileSync(enPath, "utf8")) as Record<string, any>

        const pEmpty = loadMusic({ text: "<mei/>" })
        const worker = FakeWorker.instances[0]
        worker.emitMessage({ id: worker.posted[0].id, ok: false, code: "empty_music", error: "No music measures found" })
        await expect(pEmpty).rejects.toBeInstanceOf(SheetMusicError)
        await expect(pEmpty).rejects.toMatchObject({ code: "empty_music", message: "No music measures found" })

        const pRenderFail = renderMusic("<mei>bad</mei>", 1840)
        worker.emitMessage({ id: worker.posted[1].id, ok: false, code: "render_failed", error: "Could not render music" })
        await expect(pRenderFail).rejects.toMatchObject({ code: "render_failed", message: "Could not render music" })

        for (const code of ["load_failed", "empty_music", "render_failed", "timeout"] as const) {
            const key = getSheetMusicErrorKey(new SheetMusicError(code, "err"))
            expect(typeof getNestedValue(en, key)).toBe("string")
        }
        expect(getNestedValue(en, "error.sheet_music_truncated")).toBe("This music is too long for this item")
    })

    it("drops a queued render when cancelled and terminates the worker when a running render loses its last caller", async () => {
        const { renderMusic, SheetMusicError } = await import("./engine")

        const activeCtrl = new AbortController()
        const queuedCtrl = new AbortController()
        const finalCtrl = new AbortController()

        const pActive = renderMusic("<mei>A</mei>", 1000, 0.5, activeCtrl.signal)
        const pQueued = renderMusic("<mei>B</mei>", 1000, 0.5, queuedCtrl.signal)
        const pFinal = renderMusic("<mei>C</mei>", 1000, 0.5, finalCtrl.signal)

        const firstWorker = FakeWorker.instances[0]
        expect(firstWorker.posted.map((m) => m.mei)).toEqual(["<mei>A</mei>"])

        queuedCtrl.abort()
        activeCtrl.abort()

        await expect(pQueued).rejects.toBeInstanceOf(SheetMusicError)
        await expect(pActive).rejects.toMatchObject({ code: "aborted" })
        expect(firstWorker.terminated).toBe(true)

        // Next queued job starts immediately on a fresh worker
        expect(FakeWorker.instances).toHaveLength(2)
        const secondWorker = FakeWorker.instances[1]
        expect(secondWorker.posted.map((m) => m.mei)).toEqual(["<mei>C</mei>"])

        // A late reply from the terminated worker must be ignored
        firstWorker.emitMessage({ id: firstWorker.posted[0].id, ok: true, result: { svg: "<svg>stale</svg>", pageWidth: 1000, scale: 1, fits: true, pages: 1 } })

        secondWorker.emitMessage({ id: secondWorker.posted[0].id, ok: true, result: { svg: "<svg>C</svg>", pageWidth: 1000, scale: 1, fits: true, pages: 1 } })
        await expect(pFinal).resolves.toEqual({ svg: "<svg>C</svg>", scale: 1, fits: true, pages: 1 })

        // Cancelled key A is not marked as timed out and can be requested again right away
        const pRetryA = renderMusic("<mei>A</mei>", 1000, 0.5)
        expect(secondWorker.posted.map((m) => m.mei)).toEqual(["<mei>C</mei>", "<mei>A</mei>"])
        secondWorker.emitMessage({ id: secondWorker.posted[1].id, ok: true, result: { svg: "<svg>A</svg>", pageWidth: 1000, scale: 1, fits: true, pages: 1 } })
        await expect(pRetryA).resolves.toEqual({ svg: "<svg>A</svg>", scale: 1, fits: true, pages: 1 })
    })

    it("keeps a running render alive when only one of two callers cancels", async () => {
        const { renderMusic } = await import("./engine")

        const ctrl1 = new AbortController()
        const ctrl2 = new AbortController()

        const p1 = renderMusic("<mei>shared</mei>", 1000, 0.5, ctrl1.signal)
        const p2 = renderMusic("<mei>shared</mei>", 1000, 0.5, ctrl2.signal)

        const worker = FakeWorker.instances[0]
        ctrl1.abort()
        await expect(p1).rejects.toMatchObject({ code: "aborted" })
        expect(worker.terminated).toBe(false)

        worker.emitMessage({ id: worker.posted[0].id, ok: true, result: { svg: "<svg>ok</svg>", pageWidth: 1000, scale: 1, fits: true, pages: 1 } })
        await expect(p2).resolves.toEqual({ svg: "<svg>ok</svg>", scale: 1, fits: true, pages: 1 })
    })

    it("fails only the timed-out job, continues the queue on a new worker, and expires the timeout block after 60s", async () => {
        const { renderMusic, RENDER_TIMEOUT_MS, TIMED_OUT_KEY_TTL_MS, SheetMusicError } = await import("./engine")

        const pSlow = renderMusic("<mei>slow</mei>", 1840, 0.31)
        const pWaiting = renderMusic("<mei>waiting</mei>", 1840, 0.31)

        expect(FakeWorker.instances).toHaveLength(1)
        const firstWorker = FakeWorker.instances[0]

        vi.advanceTimersByTime(RENDER_TIMEOUT_MS)

        await expect(pSlow).rejects.toBeInstanceOf(SheetMusicError)
        await expect(pSlow).rejects.toMatchObject({ code: "timeout" })
        expect(firstWorker.terminated).toBe(true)

        // Queued job runs on a fresh worker instead of failing with the timed-out job
        expect(FakeWorker.instances).toHaveLength(2)
        const secondWorker = FakeWorker.instances[1]
        expect(secondWorker.posted.map((m) => m.mei)).toEqual(["<mei>waiting</mei>"])

        // Late reply from the terminated worker is ignored
        firstWorker.emitMessage({ id: firstWorker.posted[0].id, ok: true, result: { svg: "<svg>late</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })

        secondWorker.emitMessage({ id: secondWorker.posted[0].id, ok: true, result: { svg: "<svg>waiting</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })
        await expect(pWaiting).resolves.toEqual({ svg: "<svg>waiting</svg>", scale: 1, fits: true, pages: 1 })

        // Same key rejects immediately during the 60s cooldown without posting work
        const pRepeat = renderMusic("<mei>slow</mei>", 1840, 0.31)
        await expect(pRepeat).rejects.toMatchObject({ code: "timeout" })
        expect(secondWorker.posted).toHaveLength(1)

        // After 60s the key can be tried again
        vi.advanceTimersByTime(TIMED_OUT_KEY_TTL_MS)
        const pRetried = renderMusic("<mei>slow</mei>", 1840, 0.31)
        const activeWorker = FakeWorker.instances[FakeWorker.instances.length - 1]
        const lastPost = activeWorker.posted[activeWorker.posted.length - 1]
        expect(lastPost.mei).toBe("<mei>slow</mei>")
        activeWorker.emitMessage({ id: lastPost.id, ok: true, result: { svg: "<svg>recovered</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })
        await expect(pRetried).resolves.toEqual({ svg: "<svg>recovered</svg>", scale: 1, fits: true, pages: 1 })
    })

    it("rejects pending requests when Worker creation throws and tries again on the next request", async () => {
        const { renderMusic, SheetMusicError } = await import("./engine")

        FakeWorker.throwOnCreate = true
        const p1 = renderMusic("<mei>one</mei>", 1840)
        const p2 = renderMusic("<mei>two</mei>", 1840)

        await expect(p1).rejects.toBeInstanceOf(SheetMusicError)
        await expect(p1).rejects.toMatchObject({ code: "render_failed" })
        await expect(p2).rejects.toMatchObject({ code: "render_failed" })
        expect(FakeWorker.instances).toHaveLength(0)

        FakeWorker.throwOnCreate = false
        const p3 = renderMusic("<mei>three</mei>", 1840)
        expect(FakeWorker.instances).toHaveLength(1)
        const worker = FakeWorker.instances[0]
        worker.emitMessage({ id: worker.posted[0].id, ok: true, result: { svg: "<svg>three</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })
        await expect(p3).resolves.toEqual({ svg: "<svg>three</svg>", scale: 1, fits: true, pages: 1 })
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
        secondWorker.emitMessage({ id: secondWorker.posted[0].id, ok: true, result: { svg: "<svg>ok</svg>", pageWidth: 1840, scale: 1, fits: true, pages: 1 } })
        await expect(p3).resolves.toEqual({ svg: "<svg>ok</svg>", scale: 1, fits: true, pages: 1 })

        vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1)
        expect(secondWorker.terminated).toBe(false)
        vi.advanceTimersByTime(1)
        expect(secondWorker.terminated).toBe(true)
    })

    it("queues, cancels, times out and resolves sliceMusic requests like loadMusic", async () => {
        const { sliceMusic, LOAD_TIMEOUT_MS, SheetMusicError } = await import("./engine")

        const pSlice = sliceMusic("<mei>full</mei>", 5, 8)
        const worker = FakeWorker.instances[0]
        expect(worker.posted).toEqual([{ id: 1, type: "slice", mei: "<mei>full</mei>", first: 5, last: 8 }])

        worker.emitMessage({ id: 1, ok: true, result: { mei: "<mei>5-8</mei>", measures: 4 } })
        await expect(pSlice).resolves.toEqual({ mei: "<mei>5-8</mei>", measures: 4 })

        const ctrl = new AbortController()
        const pCancel = sliceMusic("<mei>cancel</mei>", 1, 2, ctrl.signal)
        ctrl.abort()
        await expect(pCancel).rejects.toMatchObject({ code: "aborted" })
        expect(worker.terminated).toBe(true)

        const pTimeout = sliceMusic("<mei>slow</mei>", 2, 4)
        vi.advanceTimersByTime(LOAD_TIMEOUT_MS)
        await expect(pTimeout).rejects.toBeInstanceOf(SheetMusicError)
        await expect(pTimeout).rejects.toMatchObject({ code: "timeout" })
    })
})
