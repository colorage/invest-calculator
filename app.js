const CURRENCIES = ["PLN", "EUR", "USD"];

const currencyConfig = {
  PLN: { locale: "pl-PL", monthlyBudgetMax: 25000 },
  EUR: { locale: "de-DE", monthlyBudgetMax: 10000 },
  USD: { locale: "en-US", monthlyBudgetMax: 10000 },
};

const formatterCache = {};

function getFormatters(currency) {
  if (!formatterCache[currency]) {
    const { locale } = currencyConfig[currency];
    formatterCache[currency] = {
      whole: new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
      detailed: new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }),
    };
  }
  return formatterCache[currency];
}

function getCurrencySymbol(currency) {
  const parts = getFormatters(currency).whole.formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? currency;
}

const yearLabelFormatter = new Intl.DateTimeFormat("en", {
  year: "numeric",
});

function buildYearLabels(dataPoints) {
  return dataPoints.map((point, index) => {
    if (index === 0) {
      return yearLabelFormatter.format(point.date);
    }

    const previousYear = dataPoints[index - 1].date.getFullYear();
    const currentYear = point.date.getFullYear();
    if (currentYear !== previousYear) {
      return yearLabelFormatter.format(point.date);
    }

    return "";
  });
}

const PLAN_COLOR = "#2563eb";
const ACTUAL_COLOR = "#dc2626";

const currencySwitcher = document.querySelector(".currency-switcher");
const currencyOptions = [...document.querySelectorAll(".currency-option")];

const startDateInput = document.getElementById("startDate");
const currentBalanceInput = document.getElementById("currentBalance");
const monthlyBudgetInput = document.getElementById("monthlyBudget");
const yearlyGrowthInput = document.getElementById("yearlyGrowth");
const yearlyTaxInput = document.getElementById("yearlyTax");
const yearsToInvestInput = document.getElementById("yearsToInvest");

const currentBalanceValue = document.getElementById("currentBalanceValue");
const monthlyBudgetValue = document.getElementById("monthlyBudgetValue");
const yearlyGrowthValue = document.getElementById("yearlyGrowthValue");
const yearlyTaxValue = document.getElementById("yearlyTaxValue");
const yearsToInvestValue = document.getElementById("yearsToInvestValue");

const finalBalanceEl = document.getElementById("finalBalance");
const monthlyIncomeAfterInvestingEl = document.getElementById("monthlyIncomeAfterInvesting");
const totalContributedEl = document.getElementById("totalContributed");
const totalTaxPaidEl = document.getElementById("totalTaxPaid");
const netGainEl = document.getElementById("netGain");

const chartPlaceholder = document.getElementById("chartPlaceholder");
const chartWrapper = document.querySelector(".chart-wrapper");
const chartCanvas = document.getElementById("balanceChart");

let balanceChart = null;
let selectedCurrency = "EUR";
let lastProjection = null;
let lastActualTrack = null;

const STORAGE_KEY = "investCalculatorSettings";

const inputFields = [
  { key: "startDate", input: startDateInput, type: "month" },
  { key: "currentBalance", input: currentBalanceInput, type: "number" },
  { key: "monthlyBudget", input: monthlyBudgetInput, type: "number" },
  { key: "yearlyGrowth", input: yearlyGrowthInput, type: "number" },
  { key: "yearlyTax", input: yearlyTaxInput, type: "number" },
  { key: "yearsToInvest", input: yearsToInvestInput, type: "number" },
];

function getSelectedCurrency() {
  return selectedCurrency;
}

function setSelectedCurrency(currency) {
  if (!CURRENCIES.includes(currency)) return;
  selectedCurrency = currency;

  currencyOptions.forEach((option) => {
    const isActive = option.dataset.currency === currency;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-checked", String(isActive));
  });

  applyMonthlyBudgetRange(currency);
}

function applyMonthlyBudgetRange(currency) {
  const { monthlyBudgetMax } = currencyConfig[currency];
  monthlyBudgetInput.max = String(monthlyBudgetMax);

  const clamped = clampToInput(monthlyBudgetInput.value, monthlyBudgetInput);
  if (clamped !== null) {
    monthlyBudgetInput.value = String(clamped);
  }
}

function formatCurrency(value) {
  return getFormatters(getSelectedCurrency()).whole.format(value);
}

function formatCurrencyDetailed(value) {
  return getFormatters(getSelectedCurrency()).detailed.format(value);
}

function formatCompactCurrency(value) {
  const symbol = getCurrencySymbol(getSelectedCurrency());
  if (Math.abs(value) >= 1_000_000) {
    return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${symbol}${(value / 1_000).toFixed(0)}k`;
  }
  return formatCurrency(value);
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function createProjectionState(initialBalance = 0) {
  return {
    balance: initialBalance,
    yearStartBalance: initialBalance,
    yearContributions: 0,
    totalContributions: 0,
    totalTaxPaid: 0,
  };
}

function applyMonthStep(state, monthIndex, monthlyBudget, monthlyGrowthRate, taxRate) {
  let balance = state.balance + monthlyBudget;
  const yearContributions = state.yearContributions + monthlyBudget;
  const totalContributions = state.totalContributions + monthlyBudget;

  balance *= 1 + monthlyGrowthRate;

  let monthlyIncome = balance * monthlyGrowthRate;
  let totalTaxPaid = state.totalTaxPaid;
  let yearStartBalance = state.yearStartBalance;

  if ((monthIndex + 1) % 12 === 0) {
    const gains = balance - yearStartBalance - yearContributions;
    if (gains > 0) {
      const tax = gains * taxRate;
      totalTaxPaid += tax;
      balance -= tax;
      monthlyIncome = balance * monthlyGrowthRate;
    }
    yearStartBalance = balance;
    return {
      balance,
      yearStartBalance,
      yearContributions: 0,
      totalContributions,
      totalTaxPaid,
      monthlyIncome,
    };
  }

  return {
    balance,
    yearStartBalance,
    yearContributions,
    totalContributions,
    totalTaxPaid,
    monthlyIncome,
  };
}

function findTodayIndex(startDate, totalMonths) {
  const today = startOfMonth(new Date());
  let todayIndex = -1;

  for (let month = 0; month < totalMonths; month += 1) {
    const pointDate = startOfMonth(addMonths(startDate, month));
    if (pointDate <= today) {
      todayIndex = month;
    } else {
      break;
    }
  }

  return todayIndex;
}

function findAverageMonthlyBudget(
  currentBalance,
  monthsElapsed,
  monthlyGrowthRate,
  taxRate
) {
  if (monthsElapsed <= 0 || currentBalance <= 0) {
    return 0;
  }

  let low = 0;
  let high = currentBalance;

  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (low + high) / 2;
    let state = createProjectionState(0);

    for (let month = 0; month < monthsElapsed; month += 1) {
      state = applyMonthStep(state, month, mid, monthlyGrowthRate, taxRate);
    }

    if (state.balance < currentBalance) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
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

  let state = createProjectionState(0);
  const dataPoints = [];

  for (let month = 0; month < totalMonths; month += 1) {
    state = applyMonthStep(state, month, monthlyBudget, monthlyGrowthRate, taxRate);

    const pointDate = addMonths(startDate, month);
    dataPoints.push({
      date: pointDate,
      balance: state.balance,
      monthlyIncome: state.monthlyIncome,
    });
  }

  const finalBalance = state.balance;
  const totalContributions = state.totalContributions;
  const totalTaxPaidAtEnd = state.totalTaxPaid;
  let postInvestmentMonthlyIncome = 0;

  state = applyMonthStep(state, totalMonths, 0, monthlyGrowthRate, taxRate);
  postInvestmentMonthlyIncome = state.monthlyIncome;

  return {
    dataPoints,
    finalBalance,
    totalContributions,
    totalTaxPaid: totalTaxPaidAtEnd,
    netGain: finalBalance - totalContributions,
    postInvestmentMonthlyIncome,
  };
}

function calculateActualTrack(params) {
  const {
    startDate,
    monthlyBudget,
    yearlyGrowthPercent,
    yearlyTaxPercent,
    years,
    currentBalance,
  } = params;

  const totalMonths = years * 12;
  const monthlyGrowthRate = yearlyGrowthPercent / 100 / 12;
  const taxRate = yearlyTaxPercent / 100;
  const todayIndex = findTodayIndex(startDate, totalMonths);

  const actualSolid = Array(totalMonths).fill(null);
  const actualDashed = Array(totalMonths).fill(null);
  const monthlyIncomesSolid = Array(totalMonths).fill(null);
  const monthlyIncomesDashed = Array(totalMonths).fill(null);

  if (todayIndex >= 0) {
    const anchoredIncome = currentBalance * monthlyGrowthRate;

    if (todayIndex === 0) {
      actualSolid[0] = currentBalance;
      monthlyIncomesSolid[0] = anchoredIncome;
    } else {
      for (let month = 0; month <= todayIndex; month += 1) {
        const balance = (currentBalance * month) / todayIndex;
        actualSolid[month] = balance;
        monthlyIncomesSolid[month] = balance * monthlyGrowthRate;
      }
    }

    actualDashed[todayIndex] = currentBalance;
    monthlyIncomesDashed[todayIndex] = anchoredIncome;
  }

  const forwardStart = todayIndex >= 0 ? todayIndex + 1 : 0;
  const monthsElapsed = todayIndex >= 0 ? todayIndex + 1 : 0;
  const predictedMonthlyBudget =
    todayIndex >= 0
      ? findAverageMonthlyBudget(
          currentBalance,
          monthsElapsed,
          monthlyGrowthRate,
          taxRate
        )
      : monthlyBudget;
  let forwardState =
    todayIndex >= 0
      ? createProjectionState(currentBalance)
      : createProjectionState(0);

  for (let month = forwardStart; month < totalMonths; month += 1) {
    forwardState = applyMonthStep(
      forwardState,
      month,
      predictedMonthlyBudget,
      monthlyGrowthRate,
      taxRate
    );
    actualDashed[month] = forwardState.balance;
    monthlyIncomesDashed[month] = forwardState.monthlyIncome;
  }

  return {
    actualSolid,
    actualDashed,
    monthlyIncomesSolid,
    monthlyIncomesDashed,
    todayIndex,
  };
}

function updateReadouts() {
  currentBalanceValue.textContent = formatCurrency(Number(currentBalanceInput.value));
  monthlyBudgetValue.textContent = formatCurrency(Number(monthlyBudgetInput.value));
  yearlyGrowthValue.textContent = `${Number(yearlyGrowthInput.value).toFixed(1)}%`;
  yearlyTaxValue.textContent = `${Number(yearlyTaxInput.value)}%`;
  const years = Number(yearsToInvestInput.value);
  yearsToInvestValue.textContent = years === 1 ? "1 year" : `${years} years`;
}

function getParams() {
  const startDate = parseStartMonth(startDateInput.value);
  const years = Number(yearsToInvestInput.value);

  if (!startDate || years <= 0) {
    return null;
  }

  return {
    startDate,
    currentBalance: Number(currentBalanceInput.value),
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

function destroyChart() {
  if (!balanceChart) return;
  balanceChart.destroy();
  balanceChart = null;
}

function getChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        display: true,
        labels: {
          usePointStyle: true,
          boxWidth: 8,
        },
      },
      tooltip: {
        callbacks: {
          label(context) {
            if (context.parsed.y === null) {
              return null;
            }

            const monthlyIncome = context.dataset.monthlyIncomes?.[context.dataIndex];
            const lines = [`${context.dataset.label}: ${formatCurrencyDetailed(context.parsed.y)}`];

            if (monthlyIncome !== null && monthlyIncome !== undefined) {
              lines.push(`Monthly income: ${formatCurrencyDetailed(monthlyIncome)}`);
            }

            return lines;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 12,
          maxRotation: 0,
          callback(value) {
            const label = this.getLabelForValue(value);
            return label || undefined;
          },
        },
        grid: {
          display: false,
        },
      },
      y: {
        ticks: {
          callback(value) {
            return formatCompactCurrency(value);
          },
        },
      },
    },
  };
}

function buildChartDataset(label, data, monthlyIncomes, options = {}) {
  return {
    label,
    data,
    monthlyIncomes,
    borderColor: ACTUAL_COLOR,
    backgroundColor: "transparent",
    fill: false,
    tension: 0.2,
    pointRadius: 0,
    pointHoverRadius: 4,
    borderWidth: 2,
    ...options,
  };
}

function padChartSeries(values, length) {
  if (values.length >= length) {
    return values;
  }

  return [...values, ...Array(length - values.length).fill(null)];
}

function updateChart(projection, actualTrack, { forceRebuild = false } = {}) {
  const labels = buildYearLabels(projection.dataPoints);
  const planValues = projection.dataPoints.map((point) => point.balance);
  const planMonthlyIncomes = projection.dataPoints.map((point) => point.monthlyIncome);
  const chartLength = labels.length;
  const actualSolid = padChartSeries(actualTrack.actualSolid, chartLength);
  const actualDashed = padChartSeries(actualTrack.actualDashed, chartLength);
  const monthlyIncomesSolid = padChartSeries(actualTrack.monthlyIncomesSolid, chartLength);
  const monthlyIncomesDashed = padChartSeries(actualTrack.monthlyIncomesDashed, chartLength);

  if (balanceChart && !forceRebuild) {
    balanceChart.data.labels = labels;
    balanceChart.data.datasets[0].data = planValues;
    balanceChart.data.datasets[0].monthlyIncomes = planMonthlyIncomes;
    balanceChart.data.datasets[1].data = actualSolid;
    balanceChart.data.datasets[1].monthlyIncomes = monthlyIncomesSolid;
    balanceChart.data.datasets[2].data = actualDashed;
    balanceChart.data.datasets[2].monthlyIncomes = monthlyIncomesDashed;
    balanceChart.options = getChartOptions();
    balanceChart.update();
    return;
  }

  destroyChart();

  balanceChart = new Chart(chartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Projected balance",
          data: planValues,
          monthlyIncomes: planMonthlyIncomes,
          borderColor: PLAN_COLOR,
          backgroundColor: "rgba(37, 99, 235, 0.1)",
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
        buildChartDataset(
          "Your balance",
          actualSolid,
          monthlyIncomesSolid
        ),
        buildChartDataset(
          "Predicted balance",
          actualDashed,
          monthlyIncomesDashed,
          { borderDash: [6, 4] }
        ),
      ],
    },
    options: getChartOptions(),
  });
}

function updateSummary(projection) {
  finalBalanceEl.textContent = formatCurrencyDetailed(projection.finalBalance);
  monthlyIncomeAfterInvestingEl.textContent = formatCurrencyDetailed(
    projection.postInvestmentMonthlyIncome
  );
  totalContributedEl.textContent = formatCurrencyDetailed(projection.totalContributions);
  totalTaxPaidEl.textContent = formatCurrencyDetailed(projection.totalTaxPaid);
  netGainEl.textContent = formatCurrencyDetailed(projection.netGain);
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

function parseStartMonth(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return new Date(year, month - 1, 1);
}

function isValidMonthString(value) {
  return parseStartMonth(value) !== null;
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const cached = JSON.parse(raw);
    if (!cached || typeof cached !== "object") return false;

    let loaded = false;

    if (CURRENCIES.includes(cached.currency)) {
      setSelectedCurrency(cached.currency);
      loaded = true;
    }

    for (const { key, input, type } of inputFields) {
      if (cached[key] === undefined) continue;

      if (type === "month") {
        let monthValue = cached[key];
        if (/^\d{4}-\d{2}-\d{2}$/.test(monthValue)) {
          monthValue = monthValue.slice(0, 7);
        }
        if (!isValidMonthString(monthValue)) continue;
        input.value = monthValue;
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
  const settings = { currency: getSelectedCurrency() };
  for (const { key, input } of inputFields) {
    settings[key] = input.value;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or unavailable — ignore
  }
}

function handleCurrencyChange(currency) {
  if (currency === getSelectedCurrency()) return;

  setSelectedCurrency(currency);
  updateReadouts();
  saveToCache();

  if (!lastProjection || !lastActualTrack) {
    recalculate();
    return;
  }

  updateChart(lastProjection, lastActualTrack, { forceRebuild: true });
  updateSummary(lastProjection);
}

function recalculate() {
  updateReadouts();
  saveToCache();

  const params = getParams();
  if (!params) {
    lastProjection = null;
    lastActualTrack = null;
    destroyChart();
    showPlaceholder(true);
    finalBalanceEl.textContent = "—";
    monthlyIncomeAfterInvestingEl.textContent = "—";
    totalContributedEl.textContent = "—";
    totalTaxPaidEl.textContent = "—";
    netGainEl.textContent = "—";
    return;
  }

  showPlaceholder(false);
  const projection = calculateProjection(params);
  const actualTrack = calculateActualTrack(params);
  lastProjection = projection;
  lastActualTrack = actualTrack;
  updateChart(projection, actualTrack);
  updateSummary(projection);
}

function setDefaultStartDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  startDateInput.value = `${year}-${month}`;
}

currencyOptions.forEach((option) => {
  option.addEventListener("click", () => {
    handleCurrencyChange(option.dataset.currency);
  });
});

if (!loadFromCache() || !startDateInput.value) {
  setDefaultStartDate();
}

applyMonthlyBudgetRange(getSelectedCurrency());

inputFields.forEach(({ input }) => input.addEventListener("input", recalculate));
recalculate();
