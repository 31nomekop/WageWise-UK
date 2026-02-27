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

// boot
resetUI();
syncModeUI();
