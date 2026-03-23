import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  onValue,
  ref,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const CONFIG = {
  source: "thingspeak",
  apiUrl: "http://localhost:3000/status",
  pollInterval: 2000,
  maxPoints: 12,
  thingSpeak: {
    channelId: "3254832",
    fireFieldNumber: 1,
    temperatureFieldNumber: 2,
    smokeFieldNumber: 3,
    readApiKey: "",
    pollInterval: 15000,
  },
  firebase: {
    enabled: true,
    config: {
      apiKey: "REPLACE_WITH_YOUR_API_KEY",
      authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
      databaseURL: "https://REPLACE_WITH_YOUR_PROJECT-default-rtdb.firebaseio.com",
      projectId: "REPLACE_WITH_YOUR_PROJECT",
      storageBucket: "REPLACE_WITH_YOUR_PROJECT.appspot.com",
      messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
      appId: "REPLACE_WITH_YOUR_APP_ID",
    },
    dataPath: "fireSensors/current",
  },
};

const elements = {
  temperatureValue: document.getElementById("temperatureValue"),
  smokeValue: document.getElementById("smokeValue"),
  fireValue: document.getElementById("fireValue"),
  statusFoot: document.getElementById("statusFoot"),
  heroTitle: document.getElementById("heroTitle"),
  heroText: document.getElementById("heroText"),
  alertBanner: document.getElementById("alertBanner"),
  alertIcon: document.getElementById("alertIcon"),
  alertOrb: document.getElementById("alertOrb"),
  connectionStatus: document.getElementById("connectionStatus"),
  statusCard: document.getElementById("statusCard"),
  fireToast: document.getElementById("fireToast"),
  body: document.body,
};

const chartTheme = {
  labels: [],
  temperature: [],
  smoke: [],
};

let temperatureChart;
let smokeChart;
let previousFireState = false;
let toastTimer;
let pollTimer;

function getTimeLabel() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function trimDataset(array) {
  while (array.length > CONFIG.maxPoints) {
    array.shift();
  }
}

function pushChartPoint(temperature, smoke) {
  chartTheme.labels.push(getTimeLabel());
  chartTheme.temperature.push(temperature);
  chartTheme.smoke.push(smoke);

  trimDataset(chartTheme.labels);
  trimDataset(chartTheme.temperature);
  trimDataset(chartTheme.smoke);

  if (temperatureChart && smokeChart) {
    temperatureChart.data.labels = [...chartTheme.labels];
    temperatureChart.data.datasets[0].data = [...chartTheme.temperature];
    smokeChart.data.labels = [...chartTheme.labels];
    smokeChart.data.datasets[0].data = [...chartTheme.smoke];
    temperatureChart.update("none");
    smokeChart.update("none");
  }
}

function createChart(canvasId, label, borderColor, backgroundColor) {
  const context = document.getElementById(canvasId);
  return new Chart(context, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        borderColor,
        backgroundColor,
        fill: true,
        borderWidth: 3,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: borderColor,
        pointBorderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 350,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: "rgba(5, 10, 18, 0.92)",
          borderColor: "rgba(255, 255, 255, 0.1)",
          borderWidth: 1,
          titleColor: "#f5f7ff",
          bodyColor: "#d6def7",
          displayColors: false,
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#8f9dbf",
            maxRotation: 0,
            autoSkip: true,
          },
          grid: {
            color: "rgba(255, 255, 255, 0.06)",
          },
        },
        y: {
          ticks: {
            color: "#8f9dbf",
          },
          grid: {
            color: "rgba(255, 255, 255, 0.06)",
          },
        },
      },
    },
  });
}

function initCharts() {
  temperatureChart = createChart(
    "temperatureChart",
    "Temperature",
    "#ff9f43",
    "rgba(255, 159, 67, 0.14)"
  );

  smokeChart = createChart(
    "smokeChart",
    "Smoke Level",
    "#39ff9c",
    "rgba(57, 255, 156, 0.12)"
  );
}

function showToast(message) {
  const text = elements.fireToast.querySelector(".toast-text");
  text.textContent = message;
  elements.fireToast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.fireToast.classList.remove("show");
  }, 4200);
}

function maybeNotifyFire(temperature, smoke) {
  const details =
    temperature != null && smoke != null
      ? ` Temperature ${temperature} deg C, smoke ${smoke} ppm.`
      : " Flame sensor reported fire.";
  const message = `Fire detected.${details}`;
  showToast(message);

  if ("Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification("IoT Fire Alert", { body: message });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          new Notification("IoT Fire Alert", { body: message });
        }
      });
    }
  }
}

function setConnectionState(text, colorClass) {
  elements.connectionStatus.lastElementChild.textContent = text;
  const dot = elements.connectionStatus.firstElementChild;
  dot.style.background =
    colorClass === "safe" ? "#39ff9c" :
    colorClass === "danger" ? "#ff4d5e" :
    "#ff9f43";
  dot.style.boxShadow = `0 0 12px ${dot.style.background}`;
}

function setTextValue(node, value, suffix) {
  node.innerHTML = `${value}<span>${suffix}</span>`;
}

function normalizePayload(data) {
  const temperature = data?.temperature == null ? null : Number(data.temperature);
  const smoke = data?.smoke == null ? null : Number(data.smoke);
  const explicitFireState =
    data?.fire ??
    data?.fireDetected ??
    (typeof data?.status === "string" ? data.status.toLowerCase() === "fire" : null);
  const inferredFireState =
    temperature != null && smoke != null ? temperature >= 55 && smoke >= 120 : false;
  const fire = Boolean(explicitFireState ?? inferredFireState);

  return { temperature, smoke, fire };
}

function normalizeThingSpeakPayload(data) {
  const fireFieldName = `field${CONFIG.thingSpeak.fireFieldNumber}`;
  const temperatureFieldName = `field${CONFIG.thingSpeak.temperatureFieldNumber}`;
  const smokeFieldName = `field${CONFIG.thingSpeak.smokeFieldNumber}`;
  const fireValue = Number(data?.[fireFieldName] ?? 0);
  const temperatureValue = data?.[temperatureFieldName];
  const smokeValue = data?.[smokeFieldName];

  return {
    temperature: temperatureValue == null || temperatureValue === "" ? null : Number(temperatureValue),
    smoke: smokeValue == null || smokeValue === "" ? null : Number(smokeValue),
    fire: fireValue === 1,
  };
}

function applyState(rawData) {
  const { temperature, smoke, fire } = normalizePayload(rawData);
  const smokeState =
    smoke == null
      ? "Smoke sensor data not available in the current feed."
      : smoke >= 120
        ? "Elevated smoke concentration detected."
        : "Air quality within normal threshold.";

  setTextValue(elements.temperatureValue, temperature ?? "--", "&deg;C");
  setTextValue(elements.smokeValue, smoke ?? "--", " ppm");

  if (temperature != null && smoke != null) {
    pushChartPoint(temperature, smoke);
  }

  elements.fireValue.textContent = fire ? "Detected" : "Normal";
  elements.fireValue.className = fire ? "status-danger" : "status-safe";
  elements.statusFoot.textContent = fire ? "Emergency response required" : smokeState;

  if (fire) {
    elements.heroTitle.textContent = "Fire Detected";
    elements.heroText.textContent = "Critical thermal and combustion indicators are active. Dispatch response immediately.";
    elements.alertBanner.classList.add("active");
    elements.alertIcon.classList.add("flash");
    elements.alertOrb.classList.add("flash");
    elements.body.classList.add("alert-active");
    elements.statusCard.style.borderColor = "rgba(255, 77, 94, 0.72)";
    setConnectionState("Live Alert Feed", "danger");
    if (!previousFireState) {
      maybeNotifyFire(temperature, smoke);
    }
  } else {
    elements.heroTitle.textContent = "System Stable";
    elements.heroText.textContent = "Monitoring environmental risk signals from the fire detection node.";
    elements.alertBanner.classList.remove("active");
    elements.alertIcon.classList.remove("flash");
    elements.alertOrb.classList.remove("flash");
    elements.body.classList.remove("alert-active");
    elements.statusCard.style.borderColor = "rgba(255, 255, 255, 0.08)";
    setConnectionState("Live Monitoring", "safe");
  }

  previousFireState = fire;
}

function applyErrorState(message = "No response from data source") {
  elements.heroTitle.textContent = "Connection Interrupted";
  elements.heroText.textContent = "Unable to read the sensor endpoint. Verify the local API, Firebase setup, and network bridge.";
  elements.fireValue.textContent = "Offline";
  elements.fireValue.className = "status-warning";
  elements.statusFoot.textContent = message;
  elements.alertBanner.classList.remove("active");
  elements.alertIcon.classList.remove("flash");
  elements.alertOrb.classList.remove("flash");
  elements.body.classList.remove("alert-active");
  elements.fireToast.classList.remove("show");
  elements.statusCard.style.borderColor = "rgba(255, 159, 67, 0.5)";
  setConnectionState("Feed Offline", "warning");
  previousFireState = false;
}

async function fetchStatus() {
  try {
    const response = await fetch(CONFIG.apiUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    applyState(data);
  } catch (error) {
    applyErrorState("No response from API");
    console.error("Failed to fetch fire status:", error);
  }
}

function startPolling() {
  setConnectionState("Polling Local API", "warning");
  fetchStatus();
  pollTimer = window.setInterval(fetchStatus, CONFIG.pollInterval);
}

function getThingSpeakUrl() {
  const url = new URL(
    `https://api.thingspeak.com/channels/${CONFIG.thingSpeak.channelId}/feeds/last.json`
  );

  if (CONFIG.thingSpeak.readApiKey) {
    url.searchParams.set("api_key", CONFIG.thingSpeak.readApiKey);
  }

  return url.toString();
}

async function fetchThingSpeakStatus() {
  try {
    const response = await fetch(getThingSpeakUrl(), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    applyState(normalizeThingSpeakPayload(data));
    elements.statusFoot.textContent = data?.created_at
      ? `Last ThingSpeak update: ${new Date(data.created_at).toLocaleString()}`
      : "Last update received from ThingSpeak";
  } catch (error) {
    applyErrorState("No response from ThingSpeak");
    console.error("Failed to fetch ThingSpeak status:", error);
  }
}

function startThingSpeakPolling() {
  setConnectionState("ThingSpeak Live Feed", "warning");
  fetchThingSpeakStatus();
  pollTimer = window.setInterval(fetchThingSpeakStatus, CONFIG.thingSpeak.pollInterval);
}

function hasFirebasePlaceholders() {
  return Object.values(CONFIG.firebase.config).some((value) => String(value).includes("REPLACE_WITH_YOUR"));
}

function startFirebaseRealtime() {
  if (!CONFIG.firebase.enabled || hasFirebasePlaceholders()) {
    console.warn("Firebase is not configured yet. Falling back to API polling.");
    startPolling();
    return;
  }

  try {
    const app = initializeApp(CONFIG.firebase.config);
    const database = getDatabase(app);
    const sensorRef = ref(database, CONFIG.firebase.dataPath);

    setConnectionState("Connecting To Firebase", "warning");

    onValue(
      sensorRef,
      (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          applyErrorState("No live sensor data in Firebase");
          return;
        }

        applyState(data);
      },
      (error) => {
        console.error("Firebase realtime listener failed:", error);
        applyErrorState("Firebase listener disconnected");
      }
    );
  } catch (error) {
    console.error("Failed to initialize Firebase:", error);
    applyErrorState("Firebase setup error");
    startPolling();
  }
}

function startDataFeed() {
  if (CONFIG.source === "thingspeak") {
    startThingSpeakPolling();
    return;
  }

  if (CONFIG.source === "firebase") {
    startFirebaseRealtime();
    return;
  }

  startPolling();
}

initCharts();
startDataFeed();
