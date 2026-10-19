// "Start here" tour: a few steps that show a new hire how the workpaper works,
// spotlighting the real controls on the real pages.
import { html, useState, useEffect, useApp } from '../ui.js';

const STEPS = [
  { route: 'overview', sel: '.positions', title: 'The return, three ways', body: 'Every total is shown as the engine computed it, with the changes we have approved, and including changes still proposed. Nothing the engine produced is ever overwritten.' },
  { route: 'overview', sel: '.ready', title: 'Is it ready to file?', body: 'This is computed from the work, not ticked by hand: failing checks, blocking review notes, changes awaiting approval and the firm\'s required steps.' },
  { route: 'overview', sel: '.drawer', open: 'F1040.1z', title: 'Click any number', body: 'Every number opens this trace: the rule and inputs that built it, the source value, and the exact field highlighted on the document page. Verify it, question it or adjust it from here.' },
  { route: 'checks', sel: '.check-card', title: 'Checks that don\'t trust the engine', body: '32 checks recompute the return from the documents. Each failure shows its evidence and a proposed fix with its tax effect. Adopt one, or select several and adopt them together (with undo).' },
  { route: 'adjustments', sel: '.tabs', title: 'Every change keeps its history', body: 'Who changed what, why, on what authority and with what tax effect. Compare engine versions, try what-ifs, and see the full activity log.' },
  { route: 'adjustments', sel: '.role', title: 'Roles are enforced', body: 'Switch who you are acting as. A preparer can\'t approve their own work; the reviewer approves; anything over 1,000 of tax needs the partner. Staff without clearance see identifiers masked.' },
  { route: 'review', sel: '.bell', title: 'What needs you', body: 'The bell lists what is waiting for the person you are acting as: questions, approvals, reopened sign-offs, e-file rejections, notices.' },
  { route: 'review', sel: '.ask-btn', title: 'Ask the workpaper', body: 'Ask a question in plain English. The AI answers only from this return, cites the lines and documents it used (all verified), and nothing changes until a person accepts it.' },
  { route: 'filing', sel: '.flow', title: 'Filing and after', body: 'Send to the client, collect the e-file signature, transmit, handle a rejection, freeze at acceptance, amend on top, and replay the season to the IRS notice.' },
];

export function Tour({ onClose }) {
  const app = useApp();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const step = STEPS[i];
  useEffect(() => {
    if (location.hash !== '#/' + step.route) app.go(step.route);
    if (step.open) setTimeout(() => app.openTrace(step.open), 150);
    let tries = 0;
    const find = () => {
      const el = document.querySelector(step.sel);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => setRect(el.getBoundingClientRect()), 250); }
      else if (tries++ < 20) setTimeout(find, 120);
      else setRect(null);
    };
    setRect(null); setTimeout(find, 200);
    const onResize = () => { const el = document.querySelector(step.sel); if (el) setRect(el.getBoundingClientRect()); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [i]);
  const finish = () => { try { localStorage.setItem('mwp.tour.done', '1'); } catch { } onClose(); };
  const pad = 6;
  const card = rect ? cardPos(rect) : { top: window.innerHeight / 2 - 90, left: window.innerWidth / 2 - 180 };
  return html`<div class="tour" role="dialog" aria-label="Guided tour">
    ${rect ? html`<div class="tour-hole" style=${`top:${rect.top - pad}px;left:${rect.left - pad}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px`}></div>` : html`<div class="tour-dim"></div>`}
    <div class="tour-card card" style=${`top:${card.top}px;left:${card.left}px`}>
      <div class="muted small">Step ${i + 1} of ${STEPS.length}</div>
      <h3>${step.title}</h3>
      <p>${step.body}</p>
      <div class="row">
        <button class="small" onClick=${finish}>Skip tour</button>
        <span style="flex:1"></span>
        ${i > 0 && html`<button class="small" onClick=${() => setI(i - 1)}>Back</button>`}
        ${i < STEPS.length - 1 ? html`<button class="small primary" onClick=${() => setI(i + 1)}>Next</button>` : html`<button class="small primary" onClick=${finish}>Start working</button>`}
      </div>
    </div>
  </div>`;
}

function cardPos(r) {
  const W = 360, H = 200, vw = window.innerWidth, vh = window.innerHeight;
  let top = r.bottom + 14, left = Math.min(Math.max(16, r.left), vw - W - 16);
  if (top + H > vh) top = r.top - H - 14;
  if (top < 16) { top = Math.min(vh - H - 16, Math.max(16, r.top + 20)); left = r.right + 16 + W < vw ? r.right + 16 : Math.max(16, r.left - W - 16); }
  return { top, left };
}

export function shouldAutoStartTour() {
  try { return !localStorage.getItem('mwp.tour.done') && !navigator.webdriver; } catch { return false; }
}
