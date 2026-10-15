import { signoffState } from '../ledger.js';
import { varianceFlags, documentDisposition, checkRefIndex } from '../checks.js';

export function checkResolution(c, st) {
  if (c.status === 'pass') return 'pass';
  if (st.dismissed.has(c.id)) return 'dismissed';
  const props = c.proposals || [];
  if (props.length) {
    const adopted = props.filter(p => p.override ? st.overrides.has(p.key) : [...st.adjustments.values()].some(a => a.checkId === c.id && a.key === p.key && a.status !== 'rejected'));
    if (adopted.length === props.length) return 'adopted';
    if (adopted.length) return 'partial';
  }
  const noted = st.judgments.some(j => j.target === 'check:' + c.id);
  if (noted) return 'judged';
  return 'open';
}

export function docDispositions(app) {
  const disp = documentDisposition(app.model, checkRefIndex(app.checks));
  return disp.map(d => {
    const j = app.st.judgments.filter(x => x.target === d.doc.id && x.kind === 'disposition').pop();
    return j ? { ...d, status: d.status === 'unplaced' ? 'disposed' : d.status, disposition: j } : d;
  });
}

export function readiness(app) {
  const { model, st, checks } = app;
  const flags = varianceFlags(model, st.standards);
  const explained = f => st.judgments.some(j => j.target === 'line:' + f.key && j.kind === 'variance_explanation') || [...st.notes.values()].some(n => n.target === 'line:' + f.key && n.kind === 'comment');
  const unplaced = docDispositions(app).filter(d => d.status === 'unplaced');
  const est = ['fed-estimates', 'ca-estimates'].map(id => checks.find(c => c.id === id)).filter(Boolean);
  const diag = model.current.diagnostics.filter(d => d.severity === 'warning');
  const diagDone = diag.filter(d => st.judgments.some(j => j.target === 'diag:' + d.code));
  const steps = {
    'Engagement letter and consents signed': { auto: true, done: true, detail: 'D01 and D02 signed 01/12/2026' },
    'Identity verified': { done: ['D04', 'D05'].every(d => st.verifications.has(d)) || st.steps.has('Identity verified'), detail: 'Verify the driver licenses (D04, D05)' },
    'Prior-year return reviewed': { done: st.steps.has('Prior-year return reviewed') },
    'All documents accounted for': { auto: true, done: unplaced.length === 0, detail: unplaced.length ? `${unplaced.length} document(s) need a disposition` : 'Every document landed or has a reason' },
    'Prior-year variances explained': { auto: true, done: flags.every(explained), detail: `${flags.filter(explained).length} of ${flags.length} explained` },
    'Carryovers agreed to prior year': { done: st.steps.has('Carryovers agreed to prior year') || checks.find(c => c.id === 'carryovers')?.status === 'pass' && st.verifications.has('line:SchD.6'), detail: 'Check passes; verify SchD.6 to confirm' },
    'Estimated payments agreed to IRS and FTB records': { auto: true, done: est.every(c => ['pass', 'adopted', 'dismissed', 'judged'].includes(checkResolution(c, st))), detail: est.map(c => `${c.id}: ${checkResolution(c, st)}`).join(' · ') },
    'Due diligence completed': { auto: true, done: st.judgments.some(j => j.kind === 'due_diligence'), detail: 'Form 8867: record due diligence for CTC/ODC (and AOTC)' },
    'Diagnostics resolved': { auto: true, done: diagDone.length === diag.length, detail: `${diagDone.length} of ${diag.length} engine warnings dispositioned` },
    'Reviewer sign-off': { auto: true, done: signoffState(model, st, 'return', 'reviewer').state === 'signed', detail: signoffState(model, st, 'return', 'reviewer').state },
    'Partner sign-off': { auto: true, done: signoffState(model, st, 'return', 'partner').state === 'signed', detail: signoffState(model, st, 'return', 'partner').state },
    'Client approval and e-file authorization': { auto: true, done: !!st.filing.clientApproval, detail: st.filing.clientApproval ? 'Signed 8879' : 'Waiting for client' },
  };
  const list = (st.standards.required_steps || []).map(name => ({ name, ...(steps[name] || { done: st.steps.has(name) }) }));
  const blockingNotes = [...st.notes.values()].filter(n => n.status === 'open' && n.blocking);
  const openChecks = checks.filter(c => c.status === 'fail' && ['open', 'partial'].includes(checkResolution(c, st)));
  const pendingPartner = [...st.adjustments.values()].filter(a => a.status === 'awaiting_partner' || a.status === 'proposed');
  return { list, blockingNotes, openChecks, pendingPartner, flags, unplaced, diag, explained };
}
