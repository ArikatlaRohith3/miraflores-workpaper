# Miraflores Workpaper: Okafor-Lindqvist 2025

A web-native tax workpaper for one complex household's return. It loads `data/packet.json` as delivered and never modifies it. Everything people do is saved as an append-only log on top of the packet, stored on the server so several people can work on it at once.

**Live:** https://rohith-miraflores-workpaper.netlify.app. Everyone who opens this link shares the `demo` workspace. For a clean copy of your own, click the green status chip in the header, then **Open a new private sandbox**.

- **Core idea and data model:** [docs/ONE_PAGER.md](docs/ONE_PAGER.md)
- **Errors found and how the design surfaced them:** [docs/ERRORS.md](docs/ERRORS.md)

## Run it

The front end is static, with no build step. The shared log is two small Netlify Functions backed by Netlify Blobs.

```bash
netlify dev                     # front end + functions + local storage on http://localhost:8888
# or, front end only (the log is then saved in the browser):
python -m http.server 8000
```

Deploy with `netlify deploy --prod` (it uses `netlify.toml`). Without the functions the app still works: it detects that there is no server and saves in the browser instead.

## Five-minute tour

1. **Acting as** (top right) switches between the six staff and the two clients. Roles are enforced on every action. Two examples:
   - Marcus Bell has no sensitive-data clearance, so he sees masked SSNs.
   - The administrator can edit firm standards but can't change the return.

   Open a second window as a different person and changes appear live.
2. **Overview**: federal and California positions shown three ways: engine, approved changes, and including proposed changes. It also shows readiness to file, required steps (tracked from the data), the summary against last year with variance flags to explain, area tiles, and engine diagnostics.
3. **Independent checks**: 32 checks that recompute the return from the documents. Select all → **Adopt** turns 19 findings into proposed changes in one go, and the toast offers **Undo**.
4. Click **any number** to open the trace drawer: rule and inputs, then sources, then the extracted value highlighted on the simulated page. The drawer also shows v1/v2/v3 and 2024 values, verifications, notes, questions, judgments and attachments.
5. **Changes & versions**: approve as Daniel (reviewer), then as Helen (partner). Changes over 1,000 of tax need the partner, and nobody can approve their own work. This tab also covers compare versions, what-ifs, prior preparer vs us, and the full activity log with per-event undo.
6. **Areas**:
   - Books → tax for the studio.
   - Sales detail: 300+ lots summarized, with exceptions first.
   - Rentals, passive losses and the condo sale.
   - Depreciation by asset: federal vs California vs AMT, disposals and recapture.
   - K-1 lines and basis by year, the state split, payments vs agency records, and carryovers.
7. **Filing & after**:
   - Send to client, then switch to Ngozi and sign the 8879 in the portal.
   - **Transmit**. If Theo's SSN wasn't fixed, the IRS rejection from the packet comes back with a blocking review note. Fix it, transmit again, and the return is accepted and frozen. Later changes become an amendment layer.
   - **Replay** the rest of the season up to the 2028 Letter 566, then **Build response** for a self-contained examination record.
8. **Firm**: standards editor (enforced), time against budget, people and clearance, and the log of sensitive-data views.

`Ctrl K` searches everything: line keys, amounts, documents, securities, answers and people.

## Tests

```bash
node tools/run_checks.mjs                     # the 32 independent checks, headless
node tools/e2e.mjs                            # 115 end-to-end checks of every requirement in the brief, run against the live site
node tools/e2e.mjs http://localhost:8888      # …or against netlify dev
```

`e2e.mjs` drives the real UI in two independent headless Chrome browsers, so it is two different "computers". It covers:

- tracing a number to its exact field and a document to where it landed;
- verification, links and file evidence;
- reconciliations and large detail;
- adjustments with tax effects, live sync and simultaneous saves, bulk adopt and undo, versions and what-ifs;
- role enforcement, PII masking and the view log;
- judgments and completeness;
- client questions, notifications, assignments, blocking notes and reopening sign-offs;
- extension, client signature, e-file rejection and fix, freeze, amendment, notice response, roll-forward;
- standards, time and search, every CPA record, and persistence across reloads.

It uses a throwaway workspace and deletes it afterwards.

## Layout

```
index.html
app/
  model.js      read-only indexes over the packet, reference resolution, masking
  ledger.js     append-only log, fold → state, tax effects, sign-off fingerprints
  checks.js     32 independent checks (also runnable headless: tools/run_checks.mjs)
  views/        overview, checks, area + panels, documents + docpage, trace drawer,
                changes/versions, review, filing, firm, client portal, search
  vendor/       Preact + htm (13 KB, vendored, no CDN at runtime)
data/packet.json   the packet, unchanged
netlify/functions/ ledger.mjs (shared append-only log), files.mjs (evidence files)
tools/          probe scripts used to explore the packet, headless check runner, browser smoke test
```

## Decisions and tradeoffs

- **A tiny backend.** The server only appends and lists events: `/api/ledger` and `/api/files`, about 120 lines in total. Each event is stored under its own unique, time-ordered key, so simultaneous saves never overwrite each other. Load testing found that a single shared document with compare-and-swap lost writes, which is why it uses per-event keys. Browsers poll every 2 seconds, and changes appear on other machines within about 2 seconds. A watermark re-reads a short window, so late writes from another server instance are never missed. There is no login: the role switcher stands in for authentication, so masking and the view log demonstrate the rules rather than enforce them against a determined user.
- **Front end without a build step.** Preact + htm, vendored at 13 KB.
- **Simulated documents.** Pages are rendered from `printed_content`, and values are highlighted by locating them in the text. Trace links point at `(document, page, field position)`, so a real PDF renderer could replace `views/docpage.js` without changing any link.
- **Tax effects from rates.** As the README in the packet instructs, effects are change × rate per category, or the engine's exact result for what-ifs. Where second-order effects matter (QBI, SEP limit, SALT cap), the check either computes them or says so.

## How AI was used

I built this with Claude Code (Anthropic's coding agent) as a pair. Claude:

- read the packet and the brief;
- wrote Python and Node probes that compared every extracted value with its printed text, and every 1099-B lot with Form 8949, to find the confident mistakes;
- drafted the checks, the ledger and the views;
- ran a headless-browser smoke test across every view and a scripted end-to-end season (adopt, approve, sign, transmit, reject, fix, freeze, notice) to catch runtime errors.

I directed the design, reviewed the tax reasoning behind each finding, and made the scope calls.
