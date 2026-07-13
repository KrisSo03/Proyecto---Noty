// ==========================================
// API CONNECTION SECTION
// Here we define the base URL used by the frontend
// to communicate with the backend.
// ==========================================

const API_BASE_URL = window.location.port === "3000"
  ? "/api"
  : "http://localhost:3000/api";

function getToken() {
  return localStorage.getItem("noty_token");
}

function saveToken(token) {
  localStorage.setItem("noty_token", token);
}

function removeToken() {
  localStorage.removeItem("noty_token");
  localStorage.removeItem("noty_user");
}

function saveUser(user) {
  localStorage.setItem("noty_user", JSON.stringify(user));
}

const THEME_KEY = "noty_theme";

function getTheme() {
  return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

applyTheme(getTheme());

async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers
  };

  const token = getToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers
    });
  } catch (error) {
    throw new Error("No se pudo conectar con el backend. Verifica que http://localhost:3000 este activo.");
  }

  const responseText = await response.text();
  let data;

  try {
    data = JSON.parse(responseText);
  } catch (error) {
    throw new Error("La API no devolvio JSON. Abre la app desde http://localhost:3000/login.html y verifica que el backend este activo.");
  }

  if (!response.ok) {
    throw new Error(data.message || "Unexpected API error.");
  }

  return data;
}
