import abcjs from "abcjs"
import { describe, expect, it } from "vitest"
import { convertAndCheckAbc } from "./abcToMei"
import { filterMei, summarizeMei } from "./meiParts"

const HYMN_EXCERPT = `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="6.0-dev"><music><body><mdiv><score><scoreDef><staffGrp bar.thru="false"><staffGrp bar.thru="false"><grpSym symbol="brace" /><staffDef n="1" lines="5" ppq="1"><clef shape="G" line="2" /><keySig sig="2f" /><meterSig count="4" unit="4" /></staffDef><staffDef n="2" lines="5" ppq="1"><clef shape="F" line="4" /><keySig sig="2f" /><meterSig count="4" unit="4" /></staffDef></staffGrp></staffGrp></scoreDef><section><expansion plist="#ewg6v23" /><pb /><section xml:id="ewg6v23"><measure n="1"><staff n="1"><layer n="1"><note xml:id="n1" dur.ppq="1" dur="4" oct="5" pname="d" stem.dir="up"><verse place="below" n="1"><syl con="s" wordpos="s">Praise</syl></verse><verse place="below" n="2"><syl con="s" wordpos="s">All</syl></verse><verse place="below" n="3"><syl con="s" wordpos="s">Here</syl></verse></note></layer><layer n="2"><note xml:id="n2" dur.ppq="1" dur="4" oct="4" pname="b" stem.dir="down" accid.ges="f" /></layer></staff><staff n="2"><layer n="5"><note xml:id="n5" dur.ppq="1" dur="4" oct="4" pname="f" stem.dir="up" /></layer><layer n="6"><note xml:id="n6" dur.ppq="1" dur="4" oct="3" pname="d" stem.dir="down" /></layer></staff><dir place="above" staff="1" tstamp="1"><rend>Verse</rend></dir><harm staff="1" tstamp="1">Bb</harm><tempo place="above" staff="1 2" tstamp="1" midi.bpm="100" /><tie startid="#n1" endid="#n1b" /><tie startid="#n2" endid="#n2b" /><tie startid="#n5" endid="#n5b" /><slur startid="#n6" endid="#n6b" curvedir="below" /></measure><measure n="2"><staff n="1"><layer n="1"><note xml:id="n1b" dur.ppq="1" dur="4" oct="5" pname="d" stem.dir="up"><verse place="below" n="1"><syl con="s" wordpos="s">God</syl></verse><verse place="below" n="2"><syl con="s" wordpos="s">crea</syl></verse><verse place="below" n="3"><syl con="s" wordpos="s">be</syl></verse></note></layer><layer n="2"><note xml:id="n2b" dur.ppq="1" dur="4" oct="4" pname="b" stem.dir="down" accid.ges="f" /></layer></staff><staff n="2"><layer n="5"><note xml:id="n5b" dur.ppq="1" dur="4" oct="4" pname="f" stem.dir="up" /></layer><layer n="6"><note xml:id="n6b" dur.ppq="1" dur="4" oct="3" pname="d" stem.dir="down" /></layer></staff></measure></section></section></score></mdiv></body></music></mei>`

const CHORD_MEI = `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="6.0-dev"><music><body><mdiv><score><scoreDef><staffGrp symbol="brace" bar.thru="false"><staffDef n="1" lines="5"><clef shape="G" line="2" /><keySig sig="0" /><meterSig count="4" unit="4" /></staffDef><staffDef n="2" lines="5"><clef shape="F" line="4" /><keySig sig="0" /><meterSig count="4" unit="4" /></staffDef></staffGrp></scoreDef><section><measure n="1"><staff n="1"><layer n="1"><chord xml:id="ch1" dur.ppq="4" dur="4" dots="1" stem.dir="up"><verse n="1"><syl>Joy</syl></verse><verse n="2"><syl>Peace</syl></verse><note xml:id="lo1" oct="4" pname="e" /><note xml:id="hi1" oct="4" pname="b" /><note xml:id="mid1" oct="4" pname="g" /></chord><chord xml:id="ch2" dur.ppq="2" dur="8" stem.dir="up"><note xml:id="lo2" oct="4" pname="b" /><note xml:id="hi2" oct="5" pname="c" /></chord></layer></staff><staff n="2"><layer n="1"><chord xml:id="ch3" dur="2" stem.dir="down"><note xml:id="b1" oct="3" pname="c" /><note xml:id="t1" oct="3" pname="g" /></chord></layer></staff><slur startid="#ch1" endid="#hi2" /><tie startid="#lo1" endid="#lo2" /><slur startid="#b1" endid="#t1" /></measure></section></score></mdiv></body></music></mei>`

describe("summarizeMei", () => {
    it("summarizes staves in order with layer numbers, verses and measure count", () => {
        expect(summarizeMei(HYMN_EXCERPT)).toEqual({
            staves: [
                { n: "1", layers: ["1", "2"] },
                { n: "2", layers: ["5", "6"] }
            ],
            verses: [1, 2, 3],
            measures: 2
        })
    })

    it("summarizes ABC-converted four-part music", () => {
        const abc = ["T: Sample", "M: 4/4", "L: 1/4", "K: C", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] C D E F | G4 |", "w: 1.~One two three four | five |", "w: 2.~A B C D | E |", "[V:A] C B, C D | E4 |", "[V:T] E F G A | c4 |", "[V:B] C, D, E, F, | C4 |"].join("\n")

        const converted = convertAndCheckAbc(abc, abcjs.parseOnly)
        expect(summarizeMei(converted.mei)).toEqual({
            staves: [
                { n: "1", layers: ["1", "2"] },
                { n: "2", layers: ["1", "2"] }
            ],
            verses: [1, 2],
            measures: 2
        })
    })

    it("returns an empty summary for blank or non-MEI text", () => {
        expect(summarizeMei("")).toEqual({ staves: [], verses: [], measures: 0 })
        expect(summarizeMei("not xml")).toEqual({ staves: [], verses: [], measures: 0 })
    })
})

describe("filterMei", () => {
    it("returns the input string unchanged when nothing is filtered", () => {
        expect(filterMei(HYMN_EXCERPT, { parts: "all", verses: "all" })).toBe(HYMN_EXCERPT)
        expect(filterMei(HYMN_EXCERPT, { parts: ["1.1", "1.2", "2.5", "2.6"], verses: [1, 2, 3] })).toBe(HYMN_EXCERPT)
    })

    it("keeps only the upper staff, removes the brace, keeps forced stems for two layers and removes lower-staff ties/slurs", () => {
        const filtered = filterMei(HYMN_EXCERPT, { parts: ["1.1", "1.2"], verses: "all" })

        expect(filtered).toContain('<staffDef n="1"')
        expect(filtered).not.toContain('<staffDef n="2"')
        expect(filtered).toContain('<staff n="1">')
        expect(filtered).not.toContain('<staff n="2">')
        expect(filtered).not.toContain("<grpSym")
        expect(filtered).toContain('stem.dir="up"')
        expect(filtered).toContain('stem.dir="down"')
        expect(filtered).toContain('<harm staff="1"')
        expect(filtered).toContain('<tempo place="above" staff="1"')
        expect(filtered).toContain('startid="#n1"')
        expect(filtered).toContain('startid="#n2"')
        expect(filtered).not.toContain('startid="#n5"')
        expect(filtered).not.toContain('startid="#n6"')
    })

    it("keeps only the lower staff with its original staff number and drops upper-staff controls", () => {
        const filtered = filterMei(HYMN_EXCERPT, { parts: ["2.5", "2.6"], verses: "all" })

        expect(filtered).not.toContain('<staffDef n="1"')
        expect(filtered).toContain('<staffDef n="2"')
        expect(filtered).not.toContain('<staff n="1">')
        expect(filtered).toContain('<staff n="2">')
        expect(filtered).toContain('<layer n="5">')
        expect(filtered).toContain('<layer n="6">')
        expect(filtered).not.toContain("<grpSym")
        expect(filtered).not.toContain("<dir ")
        expect(filtered).not.toContain("<harm ")
        expect(filtered).toContain('<tempo place="above" staff="2"')
        expect(filtered).not.toContain('startid="#n1"')
        expect(filtered).not.toContain('startid="#n2"')
        expect(filtered).toContain('startid="#n5"')
        expect(filtered).toContain('startid="#n6"')
    })

    it("strips forced stem directions on any staff left with a single layer", () => {
        const sopranoOnly = filterMei(HYMN_EXCERPT, { parts: ["1.1"], verses: "all" })
        expect(sopranoOnly).toContain('<layer n="1">')
        expect(sopranoOnly).not.toContain('<layer n="2">')
        expect(sopranoOnly).not.toContain("stem.dir=")
        expect(sopranoOnly).toContain('startid="#n1"')
        expect(sopranoOnly).not.toContain('startid="#n2"')

        const sopranoAndTenor = filterMei(HYMN_EXCERPT, { parts: ["1.1", "2.5"], verses: "all" })
        expect(sopranoAndTenor).toContain('<staffDef n="1"')
        expect(sopranoAndTenor).toContain('<staffDef n="2"')
        expect(sopranoAndTenor).toContain("<grpSym")
        expect(sopranoAndTenor).toContain('<layer n="1">')
        expect(sopranoAndTenor).not.toContain('<layer n="2">')
        expect(sopranoAndTenor).toContain('<layer n="5">')
        expect(sopranoAndTenor).not.toContain('<layer n="6">')
        expect(sopranoAndTenor).not.toContain("stem.dir=")
    })

    it("filters verses to none or a chosen subset while leaving parts untouched", () => {
        const noWords = filterMei(HYMN_EXCERPT, { parts: "all", verses: "none" })
        expect(noWords).not.toContain("<verse")
        expect(noWords).toContain('<staff n="2">')
        expect(noWords).toContain('stem.dir="up"')

        const verseTwo = filterMei(HYMN_EXCERPT, { parts: "all", verses: [2] })
        expect(verseTwo).not.toContain('n="1"><syl')
        expect(verseTwo).toContain('<verse place="below" n="2">')
        expect(verseTwo).not.toContain('n="3"><syl')
    })

    it("reduces chords to their highest note when highestNoteOnly is enabled", () => {
        const melody = filterMei(CHORD_MEI, { parts: ["1.1"], verses: [1], highestNoteOnly: true })

        expect(melody).not.toContain("<chord")
        expect(melody).not.toContain('<staff n="2">')
        expect(melody).not.toContain('symbol="brace"')
        expect(melody).not.toContain("stem.dir=")

        // First chord (e4, b4, g4) keeps b4 with chord duration, dots and verse 1 only
        expect(melody).toContain('<note xml:id="hi1" oct="4" pname="b" dur="4" dur.ppq="4" dots="1"><verse n="1"><syl>Joy</syl></verse></note>')
        expect(melody).not.toContain('pname="e"')
        expect(melody).not.toContain('pname="g"')
        expect(melody).not.toContain("Peace")

        // Second chord (b4, c5) picks c5 because oct 5 > oct 4
        expect(melody).toContain('<note xml:id="hi2" oct="5" pname="c" dur="8" dur.ppq="2" />')

        // Slur from chord #ch1 to #hi2 is remapped to #hi1; ties/slurs on removed notes are dropped
        expect(melody).toContain('<slur startid="#hi1" endid="#hi2" />')
        expect(melody).not.toContain("#lo1")
        expect(melody).not.toContain("#b1")
    })

    it("keeps lyrics from ABC chords even when written with the lower note last", () => {
        const abc = ["M: 4/4", "L: 1/4", "K: C", "[ge]2 [fc]2 |", "w: High low"].join("\n")
        const converted = convertAndCheckAbc(abc, abcjs.parseOnly)

        const melody = filterMei(converted.mei, { parts: ["1.1"], verses: "all", highestNoteOnly: true })
        expect(melody).not.toContain("<chord")
        expect(melody).toContain('pname="g" oct="5"')
        expect(melody).toContain('pname="f" oct="5"')
        expect(melody).not.toContain('pname="e"')
        expect(melody).not.toContain('pname="c"')
        expect(melody).toContain(">High</syl>")
        expect(melody).toContain(">low</syl>")
    })
})
