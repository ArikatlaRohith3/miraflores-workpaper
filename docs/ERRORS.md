# Errors found, and how the design surfaced them

Every item below is raised by an independent check in the app (**Independent checks** view). Each check recomputes from the documents rather than the engine's lines, links to the exact evidence, and, where the fix is mechanical, proposes the change with its tax effect. Effects use engine v3's per-dollar rates (or the engine's what-if result). "Fed" and "CA" are tax changes. Payment corrections change the balance 1:1.

Net effect if every proposal is adopted: **federal tax −9,484 and payments −1,000**, so a balance due of 4,220 becomes a refund of about 4,264. **California tax −6,935 and payments −3,500**, so the refund grows from 8,256 to about 11,691.

## Confident extraction mistakes (the pipeline read the page wrong)

| # | Error | Evidence | Effect | How it surfaced |
|---|---|---|---|---|
| 1 | **RSU basis read as 0.00.** Northlake prints "basis (not reported)" for noncovered RSU lots N1, N3 and N4. The pipeline stored 0.00 at confidence 0.98, so the engine taxed the full proceeds. The plan supplement gives the adjusted basis (19,100 / 19,100 / 9,420), and W-2 box 14 RSU 38,200 equals the two 2025 vests. | D28 p3, D11, D08 | fed −15,536 · CA −2,764 | `rsu-basis` check. The trace view of the extracted value warns "nothing printed here, but the pipeline stored 0". |
| 2 | **Care provider TIN transposed.** The pipeline read 74-3829516 (confidence 0.97); the statement prints 74-3829156. | D62 | filing error, no tax effect | `care-provider-D62`. Form 2441 label compared with the provider's printed TIN. |
| 3 | **Care provider name wrong.** Form 2441 says "Bright Oak Preschool"; the statement and the 2024 return say "Bright Oak Kids Club". | D61, D06 p10 | filing error | `care-provider-D61` |
| 4 | **Page never read.** Meridian page 32 ("Additional transactions") was not extracted, so lot M18 is missing from the return. The engine flagged the 250 summary/detail gap but did not fix it. | D31 p32, ev-0703 | fed −21 | `broker-unread-page` parses the unread page and proposes the missing lot. |
| 5 | **Handwritten receipt, low confidence (0.41).** The first digit is ambiguous (1,500 or 7,500). | D64, msg-08 | none | Engine diagnostic, plus the client's confirmation (msg-08, 1,500) linked as evidence. |

## Engine and rule mistakes (correct reads, wrong treatment)

| # | Error | Evidence | Effect | Check |
|---|---|---|---|---|
| 6 | **Interest counted twice.** The bank-sweep interest of 1,840 is on both the composite 1099 and the stand-alone 1099-INT for the same account (ending 7731). | D28, D29 | fed −640 · CA −127 | `interest-double` |
| 7 | **Wrong exchange rate.** Swedish interest was converted at the 2024 average rate (10.56) instead of the 2025 rate (9.86): 1,747 should be 1,871. | D36, engine_reference fx | fed +43 · CA +9 | `fx-rate-year` |
| 8 | **Duplicate mileage page.** Page 3 is a second scan of page 2. The engine summed page totals (11,800 miles); the unique trips add to 8,100. Car expense of 8,260 should be 5,670. | D23 | fed +919 · CA +80 | `mileage-duplicate-page` |
| 9 | **1099-K added to receipts a second time.** The 12,400 Paywell 1099-K is already inside Atlas's 1099-NEC (D15 p3). Books 151,300 = 1099-NECs 142,000 + 9,300 from clients who issued no 1099. This is exactly the item in the 2028 Letter 566. | D14, D15, D16–D21 | fed −4,402 · CA −384 | `gross-receipts`. The reconciliation table goes straight into the notice response record. |
| 10 | **Personal costs in the business.** The family phone plan (70% business), home internet (50%) and Spotify Family (personal) were all deducted at 100%. | call-01, D15 | fed +541 · CA +48 | `personal-expenses` |
| 11 | **Self-employed health insurance not allowed.** 14,400 was deducted, but Erik could join Ngozi's employer family plan at both jobs (qa-25), which bars the deduction under §162(l)(2)(B). | qa-25, D25 | fed +4,464 · CA +605 (QBI effect not included) | `sehi-eligibility` |
| 12 | **HVAC expensed as a repair.** Replacing the whole HVAC system (11,000) is a restoration and must be capitalized. | D47, call-01 | fed +3,633 · CA +896 (engine what-if) | `hvac-improvement` |
| 13 | **Car donation overstated.** Claimed at the client's Kelley Blue Book value (6,000); the charity sold it for 2,900, which caps the deduction (1098-C box 4c). | D66, qa-39 | fed +806 · CA +149 | `vehicle-donation` |
| 14 | **Home property tax includes the seller's months.** The full 13,420 was deducted, but the seller credited 6,912 for 01/01–07/07 at closing. | D54, D57 | fed +1,462 (through the SALT cap) · CA +332 | `property-tax-proration` |
| 15 | **Payoff interest counted twice.** The payoff interest of 2,150 is already inside the Lonestar 1098 box 1. | D55, D56 | fed +559 · CA +103 | `mortgage-interest-double` |
| 16 | **Q4 federal estimate overstated.** The engine used the client's "4,000 I think"; the IRS transcript shows 3,000. | qa-41, transcript, D67 | fed payments −1,000 | `fed-estimates` |
| 17 | **California estimate belongs to the wrong year.** The 09/15/2025 payment of 3,500 was designated tax year 2024 and is held as a 2024 credit. | D68, FTB account | CA payments −3,500 | `ca-estimates` |
| 18 | **All wages sourced to California.** Halvorsen kept California as the work state through 09/30, but the family moved on 07/15. California-source wages are 107,100 + 22,469 (paystub D73), not 218,400. | D09, D73, qa-45 | CA −5,685 | `ca-wage-source` |
| 19 | **Crypto lot C6 at zero basis and short-term.** The transfer-in date was used as the acquisition date. Per the client it was bought on 03/15/2021 for 3,050, which makes it long-term. Needs the bank statement as support. | D35, msg-07 | fed −1,312 · CA −195 | `crypto-c6-basis` (question to client generated) |
| 20 | **Dependent SSN typo.** The organizer has Theo as 666-74-3309; the 2024 return and his Social Security card show 666-74-3390. This causes the scripted e-file rejection (R0000-504-02). | household, D06, D71 | blocks e-file | `ssn-theo` catches it before filing. If it is ignored, "Transmit" gets the IRS rejection from the packet, which opens a blocking review note. |

## Contradictions and outside items (judgment, no automatic change)

- **Client answers that disagree with the records:**
  - qa-14 "no investments sold" vs 300+ sales
  - qa-15 "didn't really sell" crypto vs 12 dispositions
  - qa-31 "no prior IRA basis" vs the 2024 Form 8606 and Form 5498 showing 7,000
  - qa-39 car value vs the 1098-C sale price
  - qa-41 Q4 amount vs the IRS transcript
- **SEP over-contribution:** 18,000 deposited vs a 15,214 limit (lower once Schedule C is corrected). The excess faces a 6% excise tax unless withdrawn.
- **Filings outside the engagement:**
  - FBAR for the Sparbanken account (above 10,000 USD)
  - Forms 1099-NEC the client never issued to two contractors
  - The 2023 Form 3520 for the foreign inheritance, an open item the prior preparer never resolved
- **ISO exercise:** California AMT not computed, and the California sourcing of the spread needs a decision. The AMT basis (52,000) must carry forward to next year.
- **Prior preparer:** the 2024 home office used 300 sq ft; the measured room is 220. Woodworks basis was "assumed sufficient"; it is now rolled forward properly with the late 2023 K-1.

## Things that looked wrong but checked out

These are shown as passing checks, so the reviewer sees what was tested:

- The duplicate W-2 photo (D10) is counted once.
- The ESPP basis adjustment is right.
- Corrected-1099 changes (M6 wash sale, M9 basis, M14 holding period) are applied.
- Carryovers agree to the 2024 return.
- The W-2 totals and the excess social security credit reconcile.
- The K-1 lines match the return.
- The S corporation basis rolls forward to the engine's 21,215 excess distribution.
- Straight-line depreciation and §1250 recapture recompute.
- Every Brightpath lot (260) adds to the 1099-B summary.
