const eurFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const eurFormatterDetailed = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const monthLabelFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
});

const startDateInput = document.getElementById("startDate");
const monthlyBudgetInput = document.getElementById("monthlyBudget");
const yearlyGrowthInput = document.getElementById("yearlyGrowth");
const yearlyTaxInput = document.getElementById("yearlyTax");
const yearsToInvestInput = document.getElementById("yearsToInvest");

const monthlyBudgetValue = document.getElementById("monthlyBudgetValue");
const yearlyGrowthValue = document.getElementById("yearlyGrowthValue");
const yearlyTaxValue = document.getElementById("yearlyTaxValue");
const yearsToInvestValue = document.getElementById("yearsToInvestValue");

const finalBalanceEl = document.getElementById("finalBalance");
const totalContributedEl = document.getElementById("totalContributed");
const totalTaxPaidEl = document.getElementById("totalTaxPaid");
const netGainEl = document.getElementById("netGain");

const chartPlaceholder = document.getElementById("chartPlaceholder");
const chartWrapper = document.querySelector(".chart-wrapper");
const chartCanvas = document.getElementById("balanceChart");

let balanceChart = null;

const STORAGE_KEY = "investCalculatorSettings";

const inputFields = [
  { key: "startDate", input: startDateInput, type: "date" },
  { key: "monthlyBudget", input: monthlyBudgetInput, type: "number" },
  { key: "yearlyGrowth", input: yearlyGrowthInput, type: "number" },
  { key: "yearlyTax", input: yearlyTaxInput, type: "number" },
  { key: "yearsToInvest", input: yearsToInvestInput, type: "number" },
];

function formatEur(value) {
  return eurFormatter.format(value);
}

function formatEurDetailed(value) {
  return eurFormatterDetailed.format(value);
}

function formatCompactEur(value) {
  if (Math.abs(value) >= 1_000_000) {
    return `€${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `€${(value / 1_000).toFixed(0)}k`;
  }
  return formatEur(value);
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function calculateProjection(params) {
  const {
    startDate,
    monthlyBudget,
    yearlyGrowthPercent,
    yearlyTaxPercent,
    years,
  } = params;

  const totalMonths = years * 12;
  const monthlyGrowthRate = yearlyGrowthPercent / 100 / 12;
  const taxRate = yearlyTaxPercent / 100;

  let balance = 0;
  let yearStartBalance = 0;
  let yearContributions = 0;
  let totalContributions = 0;
  let totalTaxPaid = 0;

  const dataPoints = [];

  for (let month = 0; month < totalMonths; month += 1) {
    balance += monthlyBudget;
    yearContributions += monthlyBudget;
    totalContributions += monthlyBudget;

    balance *= 1 + monthlyGrowthRate;

    const pointDate = addMonths(startDate, month);
    dataPoints.push({
      date: pointDate,
      balance,
      monthlyIncome: balance * monthlyGrowthRate,
    });

    if ((month + 1) % 12 === 0) {
      const gains = balance - yearStartBalance - yearContributions;
      if (gains > 0) {
        const tax = gains * taxRate;
        totalTaxPaid += tax;
        balance -= tax;
        const lastPoint = dataPoints[dataPoints.length - 1];
        lastPoint.balance = balance;
        lastPoint.monthlyIncome = balance * monthlyGrowthRate;
      }
      yearStartBalance = balance;
      yearContributions = 0;
    }
  }

  return {
    dataPoints,
    finalBalance: balance,
    totalContributions,
    totalTaxPaid,
    netGain: balance - totalContributions,
  };
}

function updateReadouts() {
  monthlyBudgetValue.textContent = formatEur(Number(monthlyBudgetInput.value));
  yearlyGrowthValue.textContent = `${Number(yearlyGrowthInput.value).toFixed(1)}%`;
  yearlyTaxValue.textContent = `${Number(yearlyTaxInput.value)}%`;
  const years = Number(yearsToInvestInput.value);
  yearsToInvestValue.textContent = years === 1 ? "1 year" : `${years} years`;
}

function getParams() {
  const startDate = new Date(startDateInput.value);
  const years = Number(yearsToInvestInput.value);

  if (!startDateInput.value || Number.isNaN(startDate.getTime()) || years <= 0) {
    return null;
  }

  return {
    startDate,
    monthlyBudget: Number(monthlyBudgetInput.value),
    yearlyGrowthPercent: Number(yearlyGrowthInput.value),
    yearlyTaxPercent: Number(yearlyTaxInput.value),
    years,
  };
}

function showPlaceholder(show) {
  chartPlaceholder.classList.toggle("hidden", !show);
  chartWrapper.classList.toggle("hidden", show);
}

function updateChart(projection) {
  const labels = projection.dataPoints.map((point) =>
    monthLabelFormatter.format(point.date)
  );
  const values = projection.dataPoints.map((point) => point.balance);
  const monthlyIncomes = projection.dataPoints.map((point) => point.monthlyIncome);

  if (balanceChart) {
    balanceChart.data.labels = labels;
    balanceChart.data.datasets[0].data = values;
    balanceChart.data.datasets[0].monthlyIncomes = monthlyIncomes;
    balanceChart.update();
    return;
  }

  balanceChart = new Chart(chartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Projected balance",
          data: values,
          monthlyIncomes,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.1)",
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label(context) {
              const monthlyIncome = context.dataset.monthlyIncomes[context.dataIndex];
              return [
                `Balance: ${formatEurDetailed(context.parsed.y)}`,
                `Monthly income: ${formatEurDetailed(monthlyIncome)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 12,
            maxRotation: 0,
          },
          grid: {
            display: false,
          },
        },
        y: {
          ticks: {
            callback(value) {
              return formatCompactEur(value);
            },
          },
        },
      },
    },
  });
}

function updateSummary(projection) {
  finalBalanceEl.textContent = formatEurDetailed(projection.finalBalance);
  totalContributedEl.textContent = formatEurDetailed(projection.totalContributions);
  totalTaxPaidEl.textContent = formatEurDetailed(projection.totalTaxPaid);
  netGainEl.textContent = formatEurDetailed(projection.netGain);
}

function clampToInput(value, input) {
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  const min = Number(input.min);
  const max = Number(input.max);
  const step = Number(input.step) || 1;
  const clamped = Math.min(max, Math.max(min, num));
  const steps = Math.round((clamped - min) / step);
  return min + steps * step;
}

function isValidDateString(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const cached = JSON.parse(raw);
    if (!cached || typeof cached !== "object") return false;

    let loaded = false;

    for (const { key, input, type } of inputFields) {
      if (cached[key] === undefined) continue;

      if (type === "date") {
        if (!isValidDateString(cached[key])) continue;
        input.value = cached[key];
        loaded = true;
        continue;
      }

      const value = clampToInput(cached[key], input);
      if (value === null) continue;
      input.value = String(value);
      loaded = true;
    }

    return loaded;
  } catch {
    return false;
  }
}

function saveToCache() {
  const settings = {};
  for (const { key, input } of inputFields) {
    settings[key] = input.value;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or unavailable — ignore
  }
}

function recalculate() {
  updateReadouts();
  saveToCache();

  const params = getParams();
  if (!params) {
    showPlaceholder(true);
    finalBalanceEl.textContent = "—";
    totalContributedEl.textContent = "—";
    totalTaxPaidEl.textContent = "—";
    netGainEl.textContent = "—";
    return;
  }

  showPlaceholder(false);
  const projection = calculateProjection(params);
  updateChart(projection);
  updateSummary(projection);
}

function setDefaultStartDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  startDateInput.value = `${year}-${month}-${day}`;
}

if (!loadFromCache() || !startDateInput.value) {
  setDefaultStartDate();
}

inputFields.forEach(({ input }) => input.addEventListener("input", recalculate));
recalculate();
