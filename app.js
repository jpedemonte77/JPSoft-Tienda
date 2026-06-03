// ============================================================
//  JPSoft | QBV — app.js
//  Firestore + Auth (con soporte offline)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, collection, setDoc, addDoc, getDoc, getDocs,
  onSnapshot, deleteDoc, updateDoc, deleteField,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ============================================================
//  CONFIGURACIÓN FIREBASE
// ============================================================
const firebaseConfig = {
  apiKey:            "AIzaSyAN_v8c9UCo_d2wxVzoIGFXFU3jT_zjZg8",
  authDomain:        "jpsoft-qbv.firebaseapp.com",
  projectId:         "jpsoft-qbv",
  storageBucket:     "jpsoft-qbv.firebasestorage.app",
  messagingSenderId: "201162012438",
  appId:             "1:201162012438:web:f11b5381cfef640f1e0237"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ── Persistencia offline ──
enableIndexedDbPersistence(db).catch(err => {
  if (err.code === "failed-precondition") {
    console.warn("Offline: múltiples pestañas abiertas.");
  } else if (err.code === "unimplemented") {
    console.warn("Offline: navegador no soportado.");
  }
});



// ============================================================
//  AVISO OFFLINE — usando Firebase .info/connected
// ============================================================
let estaOnline = true;

function setOnlineStatus(online) {
  estaOnline = online;
  const banner = document.getElementById("offlineBanner");
  const wrap   = document.getElementById("app-wrapper");
  if (!banner) return;
  if (online) {
    banner.style.display = "none";
    if (wrap) wrap.style.marginTop = "";
  } else {
    banner.style.display = "block";
    if (wrap) wrap.style.marginTop = "36px";
  }
}

// Detectar conexión usando navigator.onLine + eventos
let connectionCheckDone = false;

async function checkConnection() {
  // Si el navegador dice offline, confiar en eso
  if (!navigator.onLine) {
    setOnlineStatus(false);
    connectionCheckDone = true;
    return;
  }
  // Si dice online, intentar conectar a Firestore
  try {
    await getDoc(doc(db, "config", "margenes"));
    setOnlineStatus(true);
  } catch(e) {
    // Si falla por red (no por permisos), estamos offline
    if (e.code === "unavailable" || e.message?.includes("network")) {
      setOnlineStatus(false);
    } else {
      setOnlineStatus(true); // error de permisos u otro — hay conexión
    }
  }
  connectionCheckDone = true;
}

window.addEventListener("online", async () => {
  await checkConnection();
  // Al volver la conexión actualizar el banner y sincronizar
  showToast("Conexión restablecida ✓", "success");
});
window.addEventListener("offline", () => { setOnlineStatus(false); connectionCheckDone = true; });
checkConnection();

// ============================================================
//  ESTADO GLOBAL
// ============================================================
let allProducts   = [];
let proveedores   = {};   // { id: { nombre, tipo, ganancia, categoria } }
let gananciaMap   = {};   // { nombreProv: pct (0-1) }
let provColorMap  = {};
let margenesConfig = { general: 50, tabaco: 30, cigarrillos: 20 }; // valores por defecto
// Nueva estructura: caja/YYYY-MM-DD/manana y caja/YYYY-MM-DD/tarde
let cajaData      = {};   // { "YYYY-MM-DD": { manana: {apertura,ventas,cierre}, tarde: {apertura,ventas,cierre} } }
let cajaFechaKey  = todayKey();
let cierreTurnoActivo = null; // "manana" | "tarde"

// Filtros vista venta
let activeFilter  = "Todos";
let filtered      = [];
let page          = 1;
const PAGE_SIZE   = 50;

// Filtros vista productos
let prodFiltered   = [];
let prodPage       = 1;
const PROD_PAGE    = 40;
let prodEditId     = null;
let provEditId     = null;
let soloConAlerta  = false;

// Carrito
const cart   = {};
const idxMap = {};
let metodoSeleccionado = "efectivo";
let descuentoTipo  = "pesos"; // "pesos" | "pct"
let descuentoValor = 0;

// Import Excel
let parsedImport = null;

const BADGE_COLORS = ["b0","b1","b2","b3","b4","b5","b6"];

// ============================================================
//  HELPERS
// ============================================================
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function todayLabel() {
  return new Date().toLocaleDateString("es-AR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
}

function nowHora() {
  return new Date().toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit", hour12:false });
}

function fmtHora(h) {
  if (!h) return "—";
  // Limpiar formato "11:56 a. m." → "11:56"
  const m = String(h).match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : h;
}

function fmt(n) {
  return "$" + Math.round(n).toLocaleString("es-AR");
}

function fmtDec(n) {
  const r = Math.round(n * 10) / 10;
  return "$" + r.toLocaleString("es-AR", { minimumFractionDigits: r % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 });
}

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function matchQuery(haystack, words) {
  return words.every(w => haystack.includes(w));
}

function highlight(text, words) {
  if (!words.length) return text;
  let r = text;
  words.forEach(w => {
    if (!w) return;
    const e = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    r = r.replace(new RegExp(e, "gi"), m => `<mark>${m}</mark>`);
  });
  return r;
}

function badgeClass(provNombre) {
  const prov = Object.values(proveedores).find(p => p.nombre === provNombre);
  if (prov && prov.tabaco) return "b-tabaco";
  if (!(provNombre in provColorMap))
    provColorMap[provNombre] = BADGE_COLORS[Object.keys(provColorMap).length % BADGE_COLORS.length];
  return provColorMap[provNombre];
}

function getPrecioVenta(p) {
  const gan = gananciaMap[p.proveedor] ?? 0.2;
  return p.lista * (1 + gan);
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast" + (type ? " " + type : "");
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 2800);
}

function getStockStatus(p) {
  if (p.stock === null || p.stock === undefined) return null;
  if (p.stock <= 0) return "sin-stock";
  if (p.stock <= (p.stockMin ?? 5)) return "bajo";
  return "ok";
}

function updateStockBadge() {
  const alertas = allProducts.filter(p => {
    const s = getStockStatus(p);
    return s === "sin-stock" || s === "bajo";
  }).length;
  const badge = document.getElementById("stockAlertBadge");
  const btnAlerta = document.getElementById("btnFiltroAlerta");
  const btnLabel  = document.getElementById("btnFiltroAlertaLabel");
  if (!badge) return;
  if (alertas > 0) {
    badge.textContent = alertas;
    badge.classList.remove("hidden");
    if (btnAlerta) {
      btnAlerta.classList.remove("hidden");
      if (btnLabel) btnLabel.textContent = `Con alerta (${alertas})`;
    }
  } else {
    badge.classList.add("hidden");
    if (btnAlerta) btnAlerta.classList.add("hidden");
    soloConAlerta = false;
  }
}

function getNombreUsuario() {
  return document.getElementById("user-nombre")?.textContent || "";
}

function pct(part, total) {
  if (!total) return "—";
  return Math.round((part / total) * 100) + "% del total";
}

// ============================================================
//  MAPA DE USUARIOS
//  Agregá aquí los emails y nombres de cada empleado
// ============================================================
const ADMIN_NOMBRES = {
  "joaquin@jpsoft-qbv.com": "Joaquín",
  "carlos@jpsoft-qbv.com":  "Carlos",
  // Para agregar más usuarios:
  // "carlos@jpsoft-qbv.com":  "Carlos",
  // "pablo@jpsoft-qbv.com":   "Pablo",
};

function iniciales(nombre) {
  return (nombre || "?").trim().split(/\s+/).filter(Boolean)
    .map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

// ============================================================
//  LOGIN OFFLINE — credenciales encriptadas en localStorage
// ============================================================
const CRED_KEY = "jpsoft_qbv_cred";

function guardarCredencialesOffline(email, password) {
  try {
    const data = btoa(JSON.stringify({ email, password, ts: Date.now() }));
    localStorage.setItem(CRED_KEY, data);
  } catch(e) {}
}

function getCredencialesOffline() {
  try {
    const raw = localStorage.getItem(CRED_KEY);
    if (!raw) return null;
    return JSON.parse(atob(raw));
  } catch(e) { return null; }
}

async function loginOffline(email, password) {
  const cred = getCredencialesOffline();
  if (!cred) return false;
  return cred.email === email && cred.password === password;
}

// ============================================================
//  AUTH
// ============================================================
function mostrarApp(email) {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-wrapper").classList.remove("hidden");
  const _raw  = ADMIN_NOMBRES[email] || email.split("@")[0];
  const nombre = _raw.charAt(0).toUpperCase() + _raw.slice(1);
  document.getElementById("user-nombre").textContent = nombre;
  document.getElementById("user-avatar").textContent = iniciales(nombre);
  initFirebase();
}

onAuthStateChanged(auth, user => {
  if (user) {
    mostrarApp(user.email);
  } else if (!estaOnline) {
    // Si no hay internet verificar si hay sesión offline guardada
    const cred = getCredencialesOffline();
    if (cred) mostrarApp(cred.email);
    else {
      document.getElementById("login-screen").classList.remove("hidden");
      document.getElementById("app-wrapper").classList.add("hidden");
    }
  } else {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app-wrapper").classList.add("hidden");
  }
});

document.getElementById("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const pwd   = document.getElementById("login-password").value;
  const btn   = document.getElementById("btn-login");
  const err   = document.getElementById("login-error");
  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Verificando conexión…";

  // Esperar a que el check de conexión termine
  if (!connectionCheckDone) {
    await checkConnection();
  }

  btn.textContent = "Ingresando…";

  if (!estaOnline) {
    // Login offline — verificar credenciales guardadas
    const ok = await loginOffline(email, pwd);
    if (ok) {
      // Simular usuario logueado con datos guardados
      const cred = getCredencialesOffline();
      mostrarApp(cred.email);
    } else {
      err.textContent = "Sin conexión. Usá las mismas credenciales con las que te logueaste la última vez.";
      btn.disabled = false;
      btn.textContent = "Ingresar";
    }
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, pwd);
    // Guardar credenciales para uso offline
    guardarCredencialesOffline(email, pwd);
  } catch(ex) {
    err.textContent = ex.code === "auth/too-many-requests"
      ? "Demasiados intentos. Esperá unos minutos."
      : "Email o contraseña incorrectos.";
    btn.disabled = false;
    btn.textContent = "Ingresar";
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  const nombre = document.getElementById("user-nombre").textContent || "usuario";
  if (!confirm(`¿Cerrar sesión como ${nombre}?`)) return;
  await signOut(auth);
});

// ============================================================
//  FIREBASE: ESCUCHAR CAMBIOS EN TIEMPO REAL (Firestore)
// ============================================================

// Helper para convertir doc Firestore a objeto plano
function docToObj(d) { return { ...d.data(), _id: d.id }; }

function initFirebase() {
  // Proveedores
  onSnapshot(collection(db, "proveedores"), snap => {
    proveedores = {};
    snap.forEach(d => { proveedores[d.id] = docToObj(d); });
    rebuildGananciaMap();
    renderProveedores();
    buildFilterBar();
    populateProvSelect();
    renderProductosVenta();
    renderProductosTabla();
  });

  // Productos
  onSnapshot(collection(db, "productos"), snap => {
    allProducts = snap.docs.map(d => ({
      ...d.data(), _id: d.id,
      normDesc: norm(d.data().desc || ""),
      normCod:  norm(String(d.data().cod || "")),
      normId:   norm(String(d.data().id || ""))
    }));
    buildFilterBar();
    renderProductosVenta();
    renderProductosTabla();
    updateStockBadge();
  });

  // Caja
  onSnapshot(collection(db, "caja"), snap => {
    cajaData = {};
    snap.forEach(d => { cajaData[d.id] = d.data(); });
    renderCaja();
    updateCajaSidebar();
  });

  // Config márgenes
  onSnapshot(doc(db, "config", "margenes"), snap => {
    if (snap.exists()) Object.assign(margenesConfig, snap.data());
    renderMargenesConfig();
    rebuildGananciaMap();
    renderProductosVenta();
    renderProductosTabla();
  });
}

function rebuildGananciaMap() {
  gananciaMap = {};
  Object.values(proveedores).forEach(p => {
    gananciaMap[p.nombre] = (p.ganancia ?? margenesConfig[p.tipo || "general"] ?? 50) / 100;
  });
}

// ============================================================
//  NAVEGACIÓN
// ============================================================
const VIEWS = { venta: "Venta", caja: "Caja", productos: "Productos", proveedores: "Proveedores" };

document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-" + view).classList.add("active");
    document.getElementById("topbar-title").textContent = VIEWS[view] || view;
    // Cerrar sidebar en mobile
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("open");
  });
});

// Sidebar mobile
document.getElementById("menu-btn").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebar-overlay").classList.toggle("open");
});
document.getElementById("sidebar-close").addEventListener("click", () => {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("open");
});
document.getElementById("sidebar-overlay").addEventListener("click", () => {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("open");
});

// ============================================================
//  VISTA VENTA — TABLA DE PRODUCTOS
// ============================================================
function buildFilterBar() {
  const bar = document.getElementById("filterBar");
  const provs = [...new Set(allProducts.map(p => p.proveedor).filter(Boolean))];
  bar.innerHTML = "";
  ["Todos", ...provs].forEach(name => {
    const btn = document.createElement("button");
    btn.className = "pill" + (name === activeFilter ? " active" : "");
    btn.textContent = name;
    btn.addEventListener("click", () => {
      activeFilter = name;
      document.querySelectorAll("#filterBar .pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      page = 1;
      applyFilters();
    });
    bar.appendChild(btn);
  });
}

function applyFilters() {
  const raw   = document.getElementById("searchInput").value;
  const words = norm(raw).split(" ").filter(Boolean);
  filtered = allProducts.filter(p => {
    if (activeFilter !== "Todos" && p.proveedor !== activeFilter) return false;
    if (!words.length) return true;
    return matchQuery(p.normDesc, words) || matchQuery(p.normCod, words) || matchQuery(p.normId, words);
  });
  page = 1;
  renderProductosVenta();
}

function renderProductosVenta() {
  const tbody  = document.getElementById("tableBody");
  const empty  = document.getElementById("emptyMsg");
  const raw    = document.getElementById("searchInput").value;
  const words  = norm(raw).split(" ").filter(Boolean);
  const total  = filtered.length || allProducts.length;
  const list   = filtered.length || !words.length ? (filtered.length ? filtered : allProducts) : filtered;

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (page > totalPages) page = totalPages;
  const slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (!slice.length) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    renderPagination("pagination", page, totalPages, v => { page = v; renderProductosVenta(); });
    return;
  }

  empty.style.display = "none";

  tbody.innerHTML = slice.map(p => {
    const venta  = getPrecioVenta(p);
    const diff   = venta - p.lista;
    const descHL = words.length ? highlight(p.desc || "", words) : (p.desc || "");
    const inCart = !!cart[p._id];
    const idx    = getIdx(p._id);
    const stock  = p.stock ?? "—";
    const stockClass = typeof p.stock === "number"
      ? (p.stock <= 0 ? "badge-danger" : p.stock <= (p.stockMin || 5) ? "badge-warn" : "badge-neutral")
      : "";

    return `<tr class="${inCart ? "in-cart" : ""}">
      <td><button class="add-btn ${inCart ? "added" : ""}" onclick="window._toggleCart(${idx})" title="${inCart ? "Quitar" : "Agregar"}">${inCart ? "✓" : "+"}</button></td>
      <td><span class="badge ${badgeClass(p.proveedor)}">${p.proveedor || "—"}</span></td>
      <td class="id-cell">${p.id || "—"}</td>
      <td class="cod-cell">${p.cod || "—"}</td>
      <td style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.desc || ""}">${descHL}</td>
      <td class="num p-venta">${fmt(venta)}</td>
      <td class="num"><span class="p-lista">${fmt(p.lista)}</span></td>
      <td class="num"><span class="badge ${stockClass}" style="font-size:10px">${stock}</span></td>
    </tr>`;
  }).join("");

  renderPagination("pagination", page, totalPages, v => { page = v; renderProductosVenta(); });
}

function renderPagination(containerId, currentPage, totalPages, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <button class="btn-secondary" style="font-size:12px;padding:5px 12px" onclick="(${onChange.toString()})(${currentPage - 1})" ${currentPage <= 1 ? "disabled" : ""}>← Anterior</button>
    <span style="font-size:13px;color:var(--text3)">Página ${currentPage} de ${totalPages}</span>
    <button class="btn-secondary" style="font-size:12px;padding:5px 12px" onclick="(${onChange.toString()})(${currentPage + 1})" ${currentPage >= totalPages ? "disabled" : ""}>Siguiente →</button>`;
}

// Lector de código de barras
let scanBuffer = "", lastKeyTime = 0, scanResetTimer = null;
const SCAN_SPEED = 60;

function setScanState(state) {
  const badge = document.getElementById("scanBadge");
  const input = document.getElementById("searchInput");
  if (!badge) return;
  badge.className = "scan-badge";
  input.classList.remove("scanning");
  if (state === "scanning") {
    badge.classList.add("scanning");
    input.classList.add("scanning");
    document.getElementById("scanText").textContent = "Escaneando…";
  } else if (state === "read") {
    badge.classList.add("read");
    document.getElementById("scanText").textContent = "Leído";
    if (scanResetTimer) clearTimeout(scanResetTimer);
    scanResetTimer = setTimeout(() => setScanState("normal"), 2000);
  } else {
    document.getElementById("scanText").textContent = "Listo";
  }
}

document.addEventListener("keydown", e => {
  const now   = Date.now();
  const input = document.getElementById("searchInput");
  if (!input) return;

  // Si el foco está en otro input/textarea/select → no interferir
  const tag = document.activeElement?.tagName?.toLowerCase();
  const isOtherInput = (tag === "input" || tag === "textarea" || tag === "select") && document.activeElement !== input;
  if (isOtherInput) return;

  // Si el foco está en el buscador
  if (document.activeElement === input) {
    if (e.key === "Enter") { e.preventDefault(); applyFilters(); }
    if (e.key === "Escape") { input.value = ""; applyFilters(); input.blur(); }
    return;
  }

  // Solo actuar si la vista venta está activa
  const viewVenta = document.getElementById("view-venta");
  if (!viewVenta?.classList.contains("active")) return;

  const gap = now - lastKeyTime; lastKeyTime = now;

  if (e.key === "Enter") {
    if (scanBuffer.length >= 4) {
      input.value = scanBuffer;
      setScanState("read");
      applyFilters();
      input.focus();
    }
    scanBuffer = ""; return;
  }

  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // Tecleo rápido (scanner) vs lento (humano)
    const esScan = gap < SCAN_SPEED;
    if (esScan) {
      if (gap > SCAN_SPEED * 3 && scanBuffer.length > 0) { scanBuffer = ""; setScanState("normal"); }
      if (scanBuffer.length === 0) setScanState("scanning");
      scanBuffer += e.key;
    } else {
      // Búsqueda rápida — enfocar el input y dejar que el caracter se escriba
      scanBuffer = "";
      setScanState("normal");
      input.focus();
      // No prevenir el default — el caracter se escribe solo en el input enfocado
    }
  } else if (e.key === "Escape") {
    input.value = "";
    applyFilters();
    scanBuffer = "";
  } else {
    scanBuffer = "";
  }
});

document.getElementById("searchInput").addEventListener("input", applyFilters);

// ============================================================
//  CARRITO
// ============================================================
function getIdx(key) {
  for (const [i, k] of Object.entries(idxMap)) if (k === key) return i;
  const i = Object.keys(idxMap).length;
  idxMap[i] = key;
  return i;
}

window._toggleCart = function(idx) {
  const key = idxMap[idx]; if (!key) return;
  const p = allProducts.find(x => x._id === key); if (!p) return;
  if (cart[key]) delete cart[key];
  else cart[key] = { product: p, qty: 1 };
  renderProductosVenta();
  renderCart();
};

window._removeFromCart = function(key) {
  delete cart[key];
  renderProductosVenta();
  renderCart();
};

window._changeQty = function(key, delta) {
  if (!cart[key]) return;
  cart[key].qty = Math.max(1, cart[key].qty + delta);
  renderCart();
};

function calcDescuento(subtotal) {
  if (!descuentoValor || descuentoValor <= 0) return 0;
  if (descuentoTipo === "pct") return Math.round(subtotal * (descuentoValor / 100));
  return Math.min(Math.round(descuentoValor), subtotal);
}

function renderCart() {
  const keys      = Object.keys(cart);
  const subtotal  = keys.reduce((s, k) => s + getPrecioVenta(cart[k].product) * cart[k].qty, 0);
  const descMonto = calcDescuento(subtotal);
  const total     = subtotal - descMonto;

  // ── Barra cobrar (layout E) ──
  const cobrarBar   = document.getElementById("cobrarBar");
  const cobrarItems = document.getElementById("cobrarItems");
  const cobrarTotal = document.getElementById("cobrarTotal");
  if (cobrarBar)   cobrarBar.style.display   = keys.length > 0 ? "flex" : "none";
  if (cobrarItems) cobrarItems.textContent   = keys.length + (keys.length === 1 ? " ítem" : " ítems");
  if (cobrarTotal) cobrarTotal.textContent   = fmtDec(total);

  // ── Compatibilidad ──
  const btnConfirmar = document.getElementById("btnConfirmarVenta");
  const el    = document.getElementById("cartItems");
  const empty = document.getElementById("cartEmpty");

  if (btnConfirmar) btnConfirmar.disabled = keys.length === 0;

  if (!el) return;

  if (!keys.length) {
    if (empty) empty.style.display = "block";
    el.innerHTML = "";
    return;
  }

  if (empty) empty.style.display = "none";
  el.innerHTML = "";

  keys.forEach(k => {
    const { product: p, qty } = cart[k];
    const pv  = getPrecioVenta(p);
    const sub = pv * qty;

    const item = document.createElement("div");
    item.className = "cart-item";

    const info = document.createElement("div");
    info.className = "cart-item-info";

    const nombre = document.createElement("div");
    nombre.className = "cart-item-name";
    nombre.title = p.desc || "";
    nombre.textContent = p.desc || "";

    const detalle = document.createElement("div");
    detalle.className = "cart-item-detail";
    const badge = document.createElement("span");
    badge.className = "badge " + badgeClass(p.proveedor);
    badge.style.fontSize = "9px";
    badge.textContent = p.proveedor || "";
    detalle.appendChild(badge);

    info.appendChild(nombre);
    info.appendChild(detalle);

    const right = document.createElement("div");
    right.className = "cart-item-right";

    const precio = document.createElement("span");
    precio.className = "cart-item-price";
    precio.textContent = fmtDec(sub);

    const qtyWrap = document.createElement("div");
    qtyWrap.className = "qty-wrap";

    const btnMinus = document.createElement("button");
    btnMinus.className = "qty-btn";
    btnMinus.textContent = "-";
    btnMinus.dataset.action = "minus";
    btnMinus.dataset.key = k;

    const qtyVal = document.createElement("span");
    qtyVal.className = "qty-val";
    qtyVal.textContent = qty;

    const btnPlus = document.createElement("button");
    btnPlus.className = "qty-btn";
    btnPlus.textContent = "+";
    btnPlus.dataset.action = "plus";
    btnPlus.dataset.key = k;

    qtyWrap.appendChild(btnMinus);
    qtyWrap.appendChild(qtyVal);
    qtyWrap.appendChild(btnPlus);

    right.appendChild(precio);
    right.appendChild(qtyWrap);

    const btnDel = document.createElement("button");
    btnDel.className = "cart-del";
    btnDel.textContent = "×";
    btnDel.dataset.action = "remove";
    btnDel.dataset.key = k;

    item.appendChild(info);
    item.appendChild(right);
    item.appendChild(btnDel);

    el.appendChild(item);
  });
}

// Delegación de eventos en el contenedor — se registra una sola vez
document.getElementById("cartItems").addEventListener("click", e => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const key    = btn.dataset.key;
  if (action === "plus")   window._changeQty(key, 1);
  if (action === "minus")  window._changeQty(key, -1);
  if (action === "remove") window._removeFromCart(key);
});

// Descuento — tipo y valor
document.querySelectorAll(".desc-tipo-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    descuentoTipo = btn.dataset.tipo;
    document.querySelectorAll(".desc-tipo-btn").forEach(b => {
      b.style.background = "var(--surface2)";
      b.style.color = "var(--text2)";
    });
    btn.style.background = "var(--accent)";
    btn.style.color = "#fff";
    renderCart();
  });
});

document.getElementById("descuentoInput")?.addEventListener("input", function() {
  descuentoValor = parseFloat(this.value) || 0;
  renderCart();
});

// Métodos de pago
document.querySelectorAll(".pago-chip").forEach(btn => {
  btn.addEventListener("click", () => {
    metodoSeleccionado = btn.dataset.metodo;
    document.querySelectorAll(".pago-chip").forEach(b => {
      b.className = "pago-chip";
    });
    btn.classList.add("selected-" + metodoSeleccionado);
  });
});

// Confirmar venta → abrir modal ticket
document.getElementById("btnConfirmarVenta").addEventListener("click", () => {
  const keys = Object.keys(cart);
  if (!keys.length) return;

  const cajaHoy = cajaData[todayKey()] || {};
  const turnoAbierto = (cajaHoy.manana?.apertura && !cajaHoy.manana?.cierre) ? "manana"
    : (cajaHoy.tarde?.apertura && !cajaHoy.tarde?.cierre) ? "tarde" : null;
  if (!turnoAbierto) {
    showToast("Debés abrir la caja antes de registrar ventas.", "error");
    document.querySelector('[data-view="caja"]').click();
    return;
  }

  renderModalVenta();
  document.getElementById("modalVenta").classList.remove("hidden");
});

// Event listener único para +/- en modal (se registra una sola vez)
document.getElementById("ventaCartItems")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const key    = btn.dataset.key;
  if (action === "plus")  { window._changeQty(key, 1);  renderModalVenta(); }
  if (action === "minus") { window._changeQty(key, -1); renderModalVenta(); }
});

function renderModalVenta() {
  const keys      = Object.keys(cart);
  const subtotal  = keys.reduce((s, k) => s + getPrecioVenta(cart[k].product) * cart[k].qty, 0);
  const descMonto = calcDescuento(subtotal);
  const total     = subtotal - descMonto;
  const hora      = nowHora();
  const fecha     = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });

  // ── Ítems ──
  const ventaCart = document.getElementById("ventaCartItems");
  if (ventaCart) {
    ventaCart.innerHTML = keys.map((k, i) => {
      const { product: p, qty } = cart[k];
      const sub = getPrecioVenta(p) * qty;
      const border = i < keys.length - 1 ? "border-bottom:1px solid var(--border);" : "";
      return `<div style="display:flex;align-items:center;padding:8px 12px;${border}gap:8px;font-size:13px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">${p.desc}</span>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <button class="qty-btn" data-action="minus" data-key="${k}" style="width:22px;height:22px">-</button>
          <span style="font-size:12px;font-weight:500;min-width:18px;text-align:center">${qty}</span>
          <button class="qty-btn" data-action="plus" data-key="${k}" style="width:22px;height:22px">+</button>
        </div>
        <span style="font-weight:600;flex-shrink:0;min-width:64px;text-align:right">${fmtDec(sub)}</span>
      </div>`;
    }).join("");
  }

  // ── Totales en modal (IDs únicos) ──
  const mSub   = document.getElementById("modalSubtotal");
  const mTot   = document.getElementById("modalTotal");
  const mDRow  = document.getElementById("modalDescuentoRow");
  const mDLbl  = document.getElementById("modalDescuentoLabel");
  const mDMon  = document.getElementById("modalDescuentoMonto");
  const mDBar  = document.getElementById("modalDescBar");

  if (mSub)  mSub.textContent  = fmtDec(subtotal);
  if (mTot)  mTot.textContent  = fmtDec(total);
  if (mDBar) mDBar.textContent = descMonto > 0 ? "− " + fmtDec(descMonto) : "";

  if (mDRow) {
    if (descMonto > 0) {
      mDRow.style.display = "flex";
      const sufijo = descuentoTipo === "pct" ? ` (${descuentoValor}%)` : "";
      if (mDLbl) mDLbl.textContent = "Descuento" + sufijo;
      if (mDMon) mDMon.textContent = "− " + fmtDec(descMonto);
    } else {
      mDRow.style.display = "none";
    }
  }

  // ── Actualizar barra cobrar ──
  const cobrarTotal = document.getElementById("cobrarTotal");
  const cobrarItems = document.getElementById("cobrarItems");
  if (cobrarTotal) cobrarTotal.textContent = fmtDec(total);
  if (cobrarItems) cobrarItems.textContent = keys.length + (keys.length === 1 ? " ítem" : " ítems");

  window._ventaPendiente = { keys, total, subtotal, descMonto, hora, fecha };
}

document.getElementById("closeModalVenta").addEventListener("click", () => document.getElementById("modalVenta").classList.add("hidden"));
document.getElementById("btnCancelarVenta").addEventListener("click", () => document.getElementById("modalVenta").classList.add("hidden"));

// Guardar ticket como .txt
document.getElementById("btnGuardarTicket").addEventListener("click", () => {
  const { keys, total, hora, fecha } = window._ventaPendiente || {};
  if (!keys) return;
  const metodoLabel = { efectivo: "Efectivo", debito: "Débito", mp: "Mercado Pago" };
  const lineas = keys.map(k => {
    const { product: p, qty } = cart[k];
    const sub = getPrecioVenta(p) * qty;
    const det = qty > 1 ? `${p.desc} x${qty}` : p.desc;
    return `${det.padEnd(35, ".")} ${fmtDec(sub)}`;
  }).join("\n");
  const txt = `JPSoft | QBV\n${fecha} — ${hora} hs\nMétodo: ${metodoLabel[metodoSeleccionado]}\n\n${lineas}\n${"─".repeat(45)}\nTOTAL: ${fmtDec(total)}`;
  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Ticket_${fecha.replace(/\//g,"-")}_${hora.replace(":","-")}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  confirmarVentaFinal();
});

// Confirmar venta final → guardar en Firebase
document.getElementById("btnConfirmarVentaFinal").addEventListener("click", confirmarVentaFinal);

async function confirmarVentaFinal() {
  const pendiente = window._ventaPendiente;
  if (!pendiente?.keys) return;
  const { keys, total, hora, subtotal: vSubtotal, descMonto: vDesc } = pendiente;

  // 1. Capturar todos los datos ANTES de limpiar el carrito
  const items = keys.map(k => {
    const { product: p, qty } = cart[k];
    return { desc: p.desc, qty, precioUnit: Math.round(getPrecioVenta(p)), subtotal: Math.round(getPrecioVenta(p) * qty), proveedor: p.proveedor };
  });

  const stockUpdates = {};
  keys.forEach(k => {
    const { product: p, qty } = cart[k];
    if (typeof p.stock === "number") {
      stockUpdates[p._id] = Math.max(0, p.stock - qty);
    }
  });

  const _cajaHoy = cajaData[todayKey()] || {};
  const _turno = (_cajaHoy.manana?.apertura && !_cajaHoy.manana?.cierre) ? "manana"
    : (_cajaHoy.tarde?.apertura && !_cajaHoy.tarde?.cierre) ? "tarde" : "manana";
  const cajaActual = { ..._cajaHoy };
  const turnoData  = cajaActual[_turno] || {};
  const ventaId    = `v_${Date.now()}`;
  const ventasActuales = { ...(turnoData.ventas || {}) };
  ventasActuales[ventaId] = {
    hora, metodo: metodoSeleccionado,
    total:     Math.round(total),
    subtotal:  Math.round(vSubtotal || total),
    descuento: Math.round(vDesc || 0),
    items, admin: getNombreUsuario()
  };

  // 2. Cerrar modal y limpiar carrito INMEDIATAMENTE
  Object.keys(cart).forEach(k => delete cart[k]);
  descuentoValor = 0;
  const descInput = document.getElementById("descuentoInput");
  if (descInput) descInput.value = "";
  window._ventaPendiente = null;
  document.getElementById("modalVenta").classList.add("hidden");
  renderCart();
  renderProductosVenta();
  showToast("Venta registrada ✓", "success");

  // 3. Escribir en Firestore en segundo plano (funciona offline)
  const cajaRef = doc(db, 'caja', todayKey());
  setDoc(cajaRef, { [_turno]: { ...turnoData, ventas: ventasActuales } }, { merge: true });

  Object.entries(stockUpdates).forEach(([prodId, val]) => {
    updateDoc(doc(db, 'productos', prodId), { stock: val });
  });
}

// ============================================================
//  VISTA CAJA — DOS TURNOS
// ============================================================

const TURNO_LABEL = { manana: "Mañana", tarde: "Tarde" };

function getTurnosDelDia(fecha) {
  const d = cajaData[fecha] || {};
  return { manana: d.manana || null, tarde: d.tarde || null };
}

function getVentas(turnoObj) {
  return turnoObj?.ventas ? Object.values(turnoObj.ventas) : [];
}

function calcTotalesTurno(turnoObj) {
  const ventas = getVentas(turnoObj);
  let totE = 0, totD = 0, totM = 0;
  ventas.forEach(v => {
    if (v.metodo === "efectivo") totE += v.total || 0;
    else if (v.metodo === "debito") totD += v.total || 0;
    else if (v.metodo === "mp") totM += v.total || 0;
  });
  return { totE, totD, totM, tot: totE + totD + totM, ventas };
}

function renderCaja() {
  const esHoy = cajaFechaKey === todayKey();
  const { manana, tarde } = getTurnosDelDia(cajaFechaKey);

  document.getElementById("cajaTituloFecha").textContent = "Caja — " + fechaLabel(cajaFechaKey);
  document.getElementById("btnCajaSiguiente").disabled = esHoy;

  // Stats globales del día
  const tmTot = calcTotalesTurno(manana);
  const ttTot = calcTotalesTurno(tarde);
  const totTotal  = tmTot.tot + ttTot.tot;
  const totE      = tmTot.totE + ttTot.totE;
  const totD      = tmTot.totD + ttTot.totD;
  const totM      = tmTot.totM + ttTot.totM;
  const totVentas = tmTot.ventas.length + ttTot.ventas.length;
  const hayDatos  = manana || tarde;

  const statsWrap = document.getElementById("cajaStatsWrap");
  if (hayDatos) {
    statsWrap.classList.remove("hidden");
    document.getElementById("statTotal").textContent    = fmt(totTotal);
    document.getElementById("statVentas").textContent   = totVentas + (totVentas === 1 ? " venta" : " ventas");
    document.getElementById("statEfectivo").textContent = fmt(totE);
    document.getElementById("statDebito").textContent   = fmt(totD);
    document.getElementById("statMp").textContent       = fmt(totM);
    document.getElementById("statEfectivoPct").textContent = pct(totE, totTotal);
    document.getElementById("statDebitoPct").textContent   = pct(totD, totTotal);
    document.getElementById("statMpPct").textContent       = pct(totM, totTotal);
  } else {
    statsWrap.classList.add("hidden");
  }

  // Botones de acción en el header
  const acciones = document.getElementById("cajaAcciones");
  acciones.innerHTML = "";

  // Botón imprimir — solo si hay al menos un turno cerrado
  const hayAlgunCierre = manana?.cierre || tarde?.cierre;
  if (hayAlgunCierre) {
    const btnPrint = document.createElement("button");
    btnPrint.className = "btn-secondary";
    btnPrint.id = "btnImprimirCierre";
    btnPrint.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Imprimir`;
    btnPrint.addEventListener("click", imprimirCierreCaja);
    acciones.appendChild(btnPrint);
  }

  // Render de cada turno
  const wrap = document.getElementById("cajaTurnosWrap");
  wrap.innerHTML = "";

  const ambosNoAbiertos = !manana?.apertura && !tarde?.apertura;

  if (ambosNoAbiertos) {
    // Ambos sin abrir — lado a lado
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:14px;padding:1.25rem;background:var(--surface2)";
    ["manana", "tarde"].forEach(turnoKey => {
      const turno = turnoKey === "manana" ? manana : tarde;
      row.appendChild(renderTurnoCard(turnoKey, turno, esHoy, manana, tarde));
    });
    wrap.appendChild(row);
  } else {
    // Al menos uno tiene datos — uno debajo del otro
    ["manana", "tarde"].forEach(turnoKey => {
      const turno = turnoKey === "manana" ? manana : tarde;
      wrap.appendChild(renderTurnoCard(turnoKey, turno, esHoy, manana, tarde));
    });
  }

  // Subtítulo
  const abiertos = [];
  if (manana?.apertura && !manana?.cierre) abiertos.push("Mañana");
  if (tarde?.apertura && !tarde?.cierre)   abiertos.push("Tarde");
  document.getElementById("cajaSubtitulo").textContent = abiertos.length
    ? "Abierto: " + abiertos.join(" y ")
    : hayDatos ? "Ambos turnos cerrados" : "Sin registros";
}

function renderTurnoCard(turnoKey, turno, esHoy, manana, tarde) {
  const label    = TURNO_LABEL[turnoKey];
  const apertura = turno?.apertura;
  const cierre   = turno?.cierre;
  const { totE, totD, totM, tot, ventas } = calcTotalesTurno(turno);
  const yaAbierto = !!apertura;
  const yaCerrado = !!cierre;

  // Condición para poder abrir turno tarde: mañana debe estar cerrado
  const puedeAbrirTarde = turnoKey === "tarde" && (!tarde?.apertura) && (manana?.cierre || !manana?.apertura);
  const puedeAbrir = turnoKey === "manana" ? (!manana?.apertura) : puedeAbrirTarde;

  const card = document.createElement("div");
  card.style.cssText = "background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;margin-bottom:14px";

  // Header del turno
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px";

  const titleWrap = document.createElement("div");
  titleWrap.innerHTML = `<div style="font-size:14px;font-weight:600">Turno ${label}</div>
    ${apertura ? `<div style="font-size:12px;color:var(--text3);margin-top:2px">Apertura ${fmtHora(apertura.hora)} · Fondo ${apertura.fondo ? fmt(apertura.fondo) : "—"} · ${apertura.admin || ""}</div>` : ""}`;

  const btns = document.createElement("div");
  btns.style.cssText = "display:flex;gap:6px";

  if (!yaAbierto && esHoy && puedeAbrir) {
    // Formulario apertura — disponible
    card.style.cssText = "background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius);padding:1.25rem;margin-bottom:14px;max-width:420px";
    card.innerHTML = `
      <div style="font-size:15px;font-weight:600;margin-bottom:4px">Turno ${label}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.5">Ingresá el fondo inicial para abrir el turno.</div>
      <label class="form-label">Fondo inicial ($)</label>
      <input type="number" class="form-input" id="fondoInput_${turnoKey}" placeholder="Ej: 5000" min="0" style="margin-bottom:12px" />
      <button id="btnAbrir_${turnoKey}" style="width:100%;padding:9px;background:#111;color:#fff;border:1px solid #111;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">
        Abrir Turno ${label}
      </button>`;

    setTimeout(() => {
      document.getElementById(`btnAbrir_${turnoKey}`)?.addEventListener("click", async () => {
        const fondo = parseFloat(document.getElementById(`fondoInput_${turnoKey}`).value) || 0;
        // Cerrar form inmediatamente
        showToast(`Turno ${label} abierto ✓`, "success");
        // Escribir en Firestore en segundo plano
        setDoc(doc(db, 'caja', cajaFechaKey), {
          [turnoKey]: { apertura: { hora: nowHora(), fondo, turno: label, admin: getNombreUsuario() } }
        }, { merge: true });
      });
    }, 0);
    return card;
  }

  if (!yaAbierto) {
    // Turno no abierto y no se puede abrir aún — atenuado
    card.style.cssText = "background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;flex:1;opacity:0.45;max-width:420px";
    card.innerHTML = `
      <div style="font-size:15px;font-weight:600;margin-bottom:4px">Turno ${label}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.5">Disponible una vez cerrado el Turno Mañana.</div>
      <label class="form-label">Fondo inicial ($)</label>
      <input type="number" class="form-input" placeholder="Ej: 5000" disabled style="margin-bottom:12px;opacity:.6" />
      <button disabled style="width:100%;padding:9px;background:#111;color:#fff;border:1px solid #111;border-radius:8px;font-size:13px;font-weight:500;font-family:inherit;cursor:default;opacity:.6">
        No disponible aún
      </button>`;
    return card;
  }

  // Turno abierto o cerrado — mostrar datos
  if (yaCerrado) {
    const btnReabrir = document.createElement("button");
    btnReabrir.className = "btn-secondary";
    btnReabrir.textContent = "Reabrir";
    btnReabrir.addEventListener("click", async () => {
      if (!confirm(`¿Reabrir el Turno ${label}?\nSe eliminará el cierre registrado.`)) return;
      showToast(`Turno ${label} reabierto ✓`, "success");
      updateDoc(doc(db, 'caja', cajaFechaKey), {
        [`${turnoKey}.cierre`]: deleteField()
      });
    });
    btns.appendChild(btnReabrir);
  } else if (esHoy) {
    const btnCerrar = document.createElement("button");
    btnCerrar.className = "btn-danger";
    btnCerrar.textContent = "Cerrar turno";
    btnCerrar.addEventListener("click", () => abrirModalCierre(turnoKey, { totE, totD, totM, tot, ventas }));
    btns.appendChild(btnCerrar);
  }

  header.appendChild(titleWrap);
  header.appendChild(btns);
  card.appendChild(header);

  // Badge estado
  const badge = document.createElement("div");
  badge.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap";
  badge.innerHTML = yaCerrado
    ? `<span class="badge badge-neutral">Cerrado ${fmtHora(cierre.hora)}</span>`
    : `<span class="badge badge-success">Abierto</span>`;
  card.appendChild(badge);

  // Mini stats del turno
  const stats = document.createElement("div");
  stats.style.cssText = "display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px";
  stats.innerHTML = `
    <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:8px 10px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Total</div>
      <div style="font-size:15px;font-weight:600;font-family:'DM Mono',monospace">${fmt(tot)}</div>
      <div style="font-size:10px;color:var(--text3)">${ventas.length} ventas</div>
    </div>
    <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:8px 10px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Efectivo</div>
      <div style="font-size:14px;font-weight:500;color:var(--success)">${fmt(totE)}</div>
    </div>
    <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:8px 10px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Débito</div>
      <div style="font-size:14px;font-weight:500;color:var(--info)">${fmt(totD)}</div>
    </div>
    <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:8px 10px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Mercado Pago</div>
      <div style="font-size:14px;font-weight:500;color:var(--mp)">${fmt(totM)}</div>
    </div>`;
  card.appendChild(stats);

  // Timeline ventas
  if (ventas.length) {
    const timelineWrap = document.createElement("div");
    timelineWrap.className = "timeline-wrap";
    timelineWrap.style.marginTop = "0";
    const metLabel = { efectivo:"Efectivo", debito:"Débito", mp:"Mercado Pago" };
    const metClass = { efectivo:"metodo-efectivo", debito:"metodo-debito", mp:"metodo-mp" };
    timelineWrap.innerHTML = `
      <div class="timeline-header">
        <span>Descripción</span><span>Hora</span><span>Método</span><span class="num">Ítems</span><span class="num">Total</span>
      </div>
      ${[...ventas].sort((a,b)=>(b.hora||"").localeCompare(a.hora||"")).map(v=>`
        <div class="timeline-row">
          <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(v.items||[]).map(i=>i.desc).join(", ")}</span>
          <span style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fmtHora(v.hora)||"—"}</span>
          <span class="${metClass[v.metodo]||""}">${metLabel[v.metodo]||v.metodo}</span>
          <span class="num">${(v.items||[]).reduce((s,i)=>s+i.qty,0)}</span>
          <span class="num" style="font-weight:500">${fmt(v.total)}</span>
        </div>`).join("")}`;
    card.appendChild(timelineWrap);
  }

  return card;
}

function abrirModalCierre(turnoKey, { totE, totD, totM, tot, ventas }) {
  cierreTurnoActivo = turnoKey;
  const label = TURNO_LABEL[turnoKey];
  document.getElementById("modalCierreTitulo").textContent = `Cerrar Turno ${label}`;
  document.getElementById("cierreResumenTexto").innerHTML = `
    <p style="margin-bottom:10px">Vas a cerrar el Turno ${label}.</p>
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:13px;line-height:2">
      <div style="display:flex;justify-content:space-between"><span>Total recaudado</span><span style="font-weight:600">${fmt(tot)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Efectivo</span><span>${fmt(totE)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Débito</span><span>${fmt(totD)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Mercado Pago</span><span>${fmt(totM)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Ventas</span><span>${ventas.length}</span></div>
    </div>`;
  document.getElementById("modalCierreCaja").classList.remove("hidden");
}

function updateCajaSidebar() {
  const hoy = cajaData[todayKey()] || {};
  const tmTot = calcTotalesTurno(hoy.manana);
  const ttTot = calcTotalesTurno(hoy.tarde);
  const total = tmTot.tot + ttTot.tot;

  document.getElementById("caja-sidebar-total").textContent = fmt(total);
  const state = document.getElementById("caja-sidebar-state");

  const tmAbierto = hoy.manana?.apertura && !hoy.manana?.cierre;
  const ttAbierto = hoy.tarde?.apertura  && !hoy.tarde?.cierre;

  if (tmAbierto || ttAbierto) {
    const t = [];
    if (tmAbierto) t.push("TM");
    if (ttAbierto) t.push("TT");
    state.textContent = "Abierta · " + t.join("+");
    state.className = "caja-sidebar-state caja-open";
  } else if (hoy.manana || hoy.tarde) {
    state.textContent = "Cerrada";
    state.className = "caja-sidebar-state caja-closed";
  } else {
    state.textContent = "Sin abrir";
    state.className = "caja-sidebar-state caja-closed";
  }
}

// Navegación de fechas
function offsetFecha(key, dias) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + dias);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}

function fechaLabel(key) {
  if (key === todayKey()) return "Hoy — " + new Date().toLocaleDateString("es-AR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m-1, d).toLocaleDateString("es-AR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
}

document.getElementById("btnCajaAnterior").addEventListener("click", () => {
  cajaFechaKey = offsetFecha(cajaFechaKey, -1);
  renderCaja();
});

document.getElementById("btnCajaSiguiente").addEventListener("click", () => {
  const siguiente = offsetFecha(cajaFechaKey, 1);
  if (siguiente > todayKey()) return;
  cajaFechaKey = siguiente;
  renderCaja();
});

// Modal cierre
document.getElementById("closeModalCierre").addEventListener("click", () => document.getElementById("modalCierreCaja").classList.add("hidden"));
document.getElementById("btnCancelarCierre").addEventListener("click", () => document.getElementById("modalCierreCaja").classList.add("hidden"));

document.getElementById("btnConfirmarCierre").addEventListener("click", () => {
  if (!cierreTurnoActivo) return;
  const turno = cierreTurnoActivo;

  // Cerrar modal inmediatamente
  document.getElementById("modalCierreCaja").classList.add("hidden");
  showToast(`Turno ${TURNO_LABEL[turno]} cerrado ✓`);
  cierreTurnoActivo = null;

  // Escribir en Firestore en segundo plano
  setDoc(doc(db, 'caja', cajaFechaKey), {
    [turno]: { cierre: { hora: nowHora(), admin: getNombreUsuario() } }
  }, { merge: true });
});

// Imprimir cierre
async function imprimirCierreCaja() {
  const { manana, tarde } = getTurnosDelDia(cajaFechaKey);
  const [fy, fm, fd] = cajaFechaKey.split("-");
  const fechaLbl = fechaLabel(cajaFechaKey);

  const renderTurnoHTML = (turnoObj, label) => {
    if (!turnoObj?.apertura) return "";
    const { totE, totD, totM, tot, ventas } = calcTotalesTurno(turnoObj);
    const metLabel = { efectivo:"Efectivo", debito:"Débito", mp:"MP" };
    const rows = [...ventas].sort((a,b)=>(b.hora||"").localeCompare(a.hora||"")).map(v => {
      const desc = (v.items||[]).map(i=>i.desc).join(", ");
      return `<tr>
        <td>${fmtHora(v.hora)||"—"}</td>
        <td>${desc.length > 35 ? desc.slice(0,35)+"…" : desc}</td>
        <td>${metLabel[v.metodo]||v.metodo}</td>
        <td style="text-align:right">${fmt(v.total)}</td>
      </tr>`;
    }).join("");

    return `
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#aaa;margin:14px 0 8px">Turno ${label}</div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#555">Apertura</span><span style="font-weight:500">${fmtHora(turnoObj.apertura.hora)||"—"}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#555">Cierre</span><span style="font-weight:500">${turnoObj.cierre ? fmtHora(turnoObj.cierre.hora) : "—"}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#555">Fondo inicial</span><span style="font-weight:500">${turnoObj.apertura.fondo ? fmt(turnoObj.apertura.fondo) : "—"}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#555">Responsable</span><span style="font-weight:500">${turnoObj.apertura.admin||"—"}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#1a7a50;font-weight:500">Efectivo</span><span>${fmt(totE)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#185fa5;font-weight:500">Débito</span><span>${fmt(totD)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#009ee3;font-weight:500">Mercado Pago</span><span>${fmt(totM)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:600;padding-top:8px;border-top:1.5px solid #111;margin-top:6px"><span>Subtotal ${label}</span><span>${fmt(tot)}</span></div>
      ${rows.length ? `
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#aaa;margin:12px 0 6px">Ventas (${ventas.length})</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr>
            <th style="text-align:left;font-size:9px;color:#aaa;text-transform:uppercase;padding:3px 0;border-bottom:1px solid #eee">Hora</th>
            <th style="text-align:left;font-size:9px;color:#aaa;text-transform:uppercase;padding:3px 0;border-bottom:1px solid #eee">Descripción</th>
            <th style="text-align:left;font-size:9px;color:#aaa;text-transform:uppercase;padding:3px 0;border-bottom:1px solid #eee">Método</th>
            <th style="text-align:right;font-size:9px;color:#aaa;text-transform:uppercase;padding:3px 0;border-bottom:1px solid #eee">Total</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>` : ""}`;
  };

  const tmTot = calcTotalesTurno(manana);
  const ttTot = calcTotalesTurno(tarde);
  const totGeneral = tmTot.tot + ttTot.tot;
  const totEG = tmTot.totE + ttTot.totE;
  const totDG = tmTot.totD + ttTot.totD;
  const totMG = tmTot.totM + ttTot.totM;

  const now = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });

  const content = `
    <div style="font-family:'DM Sans',sans-serif;font-size:13px;color:#111;padding:2rem;max-width:520px;margin:0 auto">
      <div style="font-size:18px;font-weight:600;margin-bottom:2px">JPSoft | QBV</div>
      <div style="font-size:12px;color:#888;margin-bottom:1.5rem">Resumen de cierre — ${fechaLbl}</div>

      ${renderTurnoHTML(manana, "Mañana")}
      ${(manana && tarde) ? '<hr style="border:none;border-top:1px solid #eee;margin:16px 0" />' : ""}
      ${renderTurnoHTML(tarde, "Tarde")}

      <hr style="border:none;border-top:2px solid #111;margin:16px 0" />
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#aaa;margin-bottom:8px">Total del día</div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#1a7a50;font-weight:500">Efectivo</span><span>${fmt(totEG)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#185fa5;font-weight:500">Débito</span><span>${fmt(totDG)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#009ee3;font-weight:500">Mercado Pago</span><span>${fmt(totMG)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:17px;font-weight:600;padding-top:8px;border-top:2px solid #111;margin-top:6px"><span>TOTAL GENERAL</span><span>${fmt(totGeneral)}</span></div>

      <div style="font-size:11px;color:#bbb;text-align:center;margin-top:1.5rem">Generado el ${now} · JPSoft | QBV</div>
    </div>`;

  // Nombre archivo
  const turnosAbiertos = [];
  if (manana?.apertura) turnosAbiertos.push("TM");
  if (tarde?.apertura)  turnosAbiertos.push("TT");
  const nombrePDF = `JPSoft_QBV_${turnosAbiertos.join("-")}_${parseInt(fd)}-${parseInt(fm)}-${fy}`;

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:600px;background:#fff";
  container.innerHTML = content;
  document.body.appendChild(container);

  const btn = document.getElementById("btnImprimirCierre");
  const btnOrig = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.textContent = "Generando…"; }

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: "#fff" });
    const { jsPDF } = window.jspdf;
    const pdf  = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const imgW = 210;
    const imgH = (canvas.height * imgW) / canvas.width;
    const pages = Math.ceil(imgH / 297);
    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, -i * 297, imgW, imgH);
    }
    pdf.save(`${nombrePDF}.pdf`);
    showToast("PDF generado ✓", "success");
  } catch(err) {
    showToast("Error al generar PDF: " + err.message, "error");
  } finally {
    document.body.removeChild(container);
    if (btn) { btn.disabled = false; btn.innerHTML = btnOrig; }
  }
}

// ============================================================
//  VISTA PRODUCTOS — TABLA ABM
// ============================================================
function renderProductosTabla() {
  const searchVal = (document.getElementById("prodSearchInput")?.value || "").trim();
  const provFilt  = document.getElementById("prodFilterProv")?.value || "";
  const words     = norm(searchVal).split(" ").filter(Boolean);

  prodFiltered = allProducts.filter(p => {
    if (provFilt && p.proveedor !== provFilt) return false;
    if (soloConAlerta) {
      const s = getStockStatus(p);
      if (s !== "sin-stock" && s !== "bajo") return false;
    }
    if (!words.length) return true;
    return matchQuery(p.normDesc, words) || matchQuery(p.normCod, words) || matchQuery(p.normId, words);
  });

  const totalPages = Math.max(1, Math.ceil(prodFiltered.length / PROD_PAGE));
  if (prodPage > totalPages) prodPage = totalPages;
  const slice = prodFiltered.slice((prodPage - 1) * PROD_PAGE, prodPage * PROD_PAGE);

  const tbody = document.getElementById("prodTableBody");
  const empty = document.getElementById("prodEmptyMsg");

  if (!slice.length) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    renderPagination("prodPagination", prodPage, totalPages, v => { prodPage = v; renderProductosTabla(); });
    return;
  }

  empty.style.display = "none";

  tbody.innerHTML = slice.map(p => {
    const venta      = getPrecioVenta(p);
    const ganPct     = gananciaMap[p.proveedor] != null ? Math.round(gananciaMap[p.proveedor] * 100) : null;
    const stock      = p.stock ?? "—";
    const stockStatus = getStockStatus(p);
    const stockClass = stockStatus === "sin-stock" ? "badge-danger"
      : stockStatus === "bajo" ? "badge-warn"
      : stockStatus === "ok"   ? "badge-success"
      : "badge-neutral";

    const pListaHtml = ganPct != null
      ? `${fmt(p.lista)} <span style="font-size:10px;font-weight:500;color:var(--success);margin-left:4px">+${ganPct}%</span>`
      : fmt(p.lista);

    return `<tr>
      <td><span class="badge ${badgeClass(p.proveedor)}">${p.proveedor || "—"}</span></td>
      <td class="id-cell" style="text-align:center">${p.id || "—"}</td>
      <td class="cod-cell">${p.cod || "—"}</td>
      <td style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.desc || ""}">${p.desc || "—"}</td>
      <td class="num" style="font-weight:600">${fmt(venta)}</td>
      <td class="num">${pListaHtml}</td>
      <td class="num"><span class="badge ${stockClass}" style="font-size:10px">${stock}</span></td>
      <td>
        <div style="display:flex;gap:5px;justify-content:flex-end">
          <button class="btn-secondary" style="font-size:11px;padding:4px 8px" onclick="window._editarProducto('${p._id}')">Editar</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  renderPagination("prodPagination", prodPage, totalPages, v => { prodPage = v; renderProductosTabla(); });
}

document.getElementById("prodSearchInput")?.addEventListener("input", () => { prodPage = 1; renderProductosTabla(); });
document.getElementById("prodFilterProv")?.addEventListener("change", () => { prodPage = 1; renderProductosTabla(); });

document.getElementById("btnFiltroAlerta")?.addEventListener("click", function() {
  soloConAlerta = !soloConAlerta;
  this.style.background = soloConAlerta ? "var(--danger-bg)" : "";
  this.style.borderColor = soloConAlerta ? "var(--danger-border)" : "";
  prodPage = 1;
  renderProductosTabla();
});

function populateProvSelect() {
  const sel  = document.getElementById("prodFilterProv");
  const pf   = document.getElementById("pf-proveedor");
  const provs = Object.values(proveedores).sort((a,b) => a.nombre.localeCompare(b.nombre));

  if (sel) {
    const cur = sel.value;
    sel.innerHTML = `<option value="">Todos los proveedores</option>`;
    provs.forEach(p => sel.innerHTML += `<option value="${p.nombre}" ${cur === p.nombre ? "selected" : ""}>${p.nombre}</option>`);
  }
  if (pf) {
    pf.innerHTML = `<option value="">— Seleccioná —</option>`;
    provs.forEach(p => pf.innerHTML += `<option value="${p.nombre}">${p.nombre}${p.tabaco ? " 🚬" : ""}</option>`);
  }
}

// Modal producto
document.getElementById("btnNuevoProducto").addEventListener("click", () => abrirModalProducto(null));
document.getElementById("closeModalProducto").addEventListener("click", cerrarModalProducto);
document.getElementById("btnCancelarProducto").addEventListener("click", cerrarModalProducto);

window._editarProducto = function(id) {
  abrirModalProducto(id);
};

function abrirModalProducto(id) {
  prodEditId = id;
  document.getElementById("modalProductoTitulo").textContent = id ? "Editar producto" : "Nuevo producto";
  document.getElementById("btnEliminarProducto").classList.toggle("hidden", !id);
  const p = id ? allProducts.find(x => x._id === id) : {};
  document.getElementById("pf-proveedor").value = p?.proveedor || "";
  document.getElementById("pf-id").value        = p?.id || "";
  document.getElementById("pf-desc").value      = p?.desc || "";
  document.getElementById("pf-cod").value       = p?.cod || "";
  document.getElementById("pf-lista").value     = p?.lista || "";
  document.getElementById("pf-stock").value     = p?.stock ?? "";
  document.getElementById("pf-stockMin").value  = p?.stockMin ?? "";

  // Historial de precios
  const histWrap = document.getElementById("historialPreciosWrap");
  const histList = document.getElementById("historialPreciosList");
  if (id && p?.historialPrecios) {
    const items = Object.values(p.historialPrecios)
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora));
    histList.innerHTML = items.map(h => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;border-bottom:1px solid var(--border);font-size:12px">
        <span style="color:var(--text3);font-family:'DM Mono',monospace">${h.fecha} ${h.hora}</span>
        <span style="color:var(--text2)">${h.admin || "—"}</span>
        <span><span style="color:var(--text3)">${fmt(h.precioAnterior)}</span> → <span style="font-weight:500">${fmt(h.precioNuevo)}</span></span>
      </div>`).join("").replace(/border-bottom[^;]+;([^"]*)"[^>]*>[^<]*$/, '$1"');
    histWrap.classList.remove("hidden");
  } else {
    histWrap.classList.add("hidden");
  }

  document.getElementById("modalProducto").classList.remove("hidden");
}

function cerrarModalProducto() {
  prodEditId = null;
  document.getElementById("modalProducto").classList.add("hidden");
}

document.getElementById("btnGuardarProducto").addEventListener("click", async () => {
  const desc   = document.getElementById("pf-desc").value.trim();
  const lista  = parseFloat(document.getElementById("pf-lista").value);
  const prov   = document.getElementById("pf-proveedor").value;

  if (!desc)       { showToast("Ingresá una descripción.", "error"); return; }
  if (!prov)       { showToast("Seleccioná un proveedor.", "error"); return; }
  if (isNaN(lista) || lista <= 0) { showToast("Ingresá un precio de lista válido.", "error"); return; }

  const stock    = parseInt(document.getElementById("pf-stock").value);
  const stockMin = parseInt(document.getElementById("pf-stockMin").value);

  const data = {
    proveedor: prov,
    id:        document.getElementById("pf-id").value.trim(),
    desc,
    cod:       document.getElementById("pf-cod").value.trim(),
    lista,
    stock:     isNaN(stock)    ? null : stock,
    stockMin:  isNaN(stockMin) ? 5    : stockMin
  };

  if (prodEditId) {
    // Registrar historial si cambió el precio
    const prodActual = allProducts.find(p => p._id === prodEditId);
    if (prodActual && prodActual.lista !== lista) {
      const hId = `h_${Date.now()}`;
      const histActual = prodActual.historialPrecios || {};
      histActual[hId] = {
        fecha: todayKey(), hora: nowHora(),
        admin: getNombreUsuario(),
        precioAnterior: prodActual.lista, precioNuevo: lista
      };
      data.historialPrecios = histActual;
    }
    setDoc(doc(db, 'productos', prodEditId), data, { merge: true });
    showToast("Producto actualizado ✓", "success");
  } else {
    addDoc(collection(db, 'productos'), data);
    showToast("Producto agregado ✓", "success");
  }
  cerrarModalProducto();
});

document.getElementById("btnEliminarProducto").addEventListener("click", async () => {
  if (!prodEditId) return;
  if (!confirm("¿Eliminar este producto?")) return;
  cerrarModalProducto();
  showToast("Producto eliminado");
  deleteDoc(doc(db, 'productos', prodEditId));
});

// ============================================================
//  IMPORTAR EXCEL (igual que Dietética)
// ============================================================
document.getElementById("btnImportarExcel").addEventListener("click", () => {
  document.getElementById("modalImport").classList.remove("hidden");
});
document.getElementById("closeModalImport").addEventListener("click", () => {
  document.getElementById("modalImport").classList.add("hidden");
  parsedImport = null;
  document.getElementById("importPreview").classList.add("hidden");
  document.getElementById("importFooter").classList.add("hidden");
  document.getElementById("importFileInput").value = "";
  document.getElementById("importZone").querySelector("div:nth-child(2)").textContent = "Hacé clic o arrastrá tu archivo Excel";
});

document.getElementById("importZone").addEventListener("click", () => document.getElementById("importFileInput").click());

const importZone = document.getElementById("importZone");
importZone.addEventListener("dragover", e => { e.preventDefault(); importZone.style.background = "var(--bg3)"; });
importZone.addEventListener("dragleave", () => { importZone.style.background = ""; });
importZone.addEventListener("drop", e => {
  e.preventDefault(); importZone.style.background = "";
  if (e.dataTransfer.files[0]) { document.getElementById("importFileInput").files = e.dataTransfer.files; document.getElementById("importFileInput").dispatchEvent(new Event("change")); }
});

document.getElementById("importFileInput").addEventListener("change", e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      parsedImport = parseExcel(ev.target.result);
      const { resumen, allProds } = parsedImport;
      importZone.querySelector("div:nth-child(2)").textContent = `${file.name} — ${allProds.length.toLocaleString()} productos`;
      let html = `<strong>Resumen de lectura:</strong><br><br>`;
      resumen.forEach(r => {
        const gan = r.ganancia != null ? Math.round(r.ganancia * 100) + "%" : "50%";
        const est = r.error ? `<span class="badge badge-danger">${r.error}</span>` : `<span class="badge badge-success">OK</span>`;
        html += `${r.hoja}: <strong>${r.prods}</strong> productos · ganancia ${gan} ${est}<br>`;
      });
      document.getElementById("importStatus").innerHTML = html;
      document.getElementById("importPreview").classList.remove("hidden");
      document.getElementById("importProgressBar").style.width = "100%";
      document.getElementById("importFooter").classList.remove("hidden");
    } catch(err) { showToast("Error leyendo el archivo: " + err.message, "error"); }
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById("btnCancelarImport").addEventListener("click", () => {
  document.getElementById("closeModalImport").click();
});

document.getElementById("btnConfirmarImport").addEventListener("click", async () => {
  if (!parsedImport) return;
  const btn = document.getElementById("btnConfirmarImport");
  btn.disabled = true;
  btn.textContent = "Importando…";
  try {
    // Crear proveedores inexistentes
    const existentes = Object.values(proveedores).map(p => p.nombre);
    for (const pNombre of parsedImport.proveedoresNombres) {
      if (!existentes.includes(pNombre)) {
        const gan = parsedImport.gananciaMap[pNombre];
        addDoc(collection(db, 'proveedores'), { nombre: pNombre, ganancia: gan != null ? Math.round(gan * 100) : 20, tabaco: false, categoria: "" });
      }
    }
    // Guardar productos
    parsedImport.allProds.forEach(p => addDoc(collection(db, 'productos'), p));
    showToast(`${parsedImport.allProds.length} productos importados ✓`, "success");
    document.getElementById("closeModalImport").click();
  } catch(err) {
    showToast("Error al importar: " + err.message, "error");
    btn.disabled = false;
    btn.textContent = "Importar productos";
  }
});

// ── Parser Excel (portado de Dietética) ──
function normHeader(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim(); }
function safeCode(val) { if (val === null || val === undefined || val === "") return ""; if (typeof val === "string") return val.trim(); if (typeof val === "number") return val.toFixed(0); return String(val).trim(); }

function detectSheetConfig(rows) {
  let ganancia = null, colLista = -1, colCod = -1, colDesc = -1, colId = -1, headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i].map(c => normHeader(c));
    if (ganancia === null) {
      r.forEach((c, j) => {
        if (c.includes("GANANCIA")) {
          for (let k = j+1; k < r.length; k++) { const v = parseFloat(rows[i][k]); if (!isNaN(v) && v > 0 && v <= 5) ganancia = v; }
          if (ganancia === null && i+1 < rows.length) { for (let k = 0; k < rows[i+1].length; k++) { const v = parseFloat(rows[i+1][k]); if (!isNaN(v) && v > 0 && v <= 5) ganancia = v; } }
        }
      });
    }
    const hasDesc  = r.some(c => c.includes("DESC") || c.includes("NOMBRE") || c.includes("PRODUCTO"));
    const hasLista = r.some(c => c.includes("LISTA") && !c.includes("SUGERIDO"));
    if (hasDesc && hasLista) {
      headerRow = i;
      r.forEach((c, idx) => {
        if (colId < 0 && c === "ID") colId = idx;
        if (colCod < 0 && (c.includes("COD") || c === "#" || c === "CODIGO" || c === "CÓDIGO")) colCod = idx;
        if (colDesc < 0 && (c.includes("DESC") || c.includes("NOMBRE") || c.includes("PRODUCTO"))) colDesc = idx;
        if (colLista < 0 && c.includes("LISTA") && !c.includes("SUGERIDO")) colLista = idx;
      });
      break;
    }
  }
  return { headerRow, colId, colCod, colDesc, colLista, ganancia };
}

function parseExcel(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const allProds = [], gananciaMap = {}, resumen = [], proveedoresNombres = [];
  wb.SheetNames.forEach(sheetName => {
    const ws       = wb.Sheets[sheetName];
    const rows     = XLSX.utils.sheet_to_json(ws, { header:1, defval:"", raw:true,  blankrows:false });
    const rowsText = XLSX.utils.sheet_to_json(ws, { header:1, defval:"", raw:false, blankrows:false });
    const { headerRow, colId, colCod, colDesc, colLista, ganancia } = detectSheetConfig(rows);
    if (headerRow < 0 || colDesc < 0 || colLista < 0) { resumen.push({ hoja: sheetName, prods: 0, error: "Sin estructura detectada" }); return; }
    gananciaMap[sheetName] = ganancia !== null ? ganancia : 0.2;
    proveedoresNombres.push(sheetName);
    let count = 0;
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i], rowT = rowsText[i] || [];
      const desc  = String(row[colDesc] || "").trim();
      const lista = parseFloat(row[colLista]);
      if (!desc || desc.length < 3 || isNaN(lista) || lista <= 0) continue;
      const codRaw  = colCod >= 0 ? row[colCod] : "";
      const codText = colCod >= 0 ? (rowT[colCod] || "") : "";
      const cod     = codText ? String(codText).trim() : safeCode(codRaw);
      const idRaw   = colId >= 0 ? row[colId] : "";
      const idText  = colId >= 0 ? (rowT[colId] || "") : "";
      const pid     = idText ? String(idText).trim() : safeCode(idRaw);
      allProds.push({ proveedor: sheetName, id: pid, cod, desc, lista, stock: null, stockMin: 5 });
      count++;
    }
    resumen.push({ hoja: sheetName, prods: count, ganancia: gananciaMap[sheetName] });
  });
  return { allProds, gananciaMap, resumen, proveedoresNombres };
}

// ============================================================
//  VISTA PROVEEDORES
// ============================================================

const TIPO_LABEL = { general: "General", tabaco: "Tabaco 🚬", cigarrillos: "Cigarrillo 🚬" };
const TIPO_BADGE = { general: "badge-neutral", tabaco: "b-tabaco", cigarrillos: "b-tabaco" };

function renderMargenesConfig() {
  const gEl = document.getElementById("cfg-margen-general");
  const tEl = document.getElementById("cfg-margen-tabaco");
  const cEl = document.getElementById("cfg-margen-cigarrillos");
  if (gEl && !document.activeElement === gEl) gEl.value = margenesConfig.general ?? 50;
  if (tEl && !document.activeElement === tEl) tEl.value = margenesConfig.tabaco   ?? 30;
  if (cEl && !document.activeElement === cEl) cEl.value = margenesConfig.cigarrillos ?? 20;
  if (gEl) gEl.value = margenesConfig.general    ?? 50;
  if (tEl) tEl.value = margenesConfig.tabaco      ?? 30;
  if (cEl) cEl.value = margenesConfig.cigarrillos ?? 20;
}

async function guardarMargen(tipo) {
  const ids = { general: "cfg-margen-general", tabaco: "cfg-margen-tabaco", cigarrillos: "cfg-margen-cigarrillos" };
  const val = parseFloat(document.getElementById(ids[tipo]).value);
  if (isNaN(val) || val < 0) { showToast("Ingresá un valor válido.", "error"); return; }
  setDoc(doc(db, 'config', 'margenes'), { [tipo]: val }, { merge: true });
  showToast(`Margen de ${TIPO_LABEL[tipo]} actualizado: ${val}% ✓`, "success");
}

document.getElementById("btnGuardarMargenGeneral")?.addEventListener("click",     () => guardarMargen("general"));
document.getElementById("btnGuardarMargenTabaco")?.addEventListener("click",      () => guardarMargen("tabaco"));
document.getElementById("btnGuardarMargenCigarrillos")?.addEventListener("click", () => guardarMargen("cigarrillos"));

function renderProveedores() {
  const grid  = document.getElementById("proveedoresGrid");
  const lista = Object.entries(proveedores).sort((a,b) => a[1].nombre.localeCompare(b[1].nombre));

  if (!lista.length) {
    grid.innerHTML = `<div class="empty-row">No hay proveedores. Creá el primero con el botón de arriba.</div>`;
    return;
  }

  grid.innerHTML = lista.map(([id, p]) => {
    const tipo     = p.tipo || (p.tabaco ? "tabaco" : "general");
    const cantProd = allProducts.filter(x => x.proveedor === p.nombre).length;
    return `<div class="proveedor-card">
      <div class="proveedor-card-header">
        <div class="proveedor-nombre">${p.nombre}</div>
        <span class="badge ${TIPO_BADGE[tipo] || "badge-neutral"}">${TIPO_LABEL[tipo] || tipo}</span>
      </div>
      <div class="proveedor-row"><span class="label">Margen ganancia</span><span class="val"><span class="badge ${TIPO_BADGE[tipo] || "badge-neutral"}">${p.ganancia ?? 0}%</span></span></div>
      <div class="proveedor-row"><span class="label">Productos</span><span class="val">${cantProd}</span></div>
      ${p.categoria ? `<div class="proveedor-row"><span class="label">Categoría</span><span class="val">${p.categoria}</span></div>` : ""}
      <div class="proveedor-actions">
        <button class="btn-secondary" style="font-size:12px;padding:5px 10px;flex:1" onclick="window._filtrarPorProv('${p.nombre}')">Ver productos</button>
        <button class="btn-secondary" style="font-size:12px;padding:5px 10px;flex:1" onclick="window._editarProveedor('${id}')">Editar</button>
      </div>
    </div>`;
  }).join("");
}

window._filtrarPorProv = function(nombre) {
  document.querySelector('[data-view="productos"]').click();
  const sel = document.getElementById("prodFilterProv");
  if (sel) { sel.value = nombre; prodPage = 1; renderProductosTabla(); }
};

// Modal proveedor
document.getElementById("btnNuevoProveedor").addEventListener("click", () => abrirModalProveedor(null));
document.getElementById("closeModalProveedor").addEventListener("click", cerrarModalProveedor);
document.getElementById("btnCancelarProveedor").addEventListener("click", cerrarModalProveedor);

window._editarProveedor = function(id) { abrirModalProveedor(id); };

// Al cambiar el tipo, pre-cargar el margen global correspondiente
document.getElementById("vf-tipo")?.addEventListener("change", function() {
  const tipo = this.value;
  const margen = margenesConfig[tipo] ?? (tipo === "general" ? 50 : tipo === "tabaco" ? 30 : 20);
  // Solo pre-cargar si es un proveedor nuevo (no editando)
  if (!provEditId) {
    document.getElementById("vf-ganancia").value = margen;
    document.getElementById("vf-ganancia-hint").textContent = `Pre-cargado desde márgenes globales (${margen}%)`;
  }
});

function abrirModalProveedor(id) {
  provEditId = id;
  document.getElementById("modalProveedorTitulo").textContent = id ? "Editar proveedor" : "Nuevo proveedor";
  document.getElementById("btnEliminarProveedor").classList.toggle("hidden", !id);
  const p = id ? proveedores[id] : {};
  const tipo = p?.tipo || (p?.tabaco ? "tabaco" : "general");
  document.getElementById("vf-nombre").value    = p?.nombre    || "";
  document.getElementById("vf-tipo").value      = tipo;
  document.getElementById("vf-categoria").value = p?.categoria || "";
  // Si es nuevo, pre-cargar margen global; si es edición, mostrar el margen actual
  if (id) {
    document.getElementById("vf-ganancia").value = p?.ganancia ?? "";
    document.getElementById("vf-ganancia-hint").textContent = "Margen actual del proveedor";
  } else {
    const margenDefault = margenesConfig[tipo] ?? 50;
    document.getElementById("vf-ganancia").value = margenDefault;
    document.getElementById("vf-ganancia-hint").textContent = `Pre-cargado desde márgenes globales (${margenDefault}%)`;
  }
  document.getElementById("modalProveedor").classList.remove("hidden");
}

function cerrarModalProveedor() {
  provEditId = null;
  document.getElementById("modalProveedor").classList.add("hidden");
}

document.getElementById("btnGuardarProveedor").addEventListener("click", async () => {
  const nombre   = document.getElementById("vf-nombre").value.trim();
  const ganancia = parseFloat(document.getElementById("vf-ganancia").value);
  const tipo     = document.getElementById("vf-tipo").value;
  if (!nombre) { showToast("Ingresá el nombre del proveedor.", "error"); return; }
  if (isNaN(ganancia) || ganancia < 0) { showToast("Ingresá un margen válido (0 o más).", "error"); return; }

  const data = {
    nombre,
    ganancia,
    tipo,
    tabaco:    tipo === "tabaco" || tipo === "cigarrillos",
    categoria: document.getElementById("vf-categoria").value.trim()
  };

  if (provEditId) {
    setDoc(doc(db, 'proveedores', provEditId), data, { merge: true });
    const ant = proveedores[provEditId]?.nombre;
    if (ant && ant !== nombre) {
      allProducts.filter(x => x.proveedor === ant).forEach(p => {
        updateDoc(doc(db, 'productos', p._id), { proveedor: nombre });
      });
    }
    showToast("Proveedor actualizado ✓", "success");
  } else {
    addDoc(collection(db, 'proveedores'), data);
    showToast("Proveedor creado ✓", "success");
  }
  cerrarModalProveedor();
});

document.getElementById("btnEliminarProveedor").addEventListener("click", async () => {
  if (!provEditId) return;
  const p = proveedores[provEditId];
  const cant = allProducts.filter(x => x.proveedor === p?.nombre).length;
  if (cant > 0) { showToast(`No podés eliminar: tiene ${cant} productos asociados.`, "error"); return; }
  if (!confirm(`¿Eliminar el proveedor "${p?.nombre}"?`)) return;
  deleteDoc(doc(db, 'proveedores', provEditId));
  showToast("Proveedor eliminado");
  cerrarModalProveedor();
});

// Cerrar modales con Escape
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  ["modalVenta","modalProducto","modalProveedor","modalImport","modalCierreCaja"].forEach(id => {
    document.getElementById(id)?.classList.add("hidden");
  });
});
