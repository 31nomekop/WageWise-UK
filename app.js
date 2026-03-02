const APP_VERSION = "1.3.0";
// WageWise UK (PWA) — 2025/26 PAYE estimator (single-file, GitHub Pages friendly)

// Splash fade-out (keeps first paint clean on slower phones)
window.addEventListener('load', () => {
  const splash = document.getElementById('splash');
  if (!splash) return;
  // small delay so the logo is visible even on fast loads
  setTimeout(() => splash.classList.add('hide'), 450);
  // remove from DOM after transition to keep things tidy
  setTimeout(() => splash.remove(), 900);
});

const TAX_YEARS = {
  "2025/26": {
    label: "2025/26 (current)",
    standardPersonalAllowance: 12570,
    allowanceTaperStart: 100000,
    additionalRateStarts: 125140,
    ewHigherRateStarts: 50270,

    // Scotland (2025/26)
    scStarterUpper: 15397,
    scBasicUpper: 27491,
    scIntermediateUpper: 43662,
    scHigherUpper: 75000,
    scAdvancedUpper: 125140,

    // NI (employee)
    niPrimaryThreshold: 12570,
    niUpperEarningsLimit: 50270,
    niMainRate: 0.08,
    niUpperRate: 0.02,

    // Student loan thresholds
    slPlan1Threshold: 26065,
    slPlan2Threshold: 28470,
    slPlan4Threshold: 32745,
    slPlan5Threshold: 25000,
    slPostgradThreshold: 21000,
    slPlanRate: 0.09,
    slPostgradRate: 0.06,
  },

  "2024/25": {
    label: "2024/25",
    standardPersonalAllowance: 12570,
    allowanceTaperStart: 100000,
    additionalRateStarts: 125140,
    ewHigherRateStarts: 50270,

    // Scotland (2024/25) — differs vs 2025/26
    scStarterUpper: 14876,
    scBasicUpper: 26561,
    scIntermediateUpper: 43662,
    scHigherUpper: 75000,
    scAdvancedUpper: 125140,

    // NI (employee)
    niPrimaryThreshold: 12570,
    niUpperEarningsLimit: 50270,
    niMainRate: 0.08,
    niUpperRate: 0.02,

    // Student loan thresholds
    slPlan1Threshold: 26065,
    slPlan2Threshold: 28470,
    slPlan4Threshold: 32745,
    slPlan5Threshold: 25000,
    slPostgradThreshold: 21000,
    slPlanRate: 0.09,
    slPostgradRate: 0.06,
  },
};

const TAXYEAR_KEY = "wagewiseuk_taxyear_v1";
let currentTaxYear = "2025/26";

function getTY(){
  return TAX_YEARS[currentTaxYear] || TAX_YEARS["2025/26"];
}

function applyTaxYearToUI(){
  const sel = document.getElementById("taxYear");
  if(sel) sel.value = currentTaxYear;

  // Update "Important" copy (index.html)
  const imp = document.getElementById("importantTaxYear");
  if(imp) imp.textContent = currentTaxYear;
}

function setTaxYear(year){
  if(!TAX_YEARS[year]) year = "2025/26";
  currentTaxYear = year;
  try{ localStorage.setItem(TAXYEAR_KEY, currentTaxYear); }catch(e){}
  applyTaxYearToUI();

  // Recalculate if we already have results on screen
  const mode = document.getElementById('mode')?.value || 'annualSalary';
  const isAnnual = mode === 'annualSalary';
  const annual = parseMoney(document.getElementById('annualSalary')?.value);
  const hr = parseMoney(document.getElementById('hourlyRate')?.value);
  const hrs = parseMoney(document.getElementById('hoursPerWeek')?.value);
  const ok = isAnnual ? (annual != null && annual > 0) : (hr != null && hr > 0 && hrs != null && hrs > 0);
  if(ok) document.getElementById('calcBtn')?.click();
}

function round2(x){ return Math.round((x + Number.EPSILON) * 100) / 100; }
function clamp(x, min, max){ return Math.min(Math.max(x, min), max); }

function parseMoney(input){
  if(input == null) return null;
  const t = String(input).trim();
  if(!t) return null;
  const n = Number(t.replace(/,/g,''));
  return Number.isFinite(n) ? n : null;
}

function currencyGBP(x){
  try { return new Intl.NumberFormat('en-GB', { style:'currency', currency:'GBP' }).format(x); }
  catch(e){ return '£' + Number(x).toFixed(2); }
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
    if(Number.isFinite(n) && n > 0) return { isNoTax:false, allowanceOverride: n * 10, flatRate:null };
  }
  return { isNoTax:false, allowanceOverride:null, flatRate:null };
}

function personalAllowance(adjustedNetIncome, taxCode, ty){
  const parsed = parseTaxCode(taxCode);
  if(parsed.isNoTax) return adjustedNetIncome;

  const base = (parsed.allowanceOverride != null) ? parsed.allowanceOverride : ty.standardPersonalAllowance;
  if(base <= 0) return 0;
  if(adjustedNetIncome <= ty.allowanceTaperStart) return base;

  const over = adjustedNetIncome - ty.allowanceTaperStart;
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
    if(u > lower) tax += (u - lower) * rate;
    lower = upper;
    if(income <= upper) break;
  }
  return round2(tax);
}

function incomeTaxAnnual(region, adjustedNetIncome, taxCode, ty){
  const parsed = parseTaxCode(taxCode);
  if(parsed.isNoTax) return 0;

  const income = Math.max(0, adjustedNetIncome);
  if(parsed.flatRate != null) return round2(income * parsed.flatRate);

  const allowance = clamp(personalAllowance(income, taxCode, ty), 0, income);

  if(region === 'scotland'){
    const bands = [
      { upper: allowance, rate: 0.00 },
      { upper: ty.scStarterUpper, rate: 0.19 },
      { upper: ty.scBasicUpper, rate: 0.20 },
      { upper: ty.scIntermediateUpper, rate: 0.21 },
      { upper: ty.scHigherUpper, rate: 0.42 },
      { upper: ty.scAdvancedUpper, rate: 0.45 },
      { upper: Infinity, rate: 0.48 },
    ];
    return applyBands(income, bands);
  } else {
    const bands = [
      { upper: allowance, rate: 0.00 },
      { upper: ty.ewHigherRateStarts, rate: 0.20 },
      { upper: ty.additionalRateStarts, rate: 0.40 },
      { upper: Infinity, rate: 0.45 },
    ];
    return applyBands(income, bands);
  }
}

function nationalInsuranceAnnual(annualEarnings, ty){
  const e = Math.max(0, annualEarnings);
  const pt = ty.niPrimaryThreshold;
  const uel = ty.niUpperEarningsLimit;
  if(e <= pt) return 0;
  const mainBand = Math.min(e, uel) - pt;
  const upperBand = Math.max(0, e - uel);
  return round2(mainBand * ty.niMainRate + upperBand * ty.niUpperRate);
}

function studentLoanAnnual(plan, annualEarnings, ty){
  const e = Math.max(0, annualEarnings);
  if(plan === 'none') return 0;

  let threshold = 0;
  let rate = ty.slPlanRate;

  if(plan === 'plan1') threshold = ty.slPlan1Threshold;
  if(plan === 'plan2') threshold = ty.slPlan2Threshold;
  if(plan === 'plan4') threshold = ty.slPlan4Threshold;
  if(plan === 'plan5') threshold = ty.slPlan5Threshold;
  if(plan === 'postgraduate'){ threshold = ty.slPostgradThreshold; rate = ty.slPostgradRate; }

  if(e <= threshold) return 0;
  return round2((e - threshold) * rate);
}

function compute(input){
  const gross = round2(input.grossAnnual);
  const pensionPct = clamp(input.pensionPercent, 0, 100);
  const pension = round2(gross * (pensionPct / 100));

  const base = Math.max(0, input.salarySacrifice ? (gross - pension) : gross);

  const ty = getTY();
  const tax = incomeTaxAnnual(input.region, base, input.taxCode, ty);
  const ni = nationalInsuranceAnnual(base, ty);
  const sl = studentLoanAnnual(input.studentLoan, base, ty);

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

function updateUxExtras(b){
  const gross = b.grossAnnual || 0;
  const tax = b.incomeTaxAnnual || 0;
  const ni = b.nationalInsuranceAnnual || 0;
  const sl = b.studentLoanAnnual || 0;
  const pension = b.pensionAnnual || 0;
  const takeHome = b.netAnnual || 0;

  const effectiveRateEl = document.getElementById('effectiveRate');
  if(effectiveRateEl){
    if(gross > 0){
      const total = tax + ni + sl + pension;
      effectiveRateEl.textContent = ((total / gross) * 100).toFixed(1) + '%';
    } else effectiveRateEl.textContent = '—';
  }

  const breakdownBar = document.getElementById('breakdownBar');
  const barLegend = document.getElementById('barLegend');
  if(!breakdownBar || !barLegend) return;

  breakdownBar.innerHTML = '';
  barLegend.innerHTML = '';
  if(gross <= 0) return;

  const segments = [
    { label:'Tax', value: tax, color:'rgba(255,255,255,.18)' },
    { label:'NI', value: ni, color:'rgba(255,255,255,.12)' },
    { label:'Student Loan', value: sl, color:'rgba(255,255,255,.10)' },
    { label:'Pension', value: pension, color:'rgba(86,220,174,.20)' },
    { label:'Take-home', value: takeHome, color:'rgba(86,220,174,.55)' },
  ];

  for(const seg of segments){
    const pct = Math.max(0, (seg.value / gross) * 100);
    const div = document.createElement('div');
    div.className = 'barSeg';
    div.style.width = pct + '%';
    div.style.background = seg.color;
    breakdownBar.appendChild(div);

    const item = document.createElement('div');
    item.className = 'legendItem';
    item.innerHTML = `
      <div class="legendLeft">
        <span class="legendSwatch" style="background:${seg.color}"></span>
        <span>${seg.label}</span>
      </div>
      <div><strong>${currencyGBP(seg.value)}</strong></div>
    `;
    barLegend.appendChild(item);
  }
}

function renderResults(b){
  const el = document.getElementById('results');
  if(!el) return;
  el.innerHTML = '';

  const makeRow = (label, value, strong=false) => {
    const r = document.createElement('div');
    r.className = 'row';
    if(label.toLowerCase().includes('take-home (monthly)')) r.classList.add('takeHomeFocus');
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

  updateUxExtras(b);
}

function getInputFromUI(){
  const taxYear = document.getElementById('taxYear')?.value || currentTaxYear;
  const region = document.getElementById('region').value;
  const mode = document.getElementById('mode').value;
  const preset = (document.getElementById('taxCodePreset')?.value || '1257L').trim();
  const custom = (document.getElementById('taxCodeCustom')?.value || '').trim();
  const taxCode = (preset === 'custom' ? (custom || '1257L') : (preset || '1257L')).toUpperCase();
  const pensionPercent = parseMoney(document.getElementById('pensionPercent').value) ?? 0;
  const salarySacrifice = document.getElementById('salarySacrifice').checked;
  const studentLoan = document.getElementById('studentLoan').value;

  let grossAnnual = 0;
  if(mode === 'annualSalary'){
    grossAnnual = parseMoney(document.getElementById('annualSalary').value) ?? 0;
  } else {
    const hourlyRate = parseMoney(document.getElementById('hourlyRate').value) ?? 0;
    const hoursPerWeek = parseMoney(document.getElementById('hoursPerWeek').value) ?? 0;
    grossAnnual = hourlyRate * hoursPerWeek * 52;
  }

  return { taxYear, region, mode, taxCode, pensionPercent, salarySacrifice, studentLoan, grossAnnual };
}

function syncModeUI(){
  const mode = document.getElementById('mode').value;
  document.getElementById('annualBox').hidden = (mode !== 'annualSalary');
  document.getElementById('hourlyBox').hidden = (mode === 'annualSalary');
}

// Safety alias (prevents accidental runtime crash if an older call exists)
function syncModelUI(){
  syncModeUI();
}

function toast(msg){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> el.classList.remove('show'), 1400);
}

// ===== Inline validation (light layer) =====
function setFieldError(inputId, errId, msg){
  const input = document.getElementById(inputId);
  const err = document.getElementById(errId);
  if(!input || !err) return;

  if(!msg){
    err.textContent = '';
    input.classList.remove('invalid');
  } else {
    err.textContent = msg;
    input.classList.add('invalid');
  }
}

function readNonNegNumber(inputId){
  const el = document.getElementById(inputId);
  if(!el) return { ok:false, n:null, blank:true };
  const raw = String(el.value ?? '').trim();
  if(raw === '') return { ok:false, n:null, blank:true };

  const n = parseMoney(raw);
  if(n == null || !Number.isFinite(n)) return { ok:false, n:null, blank:false };
  if(n < 0) return { ok:false, n:n, blank:false };
  return { ok:true, n:n, blank:false };
}

function validateAllInputs(){
  // clear everything first
  [
    ['annualSalary','err_annualSalary'],
    ['pensionPercent','err_pensionPercent'],
    ['hourlyRate','err_hourlyRate'],
    ['hoursPerWeek','err_hoursPerWeek'],
    ['sfP1','err_sfP1'],
    ['sfP2','err_sfP2'],
    ['sfP3','err_sfP3'],
    ['sfP4','err_sfP4'],
  ].forEach(([i,e]) => setFieldError(i,e,''));

  const mode = document.getElementById('mode')?.value || 'annualSalary';

  // Calculator validation (only validate visible mode while typing)
  if(mode === 'annualSalary'){
    const v = readNonNegNumber('annualSalary');
    if(!v.blank && !v.ok) setFieldError('annualSalary','err_annualSalary','Enter a valid annual salary.');
  } else {
    const hr = readNonNegNumber('hourlyRate');
    const hrs = readNonNegNumber('hoursPerWeek');
    if(!hr.blank && !hr.ok) setFieldError('hourlyRate','err_hourlyRate','Enter a valid hourly rate.');
    if(!hrs.blank && !hrs.ok) setFieldError('hoursPerWeek','err_hoursPerWeek','Enter valid hours per week.');
  }

  const pen = readNonNegNumber('pensionPercent');
  if(!pen.blank && !pen.ok) setFieldError('pensionPercent','err_pensionPercent','Pension must be a number (0–100).');
  if(pen.ok && pen.n > 100) setFieldError('pensionPercent','err_pensionPercent','Pension cannot be over 100%.');

  // Tax code validation (light)
  const presetTC = (document.getElementById('taxCodePreset')?.value || '1257L');
  const customTC = (document.getElementById('taxCodeCustom')?.value || '').trim().toUpperCase();
  if(presetTC === 'custom' && customTC){
    const ok = /^(NT|BR|D0|D1|0T|K\d+|\d+[A-Z])$/.test(customTC);
    if(!ok) setFieldError('taxCodeCustom','err_taxCodeCustom','Check your tax code format (e.g. 1257L, BR, 0T).');
  }


  // Salary Finder validation (only if values are entered)
  ['sfP1','sfP2','sfP3','sfP4'].forEach(id => {
    const v = readNonNegNumber(id);
    if(!v.blank && !v.ok) setFieldError(id, 'err_' + id, 'Enter a valid gross pay amount.');
  });
}

// Salary Finder
function sfSolveGrossFromNet(targetNetAnnual, assumptions){
  // Binary search gross salary so compute() netAnnual matches target net.
  // assumptions: {region,taxCode,pensionPercent,salarySacrifice,studentLoan}
  let lo = 0, hi = 300000; // plenty for typical users
  for(let i=0;i<28;i++){
    const mid = (lo + hi) / 2;
    const out = compute({
      grossAnnual: mid,
      region: assumptions.region,
      taxCode: assumptions.taxCode,
      pensionPercent: assumptions.pensionPercent,
      salarySacrifice: assumptions.salarySacrifice,
      studentLoan: assumptions.studentLoan
    });
    if(out.netAnnual < targetNetAnnual) lo = mid;
    else hi = mid;
  }
  return round2((lo+hi)/2);
}

function sfMultiplier(freq){
  if(freq === 'weekly') return 52;
  if(freq === 'fortnightly') return 26;
  if(freq === 'fourWeekly') return 13;
  if(freq === 'monthly') return 12;
  return 52;
}
function sfReadPayslips(){
  const freq = document.getElementById('sfFrequency')?.value || 'weekly';
  const nums = ['sfP1','sfP2','sfP3','sfP4'].map(id => parseMoney(document.getElementById(id)?.value))
    .filter(v => v != null && v >= 0);
  return { freq, nums };
}
let sfLastAnnual = null;
function sfEstimate(){
  const out = document.getElementById('sfOutput');
  const applyBtn = document.getElementById('sfApplyBtn');
  if(!out || !applyBtn) return null;

  const { freq, mode, nums } = sfReadPayslips();
  if(nums.length === 0){
    out.innerHTML = '<div class="hint">Add up to 4 payslips, then tap <strong>Estimate</strong>.</div>';
    applyBtn.disabled = true;
    return null;
  }

  const avg = nums.reduce((a,b)=>a+b,0) / nums.length;
  const annualFromEntry = round2(avg * sfMultiplier(freq));

  // Assumptions from calculator (region, pension, tax code, student loan)
  const calc = getInputFromUI();
  const baseAssumptions = {
    region: calc.region,
    pensionPercent: calc.pensionPercent,
    salarySacrifice: calc.salarySacrifice,
    studentLoan: calc.studentLoan
  };

  let annual = annualFromEntry;
  let rangeMin = null, rangeMax = null;
  let modeLabel = (mode === 'net') ? 'take-home (bank)' : 'gross (payslip)';

  if(mode === 'net'){
    const targetNet = annualFromEntry;
    const codes = [
      calc.taxCode || '1257L',
      '1257L',
      'BR',
      '0T'
    ].filter((v,i,arr)=>arr.indexOf(v)===i);

    const estimates = codes.map(code => sfSolveGrossFromNet(targetNet, { ...baseAssumptions, taxCode: code }));
    annual = estimates[0];
    rangeMin = Math.min(...estimates);
    rangeMax = Math.max(...estimates);
  }

  sfLastAnnual = annual;

  const pretty = currencyGBP(annual, 0);
  const hintRange = (rangeMin != null && rangeMax != null && Math.abs(rangeMax-rangeMin) >= 10)
    ? `<div class="hint">Range: <strong>${currencyGBP(rangeMin,0)}</strong> – <strong>${currencyGBP(rangeMax,0)}</strong> (varies mainly by tax code)</div>`
    : '';

  out.innerHTML = `
    <div class="big">Estimated annual salary: <strong>${pretty}</strong></div>
    <div class="muted">Based on ${nums.length} ${modeLabel} value(s), paid <strong>${freq.replace(/([A-Z])/g,' $1')}</strong>.</div>
    ${hintRange}
    <div class="hint">Tip: tap <strong>Use as annual salary</strong> to auto-fill the calculator with the same assumptions.</div>
  `;
  applyBtn.disabled = false;
  return annual;
}
function sfApplyToCalculator(annual){
  if(annual == null) return;
  document.getElementById('mode').value = 'annualSalary';
  syncModeUI();
  setActiveView('calc');
  document.getElementById('annualSalary').value = String(annual);
  validateAllInputs();
  document.getElementById('inputsCard')?.scrollIntoView({behavior:'smooth', block:'start'});
  document.getElementById('calcBtn').click();
}
function sfClear(){
  ['sfP1','sfP2','sfP3','sfP4'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  document.getElementById('sfOutput').innerHTML = '<div class="hint">Add up to 4 payslips, then tap <strong>Estimate</strong>.</div>';
  document.getElementById('sfApplyBtn').disabled = true;
  sfLastAnnual = null;
  validateAllInputs();
}


// Last used inputs (auto-restore)
const LAST_KEY = 'wagewiseuk_laststate_v1';
function loadLastState(){
  try{ return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); }catch(e){ return null; }
}
function saveLastState(state){
  try{ localStorage.setItem(LAST_KEY, JSON.stringify(state || {})); }catch(e){}
}
let lastSaveT = null;
function scheduleLastStateSave(){
  clearTimeout(lastSaveT);
  lastSaveT = setTimeout(() => {
    saveLastState(getScenarioState());
  }, 350);
}

// Scenarios
const SC_KEY = 'wagewiseuk_scenarios_v1';
function loadScenarios(){ try{ return JSON.parse(localStorage.getItem(SC_KEY) || '{}'); } catch(e){ return {}; } }
function saveScenarios(obj){ localStorage.setItem(SC_KEY, JSON.stringify(obj || {})); }
function getScenarioState(){
  const ids = ['taxYear','region','mode','annualSalary','hourlyRate','hoursPerWeek','taxCodePreset','taxCodeCustom','pensionPercent','salarySacrifice','studentLoan','sfFrequency','sfMode','sfP1','sfP2','sfP3','sfP4'];
  const state = {};
  for(const id of ids){
    const el = document.getElementById(id);
    if(!el) continue;
    state[id] = (el.type === 'checkbox') ? !!el.checked : el.value;
  }
  return state;
}
function applyScenarioState(state){
  if(!state) return;
  if(state.taxYear) setTaxYear(String(state.taxYear));
  Object.entries(state).forEach(([id,val]) => {
    const el = document.getElementById(id);
    if(!el) return;
    if(el.type === 'checkbox') el.checked = !!val;
    else el.value = String(val);
  });
  syncModeUI();
  validateAllInputs();
  document.getElementById('calcBtn').click();
}
function refreshScenarioUI(){
  const sel = document.getElementById('scenarioSelect');
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
  const saveBtn = document.getElementById('saveScenarioBtn');
  const loadBtn = document.getElementById('loadScenarioBtn');
  const delBtn = document.getElementById('deleteScenarioBtn');
  const nameEl = document.getElementById('scenarioName');
  const sel = document.getElementById('scenarioSelect');
  if(!saveBtn || !loadBtn || !delBtn || !nameEl || !sel) return;
  refreshScenarioUI();
  saveBtn.addEventListener('click', () => {
    const name = (nameEl.value || '').trim();
    if(!name) return toast('Add a name first');
    const all = loadScenarios();
    all[name] = getScenarioState();
    saveScenarios(all);
    refreshScenarioUI();
    sel.value = name;
    toast('Scenario saved');
  });
  loadBtn.addEventListener('click', () => {
    const key = sel.value;
    if(!key) return toast('Select a scenario');
    applyScenarioState(loadScenarios()[key]);
    toast('Scenario loaded');
  });
  delBtn.addEventListener('click', () => {
    const key = sel.value || (nameEl.value || '').trim();
    if(!key) return toast('Select or type a name');
    const all = loadScenarios();
    if(!all[key]) return toast('Not found');
    if(!confirm(`Delete "${key}"?`)) return;
    delete all[key];
    saveScenarios(all);
    refreshScenarioUI();
    toast('Deleted');
  });
}

// Copy buttons
let lastResult = null;
async function copyText(text, label){
  try{ await navigator.clipboard.writeText(String(text)); toast(label + ' copied'); }
  catch(e){ window.prompt('Copy this:', String(text)); }
}
function wireCopyButtons(){
  const m = document.getElementById('copyMonthlyBtn');
  const a = document.getElementById('copyAnnualBtn');
  const w = document.getElementById('copyWeeklyBtn');
  if(!m || !a || !w) return;
  m.addEventListener('click', () => { if(!lastResult) return toast('Calculate first'); copyText(lastResult.netMonthly.toFixed(2),'Monthly take-home'); });
  a.addEventListener('click', () => { if(!lastResult) return toast('Calculate first'); copyText(lastResult.netAnnual.toFixed(2),'Annual take-home'); });
  w.addEventListener('click', () => { if(!lastResult) return toast('Calculate first'); copyText(lastResult.netWeekly.toFixed(2),'Weekly take-home'); });
}


function wireTaxYearSelector(){
  const sel = document.getElementById('taxYear');
  if(!sel) return;
  sel.addEventListener('change', () => setTaxYear(sel.value));
}

function buildShareSummary(){
  if(!lastResult) return null;
  const input = getInputFromUI();
  return [
    `WageWise UK (${currentTaxYear})`,
    `Gross (annual): ${currencyGBP(lastResult.grossAnnual)}`,
    `Take-home (annual): ${currencyGBP(lastResult.netAnnual)}`,
    `Take-home (monthly): ${currencyGBP(lastResult.netMonthly)}`,
    `Take-home (weekly): ${currencyGBP(lastResult.netWeekly)}`,
    `Tax: ${currencyGBP(lastResult.incomeTaxAnnual)} • NI: ${currencyGBP(lastResult.nationalInsuranceAnnual)} • SL: ${currencyGBP(lastResult.studentLoanAnnual)} • Pension: ${currencyGBP(lastResult.pensionAnnual)}`,
    `Region: ${input.region} • Tax code: ${input.taxCode} • Student loan: ${input.studentLoan}`
  ].join('\n');
}

function wireShareButton(){
  const btn = document.getElementById('shareBtn');
  if(!btn) return;
  btn.addEventListener('click', async () => {
    if(!lastResult) return toast('Calculate first');
    const text = buildShareSummary();
    try{
      if(navigator.share){
        await navigator.share({ title: 'WageWise UK', text });
        toast('Shared');
      } else {
        await copyText(text, 'Summary');
      }
    }catch(e){
      // user cancelled share is fine
    }
  });
}


// Auto-calc
let debounceT = null;
function scheduleAutoCalc(){
  clearTimeout(debounceT);
  debounceT = setTimeout(() => {
    const mode = document.getElementById('mode').value;
    const isAnnual = mode === 'annualSalary';
    const annual = parseMoney(document.getElementById('annualSalary').value);
    const hr = parseMoney(document.getElementById('hourlyRate').value);
    const hrs = parseMoney(document.getElementById('hoursPerWeek').value);
    const ok = isAnnual ? (annual != null && annual > 0) : (hr != null && hr > 0 && hrs != null && hrs > 0);
    if(ok) document.getElementById('calcBtn').click();
  }, 450);
}

function runCalculation(){
  const input = getInputFromUI();
  const el = document.getElementById('results');
  const showError = (msg) => { if(el) el.innerHTML = `<div class="hint">${msg}</div>`; };

  // Inline validation on submit
  validateAllInputs();

  if(input.mode === 'annualSalary' && (!input.grossAnnual || input.grossAnnual <= 0)){
    setFieldError('annualSalary','err_annualSalary','Annual salary is required.');
    showError('Enter an annual salary to calculate.');
    lastResult = null;
    updateUxExtras({grossAnnual:0,incomeTaxAnnual:0,nationalInsuranceAnnual:0,studentLoanAnnual:0,pensionAnnual:0,netAnnual:0});
    return;
  }
  if(input.mode !== 'annualSalary'){
    const hr = parseMoney(document.getElementById('hourlyRate').value);
    const hrs = parseMoney(document.getElementById('hoursPerWeek').value);
    if(!(hr > 0 && hrs > 0)){
      setFieldError('hourlyRate','err_hourlyRate','Hourly rate is required.');
      setFieldError('hoursPerWeek','err_hoursPerWeek','Hours per week is required.');
      showError('Enter an hourly rate and hours per week to calculate.');
      lastResult = null;
      updateUxExtras({grossAnnual:0,incomeTaxAnnual:0,nationalInsuranceAnnual:0,studentLoanAnnual:0,pensionAnnual:0,netAnnual:0});
      return;
    }
  }

  const b = compute(input);
  lastResult = b;
  renderResults(b);
}

// Reset
function resetUI(){
  document.getElementById('region').value = 'england';
  document.getElementById('mode').value = 'annualSalary';
  document.getElementById('annualSalary').value = '';
  document.getElementById('hourlyRate').value = '';
  document.getElementById('hoursPerWeek').value = '';
  const tcPreset=document.getElementById('taxCodePreset');
  const tcCustom=document.getElementById('taxCodeCustom');
  if(tcPreset) tcPreset.value='1257L';
  if(tcCustom) tcCustom.value='';
  document.getElementById('pensionPercent').value = '';
  document.getElementById('salarySacrifice').checked = false;
  document.getElementById('studentLoan').value = 'none';
  sfClear();
  document.getElementById('results').innerHTML = '<div class="hint">Enter your details and tap <strong>Calculate</strong>.</div>';
  updateUxExtras({grossAnnual:0,incomeTaxAnnual:0,nationalInsuranceAnnual:0,studentLoanAnnual:0,pensionAnnual:0,netAnnual:0});
  validateAllInputs();
}

// Install prompt
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('installBtn');
  if(!btn) return;
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



// -------------------- View switcher (Calculator vs Salary Finder) --------------------
function setActiveView(view){
  const calc = document.getElementById('viewCalc');
  const salary = document.getElementById('viewSalary');
  const tabCalc = document.getElementById('tabCalc');
  const tabSalary = document.getElementById('tabSalary');
  if(!calc || !salary || !tabCalc || !tabSalary) return;

  const isCalc = view === 'calc';
  calc.hidden = !isCalc;
  salary.hidden = isCalc;

  tabCalc.classList.toggle('active', isCalc);
  tabSalary.classList.toggle('active', !isCalc);
  tabCalc.setAttribute('aria-selected', String(isCalc));
  tabSalary.setAttribute('aria-selected', String(!isCalc));
}

function wireViewSwitcher(){
  const tabCalc = document.getElementById('tabCalc');
  const tabSalary = document.getElementById('tabSalary');
  if(!tabCalc || !tabSalary) return;

  tabCalc.addEventListener('click', () => setActiveView('calc'));
  tabSalary.addEventListener('click', () => setActiveView('salary'));
}


// Wire events
document.getElementById('mode').addEventListener('change', () => { syncModeUI(); validateAllInputs(); scheduleAutoCalc(); });

['region','annualSalary','hourlyRate','hoursPerWeek','taxCode','pensionPercent','salarySacrifice','studentLoan'].forEach(id => {
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener('input', scheduleAutoCalc);
  el.addEventListener('change', scheduleAutoCalc);
});

// live inline validation
['annualSalary','hourlyRate','hoursPerWeek','pensionPercent','sfP1','sfP2','sfP3','sfP4'].forEach(id => {
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener('input', validateAllInputs);
  el.addEventListener('change', validateAllInputs);
});

document.getElementById('calcBtn').addEventListener('click', () => { try{ runCalculation(); } catch(e){ console.error(e); toast('Error: check inputs'); } });

document.getElementById('resetBtn').addEventListener('click', () => {
  if(!confirm('Clear all inputs?')) return;
  try{ localStorage.removeItem(LAST_KEY); }catch(e){}
  try{ localStorage.removeItem(TAXYEAR_KEY); }catch(e){}
  setTaxYear('2025/26');
  resetUI();
  syncModeUI();
  toast('Cleared');
});

document.getElementById('sfEstimateBtn').addEventListener('click', () => {
  validateAllInputs();
  sfLastAnnual = sfEstimate();
});
document.getElementById('sfApplyBtn').addEventListener('click', () => { sfApplyToCalculator(sfLastAnnual); });
document.getElementById('sfClearBtn').addEventListener('click', () => { sfClear(); });


function wireTaxCodeUI(){
  const preset = document.getElementById('taxCodePreset');
  const custom = document.getElementById('taxCodeCustom');
  if(!preset || !custom) return;
  function sync(){
    const isCustom = preset.value === 'custom';
    custom.style.display = isCustom ? '' : 'none';
    const err = document.getElementById('err_taxCodeCustom');
    if(err) err.textContent = '';
    validateAllInputs();
  }
  preset.addEventListener('change', sync);
  custom.addEventListener('input', () => { if(preset.value !== 'custom') return; validateAllInputs(); scheduleLastStateSave(); });
  sync();
}

function wireHelpToggles(){
  document.querySelectorAll('.helpBtn[data-help]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-help');
      const el = document.getElementById(id);
      if(!el) return;
      const isHidden = el.hasAttribute('hidden');
      if(isHidden) el.removeAttribute('hidden');
      else el.setAttribute('hidden','');
    });
  });
}

function wireSalaryFinderMode(){
  const mode = document.getElementById('sfMode');
  if(!mode) return;
  const labels = ['sfP1','sfP2','sfP3','sfP4'].map(id => document.getElementById(id)?.closest('label'));
  function apply(){
    const isNet = mode.value === 'net';
    labels.forEach((lab,i) => {
      const span = lab?.querySelector('span');
      if(span){
        span.childNodes[0].nodeValue = (isNet ? `Take-home (Payslip ${i+1})` : `Gross pay (Payslip ${i+1})`) + ' ';
      }
      const inp = lab?.querySelector('input');
      if(inp) inp.placeholder = isNet ? 'e.g. 1721.91' : 'e.g. 420.50';
    });
    const help = document.getElementById('help_sfGross');
    if(help){
      help.innerHTML = isNet
        ? 'Enter the <strong>bank (take-home)</strong> amount. WageWise will estimate gross salary using your assumptions in Calculator → More options.'
        : 'Use the <strong>Gross pay</strong> figure from your payslip. If you only know what hit your bank, switch to <strong>Take-home (bank)</strong>.';
    }
  }
  mode.addEventListener('change', () => { apply(); validateAllInputs(); scheduleLastStateSave(); });
  apply();
}

wireScenarioButtons();
wireCopyButtons();

// boot
// Restore tax year preference first
try{
  const savedTY = localStorage.getItem(TAXYEAR_KEY);
  if(savedTY && TAX_YEARS[savedTY]) currentTaxYear = savedTY;
}catch(e){}
applyTaxYearToUI();
wireTaxYearSelector();

resetUI();
syncModelUI();
wireViewSwitcher();
wireTaxCodeUI();
wireHelpToggles();
wireSalaryFinderMode();
setActiveView('calc');

const footerVersion = document.querySelector(".footer-version");
if (footerVersion) {
  footerVersion.textContent = "WageWise UK • v" + APP_VERSION;
}

// Auto-restore last used inputs (if present)
const last = loadLastState();
if(last){
  applyScenarioState(last);
} else {
  // ensure at least one clean validation pass on first load
  validateAllInputs();
}

// Wire sharing + autosave
wireShareButton();

// save last-used inputs while typing (covers both tabs)
[
  'taxYear','region','mode','annualSalary','hourlyRate','hoursPerWeek','taxCodePreset','taxCodeCustom','pensionPercent',
  'salarySacrifice','studentLoan','sfFrequency','sfMode','sfP1','sfP2','sfP3','sfP4'
].forEach(id => {
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener('input', scheduleLastStateSave);
  el.addEventListener('change', scheduleLastStateSave);
});