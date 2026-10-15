# Miraflores Workpaper: Okafor-Lindqvist 2025

A web-native tax workpaper for one complex household's return. It loads `data/packet.json` as delivered and never modifies it. Everything people do is saved as an append-only log on top of the packet.

- **Core idea and data model:** [docs/ONE_PAGER.md](docs/ONE_PAGER.md)
- **Errors found and how the design surfaced them:** [docs/ERRORS.md](docs/ERRORS.md)

## Run it

It is a static site with no build step and no dependencies to install.

```bash
python -m http.server 8000      # from this folder
# open http://localhost:8000
```

To deploy, use any static host: GitHub Pages (push the repo, then Settings → Pages → deploy from the branch root), Netlify Drop (drag the folder in), or Vercel. The page has to be served over HTTP so it can fetch the packet. Opening `index.html` from disk won't work.

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
tools/          probe scripts used to explore the packet, headless check runner, browser smoke test
```

## Decisions and tradeoffs

- **No build and no backend.** Anyone can run it from a link. The cost is that saved state lives in the browser's localStorage. Live collaboration works across tabs and windows on one machine (BroadcastChannel), and **Export/Import log** moves a workpaper between machines. The ledger is designed as the sync unit, so a server would only need an append endpoint and a subscription.
- **Simulated documents.** Pages are rendered from `printed_content`, and values are highlighted by locating them in the text. Trace links point at `(document, page, field position)`, so a real PDF renderer could replace `views/docpage.js` without changing any link.
- **Tax effects from rates.** As the README in the packet instructs, effects are change × rate per category, or the engine's exact result for what-ifs. Where second-order effects matter (QBI, SEP limit, SALT cap), the check either computes them or says so.

## How AI was used

I built this with Claude Code (Anthropic's coding agent) as a pair. Claude:

- read the packet and the brief;
- wrote Python and Node probes that compared every extracted value with its printed text, and every 1099-B lot with Form 8949, to find the confident mistakes;
- drafted the checks, the ledger and the views;
- ran a headless-browser smoke test across every view and a scripted end-to-end season (adopt, approve, sign, transmit, reject, fix, freeze, notice) to catch runtime errors.

I directed the design, reviewed the tax reasoning behind each finding, and made the scope calls.
