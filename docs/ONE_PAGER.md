# Core idea and data model

## The idea: a return you can interrogate, not a binder you flip through

A traditional workpaper is a stack of pages that *describe* the return. Here the return describes itself. Every number on it is a live node: click it and you see how it was built (rule and inputs), where it came from (the extracted value, highlighted on the page), how it was verified, what changed and why, and which independent check agrees or disagrees.

On top of that sit three ideas:

1. **The packet is immutable evidence; people only add to a log.** Nothing the pipeline produced is ever edited. Every human act is an event appended to a ledger: verify, adjust, note, question, answer, sign off, judge, file, replay. The workpaper on screen is `fold(packet, ledger)`. History, undo (a revert event, never a delete), "what changed since I last looked", live sync between people, freezing at filing and amending on top all fall out of that one choice.
2. **Don't trust the engine — recompute it.** 32 independent checks rebuild amounts from the documents themselves: duplicate pages and forms, totals vs detail, 1099s vs books, agency records vs claimed payments, prior-year carryovers, depreciation, basis roll-forwards, residency sourcing. A failing check carries its evidence and, when the fix is mechanical, a proposed change with its tax effect. One click (or a bulk select) turns findings into proposed adjustments; reviewers and partners approve them under the firm's rules.
3. **Review state is computed, not ticked.** Required steps, "ready to file", and sign-offs derive from the data. A sign-off stores a fingerprint of everything in its scope; if anything inside changes afterwards, the sign-off reopens by itself. Roles are enforced in the action layer, not just hidden in the UI.

## Data model

```
Packet (read-only, loaded as delivered)
  documents[] ── pages[].printed_content            ← simulated page renderer (swap for real PDFs)
  extracted_values[] (doc, page, field, position)   ← trace target
  return_versions[] (v1, v2, v3) ── lines[] { key, rule, inputs[], sources[] }
  client, prior_years, tax_agency_records, firm, timeline, engine_reference, what_if

Ledger (append-only, per client)        Event { seq, id, at, clock, actor, role, type, data, batch }
  adjust           { key, from, to, effects[{cat, base, only, caCat}] | fixed, reason, authority, checkId }
  adjust.decide    { adjId, decision }                    → proposed → awaiting_partner → approved
  verify           { target, method, note }               (method from firm standards)
  note / reply / status  { kind: comment|review|question, to, blocking, target }
  judgment         { kind: judgment|election|due_diligence|penalty|disposition|variance_explanation, decision, authority }
  signoff          { scope: area|return, level, fingerprint }
  attach, override, time, step, standards.update, assign, view.sensitive, replay, filing, seen, revert { ids }

Derived (pure functions)
  state = fold(packet, ledger)        position = engine summary + Σ effects(adjustments)
  checks = runChecks(packet)          readiness = f(state, checks, standards)
  signoffState = stored fingerprint == current fingerprint ? signed : reopened
```

**References are the glue.** Everything is addressed by the packet's own reference grammar (`ev-0226`, `D23`, `doc:D31#page32`, `qa-25`, `py:/carryovers_into_2025/...`, `asset:SAC-BLDG`, line keys). The trace drawer resolves any of them, so a note, a check, a question or a judgment can attach to anything, and the document view only needs `(document, page, field position)` — a real page image drops in without touching a link.

**Tax effects** use the engine's per-dollar rates by category (with California-source overrides), or the engine's exact numbers when a change matches a what-if. The real system would recompute; the design keeps the effect on each change so totals stay explainable.

## Main tradeoffs

- **Static app + browser storage + export/import** instead of a backend: zero build, any static host, works offline; live multi-user is real between tabs/windows (BroadcastChannel) but not across machines. The ledger is the sync unit, so a server is a drop-in (append endpoint + subscription).
- **Checks are coded per risk**, not generic rules: they read like a senior's review and produce exact evidence, at the cost of being specific to this packet's document types.
- **Rates, not recomputation**: honest about being an approximation; second-order effects (QBI, SEP limit, thresholds) are called out where they matter.
