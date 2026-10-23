# rfp-plus-addendum-revisions

This is a three-file Army custodial services solicitation package (`W9124D-26-R-0019`, fictional "Fort Calder,
Kentucky"). The facility list is right only after the amendment and the Q&A are applied on top of the base
technical exhibit. Files in package (input) order:

| # | Built file | Source | Format | Content |
|---|---|---|---|---|
| 1 | `W9124D-26-R-0019 Att J-0001 PWS Custodial Services TE-1.pdf` | `j-0001-pws-te1-facility-list.html` | PDF, 4 pp (2 portrait, 2 landscape) | PWS Part 1 (1.3 workload "26 facilities totaling 593,210 GSF", 1.4 base + 4 options, FAR 52.217-8), Part 5 frequency definitions, **TE-1 Custodial Facility List**: Item, Bldg No., name, floors, GSF, frequency, service hours, remarks; 3 zone banners, 3 zone subtotals, a grand total, 5 footnotes, notes a–c |
| 2 | `W9124D-26-R-0019 Amendment 0002.pdf` | `amendment-0002-sf30.html` | PDF, 3 pp | Page 1 is a replica of the SF 30 (blocks 1–16, Block 11 acknowledgment text, Block 14 purpose statement plus "Except as provided herein…"). Pages 2–3 are the "SF 30 – Block 14 Continuation Page / Summary of Changes": PWS 1.3 FROM/TO, **3.1 GSF corrections** (Was / Is Changed To), **3.2 deletion of Bldg 118**, **3.3 two added buildings**, 3.4 revised totals (Was/Is), Section L due-date change, Q&A incorporation, "All other terms and conditions remain unchanged." |
| 3 | `W9124D-26-R-0019 Questions and Answers No 1.docx` | `questions-and-answers-no1.html` | DOCX | 13 Q&As in three tables (No. / Solicitation Reference / Question / Government Response): incumbent and contract value, staffing (declined), over-and-above amount, Bldg 2101 GSF, Bldg 118, **Bldg 1207 floor-count correction**, out-of-scope Bldg 131, the new buildings, holidays, TEMF bays, CIF warehouse, due date, phase-in |

Render and score:

```bash
node scripts/render-fixtures.mjs tests/fixtures/rfp-plus-addendum-revisions
npx tsx scripts/eval.ts tests/fixtures/rfp-plus-addendum-revisions
```

## Ground truth

The expected list has **27 facilities totaling 627,675 GSF**: the 26 base rows, minus Bldg 118, plus Bldgs 1218 and 2145,
with three GSF values revised and one floor count corrected.

| Change | Where | Base value | Truth |
|---|---|---|---|
| Bldg 104 GSF | Amendment 0002 §3.1 | 18,240 | **19,860** |
| Bldg 1210 GSF | Amendment 0002 §3.1 | 31,640 | **33,120** |
| Bldg 2101 GSF | Amendment 0002 §3.1 (repeated in Q&A 4) | 54,780 | **52,980** |
| Bldg 118 (7,920 GSF) | Amendment 0002 §3.2: "Building 118 is deleted from the requirement in its entirety." (repeated in Q&A 5) | in TE-1 | **excluded** |
| Bldg 1218 Battalion HQ, 3rd Bn | Amendment 0002 §3.3 | n/a | **added**: 2 floors, 23,700 GSF, Daily (M–F) |
| Bldg 2145 SRP Center | Amendment 0002 §3.3 | n/a | **added**: 1 floor, 17,385 GSF, Daily (M–F) |
| Bldg 1207 floors | Q&A 6: "corrected from 1 to 2"; GSF unchanged | 1 | **2** |

The prior award comes only from Q&A 1, "Who is the incumbent and what is the current contract value?" The answer gives
the incumbent (Ostrander Facility Group, LLC), contract W9124D-21-C-0007 (FFP, awarded 24 September 2021, base + 4
options), and "Total obligations for FY2025 were $4,812,330 (1 October 2024 through 30 September 2025)". In truth that
is `spendToDate` 4,812,330 over `spendPeriodMonths` 12, with `awardYear` 2021. No total contract value is stated.

Site: 5 contract years (12-month base + four 12-month options; the FAR 52.217-8 extension and the 30-day phase-in don't
count), Fort Calder, solicitation W9124D-26-R-0019, temperate (Kentucky).

## Traps

- **Precedence across files.** The base TE-1 values for Bldgs 104, 1210, 2101 and 118 are superseded. The amendment's
  correction table prints both the old and the new GSF under a two-row "Gross Square Feet (GSF): Was | Is Changed To"
  header, so a reader has to take the "Is" column. Bldg 2101 *decreases*.
- **Deleted building with full data.** Bldg 118 has a complete TE-1 row (floors, GSF, frequency). Only the amendment
  text removes it. "Item 7 is reserved", and the line items are not renumbered.
- **Added buildings appear only in the amendment**, as TE-1 items 27 and 28, in a table with the same columns as TE-1
  plus Zone.
- **The floor correction lives only in the Q&A**, and the question restates the wrong value ("as one floor"). Q&A 4
  likewise quotes the superseded 54,780 in the question. Q&A 10 and 11 restate unchanged GSF (11,960 and 44,300).
- **Totals are not facilities.** The base TE-1 has 3 zone subtotals and a "TOTAL – TE-1 (26 FACILITIES) 593,210" row.
  The amendment adds a Was/Is totals table and the PWS 1.3 FROM/TO sentences (593,210 → 627,675).
- **Distractor buildings.** Bldg 131 (Vehicle Storage, 6,400 SF, Q&A 7) and Bldg 2150 (Thrift Shop, TE-1 note a) are not
  in scope. The 64,200 SF of TEMF maintenance bays (footnote 2) are excluded, so Bldg 1220 stays at 11,960.
- **Look-alike rows.** Bldgs 1203 and 1205 are both "Battalion Headquarters" with an identical 22,150 GSF. Bldg 1218
  (3rd Battalion) is a third look-alike.
- **Footnote superscripts glued to building numbers** in the PDF text layer: `1183`, `21014`, `21245`. On the wrapped
  1220 row the ² drops to its own line.
- **Dollar distractors in the Q&A.** Over-and-above work of $186,415 (Q&A 3) is *included in* the FY2025 obligations,
  not added to them. Q&A 2 refuses to give staffing.
- Other numbers that are not workload: the proposal due date (30 June → 10 July 2026), requisition 0011837245, the
  beneficial occupancy date, and the 1 March 2026 inventory date.

## Provenance (fidelity: real-format)

No document could be downloaded from this container, so wording and layout follow WebSearch excerpts of real
documents. No facility rows are copied.

- **USDA AMS SF-30 amendment** (https://www.ams.usda.gov/sites/default/files/2000003838%20-%20SF-30%20Amendment.pdf):
  "The purpose of this amendment is to make changes to the solicitation as follows", then section-by-section
  "… is changed to the following". This is the model for the Block 14 purpose statement and the FROM/TO paragraphs.
- **DOE custodial services amendment, Forrestal/Germantown** (https://www.energy.gov/management/articles/ammendment-2doc):
  "Attachment 2-PWS is deleted in its entirety and the revised Attachment 2 is substituted in lieu thereof". This is the
  model for the "deleted … in its entirety" sentence used for Bldg 118.
- **Army solicitation amendment W9123823B0021-0001**
  (https://govtribe.com/file/government-file/w9123823b0021-amendment-solicitation-w9123823b0021-0001-5-july-2023-dot-pdf)
  and **IB08 RFP Amendment 0003**
  (https://imlive.s3.amazonaws.com/Federal%20Government/ID318034281999830653121872406826082945626/IB08_RFP_Amendment_0003.pdf):
  SF 30 amendments that revise PWS technical exhibits "as set forth in Item 14". Block 14 carries "Except as provided
  herein, all terms and conditions of the document referenced in Item 9A or 10A, as heretofore changed, remains
  unchanged and in full force and effect", which is copied verbatim.
- **US Embassy SF30, 191Z1026Q0005**
  (https://iq.usembassy.gov/wp-content/uploads/sites/103/2026/02/Signed-SF30-191Z1026Q0005.pdf): "The purpose of this
  amendment is to: 1- correct the language in SOW/4-Deliverables …", a numbered purpose list for a custodial scope with
  a Q&A issued alongside. This is the model for purposes a–c and for issuing the Q&A with the amendment.
- **Federal "Responses to Questions"**
  (https://imlive.s3.amazonaws.com/Federal%20Government/ID209684648180184567809935809717522994258/Responses_to_Questions.pdf):
  "Who is the current incumbent, contract number, and how long have…" is answered with the incumbent and contract
  number, while "the Government elects not to disclose the length of the contract nor the contract value". This is the
  model for Q&A 1–2.
- **NATO custodial IFIB Q&A 2** (https://www.act.nato.int/wp-content/uploads/2023/05/ifib021029_qa2.pdf): "Will the
  Government please provide the incumbent name and incumbent contract number?" is answered with the contract reference
  and the company. **SWACO custodial RFP Addendum 1**
  (https://www.swaco.org/wp-content/uploads/2026/04/Addendum-1_RFP-Custodial-Services_022525.pdf) names the incumbent
  and gives the current contract value for a three-year period in one answer.
- **NYS OGS bidder Q&A** (https://ogs.ny.gov/system/files/documents/2021/12/7300323246_bidderquestionsanswers.pdf):
  a table with Question # / Solicitation Document Name / Document Section / Question / answer. This is the model for the
  docx tables. **Fort Sill custodial Q&A**
  (https://console.sweetspotgov.com/federal-contracts/0369c8db-11a5-568c-9001-b5decabab3fb) has 75 questions on the PWS
  and Technical Exhibits. This is the model for grouping questions by PWS / TE reference.

The SF 30 block labels, the Block 11 acknowledgment paragraph, Block 13 A–E and the "STANDARD FORM 30 (Rev. 11/2016)
Prescribed by GSA – FAR (48 CFR) 53.243" footer follow the standard form.

**Made up for this fixture:** Fort Calder, the issuing office address, the solicitation, requisition and contract
numbers, the incumbent, the contracting officer, and every building, name, square footage, floor count, frequency,
service hour, date and dollar value.
