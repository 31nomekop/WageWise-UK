function currency(n){
  return "£" + n.toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2});
}

function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(()=> t.classList.remove("show"), 1100);
}

function calculate(){
  const salary = Number(document.getElementById("annualSalary").value) || 0;
  const pensionPct = Number(document.getElementById("pensionPercent").value) || 0;
  const sacrifice = document.getElementById("salarySacrifice").checked;

  if(salary <= 0) return;

  const pension = salary * (pensionPct/100);
  const taxBase = sacrifice ? salary - pension : salary;

  const tax = taxBase * 0.1162;
  const ni = taxBase * 0.0465;

  const takeHome = salary - tax - ni - pension;
  const monthly = takeHome / 12;

  document.getElementById("results").innerHTML = `
    <div>Take-home (annual): <strong>${currency(takeHome)}</strong></div>
    <div>Take-home (monthly): <strong>${currency(monthly)}</strong></div>
  `;

  const effective = ((salary - takeHome)/salary) * 100;
  document.getElementById("effectiveRate").textContent = effective.toFixed(1) + "%";

  const bar = document.getElementById("breakdownBar");
  bar.style.width = effective + "%";

  document.getElementById("results").scrollIntoView({behavior:"smooth"});
}

document.getElementById("calcBtn").addEventListener("click", calculate);

document.getElementById("copyMonthlyBtn").addEventListener("click", ()=>{
  const text = document.querySelector("#results strong:last-child")?.textContent;
  if(text){
    navigator.clipboard.writeText(text).then(()=> showToast("Copied ✓"));
  }
});