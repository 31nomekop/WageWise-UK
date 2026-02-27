// WageWise UK (PWA test build) — 2025/26 PAYE estimator
// Note: This is an annualised estimator. Payroll-period exact calculations can differ.

const TY = {
  standardPersonalAllowance: 12570,
  allowanceTaperStart: 100000,
  additionalRateStarts: 125140,

  ewHigherRateStarts: 50270,

  scStarterUpper: 15397,
  scBasicUpper: 27491,
  scIntermediateUpper: 43662,
  scHigherUpper: 75000,
  scAdvancedUpper: 125140,

  niPrimaryThreshold: 12570,
  niUpperEarningsLimit: 50270,
  niMainRate: 0.08,
  niUpperRate: 0.02,

  slPlan1Threshold: 26065,
  slPlan2Threshold: 28470,
  slPlan4Threshold: 32745,
  slPlan5Threshold: 25000,
  slPostgradThreshold: 21000,
  slPlanRate: 0.09,
  slPostgradRate: 0.06,
};

function round2(x){ return Math.round((x + Number.EPSILON) * 100) / 100; }
function clamp(x, min, max){ return Math.min(Math.max(x, min), max); }

function parseMoney(input){
  if(input == null) return null;
  const t = String(input).trim();
  if(!t) return null;
  // allow commas
  const n = Number(t.replace(/,/g,'.'));
  return Number.isFinite(n) ? n : null;
}

function currencyGBP(x){
  try {
    return new Intl.NumberFormat('en-GB', { style:'currency', currency:'GBP' }).format(x);
  } catch(e){
    return '£' + x.toFixed(2);
  }
}

function parseTaxCode(raw){
  const code = String(raw || '').trim().toUpperCase();
  if(code === 'NT') return { isNoTax:true, allowanceOverride:null, flatRate:null };
  if(code === 'BR') return { isNoTax:false, allowanceOverride:0, flatRate:0.20 };
  if(code === 'D0') return { isNoTax:false, allowanceOverride:0, flatRate:0.40 };
  if(code === 'D1') return { isNoTax:false, allowanceOverride:0, flatRate:0.45 };

  const m = code.match(/^([0-9]+)/);
  if(m){
    const n = parseInt(m[1], 10);
    if(Number.isFinite(n) && n > 0){
      return { isNoTax:false, allowanceOverride: n * 10, flatRate:null };
    }
  }
  return { isNoTax:false, allowanceOverride:null, flatRate:null };
}

function personalAllowance(adjustedNetIncome, taxCode){
  const parsed = parseTaxCode(taxCode);
  if(parsed.isNoTax) return adjustedNetIncome;
  const base = (parsed.allowanceOverride != null) ? parsed.allowanceOverride : TY.standardPersonalAllowance;
  if(base <= 0) return 0;
  if(adjustedNetIncome <= TY.allowanceTaperStart) return base;

  const over = adjustedNetIncome - TY.allowanceTaperStart;
  const reduction = over / 2;
  return round2(Math.max(0, base - reduction));
}

function applyBands(income, bands){
  let tax = 0;
  let lower = 0;
  for(const b of bands){
    const upper = b.upper;
    const rate = b.rate;
    const u = (upper === Infinity) ? income : Math.min(income, upper);
    if(u > lower){
      tax += (u - lower) * rate;
    }
    lower = upper;
    if(income <= upper) break;
  }
  return round2(tax);
}

function incomeTaxAnnual(region, adjustedNetIncome, taxCode){
  const parsed = parseTaxCode(taxCode);
  if(parsed.isNoTax) return 0;

  const income = Math.max(0, adjustedNetIncome);

  if(parsed.flatRate != null){
    return round2(income * parsed.flatRate);
  }

  const allowance = clamp(personalAllowance(income, taxCode), 0, income);

  if(region === 'scotland'){
    const bands = [
      { upper: allowance, rate: 0.00 },
      { upper: TY.scStarterUpper, rate: 0.19 },
      { upper: TY.scBasicUpper, rate: 0.20 },
      { upper: TY.scIntermediateUpper, rate: 0.21 },
      { upper: TY.scHigherUpper, rate: 0.42 },
      { upper: TY.scAdvancedUpper, rate: 0.45 },
      { upper: Infinity, rate: 0.48 },
    ];
    return applyBands(income, bands);
  } else {
    const bands = [
      { upper: allowance, rate: 0.00 },
      { upper: TY.ewHigherRateStarts, rate: 0.20 },
      { upper: TY.additionalRateStarts, rate: 0.40 },
      { upper: Infinity, rate: 0.45 },
    ];
    return applyBands(income, bands);
  }
}

function nationalInsuranceAnnual(annualEarnings){
  const e = Math.max(0, annualEarnings);
  const pt = TY.niPrimaryThreshold;
  const uel = TY.niUpperEarningsLimit;
  if(e <= pt) return 0;

  const mainBand = Math.min(e, uel) - pt;
  const upperBand = Math.max(0, e - uel);
  return round2(mainBand * TY.niMainRate + upperBand * TY.niUpperRate);
}

function studentLoanAnnual(plan, annualEarnings){
  const e = Math.max(0, annualEarnings);
  if(plan === 'none') return 0;

  let threshold = 0;
  let rate = TY.slPlanRate;

  if(plan === 'plan1') threshold = TY.slPlan1Threshold;
  if(plan === 'plan2') threshold = TY.slPlan2Threshold;
  if(plan === 'plan4') threshold = TY.slPlan4Threshold;
  if(plan === 'plan5') threshold = TY.slPlan5Threshold;
  if(plan === 'postgraduate'){ threshold = TY.slPostgradThreshold; rate = TY.slPostgradRate; }

  if(e <= threshold) return 0;
  return round2((e - threshold) * rate);
}

function compute(input){
  const gross = round2(input.grossAnnual);
  const pensionPct = clamp(input.pensionPercent, 0, 100);
  const pension = round2(gross * (pensionPct / 100));

  const taxBase = Math.max(0, input.salarySacrifice ? (gross - pension) : gross);
  const adjustedNetForTax = taxBase;
  const niAndLoanBase = taxBase;

  const tax = incomeTaxAnnual(input.region, adjustedNetForTax, input.taxCode);
  const ni = nationalInsuranceAnnual(niAndLoanBase);
  const sl = studentLoanAnnual(input.studentLoan, niAndLoanBase);

  const net = round2(gross - tax - ni - sl - pension);
  return {
    grossAnnual: gross,
    incomeTaxAnnual: tax,
    nationalInsuranceAnnual: ni,
    studentLoanAnnual: sl,
    pensionAnnual: pension,
    netAnnual: net,
    netMonthly: round2(net / 12),
    netWeekly: round2(net / 52),
  };
}

function renderResults(b){
  const el = document.getElementById('results');
  el.innerHTML = '';

  const makeRow = (label, value, strong=false) => {
    const r = document.createElement('div');
    r.className = 'row';
    r.innerHTML = `<div>${label}</div><div>${strong ? '<strong>' + value + '</strong>' : value}</div>`;
    return r;
  };

  el.appendChild(makeRow('Gross pay (annual)', currencyGBP(b.grossAnnual), true));
  el.appendChild(makeRow('Income Tax (annual)', currencyGBP(b.incomeTaxAnnual)));
  el.appendChild(makeRow('National Insurance (annual)', currencyGBP(b.nationalInsuranceAnnual)));
  el.appendChild(makeRow('Student Loan (annual)', currencyGBP(b.studentLoanAnnual)));
  el.appendChild(makeRow('Pension (annual)', currencyGBP(b.pensionAnnual)));
  el.appendChild(makeRow('Take-home (annual)', currencyGBP(b.netAnnual), true));
  el.appendChild(makeRow('Take-home (monthly)', currencyGBP(b.netMonthly), true));
  el.appendChild(makeRow('Take-home (weekly)', currencyGBP(b.netWeekly), true));
}

function getInputFromUI(){
  const region = document.getElementById('region').value;
  const mode = document.getElementById('mode').value;

  const taxCode = (document.getElementById('taxCode').value || '1257L').trim() || '1257L';
  const pensionPercent = parseMoney(document.getElementById('pensionPercent').value) ?? 0;
  const salarySacrifice = document.getElementById('salarySacrifice').checked;
  const studentLoan = document.getElementById('studentLoan').value;

  let grossAnnual = 0;
  if(mode === 'annualSalary'){
    const annualSalary = parseMoney(document.getElementById('annualSalary').value) ?? 0;
    grossAnnual = annualSalary;
  } else {
    const hourlyRate = parseMoney(document.getElementById('hourlyRate').value) ?? 0;
    const hoursPerWeek = parseMoney(document.getElementById('hoursPerWeek').value) ?? 0;
    grossAnnual = hourlyRate * hoursPerWeek * 52;
  }

  return {
    region, mode, taxCode,
    pensionPercent, salarySacrifice, studentLoan,
    grossAnnual,
  };
}

function resetUI(){
  document.getElementById('region').value = 'england';
  document.getElementById('mode').value = 'annualSalary';
  document.getElementById('annualSalary').value = '';
  document.getElementById('hourlyRate').value = '';
  document.getElementById('hoursPerWeek').value = '';
  document.getElementById('taxCode').value = '1257L';
  document.getElementById('pensionPercent').value = '';
  document.getElementById('salarySacrifice').checked = false;
  document.getElementById('studentLoan').value = 'none';
  document.getElementById('results').innerHTML = '<div class="hint">Enter your details and tap <strong>Calculate</strong>.</div>';
}

function syncModeUI(){
  const mode = document.getElementById('mode').value;
  const annualBox = document.getElementById('annualBox');
  const hourlyBox = document.getElementById('hourlyBox');
  if(mode === 'annualSalary'){
    annualBox.hidden = false;
    hourlyBox.hidden = true;
  } else {
    annualBox.hidden = true;
    hourlyBox.hidden = false;
  }
}

document.getElementById('mode').addEventListener('change', syncModeUI);

document.getElementById('calcBtn').addEventListener('click', () => {
  const input = getInputFromUI();
  const b = compute(input);
  renderResults(b);
});

document.getElementById('resetBtn').addEventListener('click', () => {
  resetUI();
  syncModeUI();
});

// Install prompt (PWA)
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('installBtn');
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    btn.hidden = true;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  }, { once:true });
});

// Service worker
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
// --- Salary Finder (from payslips) ---
function sfMultiplier(freq){
  if(freq === 'weekly') return 52;
  if(freq === 'fortnightly') return 26;
  if(freq === 'fourWeekly') return 13;
  if(freq === 'monthly') return 12;
  return 52;
}

function sfReadPayslips(){
  const freq = document.getElementById('sfFrequency')?.value || 'weekly';
  const nums = ['sfP1','sfP2','sfP3','sfP4']
    .map(id => parseMoney(document.getElementById(id)?.value))
    .filter(v => v != null && v >= 0);
  return { freq, nums };
}

function sfEstimate(){
  const out = document.getElementById('sfOutput');
  const applyBtn = document.getElementById('sfApplyBtn');

  if(!out || !applyBtn) return;

  const { freq, nums } = sfReadPayslips();

  if(nums.length === 0){
    out.innerHTML = '<div class="hint">Enter at least <strong>1</strong> payslip gross value.</div>';
    applyBtn.disabled = true;
    return null;
  }

  const avg = nums.reduce((a,b)=>a+b,0) / nums.length;
  const annual = round2(avg * sfMultiplier(freq));

  out.innerHTML = `
    <div class="row"><div>Average gross per payslip</div><div><strong>${currencyGBP(round2(avg))}</strong></div></div>
    <div class="row"><div>Estimated annual gross salary</div><div><strong>${currencyGBP(annual)}</strong></div></div>
    <div class="hint">Tip: tap <strong>Use as annual salary</strong> to auto-fill the calculator.</div>
  `;

  applyBtn.disabled = false;
  return annual;
}

function sfApplyToCalculator(annual){
  if(annual == null) return;

  // set calculator to annual mode and fill salary
  document.getElementById('mode').value = 'annualSalary';
  syncModeUI();

  const annualInput = document.getElementById('annualSalary');
  annualInput.value = String(annual);

  // scroll to inputs so user sees it changed
  const inputsCard = document.querySelector('.card');
  if(inputsCard) inputsCard.scrollIntoView({ behavior:'smooth', block:'start' });
}

// Wire buttons (safe if section not present)
const sfEstimateBtn = document.getElementById('sfEstimateBtn');
const sfApplyBtn = document.getElementById('sfApplyBtn');

let sfLastAnnual = null;

if(sfEstimateBtn){
  sfEstimateBtn.addEventListener('click', () => {
    sfLastAnnual = sfEstimate();
  });
}

if(sfApplyBtn){
  sfApplyBtn.addEventListener('click', () => {
    sfApplyToCalculator(sfLastAnnual);
  });
}
// boot
resetUI();
syncModeUI();
// ===== UX Enhancements (safe, post-render) =====
(function(){
  const $ = (id) => document.getElementById(id);

  function toast(msg){
    const el = $('toast');
    if(!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(()=> el.classList.remove('show'), 1400);
  }

  function parseGBP(text){
    if(!text) return null;
    const n = String(text).replace(/[^0-9.\-]/g,'');
    if(!n) return null;
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  }

  // Reads values from the Results card (no need to modify tax logic)
  function readResultsFromDOM(){
    const res = $('results');
    if(!res) return null;

    const rows = Array.from(res.querySelectorAll('.row'));
    if(rows.length === 0) return null;

    const data = {};
    for(const r of rows){
      const label = (r.children[0]?.textContent || '').trim().toLowerCase();
      const valueText = r.children[1]?.textContent || '';
      const v = parseGBP(valueText);

      if(label.includes('gross')) data.gross = v;
      if(label.includes('income tax')) data.tax = v;
      if(label.includes('national insurance')) data.ni = v;
      if(label.includes('student loan')) data.loan = v;
      if(label.includes('pension')) data.pension = v;
      if(label.includes('take-home (annual)')) data.netAnnual = v;
      if(label.includes('take-home (monthly)')) data.netMonthly = v;
      if(label.includes('take-home (weekly)')) data.netWeekly = v;
    }

    // only meaningful if we have gross + at least netAnnual
    if(!Number.isFinite(data.gross) || !Number.isFinite(data.netAnnual)) return null;
    return data;
  }

  function applyTakeHomeFocus(){
    const res = $('results');
    if(!res) return;
    const rows = Array.from(res.querySelectorAll('.row'));
    for(const r of rows){
      const label = (r.children[0]?.textContent || '').toLowerCase();
      r.classList.toggle('takeHomeFocus', label.includes('take-home (monthly)'));
    }
  }

  // Basic breakdown bar (segments) + legend
  function renderBreakdown(data){
    const bar = $('breakdownBar');
    const legend = $('barLegend');
    const rateEl = $('effectiveRate');
    if(!bar || !legend || !rateEl || !data) return;

    const gross = data.gross || 0;
    const tax = data.tax || 0;
    const ni = data.ni || 0;
    const loan = data.loan || 0;
    const pension = data.pension || 0;
    const net = data.netAnnual || 0;

    const deductions = (tax + ni + loan + pension);
    const eff = gross > 0 ? (deductions / gross) * 100 : 0;
    rateEl.textContent = gross > 0 ? `${eff.toFixed(1)}%` : '—';

    // prevent weird negatives
    const parts = [
      { key:'Tax', value: Math.max(0, tax), color: 'rgba(255,255,255,.18)' },
      { key:'NI', value: Math.max(0, ni), color: 'rgba(255,255,255,.12)' },
      { key:'Loan', value: Math.max(0, loan), color: 'rgba(255,255,255,.10)' },
      { key:'Pension', value: Math.max(0, pension), color: 'rgba(86,220,174,.20)' },
      { key:'Take-home', value: Math.max(0, net), color: 'rgba(86,220,174,.55)' },
    ];

    // build bar
    bar.innerHTML = '';
    for(const p of parts){
      const pct = gross > 0 ? (p.value / gross) * 100 : 0;
      const seg = document.createElement('div');
      seg.className = 'barSeg';
      seg.style.width = `${Math.max(0, pct)}%`;
      seg.style.background = p.color;
      bar.appendChild(seg);
    }

    // legend
    const fmt = (n) => (Number.isFinite(n) ? `£${n.toFixed(2)}` : '—');
    legend.innerHTML = '';
    for(const p of parts){
      const row = document.createElement('div');
      row.className = 'legendItem';
      row.innerHTML = `
        <div class="legendLeft">
          <span class="legendSwatch" style="background:${p.color}"></span>
          <span>${p.key}</span>
        </div>
        <div><strong>${fmt(p.value)}</strong></div>
      `;
      legend.appendChild(row);
    }
  }

  // Copy helpers
  async function copyText(text, label){
    try{
      await navigator.clipboard.writeText(String(text));
      toast(`${label} copied`);
    }catch(e){
      // fallback prompt
      window.prompt('Copy this:', String(text));
    }
  }

  function wireCopyButtons(){
    const m = $('copyMonthlyBtn');
    const a = $('copyAnnualBtn');
    const w = $('copyWeeklyBtn');
    if(!m || !a || !w) return;

    m.addEventListener('click', () => {
      const d = readResultsFromDOM();
      if(!d || !Number.isFinite(d.netMonthly)) return toast('Calculate first');
      copyText(d.netMonthly.toFixed(2), 'Monthly take-home');
    });

    a.addEventListener('click', () => {
      const d = readResultsFromDOM();
      if(!d || !Number.isFinite(d.netAnnual)) return toast('Calculate first');
      copyText(d.netAnnual.toFixed(2), 'Annual take-home');
    });

    w.addEventListener('click', () => {
      const d = readResultsFromDOM();
      if(!d || !Number.isFinite(d.netWeekly)) return toast('Calculate first');
      copyText(d.netWeekly.toFixed(2), 'Weekly take-home');
    });
  }

  // Hide irrelevant inputs based on pay mode
  function hideUnusedInputs(){
    const mode = $('mode')?.value || '';
    const annualField = $('annualSalary')?.closest('.field');
    const hourlyField = $('hourlyRate')?.closest('.field');
    const hoursField = $('hoursPerWeek')?.closest('.field');

    // default show all if not found
    if(!annualField || !hourlyField || !hoursField) return;

    const isAnnual = mode.toLowerCase().includes('annual');
    annualField.style.display = isAnnual ? '' : 'none';
    hourlyField.style.display = isAnnual ? 'none' : '';
    hoursField.style.display = isAnnual ? 'none' : '';
  }

  // Auto-calc (debounced) when required inputs present
  function autoCalcSetup(){
    const calcBtn = $('calcBtn');
    const resetBtn = $('resetBtn');
    if(!calcBtn) return;

    // reset confirm
    if(resetBtn){
      resetBtn.addEventListener('click', (e) => {
        const ok = confirm('Clear all inputs?');
        if(!ok){
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);
    }

    // debounce typing
    let t = null;
    const kick = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        hideUnusedInputs();

        const mode = $('mode')?.value || '';
        const isAnnual = mode.toLowerCase().includes('annual');

        const annual = parseGBP($('annualSalary')?.value);
        const hr = parseGBP($('hourlyRate')?.value);
        const hrs = parseGBP($('hoursPerWeek')?.value);

        const hasRequired = isAnnual
          ? (annual != null && annual > 0)
          : (hr != null && hr > 0 && hrs != null && hrs > 0);

        if(hasRequired){
          calcBtn.click();
        }
      }, 450);
    };

    // watch inputs/selects
    const inputs = Array.from(document.querySelectorAll('input, select'));
    inputs.forEach(el => el.addEventListener('input', kick));
    inputs.forEach(el => el.addEventListener('change', kick));

    // also on mode change
    $('mode')?.addEventListener('change', () => {
      hideUnusedInputs();
      kick();
    });

    // initial
    hideUnusedInputs();
  }

  // Scenarios: save/load locally
  const SC_KEY = 'wagewiseuk_scenarios_v1';

  function getAllScenarioInputs(){
    // capture known ids if present
    const ids = [
      'region','mode','annualSalary','hourlyRate','hoursPerWeek',
      'taxCode','pensionPct','salarySacrifice','studentLoan',
      'sfFrequency','sfP1','sfP2','sfP3','sfP4'
    ];
    const state = {};
    for(const id of ids){
      const el = $(id);
      if(!el) continue;
      if(el.type === 'checkbox') state[id] = !!el.checked;
      else state[id] = el.value;
    }
    return state;
  }

  function applyScenarioInputs(state){
    if(!state) return;
    Object.entries(state).forEach(([id,val]) => {
      const el = $(id);
      if(!el) return;
      if(el.type === 'checkbox') el.checked = !!val;
      else el.value = String(val);
    });

    // keep UI consistent
    if(typeof syncModeUI === 'function') syncModeUI();
    hideUnusedInputs();
    toast('Scenario loaded');
  }

  function loadScenarios(){
    try{
      const raw = localStorage.getItem(SC_KEY);
      return raw ? JSON.parse(raw) : {};
    }catch(e){
      return {};
    }
  }

  function saveScenarios(obj){
    localStorage.setItem(SC_KEY, JSON.stringify(obj || {}));
  }

  function refreshScenarioUI(){
    const sel = $('scenarioSelect');
    if(!sel) return;
    const all = loadScenarios();
    const names = Object.keys(all).sort((a,b)=>a.localeCompare(b));
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = names.length ? 'Select…' : 'No saved scenarios';
    sel.appendChild(opt0);
    for(const n of names){
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      sel.appendChild(o);
    }
  }

  function wireScenarioButtons(){
    const saveBtn = $('saveScenarioBtn');
    const loadBtn = $('loadScenarioBtn');
    const delBtn = $('deleteScenarioBtn');
    const nameEl = $('scenarioName');
    const sel = $('scenarioSelect');

    if(!saveBtn || !loadBtn || !delBtn || !nameEl || !sel) return;

    refreshScenarioUI();

    saveBtn.addEventListener('click', () => {
      const name = (nameEl.value || '').trim();
      if(!name) return toast('Add a name first');
      const all = loadScenarios();
      all[name] = getAllScenarioInputs();
      saveScenarios(all);
      refreshScenarioUI();
      sel.value = name;
      toast('Scenario saved');
    });

    loadBtn.addEventListener('click', () => {
      const key = sel.value;
      if(!key) return toast('Select a scenario');
      const all = loadScenarios();
      applyScenarioInputs(all[key]);
      // auto-calc after load
      $('calcBtn')?.click();
    });

    delBtn.addEventListener('click', () => {
      const key = sel.value || (nameEl.value || '').trim();
      if(!key) return toast('Select or type a name');
      const all = loadScenarios();
      if(!all[key]) return toast('Not found');
      const ok = confirm(`Delete "${key}"?`);
      if(!ok) return;
      delete all[key];
      saveScenarios(all);
      refreshScenarioUI();
      toast('Deleted');
    });
  }

  // Observe Results updates → enhance automatically
  function observeResults(){
    const res = $('results');
    if(!res) return;

    const run = () => {
      const data = readResultsFromDOM();
      applyTakeHomeFocus();
      renderBreakdown(data);
    };

    const mo = new MutationObserver(() => run());
    mo.observe(res, { childList: true, subtree: true });
    run();
  }

  // Boot UX enhancements
  wireCopyButtons();
  wireScenarioButtons();
  autoCalcSetup();
  observeResults();
})();
