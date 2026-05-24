const stateKey = "hydration-tool-v1";
const todayKey = new Date().toISOString().slice(0, 10);

const form = document.querySelector("#hydrationForm");
const els = {
  weight: document.querySelector("#weight"),
  cupSize: document.querySelector("#cupSize"),
  wakeTime: document.querySelector("#wakeTime"),
  sleepTime: document.querySelector("#sleepTime"),
  hotDay: document.querySelector("#hotDay"),
  coffee: document.querySelector("#coffee"),
  salty: document.querySelector("#salty"),
  nightQuiet: document.querySelector("#nightQuiet"),
  targetMl: document.querySelector("#targetMl"),
  drunkMl: document.querySelector("#drunkMl"),
  leftMl: document.querySelector("#leftMl"),
  cupCount: document.querySelector("#cupCount"),
  cupGoal: document.querySelector("#cupGoal"),
  progressPercent: document.querySelector("#progressPercent"),
  progressRing: document.querySelector("#progressRing"),
  meterFill: document.querySelector("#meterFill"),
  nextReminder: document.querySelector("#nextReminder"),
  nextHint: document.querySelector("#nextHint"),
  timeline: document.querySelector("#timeline"),
  drinkCup: document.querySelector("#drinkCup"),
  undoCup: document.querySelector("#undoCup"),
  resetDay: document.querySelector("#resetDay"),
  notifyToggle: document.querySelector("#notifyToggle"),
};

let timerId = null;
let appState = loadState();

function loadState() {
  const fallback = {
    date: todayKey,
    settings: {},
    drinks: [],
    notifications: false,
  };

  try {
    const parsed = JSON.parse(localStorage.getItem(stateKey));
    if (!parsed || parsed.date !== todayKey) return fallback;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function saveState() {
  appState.settings = readSettings();
  localStorage.setItem(stateKey, JSON.stringify(appState));
}

function applySavedSettings() {
  const saved = appState.settings || {};
  Object.entries(saved).forEach(([key, value]) => {
    const field = els[key];
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value;
  });

  if (saved.activity !== undefined) {
    const activity = document.querySelector(`[name="activity"][value="${saved.activity}"]`);
    if (activity) activity.checked = true;
  }
}

function readSettings() {
  const activity = Number(document.querySelector('[name="activity"]:checked').value);
  return {
    weight: clamp(Number(els.weight.value) || 65, 25, 220),
    cupSize: clamp(Number(els.cupSize.value) || 350, 80, 1500),
    wakeTime: els.wakeTime.value || "08:00",
    sleepTime: els.sleepTime.value || "22:30",
    activity,
    hotDay: els.hotDay.checked,
    coffee: els.coffee.checked,
    salty: els.salty.checked,
    nightQuiet: els.nightQuiet.checked,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function calculateTarget(settings) {
  let target = settings.weight * 35 + settings.activity;
  if (settings.hotDay) target += 450;
  if (settings.coffee) target += 250;
  if (settings.salty) target += 250;
  return Math.round(target / 50) * 50;
}

function minutesFromTime(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(total) {
  const minutes = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function buildPlan(settings, target) {
  const cups = Math.max(1, Math.ceil(target / settings.cupSize));
  const wake = minutesFromTime(settings.wakeTime);
  let sleep = minutesFromTime(settings.sleepTime);
  if (sleep <= wake) sleep += 1440;

  const quietOffset = settings.nightQuiet ? 90 : 20;
  const last = Math.max(wake + 60, sleep - quietOffset);
  const span = Math.max(60, last - wake);

  return Array.from({ length: cups }, (_, index) => {
    const point = cups === 1 ? wake + 30 : wake + (span * index) / (cups - 1);
    return {
      index,
      time: timeFromMinutes(point),
      amount: Math.min(settings.cupSize, Math.max(0, target - index * settings.cupSize)),
    };
  });
}

function render() {
  const settings = readSettings();
  const target = calculateTarget(settings);
  const plan = buildPlan(settings, target);
  const drunk = appState.drinks.reduce((sum, drink) => sum + drink.amount, 0);
  const left = Math.max(0, target - drunk);
  const percent = Math.min(100, Math.round((drunk / target) * 100));
  const currentMinutes = nowMinutes();
  const doneCups = appState.drinks.length;
  const next = plan.find((item, index) => index >= doneCups && minutesFromTime(item.time) >= currentMinutes) || plan[doneCups] || plan.at(-1);

  els.targetMl.textContent = target;
  els.drunkMl.textContent = drunk;
  els.leftMl.textContent = left;
  els.cupCount.textContent = doneCups;
  els.cupGoal.textContent = plan.length;
  els.progressPercent.textContent = `${percent}%`;
  els.progressRing.style.setProperty("--pct", `${percent * 3.6}deg`);
  els.meterFill.style.width = `${percent}%`;
  els.nextReminder.textContent = left === 0 ? "完成" : next.time;
  els.nextHint.textContent = left === 0 ? "今天的目标已经达成" : `建议喝 ${Math.min(settings.cupSize, left)} ml`;
  els.notifyToggle.classList.toggle("is-on", appState.notifications);

  els.timeline.innerHTML = "";
  plan.forEach((item, index) => {
    const li = document.createElement("li");
    if (index < doneCups) li.classList.add("done");
    li.innerHTML = `<time>${item.time}</time><span>${item.amount} ml</span>`;
    els.timeline.appendChild(li);
  });

  scheduleNotification(plan, settings, target, drunk);
  saveState();
}

function addCup() {
  const settings = readSettings();
  const target = calculateTarget(settings);
  const drunk = appState.drinks.reduce((sum, drink) => sum + drink.amount, 0);
  const amount = Math.min(settings.cupSize, Math.max(0, target - drunk));
  if (amount <= 0) return;

  appState.drinks.push({
    amount,
    at: new Date().toISOString(),
  });
  render();
}

function undoCup() {
  appState.drinks.pop();
  render();
}

function resetDay() {
  appState.drinks = [];
  render();
}

async function toggleNotifications() {
  if (appState.notifications) {
    appState.notifications = false;
    clearTimeout(timerId);
    render();
    return;
  }

  if (!("Notification" in window)) {
    alert("当前浏览器不支持桌面提醒。");
    return;
  }

  const permission = await Notification.requestPermission();
  appState.notifications = permission === "granted";
  render();
}

function scheduleNotification(plan, settings, target, drunk) {
  clearTimeout(timerId);
  if (!appState.notifications || Notification.permission !== "granted" || drunk >= target) return;

  const current = nowMinutes();
  const next = plan.find((item, index) => index >= appState.drinks.length && minutesFromTime(item.time) >= current);
  if (!next) return;

  const delay = Math.max(3_000, (minutesFromTime(next.time) - current) * 60_000);
  timerId = setTimeout(() => {
    new Notification("该喝水了", {
      body: `现在喝 ${Math.min(settings.cupSize, target - drunk)} ml，今天会轻松很多。`,
    });
    render();
  }, delay);
}

applySavedSettings();
form.addEventListener("input", render);
els.drinkCup.addEventListener("click", addCup);
els.undoCup.addEventListener("click", undoCup);
els.resetDay.addEventListener("click", resetDay);
els.notifyToggle.addEventListener("click", toggleNotifications);
render();
