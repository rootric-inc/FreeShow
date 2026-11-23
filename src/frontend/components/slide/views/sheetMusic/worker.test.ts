import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import { parseSvgViewBox, svgFitsWidth } from "../../../../../../public/assets/sheet-music/mei.mjs"
import { calculatePageWidth, getItemRatioFromStyle } from "./helpers"

const verovioModulePath = fileURLToPath(new URL("../../../../../../public/assets/sheet-music/verovio-module.mjs", import.meta.url))
const verovioPath = fileURLToPath(new URL("../../../../../../public/assets/sheet-music/verovio.mjs", import.meta.url))
const workerModuleHref = new URL("../../../../../../public/assets/sheet-music/worker.mjs", import.meta.url).href
const hasVerovio = existsSync(verovioModulePath) && existsSync(verovioPath)

const SAMPLE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Short &amp; Sweet</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="4">
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`

const ONE_MEASURE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`

describe.skipIf(!hasVerovio)("sheet music worker (requires public/assets/sheet-music/verovio-module.mjs from preBuild)", () => {
    let handleMessage: (message: Record<string, unknown>) => Promise<any>

    beforeAll(async () => {
        const mod = await import(/* @vite-ignore */ workerModuleHref)
        handleMessage = mod.handleMessage
    })

    it("loads MusicXML into normalized MEI without meiHead and with bar.thru set to false", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        expect(loaded.title).toBe("Short & Sweet")
        expect(loaded.measures).toBe(4)
        expect(loaded.mei).toContain('bar.thru="false"')
        expect(loaded.mei).not.toContain("<meiHead")
    })

    it("renders MEI to SVG with the reply shape engine.ts reads and fits within a requested box ratio", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        const basic = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 1840 })
        expect(Object.keys(basic).sort()).toEqual(["fits", "pageWidth", "pages", "scale", "svg"])
        expect(basic.svg).toContain("<svg")
        expect(basic.pageWidth).toBe(1840)
        expect(basic.scale).toBe(1)
        expect(basic.fits).toBe(true)
        expect(basic.pages).toBe(1)

        const targetRatio = 0.25
        const fitted = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 500, ratio: targetRatio })
        expect(Object.keys(fitted).sort()).toEqual(["fits", "pageWidth", "pages", "scale", "svg"])
        expect(fitted.svg).toContain("<svg")
        expect(fitted.pageWidth).toBeGreaterThanOrEqual(500)
        expect(fitted.scale).toBeCloseTo(Math.min(1, 500 / fitted.pageWidth), 6)
        expect(fitted.fits).toBe(true)
        expect(fitted.pages).toBe(1)

        const vb = parseSvgViewBox(fitted.svg)
        expect(vb).not.toBeNull()
        expect(vb!.height / vb!.width).toBeLessThanOrEqual(targetRatio)
    })

    it("is pure across repeated calls and with a different request in between", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        const first = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 500, ratio: 0.25 })
        const second = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 500, ratio: 0.25 })
        await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 270, ratio: 2.0 })
        const third = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 500, ratio: 0.25 })

        expect(second.pageWidth).toBe(first.pageWidth)
        expect(second.svg).toBe(first.svg)
        expect(third.pageWidth).toBe(first.pageWidth)
        expect(third.svg).toBe(first.svg)
    })

    it("gives the same canonical pageWidth for two different preferred widths that both overflow the same box", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        const narrow = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 400, ratio: 0.2 })
        const wider = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 700, ratio: 0.2 })

        expect(narrow.fits).toBe(true)
        expect(wider.fits).toBe(true)
        expect(narrow.pageWidth).toBe(wider.pageWidth)
        expect(narrow.svg).toBe(wider.svg)
    })

    it("widens a one-measure score in a narrow 100 by 2000 box so all notes stay inside the page", async () => {
        const loaded = await handleMessage({ type: "load", text: ONE_MEASURE_MUSICXML })

        const rawNarrow = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 100 })
        expect(svgFitsWidth(rawNarrow.svg)).toBe(false)

        const preferredWidth = calculatePageWidth(100, 200)
        const ratio = getItemRatioFromStyle("width: 100px; height: 2000px;")
        const fitted = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: preferredWidth, ratio })

        expect(fitted.fits).toBe(true)
        expect(fitted.pageWidth).toBeGreaterThan(preferredWidth)
        expect(svgFitsWidth(fitted.svg)).toBe(true)
    })

    it("strips external url and CSS-escaped url attributes from rendered SVG", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        const literalMei = loaded.mei.replace("<note ", '<note color="url(https://example.com/x.svg#p)" ')
        const literalRendered = await handleMessage({ type: "render", mei: literalMei, pageWidth: 1840 })
        expect(literalRendered.svg).not.toContain("example.com")

        const hexEscapedMei = loaded.mei.replace("<note ", '<note color="u\\72l(https://example.com/x.svg#p)" ')
        const hexRendered = await handleMessage({ type: "render", mei: hexEscapedMei, pageWidth: 1840 })
        expect(hexRendered.svg).not.toContain("example.com")

        const slashEscapedMei = loaded.mei.replace("<note ", '<note color="u\\rl(https://example.com/x.svg#p)" ')
        const slashRendered = await handleMessage({ type: "render", mei: slashEscapedMei, pageWidth: 1840 })
        expect(slashRendered.svg).not.toContain("example.com")
    })

    it("returns load_failed for non-music text and keeps answering valid requests afterward", async () => {
        let caught: any = null
        try {
            await handleMessage({ type: "load", text: "this is definitely not music xml" })
        } catch (err) {
            caught = err
        }

        expect(caught).toBeInstanceOf(Error)
        expect(caught.code).toBe("load_failed")

        const recovered = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })
        expect(recovered.measures).toBe(4)
    })
})
