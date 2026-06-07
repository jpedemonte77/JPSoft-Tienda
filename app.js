// ============================================================
//  JPSoft | Tienda — app.js
//  Firestore + Auth (con soporte offline)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, collection, setDoc, addDoc, getDoc, getDocs,
  onSnapshot, deleteDoc, updateDoc, deleteField, query, orderBy, limit,
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
  if (estaOnline) {
    showToast("Conexión restablecida — sincronizando…", "success");
    // Esperar un segundo para que Firestore sincronice y recargar datos
    setTimeout(() => {
      initFirebase();
    }, 2000);
  }
});
window.addEventListener("offline", () => { setOnlineStatus(false); connectionCheckDone = true; });
checkConnection();

// ============================================================
//  ESTADO GLOBAL
// ============================================================
const TODOS_USUARIOS = [
  { email: "joaquin@jpsoft-qbv.com", nombre: "Joaquín", admin: true },
  { email: "carlos@jpsoft-qbv.com",  nombre: "Carlos",  admin: true },
];
const TIPO_LABEL = { general: "General", tabaco: "Tabaco 🚬", cigarrillos: "Cigarrillo 🚬" };
const TIPO_BADGE = { general: "badge-neutral", tabaco: "b-tabaco", cigarrillos: "b-tabaco" };

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
let filaSeleccionada = -1; // índice de fila seleccionada con teclado

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

// Referencias a los unsubscribe de cada listener
let _unsubs = [];

function initFirebase() {
  // Cancelar listeners anteriores si existen
  _unsubs.forEach(u => u());
  _unsubs = [];

  // Proveedores
  _unsubs.push(onSnapshot(collection(db, "proveedores"), snap => {
    proveedores = {};
    snap.forEach(d => { proveedores[d.id] = docToObj(d); });
    rebuildGananciaMap();
    renderProveedores();
    buildFilterBar();
    populateProvSelect();
    renderProductosVenta();
    renderProductosTabla();
    if (typeof populateHistorialFilter === "function") populateHistorialFilter();
  }));

  // Productos
  _unsubs.push(onSnapshot(collection(db, "productos"), snap => {
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
  }));

  // Caja
  _unsubs.push(onSnapshot(collection(db, "caja"), snap => {
    cajaData = {};
    snap.forEach(d => { cajaData[d.id] = d.data(); });
    renderCaja();
    updateCajaSidebar();
  }));

  // Config márgenes
  _unsubs.push(onSnapshot(doc(db, "config", "margenes"), snap => {
    if (snap.exists()) Object.assign(margenesConfig, snap.data());
    renderMargenesConfig();
    rebuildGananciaMap();
    renderProductosVenta();
    renderProductosTabla();
  }));

  // Logs de actividad
  _unsubs.push(onSnapshot(
    query(collection(db, 'logs'), orderBy('ts', 'desc'), limit(200)),
    snap => {
      logsData = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
      renderActividad();
    }
  ));

  // Último backup
  _unsubs.push(onSnapshot(doc(db, "config", "backup"), snap => {
    const ultimoBackup = snap.exists() ? (snap.data().ultimoBackup || "") : "";
    if (typeof verificarBackup === "function") verificarBackup(ultimoBackup);
  }));

  // Fechas por defecto reportes
  if (typeof setDefaultDates === "function") setDefaultDates();
  if (typeof renderUsuarios === "function") renderUsuarios();
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
const VIEWS = { venta: "Venta", caja: "Caja", productos: "Productos", proveedores: "Proveedores", reportes: "Reportes", "historial-precios": "Historial de precios", actividad: "Actividad", backup: "Backup" };

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
// ============================================================
//  LOG DE ACTIVIDAD
// ============================================================

function registrarLog(tipo, desc, extra = {}) {
  try {
    const logRef = doc(collection(db, 'logs'));
    setDoc(logRef, {
      tipo,
      desc,
      usuario: getNombreUsuario(),
      ts: new Date().toISOString(),
      fecha: todayKey(),
      ...extra
    });
  } catch(e) { /* silencioso */ }
}

let logsData = [];

function renderActividad() {
  const wrap    = document.getElementById("actLogWrap");
  if (!wrap) return;

  const filtroTipo = document.getElementById("actFiltroTipo")?.value || "";
  const filtroUser = document.getElementById("actFiltroUsuario")?.value || "";

  let logs = [...logsData];
  if (filtroTipo) logs = logs.filter(l => l.tipo === filtroTipo);
  if (filtroUser) logs = logs.filter(l => l.usuario === filtroUser);
  logs.sort((a,b) => b.ts.localeCompare(a.ts));

  if (!logs.length) {
    wrap.innerHTML = `<div class="empty-row">Sin actividad registrada.</div>`;
    return;
  }

  const TIPO_BADGE = {
    venta:     { cls: "color:#27500A;background:#EAF3DE", label: "Venta" },
    anulacion: { cls: "color:#791F1F;background:#FCEBEB", label: "Anulación" },
    precio:    { cls: "color:#0C447C;background:#E6F1FB", label: "Precio" },
    producto:  { cls: "color:#633806;background:#FAEEDA", label: "Producto" },
    caja:      { cls: "color:#3C3489;background:#EEEDFE", label: "Caja" },
    backup:    { cls: "color:var(--text2);background:var(--surface2)", label: "Backup" },
  };
  const TIPO_DOT = {
    venta: "#1a7a50", anulacion: "#c0391a", precio: "#185fa5",
    producto: "#92580a", caja: "#7f77dd", backup: "#888"
  };

  function fmtTs(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    const hoy = new Date();
    const ayer = new Date(); ayer.setDate(ayer.getDate()-1);
    const isHoy  = d.toDateString() === hoy.toDateString();
    const isAyer = d.toDateString() === ayer.toDateString();
    const hora = d.toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit" });
    if (isHoy)  return `Hoy, ${hora}`;
    if (isAyer) return `Ayer, ${hora}`;
    return `${d.getDate()}/${d.getMonth()+1}, ${hora}`;
  }

  wrap.innerHTML = logs.map(l => {
    const badge = TIPO_BADGE[l.tipo] || TIPO_BADGE.backup;
    const dot   = TIPO_DOT[l.tipo] || "#888";
    return `<div style="display:flex;align-items:flex-start;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border)">
      <div style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0;margin-top:4px"></div>
      <div style="font-size:11px;color:var(--text3);white-space:nowrap;font-family:'DM Mono',monospace;min-width:100px;padding-top:1px">${fmtTs(l.ts)}</div>
      <div style="flex:1">
        <div style="font-size:13px;color:var(--text);line-height:1.4">${l.desc}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${l.usuario||"—"}</div>
      </div>
      <span style="font-size:10px;font-weight:500;padding:2px 8px;border-radius:10px;white-space:nowrap;${badge.cls}">${badge.label}</span>
    </div>`;
  }).join("").replace(/border-bottom[^"]+last-child/g, "") + '';

  // Quitar border del último
  const rows = wrap.querySelectorAll('[style*="border-bottom:1px"]');
  if (rows.length) rows[rows.length-1].style.borderBottom = "none";

  // Popular filtro usuarios
  const usuarios = [...new Set(logsData.map(l => l.usuario).filter(Boolean))].sort();
  const selUser  = document.getElementById("actFiltroUsuario");
  if (selUser && selUser.options.length <= 1) {
    usuarios.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u; opt.textContent = u;
      selUser.appendChild(opt);
    });
  }
}

// ── Modo nocturno ──
(function() {
  const DARK_KEY = "jpsoft_dark_mode";
  const html     = document.documentElement;

  function applyDark(on) {
    html.classList.toggle("dark", on);
    const pill = document.getElementById("darkTogglePill");
    const dot  = document.getElementById("darkToggleDot");
    if (pill) pill.style.background = on ? "var(--accent)" : "var(--border2)";
    if (dot)  dot.style.left = on ? "17px" : "3px";
  }

  // Restaurar preferencia guardada
  const saved = localStorage.getItem(DARK_KEY);
  applyDark(saved === "1");

  document.getElementById("btnDarkMode")?.addEventListener("click", () => {
    const isDark = html.classList.contains("dark");
    applyDark(!isDark);
    localStorage.setItem(DARK_KEY, isDark ? "0" : "1");
  });
})();

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

  // Sincronizar prodFiltered con lo que se muestra en pantalla
  prodFiltered = slice;

  // Restaurar fila seleccionada
  if (filaSeleccionada >= prodFiltered.length) filaSeleccionada = prodFiltered.length - 1;
  resaltarFila();

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
  if (!e.key) return; // guard contra eventos sin key
  const now   = Date.now();
  const input = document.getElementById("searchInput");
  const tag   = document.activeElement?.tagName?.toLowerCase();
  const isInput = tag === "input" || tag === "textarea" || tag === "select";
  const isInlineEdit = isInput && document.activeElement?.closest?.(".td-editable");
  const isOtherInput = isInput && document.activeElement !== input;

  // Si estamos editando una celda inline — dejar pasar todo
  if (isInlineEdit) return;

  const viewVenta      = document.getElementById("view-venta")?.classList.contains("active");
  const viewProductos  = document.getElementById("view-productos")?.classList.contains("active");
  const modalVentaOpen  = !document.getElementById("modalVenta")?.classList.contains("hidden");
  const modalProdOpen   = !document.getElementById("modalProducto")?.classList.contains("hidden");
  const modalProvOpen   = !document.getElementById("modalProveedor")?.classList.contains("hidden");
  const modalCierreOpen = !document.getElementById("modalCierreCaja")?.classList.contains("hidden");

  // ── Si el modal de cobrar está abierto — bloquear fondo, solo Enter/G/Escape ──
  if (modalVentaOpen) {
    // Ignorar si el foco está en un input del propio modal (ej: descuento)
    const enInputModal = isInput && document.activeElement?.closest("#modalVenta");
    if (!enInputModal) {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("btnConfirmarVentaFinal")?.click();
        return;
      }
      if (e.key.toLowerCase() === "g") {
        e.preventDefault();
        document.getElementById("btnGuardarTicket")?.click();
        return;
      }
      if (e.key === "Escape") {
        document.getElementById("modalVenta").classList.add("hidden");
        return;
      }
    }
    // Bloquear todo lo demás para que no afecte el fondo
    if (!enInputModal) e.preventDefault();
    return;
  }

  // ── Ctrl+Enter — abrir cobrar desde cualquier lugar en vista venta ──
  if (e.key === "Enter" && e.ctrlKey && viewVenta) {
    e.preventDefault();
    const btnCobrar = document.getElementById("btnConfirmarVenta");
    if (btnCobrar && Object.keys(cart).length > 0) btnCobrar.click();
    return;
  }

  // ── Delete — quitar unidad del producto seleccionado (vista venta) ──
  if ((e.key === "Delete" || e.key === "Backspace") && viewVenta && !isInlineEdit) {
    // Solo si el buscador NO tiene texto seleccionado o el foco no está en él
    if (document.activeElement !== input || input?.selectionStart === input?.selectionEnd) {
      if (filaSeleccionada >= 0 && prodFiltered?.length) {
        const p = prodFiltered[filaSeleccionada];
        if (p && cart[p._id]) {
          e.preventDefault();
          removeFromCartByFila();
          resaltarFila();
          return;
        }
      }
    }
  }

  // ── ESCAPE — cerrar modales ──
  if (e.key === "Escape") {
    ["modalVenta","modalProducto","modalProveedor","modalImport","modalCierreCaja"].forEach(id => {
      document.getElementById(id)?.classList.add("hidden");
    });
    if (input && document.activeElement === input) {
      input.value = ""; applyFilters(); input.blur();
    }
    scanBuffer = "";
    return;
  }

  // ── ENTER en modales ──
  if (e.key === "Enter" && !isInput) {
    if (modalVentaOpen)  { e.preventDefault(); document.getElementById("btnConfirmarVentaFinal")?.click(); return; }
    if (modalProdOpen)   { e.preventDefault(); document.getElementById("btnGuardarProducto")?.click(); return; }
    if (modalProvOpen)   { e.preventDefault(); document.getElementById("btnGuardarProveedor")?.click(); return; }
    if (modalCierreOpen) { e.preventDefault(); document.getElementById("btnConfirmarCierre")?.click(); return; }
  }

  // ── ENTER en campo fondo de apertura de turno ──
  if (e.key === "Enter" && isInput) {
    const active = document.activeElement;
    if (active?.id?.startsWith("fondoInput_")) {
      const turnoKey = active.id.replace("fondoInput_", "");
      document.getElementById(`btnAbrir_${turnoKey}`)?.click();
      return;
    }
  }

  // ── No interferir con otros inputs ──
  if (isOtherInput) return;

  // ── Vista VENTA ──
  if (viewVenta) {
    const gap = now - lastKeyTime; lastKeyTime = now;

    if (document.activeElement === input) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        filaSeleccionada = Math.min(filaSeleccionada + 1, (prodFiltered?.length || 1) - 1);
        resaltarFila(); return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        filaSeleccionada = Math.max(filaSeleccionada - 1, 0);
        resaltarFila(); return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (filaSeleccionada >= 0 && prodFiltered?.length && filaSeleccionada < prodFiltered.length) {
          addToCart(prodFiltered[filaSeleccionada]);
          resaltarFila();
        } else if (prodFiltered?.length >= 1) {
          // Si no hay fila seleccionada, agregar el primero
          filaSeleccionada = 0;
          addToCart(prodFiltered[0]);
          resaltarFila();
        }
        return;
      }
      if (e.key === "ArrowRight" && e.ctrlKey) {
        e.preventDefault();
        if (filaSeleccionada >= 0 && prodFiltered?.length && filaSeleccionada < prodFiltered.length) {
          addToCart(prodFiltered[filaSeleccionada]);
          resaltarFila();
        }
        return;
      }
      if (e.key === "ArrowLeft" && e.ctrlKey) {
        e.preventDefault();
        if (prodFiltered?.length) { removeFromCartByFila(); resaltarFila(); }
        return;
      }
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (input) input.focus();
      filaSeleccionada = e.key === "ArrowDown"
        ? Math.min(filaSeleccionada + 1, (prodFiltered?.length || 1) - 1)
        : Math.max(filaSeleccionada - 1, 0);
      resaltarFila(); return;
    }

    if (e.key === "Enter") {
      if (scanBuffer.length >= 4) {
        if (input) { input.value = scanBuffer; setScanState("read"); applyFilters(); input.focus(); }
        // Agregar automáticamente si hay exactamente un resultado
        setTimeout(() => {
          if (filtered.length === 1) {
            addToCart(filtered[0]);
            if (input) { input.value = ""; applyFilters(); }
            setScanState("normal");
          } else if (filtered.length === 0) {
            showToast("Producto no encontrado", "error");
            if (input) { input.value = ""; applyFilters(); }
            setScanState("normal");
          }
          // Si hay más de un resultado deja la lista filtrada para que el usuario elija
        }, 100);
      }
      scanBuffer = ""; return;
    }

    // Tecla C — abrir panel de cobrar (sin foco en buscador)
    if (e.key.toLowerCase() === "c" && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement !== input) {
      e.preventDefault();
      const btnCobrar = document.getElementById("btnConfirmarVenta");
      if (btnCobrar && Object.keys(cart).length > 0) btnCobrar.click();
      return;
    }



    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const esScan = gap < SCAN_SPEED;
      if (esScan) {
        if (gap > SCAN_SPEED * 3 && scanBuffer.length > 0) { scanBuffer = ""; setScanState("normal"); }
        if (scanBuffer.length === 0) setScanState("scanning");
        scanBuffer += e.key;
      } else {
        scanBuffer = ""; setScanState("normal");
        if (input) input.focus();
      }
    } else { scanBuffer = ""; }
    return;
  }

  // ── Vista PRODUCTOS (tabla ABM) ──
  if (viewProductos && !isInput) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const filas = document.querySelectorAll("#prodTableBody tr");
      if (!filas.length) return;
      let idx = [...filas].findIndex(r => r.classList.contains("fila-activa"));
      filas.forEach(r => r.classList.remove("fila-activa"));
      if (e.key === "ArrowDown") idx = Math.min(idx + 1, filas.length - 1);
      else idx = Math.max(idx - 1, 0);
      if (idx < 0) idx = 0;
      filas[idx].classList.add("fila-activa");
      filas[idx].scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const activa = document.querySelector("#prodTableBody tr.fila-activa");
      if (activa) activa.querySelector("[data-edit]")?.click();
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      const activa = document.querySelector("#prodTableBody tr.fila-activa");
      if (activa) activa.querySelector("[data-delete]")?.click();
      return;
    }
  }
});

document.getElementById("searchInput").addEventListener("input", e => {
  filaSeleccionada = -1;
  applyFilters();

  // Detectar pegado de código de barras (texto largo sin espacios = posible código)
  const val = document.getElementById("searchInput").value.trim();
  if (val.length >= 8 && !val.includes(" ")) {
    // Esperar un tick para que applyFilters termine
    setTimeout(() => {
      if (filtered.length === 1) {
        addToCart(filtered[0]);
        document.getElementById("searchInput").value = "";
        applyFilters();
        setScanState("normal");
      } else if (filtered.length === 0) {
        showToast("Producto no encontrado", "error");
      }
    }, 100);
  }
});

function resaltarFila() {
  const filas = document.querySelectorAll("#tableBody tr");
  filas.forEach((r, i) => {
    if (i === filaSeleccionada) {
      r.classList.add("fila-activa");
      r.scrollIntoView({ block: "nearest" });
    } else {
      r.classList.remove("fila-activa");
    }
  });
  // Actualizar hint en barra cobrar
  const cobrarHint = document.getElementById("cobrarHint");
  if (cobrarHint) {
    const pSel = filaSeleccionada >= 0 ? prodFiltered[filaSeleccionada] : null;
    if (pSel && cart[pSel._id]) {
      cobrarHint.textContent = `${pSel.desc} ×${cart[pSel._id].qty}`;
      cobrarHint.style.display = "block";
    } else {
      cobrarHint.style.display = "none";
    }
  }
}

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

function addToCart(p) {
  if (!p) return;
  if (cart[p._id]) cart[p._id].qty += 1;
  else cart[p._id] = { product: p, qty: 1 };
  renderProductosVenta();
  renderCart();
  // Restaurar la fila seleccionada después del re-render
  resaltarFila();
}

function removeFromCartByFila() {
  if (filaSeleccionada < 0 || filaSeleccionada >= prodFiltered.length) return;
  const p = prodFiltered[filaSeleccionada];
  if (!p || !cart[p._id]) return;
  if (cart[p._id].qty > 1) cart[p._id].qty -= 1;
  else delete cart[p._id];
  renderProductosVenta();
  renderCart();
}

window._changeQty = function(key, delta) {
  if (!cart[key]) return;
  const newQty = cart[key].qty + delta;
  if (newQty < 0) return; // no bajar de 0
  cart[key].qty = newQty;
  renderModalVenta();
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
  const totalUnidades = keys.reduce((s, k) => s + (cart[k]?.qty || 0), 0);
  if (cobrarItems) cobrarItems.textContent = totalUnidades + (totalUnidades === 1 ? " ítem" : " ítems");
  if (cobrarTotal) cobrarTotal.textContent   = fmtDec(total);

  // Mostrar producto seleccionado con cantidad si está en el carrito
  const cobrarHint = document.getElementById("cobrarHint");
  if (cobrarHint) {
    const pSel = filaSeleccionada >= 0 ? prodFiltered[filaSeleccionada] : null;
    if (pSel && cart[pSel._id]) {
      const qty = cart[pSel._id].qty;
      cobrarHint.textContent = `${pSel.desc} ×${qty}`;
      cobrarHint.style.display = "block";
    } else {
      cobrarHint.style.display = "none";
    }
  }

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
  // Limpiar nota al abrir
  const notaInput = document.getElementById("notaVentaInput");
  if (notaInput) notaInput.value = "";
  document.querySelectorAll(".nota-chip").forEach(b => b.classList.remove("active"));
  const modalVenta = document.getElementById("modalVenta");
  modalVenta.classList.remove("hidden");
  // Forzar foco al modal para que las teclas funcionen sin click
  setTimeout(() => {
    modalVenta.setAttribute("tabindex", "-1");
    modalVenta.focus();
  }, 50);
});

// Event listener único para +/- en modal (se registra una sola vez)
document.getElementById("ventaCartItems")?.addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const key    = btn.dataset.key;
  if (action === "plus")  { window._changeQty(key, 1);  renderModalVenta(); }
  if (action === "minus") { window._changeQty(key, -1); renderModalVenta(); }
});

document.getElementById("ventaCartItems")?.addEventListener("change", e => {
  const input = e.target.closest("input[data-action='qty']");
  if (!input) return;
  const key = input.dataset.key;
  const val = parseInt(input.value);
  if (!key || isNaN(val) || val < 0) return;
  if (val === 0) {
    delete cart[key];
  } else {
    if (cart[key]) cart[key].qty = val;
  }
  renderModalVenta();
  renderProductosVenta();
  renderCart();

  // Si el carrito quedó vacío cerrar el modal
  if (!Object.keys(cart).length) {
    document.getElementById("modalVenta").classList.add("hidden");
    showToast("Venta cancelada — carrito vacío");
  }
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
          <input type="number" data-action="qty" data-key="${k}" value="${qty}" min="0" style="width:36px;font-size:12px;font-weight:500;text-align:center;border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-family:inherit" />
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
  const metodoLabel = { efectivo: "Efectivo", debito: "Débito", credito: "Crédito", mp: "Mercado Pago" };
  const lineas = keys.map(k => {
    const { product: p, qty } = cart[k];
    const sub = getPrecioVenta(p) * qty;
    const det = qty > 1 ? `${p.desc} x${qty}` : p.desc;
    return `${det.padEnd(35, ".")} ${fmtDec(sub)}`;
  }).join("\n");
  const _notaTxt = document.getElementById("notaVentaInput")?.value?.trim() || "";
  const txt = `JPSoft | Tienda\n${fecha} — ${hora} hs\nMétodo: ${metodoLabel[metodoSeleccionado]}${_notaTxt ? "\nNota: " + _notaTxt : ""}\n\n${lineas}\n\n${"─".repeat(45)}\nTOTAL: ${fmtDec(total)}`;
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

  // Ignorar ítems con qty 0
  const keysValidas = pendiente.keys.filter(k => cart[k]?.qty > 0);
  if (!keysValidas.length) {
    document.getElementById("modalVenta").classList.add("hidden");
    showToast("No hay ítems para confirmar");
    return;
  }

  const { hora, subtotal: vSubtotal, descMonto: vDesc } = pendiente;
  // Recalcular total con solo ítems válidos
  const total = keysValidas.reduce((s, k) => s + getPrecioVenta(cart[k].product) * cart[k].qty, 0) - (vDesc || 0);
  const keys = keysValidas;

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
  const _notaVenta = document.getElementById("notaVentaInput")?.value?.trim() || "";
  ventasActuales[ventaId] = {
    hora, metodo: metodoSeleccionado,
    total:     Math.round(total),
    subtotal:  Math.round(vSubtotal || total),
    descuento: Math.round(vDesc || 0),
    items, admin: getNombreUsuario(),
    ...(_notaVenta && { nota: _notaVenta }),
  };

  // Log de actividad
  const _itemsDesc = items.map(i => i.desc).join(", ");
  registrarLog("venta", `Venta registrada — ${fmt(Math.round(total))} · ${_itemsDesc}`);

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
  if (!turnoObj?.ventas) return [];
  return Object.entries(turnoObj.ventas).map(([id, v]) => ({ ...v, _id: id }));
}

function calcTotalesTurno(turnoObj) {
  const ventas = getVentas(turnoObj);
  let totE = 0, totD = 0, totC = 0, totM = 0;
  ventas.forEach(v => {
    if (v.metodo === "efectivo") totE += v.total || 0;
    else if (v.metodo === "debito") totD += v.total || 0;
    else if (v.metodo === "credito") totC += v.total || 0;
    else if (v.metodo === "mp") totM += v.total || 0;
  });
  return { totE, totD, totC, totM, tot: totE + totD + totC + totM, ventas };
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
  const totC      = tmTot.totC + ttTot.totC;
  const totM      = tmTot.totM + ttTot.totM;
  const totVentas = tmTot.ventas.length + ttTot.ventas.length;
  const hayDatos  = manana || tarde;

  const statsWrap = document.getElementById("cajaStatsWrap");
  if (hayDatos) {
    statsWrap.classList.remove("hidden");
    document.getElementById("statTotal").textContent    = fmt(totTotal);
    document.getElementById("statVentas").textContent   = totVentas + (totVentas === 1 ? " venta" : " ventas");
    document.getElementById("statEfectivo").textContent = fmt(totE);
    document.getElementById("statMp").textContent       = fmt(totM);
    document.getElementById("statDebito").textContent   = fmt(totD);
    document.getElementById("statCredito").textContent  = fmt(totC);
    document.getElementById("statEfectivoPct").textContent = pct(totE, totTotal);
    document.getElementById("statMpPct").textContent       = pct(totM, totTotal);
    document.getElementById("statDebitoPct").textContent   = pct(totD, totTotal);
    document.getElementById("statCreditoPct").textContent  = pct(totC, totTotal);
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

  // Comparación de turnos — solo si ambos tienen ventas
  const compWrap = document.getElementById("cajaTurnosComparacion");
  if (!compWrap) return;

  const tmV = tmTot.ventas.length;
  const ttV = ttTot.ventas.length;
  const tmProm = tmV ? Math.round(tmTot.tot / tmV) : 0;
  const ttProm = ttV ? Math.round(ttTot.tot / ttV) : 0;

  if (!tmV || !ttV) {
    compWrap.style.display = "none";
    return;
  }
  compWrap.style.display = "";

  const maxTot  = Math.max(tmTot.tot,  ttTot.tot,  1);
  const maxV    = Math.max(tmV,         ttV,        1);
  const maxProm = Math.max(tmProm,      ttProm,     1);
  const maxE    = Math.max(tmTot.totE,  ttTot.totE, 1);

  function compRow(label, mVal, tVal, maxVal, isMoney) {
    const fVal = isMoney ? fmt : (v => v);
    const mPct = Math.round(mVal / maxVal * 100);
    const tPct = Math.round(tVal / maxVal * 100);
    const winner = mVal > tVal ? "m" : tVal > mVal ? "t" : "eq";
    const wBadge = winner === "m"
      ? `<span style="font-size:10px;font-weight:500;padding:2px 8px;border-radius:10px;background:var(--info-bg);color:var(--info);white-space:nowrap">Mañana</span>`
      : winner === "t"
      ? `<span style="font-size:10px;font-weight:500;padding:2px 8px;border-radius:10px;background:var(--success-bg);color:var(--success);white-space:nowrap">Tarde</span>`
      : `<span style="font-size:10px;color:var(--text3)">Igual</span>`;
    return `
      <div style="display:grid;grid-template-columns:80px 1fr 70px 70px;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;color:var(--text2)">${label}</span>
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="height:7px;background:var(--info-bg);border-radius:3px;overflow:hidden"><div style="height:100%;width:${mPct}%;background:var(--info);border-radius:3px"></div></div>
          <div style="height:7px;background:var(--success-bg);border-radius:3px;overflow:hidden"><div style="height:100%;width:${tPct}%;background:var(--success);border-radius:3px"></div></div>
        </div>
        <div style="text-align:right;font-size:12px">
          <div style="font-weight:500;color:var(--text)">${fVal(mVal)}</div>
          <div style="color:var(--text3)">${fVal(tVal)}</div>
        </div>
        <div style="text-align:right">${wBadge}</div>
      </div>`;
  }

  const tmHoras = manana?.apertura?.hora && manana?.cierre?.hora
    ? `${manana.apertura.hora} — ${manana.cierre.hora}` : manana?.apertura?.hora || "—";
  const ttHoras = tarde?.apertura?.hora && tarde?.cierre?.hora
    ? `${tarde.apertura.hora} — ${tarde.cierre.hora}` : tarde?.apertura?.hora || "—";

  compWrap.innerHTML = `
    <div style="font-size:11px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Comparación de turnos</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div style="background:var(--info-bg);border:1px solid var(--info-border);border-radius:var(--radius-sm);padding:10px 12px">
        <div style="font-size:10px;font-weight:500;color:var(--info);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Mañana</div>
        <div style="font-size:20px;font-weight:600;color:var(--text);font-family:'DM Mono',monospace">${fmt(tmTot.tot)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${tmV} ventas · ${tmHoras}</div>
      </div>
      <div style="background:var(--success-bg);border:1px solid var(--success-border);border-radius:var(--radius-sm);padding:10px 12px">
        <div style="font-size:10px;font-weight:500;color:var(--success);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Tarde</div>
        <div style="font-size:20px;font-weight:600;color:var(--text);font-family:'DM Mono',monospace">${fmt(ttTot.tot)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${ttV} ventas · ${ttHoras}</div>
      </div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text3)"><div style="width:8px;height:8px;border-radius:50%;background:var(--info)"></div>Mañana</div>
        <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text3)"><div style="width:8px;height:8px;border-radius:50%;background:var(--success)"></div>Tarde</div>
      </div>
      ${compRow("Total", tmTot.tot, ttTot.tot, maxTot, true)}
      ${compRow("Ventas", tmV, ttV, maxV, false)}
      ${compRow("Promedio", tmProm, ttProm, maxProm, true)}
      ${compRow("Efectivo", tmTot.totE, ttTot.totE, maxE, true)}
    </div>`;
}

function renderTurnoCard(turnoKey, turno, esHoy, manana, tarde) {
  const label    = TURNO_LABEL[turnoKey];
  const apertura = turno?.apertura;
  const cierre   = turno?.cierre;
  const { totE, totD, totC, totM, tot, ventas } = calcTotalesTurno(turno);
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
        registrarLog("caja", `Turno ${label} abierto · fondo inicial ${fmt(fondo)}`);
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
    btnCerrar.addEventListener("click", () => abrirModalCierre(turnoKey, { totE, totD, totC, totM, tot, ventas }));
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
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Mercado Pago</div>
      <div style="font-size:14px;font-weight:500;color:var(--mp)">${fmt(totM)}</div>
    </div>
    <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:8px 10px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Débito</div>
      <div style="font-size:14px;font-weight:500;color:var(--info)">${fmt(totD)}</div>
    </div>
    <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:8px 10px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Crédito</div>
      <div style="font-size:14px;font-weight:500;color:var(--info)">${fmt(totC)}</div>
    </div>`;
  card.appendChild(stats);

  // Timeline ventas
  if (ventas.length) {
    const timelineWrap = document.createElement("div");
    timelineWrap.className = "timeline-wrap";
    timelineWrap.style.marginTop = "0";
    const metLabel = { efectivo:"Efectivo", mp:"Mercado Pago", debito:"Débito", credito:"Crédito" };
    const metClass = { efectivo:"metodo-efectivo", mp:"metodo-mp", debito:"metodo-debito", credito:"metodo-credito" };
    const ventasOrdenadas = [...ventas].sort((a,b)=>(b.hora||"").localeCompare(a.hora||""));
    timelineWrap.innerHTML = `
      <div class="timeline-header">
        <span>Descripción</span><span class="num">Total</span><span>Método</span><span>Hora</span><span class="num">Ítems</span><span>Usuario</span><span></span>
      </div>
      ${ventasOrdenadas.map(v=>`
        <div class="timeline-row" data-venta-id="${v._id||""}" data-turno="${turnoKey}" data-fecha="${cajaFechaKey}">
          <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(v.items||[]).map(i=>i.desc).join(", ")}${v.nota ? `<span style="display:inline-block;margin-left:6px;font-size:10px;font-weight:500;padding:1px 7px;border-radius:10px;background:var(--warn-bg);color:#8a6000;border:1px solid var(--warn-border)">${v.nota}</span>` : ''}</span>
          <span class="num" style="font-weight:500">${fmt(v.total)}</span>
          <span class="${metClass[v.metodo]||""}">${metLabel[v.metodo]||v.metodo}</span>
          <span style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fmtHora(v.hora)||"—"}</span>
          <span class="num">${(v.items||[]).reduce((s,i)=>s+i.qty,0)}</span>
          <span style="font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.admin||"—"}</span>
          <span style="text-align:right"><button class="btn-anular-venta btn-danger" style="font-size:10px;padding:2px 7px;opacity:.7" data-venta-id="${v._id||""}" data-turno="${turnoKey}" data-fecha="${cajaFechaKey}" title="Anular venta">✕ Anular</button></span>
        </div>`).join("")}`;
    card.appendChild(timelineWrap);
  }

  return card;
}

// ── Chips de nota en modal venta ──
document.getElementById("modalVenta")?.addEventListener("click", e => {
  const chip = e.target.closest(".nota-chip");
  if (!chip) return;
  const input = document.getElementById("notaVentaInput");
  if (chip.classList.contains("active")) {
    chip.classList.remove("active");
    if (input) input.value = "";
  } else {
    document.querySelectorAll(".nota-chip").forEach(b => b.classList.remove("active"));
    chip.classList.add("active");
    if (input) input.value = chip.dataset.nota;
  }
});

// Al escribir en el input, desactivar chips
document.getElementById("notaVentaInput")?.addEventListener("input", () => {
  document.querySelectorAll(".nota-chip").forEach(b => b.classList.remove("active"));
});

// ── Anular venta desde el timeline ──
document.getElementById("cajaTurnosWrap")?.addEventListener("click", async e => {
  const btn = e.target.closest(".btn-anular-venta");
  if (!btn) return;
  const ventaId = btn.dataset.ventaId;
  const turno   = btn.dataset.turno;
  const fecha   = btn.dataset.fecha;
  if (!ventaId || !turno || !fecha) return;
  const cajaHoy  = cajaData[fecha] || {};
  const turnoObj = cajaHoy[turno] || {};
  const venta    = turnoObj.ventas?.[ventaId];
  if (!venta) { showToast("Venta no encontrada.", "error"); return; }
  const desc = (venta.items||[]).map(i=>i.desc).join(", ");
  if (!confirm(`¿Anular esta venta?
${desc}
Total: ${fmt(venta.total)}
Esta acción no se puede deshacer.`)) return;
  // Eliminar la venta usando deleteField para borrar el campo en Firestore
  updateDoc(doc(db, 'caja', fecha), {
    [`${turno}.ventas.${ventaId}`]: deleteField()
  });
  (venta.items || []).forEach(item => {
    const prod = allProducts.find(p => p.desc === item.desc);
    if (prod && typeof prod.stock === "number") {
      updateDoc(doc(db, 'productos', prod._id), { stock: prod.stock + item.qty });
    }
  });
  registrarLog("anulacion", `Venta anulada — ${fmt(venta.total)} · ${(venta.items||[]).map(i=>i.desc).join(", ")}`);
  showToast("Venta anulada ✓", "success");
});

function abrirModalCierre(turnoKey, { totE, totD, totC, totM, tot, ventas }) {
  cierreTurnoActivo = turnoKey;
  const label = TURNO_LABEL[turnoKey];
  document.getElementById("modalCierreTitulo").textContent = `Cerrar Turno ${label}`;
  document.getElementById("cierreResumenTexto").innerHTML = `
    <p style="margin-bottom:10px">Vas a cerrar el Turno ${label}.</p>
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:13px;line-height:2">
      <div style="display:flex;justify-content:space-between"><span>Total recaudado</span><span style="font-weight:600">${fmt(tot)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Efectivo</span><span>${fmt(totE)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Mercado Pago</span><span>${fmt(totM)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Débito</span><span>${fmt(totD)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Crédito</span><span>${fmt(totC)}</span></div>
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
  registrarLog("caja", `Turno ${TURNO_LABEL[turno]} cerrado`);
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
    const { totE, totD, totC, totM, tot, ventas } = calcTotalesTurno(turnoObj);
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
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#009ee3;font-weight:500">Mercado Pago</span><span>${fmt(totM)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#185fa5;font-weight:500">Débito</span><span>${fmt(totD)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#185fa5;font-weight:500">Crédito</span><span>${fmt(totC)}</span></div>
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
  const totMG = tmTot.totM + ttTot.totM;
  const totDG = tmTot.totD + ttTot.totD;
  const totCG = (tmTot.totC||0) + (ttTot.totC||0);

  const now = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });

  const content = `
    <div style="font-family:'DM Sans',sans-serif;font-size:13px;color:#111;padding:2rem;max-width:520px;margin:0 auto">
      <div style="font-size:18px;font-weight:600;margin-bottom:2px">JPSoft | Tienda</div>
      <div style="font-size:12px;color:#888;margin-bottom:1.5rem">Resumen de cierre — ${fechaLbl}</div>

      ${renderTurnoHTML(manana, "Mañana")}
      ${(manana && tarde) ? '<hr style="border:none;border-top:1px solid #eee;margin:16px 0" />' : ""}
      ${renderTurnoHTML(tarde, "Tarde")}

      <hr style="border:none;border-top:2px solid #111;margin:16px 0" />
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#aaa;margin-bottom:8px">Total del día</div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#1a7a50;font-weight:500">Efectivo</span><span>${fmt(totEG)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#009ee3;font-weight:500">Mercado Pago</span><span>${fmt(totMG)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#185fa5;font-weight:500">Débito</span><span>${fmt(totDG)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="color:#185fa5;font-weight:500">Crédito</span><span>${fmt(totCG)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:17px;font-weight:600;padding-top:8px;border-top:2px solid #111;margin-top:6px"><span>TOTAL GENERAL</span><span>${fmt(totGeneral)}</span></div>

      <div style="font-size:11px;color:#bbb;text-align:center;margin-top:1.5rem">Generado el ${now} · JPSoft | Tienda</div>
    </div>`;

  // Nombre archivo
  const turnosAbiertos = [];
  if (manana?.apertura) turnosAbiertos.push("TM");
  if (tarde?.apertura)  turnosAbiertos.push("TT");
  const nombrePDF = `JPSoft_Tienda_${turnosAbiertos.join("-")}_${parseInt(fd)}-${parseInt(fm)}-${fy}`;

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

    return `<tr data-id="${p._id}">
      <td style="width:32px;text-align:center"><input type="checkbox" class="prod-check" data-id="${p._id}" style="cursor:pointer;width:14px;height:14px"></td>
      <td><span class="badge ${badgeClass(p.proveedor)}">${p.proveedor || "—"}</span></td>
      <td class="id-cell" style="text-align:center">${p.id || "—"}</td>
      <td class="cod-cell">${p.cod || "—"}</td>
      <td style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.desc || ""}">${p.desc || "—"}</td>
      <td class="num" style="font-weight:600">${fmt(venta)}</td>
      <td class="num td-editable" data-field="lista" data-id="${p._id}" data-val="${p.lista || 0}" title="Clic para editar precio de lista">
        <span class="td-val">${pListaHtml}</span>
      </td>
      <td class="num td-editable" data-field="stock" data-id="${p._id}" data-val="${p.stock ?? ""}" title="Clic para editar stock">
        <span class="td-val"><span class="badge ${stockClass}" style="font-size:10px">${stock}</span></span>
      </td>
      <td>
        <div style="display:flex;gap:5px;justify-content:flex-end">
          <button class="btn-secondary" style="font-size:11px;padding:4px 8px" data-edit onclick="window._editarProducto('${p._id}')">Editar</button>
          <button class="btn-danger" style="font-size:11px;padding:4px 7px" onclick="window._eliminarProducto('${p._id}','${(p.desc||'').replace(/'/g,'&#39;')}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  renderPagination("prodPagination", prodPage, totalPages, v => { prodPage = v; renderProductosTabla(); });
}

document.getElementById("prodSearchInput")?.addEventListener("input", () => { prodPage = 1; renderProductosTabla(); });

// ── Eliminar producto directo ──
window._eliminarProducto = function(id, desc) {
  if (!confirm(`¿Eliminar el producto "${desc}"?
Esta acción no se puede deshacer.`)) return;
  deleteDoc(doc(db, 'productos', id));
  showToast("Producto eliminado ✓", "success");
};

// ── Checkbox selección múltiple ──
document.getElementById("prodCheckAll")?.addEventListener("change", e => {
  document.querySelectorAll(".prod-check").forEach(cb => cb.checked = e.target.checked);
  actualizarBarraSeleccion();
});
document.getElementById("prodTableBody")?.addEventListener("change", e => {
  if (e.target.classList.contains("prod-check")) actualizarBarraSeleccion();
});
function actualizarBarraSeleccion() {
  const checks = document.querySelectorAll(".prod-check:checked");
  const bar    = document.getElementById("prodSeleccionBar");
  const count  = document.getElementById("prodSeleccionCount");
  const checkAll = document.getElementById("prodCheckAll");
  const total  = document.querySelectorAll(".prod-check").length;
  if (checks.length > 0) {
    bar.style.display = "flex";
    count.textContent = checks.length + (checks.length === 1 ? " seleccionado" : " seleccionados");
    if (checkAll) checkAll.indeterminate = checks.length > 0 && checks.length < total;
    if (checkAll) checkAll.checked = checks.length === total;
  } else {
    bar.style.display = "none";
    if (checkAll) { checkAll.checked = false; checkAll.indeterminate = false; }
  }
}
document.getElementById("btnEliminarSeleccionados")?.addEventListener("click", () => {
  const checks = [...document.querySelectorAll(".prod-check:checked")];
  if (!checks.length) return;
  if (!confirm(`¿Eliminar ${checks.length} producto${checks.length > 1 ? "s" : ""}?
Esta acción no se puede deshacer.`)) return;
  checks.forEach(cb => deleteDoc(doc(db, 'productos', cb.dataset.id)));
  showToast(`${checks.length} producto${checks.length > 1 ? "s eliminados" : " eliminado"} ✓`, "success");
  document.getElementById("prodCheckAll").checked = false;
});
document.getElementById("btnDeseleccionarTodos")?.addEventListener("click", () => {
  document.querySelectorAll(".prod-check").forEach(cb => cb.checked = false);
  document.getElementById("prodCheckAll").checked = false;
  actualizarBarraSeleccion();
});

// ── Edición inline de precio de lista y stock ──
document.querySelector(".productos-table-wrap")?.addEventListener("click", e => {
  const td = e.target.closest(".td-editable");
  if (!td || td.querySelector("input")) return; // ya está editando

  const field  = td.dataset.field;
  const id     = td.dataset.id;
  const val    = td.dataset.val;
  const valSpan = td.querySelector(".td-val");

  // Crear input inline
  const input = document.createElement("input");
  input.type  = field === "stock" ? "number" : "number";
  input.value = val;
  input.min   = "0";
  input.style.cssText = "width:80px;font-size:13px;padding:3px 6px;border-radius:4px;border:1.5px solid var(--info-border);background:var(--surface);text-align:right;outline:none;font-family:inherit";
  valSpan.style.display = "none";
  td.appendChild(input);
  input.focus();
  input.select();

  async function guardarInline() {
    const newVal = input.value.trim();
    const num    = parseFloat(newVal);
    if (isNaN(num) || num < 0) { cancelarInline(); return; }

    const prod = allProducts.find(p => p._id === id);
    if (!prod) { cancelarInline(); return; }

    // Registrar historial si cambia el precio de lista
    const updateData = {};
    if (field === "lista") {
      if (prod.lista !== num) {
        const histActual = prod.historialPrecios || {};
        histActual[`h_${Date.now()}`] = {
          fecha: todayKey(), hora: nowHora(),
          admin: getNombreUsuario(),
          precioAnterior: prod.lista, precioNuevo: num
        };
        updateData.historialPrecios = histActual;
      }
      updateData.lista = num;
    } else {
      updateData.stock = num;
    }

    if (field === "lista") {
      const prodLog = allProducts.find(p => p._id === id);
      registrarLog("precio", `Precio actualizado — ${prodLog?.desc || id} · ${fmt(prod.lista||0)} → ${fmt(num)}`);
    }
    updateDoc(doc(db, 'productos', id), updateData);
    showToast(field === "lista" ? "Precio actualizado ✓" : "Stock actualizado ✓", "success");
    cancelarInline();
  }

  function cancelarInline() {
    input.remove();
    valSpan.style.display = "";
  }

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); guardarInline(); }
    if (e.key === "Escape") cancelarInline();
  });

  input.addEventListener("blur", () => {
    // Pequeño delay para no interferir con Enter
    setTimeout(() => { if (document.activeElement !== input) cancelarInline(); }, 150);
  });
});
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
    registrarLog("producto", `Producto agregado — ${data.desc} · P. Lista ${fmt(data.lista||0)}`);
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
importZone?.addEventListener("dragover", e => { e.preventDefault(); if(importZone) importZone.style.background = "var(--bg3)"; });
importZone?.addEventListener("dragleave", () => { if(importZone) importZone.style.background = ""; });
importZone?.addEventListener("drop", e => {
  e.preventDefault(); if(importZone) importZone.style.background = "";
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
        addDoc(collection(db, 'proveedores'), { nombre: pNombre, ganancia: gan != null ? Math.round(gan * 100) : (margenesConfig.general ?? 50), tabaco: false, categoria: "" });
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
    gananciaMap[sheetName] = ganancia !== null ? ganancia : ((margenesConfig.general ?? 50) / 100);
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
        <button class="btn-danger" style="font-size:12px;padding:5px 10px" onclick="window._eliminarProveedor('${id}','${(p.nombre||'').replace(/'/g,'&#39;')}',${cantProd})">🗑</button>
      </div>
    </div>`;
  }).join("");
}

window._eliminarProveedor = function(id, nombre, cantProd) {
  const aviso = cantProd > 0
    ? `¿Eliminar el proveedor "${nombre}"?
Se eliminarán también sus ${cantProd} producto${cantProd > 1 ? "s" : ""} asociado${cantProd > 1 ? "s" : ""}.
Esta acción no se puede deshacer.`
    : `¿Eliminar el proveedor "${nombre}"?
Esta acción no se puede deshacer.`;
  if (!confirm(aviso)) return;
  deleteDoc(doc(db, 'proveedores', id));
  allProducts.filter(p => p.proveedor === nombre).forEach(p => deleteDoc(doc(db, 'productos', p._id)));
  showToast(`Proveedor "${nombre}" eliminado ✓`, "success");
};

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



// ============================================================
//  FUNCIONES ANÁLISIS Y SISTEMA (migradas desde Admin)
// ============================================================




function dateRange(desde, hasta) {
  const keys = [], d = new Date(desde + "T00:00:00");
  const h = new Date(hasta + "T00:00:00");
  while (d <= h) {
    keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
    d.setDate(d.getDate() + 1);
  }
  return keys;
}

function getPeriodRange(periodo) {
  const hoy = new Date();
  const pad = n => String(n).padStart(2,"0");
  const key = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  if (periodo === "hoy") return { desde: key(hoy), hasta: key(hoy) };
  if (periodo === "7dias") {
    const hace7 = new Date(hoy); hace7.setDate(hoy.getDate() - 6);
    return { desde: key(hace7), hasta: key(hoy) };
  }
  if (periodo === "semana") {
    const lunes = new Date(hoy);
    const diaSemana = hoy.getDay(); // 0=domingo, 1=lunes, ..., 6=sábado
    const diasDesdelunes = diaSemana === 0 ? 6 : diaSemana - 1;
    lunes.setDate(hoy.getDate() - diasDesdelunes);
    return { desde: key(lunes), hasta: key(hoy) };
  }
  if (periodo === "mes") {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return { desde: key(inicio), hasta: key(hoy) };
  }
  return null;
}

// ============================================================
//  AUTH
// ============================================================

document.getElementById("btn-logout").addEventListener("click", async () => {
  const nombre = document.getElementById("user-nombre").textContent || "usuario";
  if (!confirm(`¿Cerrar sesión como ${nombre}?`)) return;
  await signOut(auth);
});

// ============================================================
//  FIREBASE
// ============================================================




function setDefaultDates() {
  const { desde, hasta } = getPeriodRange("mes");
  ["expVentasDesde","expCajaDesde","reporteDesde"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = desde;
  });
  ["expVentasHasta","expCajaHasta","reporteHasta"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = hasta;
  });
}

// ============================================================
//  NAVEGACIÓN
// ============================================================




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
//  VISTA: REPORTES
// ============================================================
document.getElementById("reportePeriodo").addEventListener("change", function() {
  const customWrap = document.getElementById("reporteCustomRange");
  if (this.value === "custom") {
    customWrap.style.display = "flex";
    customWrap.classList.remove("hidden");
  } else {
    customWrap.style.display = "none";
  }
});

document.getElementById("btnGenerarReporte").addEventListener("click", generarReporte);

function generarReporte() {
  const periodo = document.getElementById("reportePeriodo").value;
  let desde, hasta;
  if (periodo === "custom") {
    desde = document.getElementById("reporteDesde").value;
    hasta = document.getElementById("reporteHasta").value;
  } else {
    const r = getPeriodRange(periodo);
    desde = r.desde; hasta = r.hasta;
  }
  if (!desde || !hasta) { showToast("Seleccioná un rango de fechas.", "error"); return; }

  const keys  = dateRange(desde, hasta);
  const ventas = [];

  keys.forEach(k => {
    const dia = cajaData[k];
    if (!dia) return;
    ["manana", "tarde"].forEach(turno => {
      const t = dia[turno];
      if (!t?.ventas) return;
      Object.values(t.ventas).forEach(v => {
        ventas.push({ ...v, fecha: k, turno });
      });
    });
  });

  // Stats
  let totE = 0, totD = 0, totC = 0, totM = 0;
  ventas.forEach(v => {
    if (v.metodo === "efectivo") totE += v.total || 0;
    else if (v.metodo === "debito") totD += v.total || 0;
    else if (v.metodo === "credito") totC += v.total || 0;
    else if (v.metodo === "mp") totM += v.total || 0;
  });
  const tot = totE + totD + totC + totM;

  (document.getElementById("rStatTotal") || {}).textContent = fmt(tot);
  (document.getElementById("rStatVentas") || {}).textContent = ventas.length + " ventas";
  (document.getElementById("rStatEfectivo") || {}).textContent = fmt(totE);
  (document.getElementById("rStatMp") || {}).textContent = fmt(totM);
  (document.getElementById("rStatDebito") || {}).textContent = fmt(totD);
  (document.getElementById("rStatCredito") || {}).textContent = fmt(totC);
  (document.getElementById("rStatEfectivoPct") || {}).textContent = pct(totE, tot);
  (document.getElementById("rStatMpPct") || {}).textContent = pct(totM, tot);
  (document.getElementById("rStatDebitoPct") || {}).textContent = pct(totD, tot);
  (document.getElementById("rStatCreditoPct") || {}).textContent = pct(totC, tot);
  (document.getElementById("btnExportarReportePDF") || {style:{}}).style.display = "";
  window._reporteData = { desde, hasta, ventas, tot, totE, totM, totD, totC };

  // Resumen por día
  const diasMap = {};
  ventas.forEach(v => {
    if (!diasMap[v.fecha]) diasMap[v.fecha] = { ventas: 0, total: 0 };
    diasMap[v.fecha].ventas++;
    diasMap[v.fecha].total += v.total || 0;
  });

  const diasTabla = document.getElementById("reporteDiasTabla");
  if (diasTabla) {
    if (!Object.keys(diasMap).length) {
      diasTabla.innerHTML = `<div class="empty-row">Sin ventas en el período.</div>`;
    } else {
      diasTabla.innerHTML = Object.entries(diasMap).sort((a,b) => b[0].localeCompare(a[0])).map(([k, d]) => `
        <div style="display:grid;grid-template-columns:1fr 80px 80px 80px;padding:9px 14px;border-bottom:1px solid var(--border);font-size:13px;align-items:center">
          <span>${fechaLabel(k)}</span>
          <span style="text-align:right">${d.ventas}</span>
          <span style="text-align:right;font-weight:500">${fmt(d.total)}</span>
          <span style="text-align:right;color:var(--text3)">${fmt(Math.round(d.total / d.ventas))}</span>
        </div>`).join("");
    }
  }

  // Top productos
  const prodMap = {};
  ventas.forEach(v => {
    (v.items || []).forEach(i => {
      if (!prodMap[i.desc]) prodMap[i.desc] = { qty: 0, total: 0 };
      prodMap[i.desc].qty   += i.qty || 0;
      prodMap[i.desc].total += i.subtotal || 0;
    });
  });

  const topProds = document.getElementById("reporteTopProductos");
  if (topProds) {
    const sorted = Object.entries(prodMap).sort((a,b) => b[1].qty - a[1].qty).slice(0, 15);
    if (!sorted.length) {
      topProds.innerHTML = `<div class="empty-row">Sin datos.</div>`;
    } else {
      topProds.innerHTML = sorted.map(([desc, d]) => `
        <div style="display:grid;grid-template-columns:1fr 60px 80px;padding:9px 14px;border-bottom:1px solid var(--border);font-size:12px;align-items:center">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${desc}">${desc}</span>
          <span style="text-align:right;font-weight:500">${d.qty}</span>
          <span style="text-align:right">${fmt(d.total)}</span>
        </div>`).join("");
    }
  }

  // Detalle ventas
  const metLabel = { efectivo: "Efectivo", debito: "Débito", credito: "Crédito", mp: "Mercado Pago" };
  const metClass = { efectivo: "metodo-efectivo", debito: "metodo-debito", mp: "metodo-mp", credito: "metodo-credito" };
  const detalle  = document.getElementById("reporteDetalle");
  if (detalle) {
    if (!ventas.length) {
      detalle.innerHTML = `<div class="empty-row">Sin ventas en el período.</div>`;
    } else {
      const rows = [...ventas].sort((a,b) => b.fecha.localeCompare(a.fecha) || (b.hora||"").localeCompare(a.hora||"")).map(v => {
        const [y,m,d] = v.fecha.split("-");
        const fechaCorta = `${parseInt(d)}/${parseInt(m)}/${y}${v.hora ? ", "+fmtHora(v.hora) : ""}`;
        return `<tr style="border-bottom:1px solid var(--border);font-size:12px">
          <td style="padding:9px 12px;white-space:nowrap;color:var(--text3);font-size:11px;font-family:'DM Mono',monospace">${fechaCorta}</td>
          <td style="padding:9px 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(v.items||[]).map(i=>i.desc).join(", ")}</td>
          <td style="padding:9px 12px" class="${metClass[v.metodo]||""}">${metLabel[v.metodo]||v.metodo}</td>
          <td style="padding:9px 12px;text-align:right">${(v.items||[]).reduce((s,i)=>s+i.qty,0)}</td>
          <td style="padding:9px 12px;text-align:right;font-weight:500">${fmt(v.total)}</td>
        </tr>`;
      }).join("");
      detalle.innerHTML = `<table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <colgroup>
          <col style="width:115px">
          <col>
          <col style="width:115px">
          <col style="width:55px">
          <col style="width:85px">
        </colgroup>
        <thead><tr style="background:var(--surface2);font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">
          <th style="padding:8px 12px;text-align:left;font-weight:500;border-bottom:1px solid var(--border)">Fecha</th>
          <th style="padding:8px 12px;text-align:left;font-weight:500;border-bottom:1px solid var(--border)">Ítems</th>
          <th style="padding:8px 12px;text-align:left;font-weight:500;border-bottom:1px solid var(--border)">Método</th>
          <th style="padding:8px 12px;text-align:right;font-weight:500;border-bottom:1px solid var(--border)">Cant.</th>
          <th style="padding:8px 12px;text-align:right;font-weight:500;border-bottom:1px solid var(--border)">Total</th>
        </tr></thead><tbody>${rows}</tbody></table>`;
    }
  }
}

// ── Exportar Reporte PDF ──
document.getElementById("btnExportarReportePDF")?.addEventListener("click", async () => {
  const rd = window._reporteData;
  if (!rd) return;
  const { desde, hasta, ventas, tot, totE, totM, totD, totC } = rd;

  const diasMap = {};
  ventas.forEach(v => {
    if (!diasMap[v.fecha]) diasMap[v.fecha] = { ventas: 0, total: 0 };
    diasMap[v.fecha].ventas++;
    diasMap[v.fecha].total += v.total || 0;
  });

  const prodMap = {};
  ventas.forEach(v => {
    (v.items || []).forEach(i => {
      if (!prodMap[i.desc]) prodMap[i.desc] = { qty: 0, total: 0 };
      prodMap[i.desc].qty   += i.qty || 0;
      prodMap[i.desc].total += i.subtotal || 0;
    });
  });
  const topProds = Object.entries(prodMap).sort((a,b) => b[1].qty - a[1].qty).slice(0, 10);

  const diasRows = Object.entries(diasMap).sort((a,b) => b[0].localeCompare(a[0])).map(([f, d]) => {
    const [fy,fm,fd] = f.split("-");
    return `<tr><td>${parseInt(fd)}/${parseInt(fm)}/${fy}</td><td style="text-align:right">${d.ventas}</td><td style="text-align:right">${fmt(d.total)}</td><td style="text-align:right">${fmt(Math.round(d.total/d.ventas))}</td></tr>`;
  }).join("");

  const prodRows = topProds.map(([desc, d]) => `<tr><td>${desc}</td><td style="text-align:right">${d.qty}</td><td style="text-align:right">${fmt(d.total)}</td></tr>`).join("");

  const [df,dm,dy] = desde.split("-");
  const [hf,hm,hy] = hasta.split("-");
  const periodoLabel = `${parseInt(df)}/${parseInt(dm)}/${dy} — ${parseInt(hf)}/${parseInt(hm)}/${hy}`;
  const now = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });

  // Filas de dias y productos más compactas
  const diasRowsPDF = Object.entries(diasMap).sort((a,b) => b[0].localeCompare(a[0])).map(([f, d]) => {
    const [fy,fm,fd] = f.split("-");
    return `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:3px 6px">${parseInt(fd)}/${parseInt(fm)}/${fy}</td><td style="text-align:right;padding:3px 6px">${d.ventas}</td><td style="text-align:right;padding:3px 6px">${fmt(d.total)}</td><td style="text-align:right;padding:3px 6px">${fmt(Math.round(d.total/d.ventas))}</td></tr>`;
  }).join("");
  const prodRowsPDF = topProds.map(([desc, d]) => `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:3px 6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${desc}</td><td style="text-align:right;padding:3px 6px">${d.qty}</td><td style="text-align:right;padding:3px 6px">${fmt(d.total)}</td></tr>`).join("");

  const content = `<div style="font-family:'DM Sans',sans-serif;font-size:11px;color:#111;padding:10mm;width:210mm;box-sizing:border-box">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:2px solid #111;padding-bottom:5px">
      <div style="font-size:15px;font-weight:600">JPSoft | Tienda — Reportes</div>
      <div style="font-size:9px;color:#888">${periodoLabel} · ${ventas.length} ventas</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:12px">
      ${[["Total",fmt(tot),"#111"],["Efectivo",fmt(totE),"#1a7a50"],["Mercado Pago",fmt(totM),"#009ee3"],["Débito",fmt(totD),"#185fa5"],["Crédito",fmt(totC),"#185fa5"]].map(([l,v,col])=>`<div style="border:1px solid #eee;border-radius:4px;padding:6px 8px"><div style="font-size:8px;color:#aaa;text-transform:uppercase;margin-bottom:2px">${l}</div><div style="font-size:12px;font-weight:600;color:${col}">${v}</div></div>`).join("")}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <div style="font-size:8px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Resumen por día</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          <thead><tr style="background:#f5f5f5"><th style="text-align:left;padding:3px 6px;font-weight:500">Fecha</th><th style="text-align:right;padding:3px 6px;font-weight:500">Ventas</th><th style="text-align:right;padding:3px 6px;font-weight:500">Total</th><th style="text-align:right;padding:3px 6px;font-weight:500">Prom.</th></tr></thead>
          <tbody>${diasRowsPDF}</tbody>
        </table>
      </div>
      <div>
        <div style="font-size:8px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Productos más vendidos</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          <thead><tr style="background:#f5f5f5"><th style="text-align:left;padding:3px 6px;font-weight:500">Producto</th><th style="text-align:right;padding:3px 6px;font-weight:500">Unid.</th><th style="text-align:right;padding:3px 6px;font-weight:500">Total</th></tr></thead>
          <tbody>${prodRowsPDF}</tbody>
        </table>
      </div>
    </div>
    <div style="font-size:8px;color:#bbb;text-align:center;margin-top:10px;border-top:1px solid #eee;padding-top:4px">JPSoft | Tienda · ${now}</div>
  </div>`;

  const btn = document.getElementById("btnExportarReportePDF");
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = "Generando…";

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:794px;background:#fff";
  container.innerHTML = content;
  document.body.appendChild(container);

  try {
    const scale  = 2;
    const canvas = await html2canvas(container, { scale, useCORS: true, backgroundColor: "#fff", width: 794 });
    const { jsPDF } = window.jspdf;
    const pdf    = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pxPerMm = canvas.width / 210;          // píxeles por mm (scale incluido)
    const pageHpx = Math.round(297 * pxPerMm);   // altura de página A4 en px
    const marginMm = 0;
    const imgW   = 210;
    const imgH   = (canvas.height / canvas.width) * 210;
    const pages  = Math.ceil(imgH / 297);
    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage();
      const srcY = i * pageHpx;
      const srcH = Math.min(pageHpx, canvas.height - srcY);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width  = canvas.width;
      pageCanvas.height = pageHpx;
      const ctx = pageCanvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
      pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", 0, 0, imgW, 297);
    }
    pdf.save(`JPSoft_Tienda_Reporte_${desde}_${hasta}.pdf`);
    showToast("PDF generado ✓", "success");
  } catch(err) {
    showToast("Error al generar PDF: " + err.message, "error");
  } finally {
    document.body.removeChild(container);
    btn.disabled = false; btn.innerHTML = orig;
  }
});

// ============================================================
//  VISTA: LISTA DE PRECIOS
// ============================================================
function populateHistorialFilter() {
  const sel   = document.getElementById("histFilterProv");
  if (!sel) return;
  const provs = Object.values(proveedores).sort((a,b) => a.nombre.localeCompare(b.nombre));
  const cur   = sel.value;
  sel.innerHTML = `<option value="">Todos los proveedores</option>`;
  provs.forEach(p => sel.innerHTML += `<option value="${p.nombre}" ${cur === p.nombre ? "selected" : ""}>${p.nombre}</option>`);
}

function populatePreciosFilter() {
  const sel   = document.getElementById("preciosFilterProv");
  const provs = Object.values(proveedores).sort((a,b) => a.nombre.localeCompare(b.nombre));
  sel.innerHTML = `<option value="">Todos los proveedores</option>`;
  provs.forEach(p => sel.innerHTML += `<option value="${p.nombre}">${p.nombre}</option>`);
}

function renderPrecios() {
  const filtro = document.getElementById("preciosFilterProv")?.value || "";
  const lista  = allProducts
    .filter(p => !filtro || p.proveedor === filtro)
    .sort((a,b) => (a.proveedor||"").localeCompare(b.proveedor||"") || (a.desc||"").localeCompare(b.desc||""));

  const tbody = document.getElementById("preciosBody");
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No hay productos.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(p => {
    const venta  = getPrecioVenta(p);
    const ganPct = gananciaMap[p.proveedor] != null ? Math.round(gananciaMap[p.proveedor] * 100) : "—";
    return `<tr>
      <td><span class="badge ${badgeClass(p.proveedor)}">${p.proveedor||"—"}</span></td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text3);text-align:center">${p.id||"—"}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text3)">${p.cod||"—"}</td>
      <td style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.desc||""}">${p.desc||"—"}</td>
      <td class="num">${fmt(p.lista)}</td>
      <td class="num"><span style="color:var(--success);font-weight:500">+${ganPct}%</span></td>
      <td class="num" style="font-weight:600">${fmt(venta)}</td>
    </tr>`;
  }).join("");
}

document.getElementById("preciosFilterProv")?.addEventListener("change", renderPrecios);

document.getElementById("btnImprimirPrecios")?.addEventListener("click", () => window.print());

document.getElementById("btnExportarPrecios")?.addEventListener("click", () => {
  const filtro = document.getElementById("preciosFilterProv").value;
  const lista  = allProducts
    .filter(p => !filtro || p.proveedor === filtro)
    .sort((a,b) => (a.proveedor||"").localeCompare(b.proveedor||"") || (a.desc||"").localeCompare(b.desc||""));

  const data = [["Proveedor","ID","Codigo","Producto","P. Lista","Ganancia %","P. Venta"]];
  lista.forEach(p => {
    const venta  = Math.round(getPrecioVenta(p));
    const ganPct = gananciaMap[p.proveedor] != null ? Math.round(gananciaMap[p.proveedor] * 100) : "";
    data.push([p.proveedor||"", p.id||"", p.cod||"", p.desc||"", p.lista||0, ganPct, venta]);
  });

  exportarExcel([{ nombre: "Lista de Precios", data, colsMoney: [4, 6] }], `JPSoft_Tienda_Precios_${todayKey()}.xlsx`);
});

// ============================================================
//  VISTA: EXPORTAR EXCEL
// ============================================================
document.getElementById("btnExpVentas")?.addEventListener("click", () => {
  const desde = document.getElementById("expVentasDesde")?.value;
  const hasta = document.getElementById("expVentasHasta")?.value;
  if (!desde || !hasta) { showToast("Seleccioná el rango de fechas.", "error"); return; }

  const keys   = dateRange(desde, hasta);
  const data   = [["Fecha","Hora","Producto","Cantidad","P. Unitario","Subtotal","Método","Total Venta"]];

  keys.forEach(k => {
    const dia = cajaData[k];
    if (!dia?.ventas) return;
    Object.values(dia.ventas).forEach(v => {
      (v.items || []).forEach(i => {
        data.push([
          fechaLabel(k), v.hora||"", i.desc||"", i.qty||0,
          i.precioUnit||0, i.subtotal||0,
          v.metodo||"", v.total||0
        ]);
      });
    });
  });

  if (data.length === 1) { showToast("No hay ventas en ese período.", "warning"); return; }
  exportarExcel([{ nombre: "Ventas", data, colsMoney: [4, 5, 7] }], `JPSoft_Tienda_Ventas_${desde}_${hasta}.xlsx`);
});

document.getElementById("btnExpCaja")?.addEventListener("click", () => {
  const desde = document.getElementById("expCajaDesde")?.value;
  const hasta = document.getElementById("expCajaHasta")?.value;
  if (!desde || !hasta) { showToast("Seleccioná el rango de fechas.", "error"); return; }

  const keys = dateRange(desde, hasta);
  const data = [["Fecha","Apertura","Cierre","Turno","Fondo Inicial","Ventas","Efectivo","Débito","Mercado Pago","Total"]];

  keys.forEach(k => {
    const dia = cajaData[k];
    if (!dia?.apertura) return;
    const ventas = dia.ventas ? Object.values(dia.ventas) : [];
    let totE = 0, totD = 0, totM = 0;
    ventas.forEach(v => {
      if (v.metodo === "efectivo") totE += v.total||0;
      else if (v.metodo === "debito") totD += v.total||0;
      else if (v.metodo === "mp") totM += v.total||0;
    });
    data.push([
      fechaLabel(k),
      dia.apertura.hora||"",
      dia.cierre?.hora||"—",
      dia.apertura.turno||"",
      dia.apertura.fondo||0,
      ventas.length,
      totE, totD, totM,
      totE + totD + totM
    ]);
  });

  if (data.length === 1) { showToast("No hay datos de caja en ese período.", "warning"); return; }
  exportarExcel([{ nombre: "Caja", data, colsMoney: [4, 6, 7, 8, 9] }], `JPSoft_Tienda_Caja_${desde}_${hasta}.xlsx`);
});

document.getElementById("btnExpProductos")?.addEventListener("click", () => {
  const data = [["Proveedor","ID","Codigo","Producto","P. Lista","Ganancia %","P. Venta","Stock"]];
  allProducts
    .sort((a,b) => (a.proveedor||"").localeCompare(b.proveedor||"") || (a.desc||"").localeCompare(b.desc||""))
    .forEach(p => {
      const venta  = Math.round(getPrecioVenta(p));
      const ganPct = gananciaMap[p.proveedor] != null ? Math.round(gananciaMap[p.proveedor] * 100) : "";
      data.push([p.proveedor||"", p.id||"", p.cod||"", p.desc||"", p.lista||0, ganPct, venta, p.stock ?? "—"]);
    });

  if (data.length === 1) { showToast("No hay productos cargados.", "warning"); return; }
  exportarExcel([{ nombre: "Productos", data, colsMoney: [4, 6] }], `JPSoft_Tienda_Productos_${todayKey()}.xlsx`);
});

// ── Helper exportar Excel ──
// colsMoney: array de índices de columna (0-based) que deben tener formato moneda
function exportarExcel(hojas, filename) {
  const wb = XLSX.utils.book_new();
  hojas.forEach(({ nombre, data, colsMoney = [] }) => {
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Formato moneda sin decimales para columnas indicadas
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let R = range.s.r + 1; R <= range.e.r; R++) {
      colsMoney.forEach(C => {
        const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[cellAddr] && typeof ws[cellAddr].v === "number") {
          ws[cellAddr].z = '"$"#,##0';
        }
      });
    }

    // Ancho de columnas automático
    const colWidths = data[0].map((_, i) =>
      Math.min(40, Math.max(...data.map(r => String(r[i]||"").length))) + 2
    );
    ws["!cols"] = colWidths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  });
  XLSX.writeFile(wb, filename);
  showToast("Archivo exportado ✓", "success");
}

// ============================================================
//  VISTA: USUARIOS
// ============================================================
function renderUsuarios() {
  const tbody = document.getElementById("usuariosTabla");
  if (!tbody) return;
  tbody.innerHTML = TODOS_USUARIOS.map(u => {
    const iniciales_ = (u.nombre || "?").charAt(0).toUpperCase();
    return `<tr>
      <td>
        <div class="user-avatar" style="margin:0 auto">${iniciales_}</div>
      </td>
      <td style="font-weight:500">${u.nombre}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text2)">${u.email}</td>
      <td><span class="badge badge-neutral">Administrador</span></td>
      <td>${u.admin ? '<span class="badge badge-success">Sí</span>' : '<span class="badge badge-neutral">No</span>'}</td>
    </tr>`;
  }).join("");
}

// ============================================================
//  VISTA: BACKUP
// ============================================================
document.getElementById("btnExportarBackup").addEventListener("click", async () => {
  const btn = document.getElementById("btnExportarBackup");
  btn.disabled = true;
  btn.textContent = "Exportando…";
  try {
    // Recolectar todos los datos de Firestore
    const [provSnap, prodSnap, cajaSnap, cfgSnap] = await Promise.all([
      getDocs(collection(db, "proveedores")),
      getDocs(collection(db, "productos")),
      getDocs(collection(db, "caja")),
      getDoc(doc(db, "config", "margenes"))
    ]);
    const data = {
      proveedores: Object.fromEntries(provSnap.docs.map(d => [d.id, d.data()])),
      productos:   Object.fromEntries(prodSnap.docs.map(d => [d.id, d.data()])),
      caja:        Object.fromEntries(cajaSnap.docs.map(d => [d.id, d.data()])),
      config:      { margenes: cfgSnap.exists() ? cfgSnap.data() : {} }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `JPSoft_Tienda_Backup_${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);

    // Registrar fecha último backup
    const fecha = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    await setDoc(doc(db, "config", "backup"), { ultimoBackup: fecha }, { merge: true });
    registrarLog("backup", "Backup exportado — formato Excel");
  showToast("Backup exportado ✓", "success");
  } catch(err) {
    showToast("Error al exportar: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Descargar backup";
    // Restaurar ícono
  }
});

// Importar backup
document.getElementById("importBackupZone")?.addEventListener("click", () => document.getElementById("importBackupInput")?.click());
document.getElementById("importBackupZone")?.addEventListener("dragover", e => { e.preventDefault(); const z=document.getElementById("importBackupZone"); if(z) z.style.background="var(--bg3)"; });
document.getElementById("importBackupZone")?.addEventListener("dragleave", () => { const z=document.getElementById("importBackupZone"); if(z) z.style.background=""; });
document.getElementById("importBackupZone")?.addEventListener("drop", e => {
  e.preventDefault();
  const z=document.getElementById("importBackupZone"); if(z) z.style.background="";
  const inp=document.getElementById("importBackupInput");
  if (e.dataTransfer.files[0] && inp) { inp.files = e.dataTransfer.files; inp.dispatchEvent(new Event("change")); }
});

document.getElementById("importBackupInput")?.addEventListener("change", e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      backupData = JSON.parse(ev.target.result);
      importZone.querySelector("div:nth-child(2)").textContent = file.name;
      importZone.querySelector("div:nth-child(3)").textContent = "Archivo listo para restaurar";
      document.getElementById("btnConfirmarRestore").classList.remove("hidden");
      showToast("Archivo leído. Confirmá para restaurar.", "warning");
    } catch(err) {
      showToast("Archivo JSON inválido.", "error");
      backupData = null;
    }
  };
  reader.readAsText(file);
});

document.getElementById("btnConfirmarRestore").addEventListener("click", async () => {
  if (!backupData) return;
  if (!confirm("⚠️ Esto sobreescribirá TODOS los datos actuales.\n¿Estás seguro?")) return;
  if (!confirm("Última confirmación: ¿restaurar el backup?")) return;

  const btn = document.getElementById("btnConfirmarRestore");
  btn.disabled = true;
  btn.textContent = "Restaurando…";

  try {
    // Restaurar colecciones desde backup
    for (const [id, data] of Object.entries(backupData.proveedores || {})) {
      await setDoc(doc(db, "proveedores", id), data);
    }
    for (const [id, data] of Object.entries(backupData.productos || {})) {
      await setDoc(doc(db, "productos", id), data);
    }
    for (const [id, data] of Object.entries(backupData.caja || {})) {
      await setDoc(doc(db, "caja", id), data);
    }
    if (backupData.config?.margenes) {
      await setDoc(doc(db, "config", "margenes"), backupData.config.margenes);
    }
    showToast("Backup restaurado ✓", "success");
    document.getElementById("btnConfirmarRestore").classList.add("hidden");
    backupData = null;
  } catch(err) {
    showToast("Error al restaurar: " + err.message, "error");
    btn.disabled = false;
    btn.textContent = "Restaurar backup";
  }
});

// ============================================================
//  BACKUP EXCEL COMPLETO
// ============================================================
document.getElementById("btnExportarBackupExcel").addEventListener("click", exportarBackupExcel);
document.getElementById("btnBackupDesdeAlerta")?.addEventListener("click", exportarBackupExcel);

// Importar JSON (nuevo botón)
document.getElementById("btnImportarBackupJson")?.addEventListener("click", () => {
  document.getElementById("importBackupInput").click();
});

// Importar Excel (nuevo botón — placeholder por ahora)
document.getElementById("btnImportarBackupExcel")?.addEventListener("click", () => {
  showToast("La restauración desde Excel estará disponible próximamente.", "warning");
});

async function exportarBackupExcel() {
  const btn = document.getElementById("btnExportarBackupExcel");
  if (btn) { btn.disabled = true; btn.textContent = "Exportando…"; }

  try {
    const [_pv, _pr, _ca, _cfg] = await Promise.all([
      getDocs(collection(db, "proveedores")),
      getDocs(collection(db, "productos")),
      getDocs(collection(db, "caja")),
      getDoc(doc(db, "config", "margenes"))
    ]);
    const data = {
      proveedores: Object.fromEntries(_pv.docs.map(d => [d.id, d.data()])),
      productos:   Object.fromEntries(_pr.docs.map(d => [d.id, d.data()])),
      caja:        Object.fromEntries(_ca.docs.map(d => [d.id, d.data()])),
      config:      { margenes: _cfg.exists() ? _cfg.data() : {} }
    };

    // Hoja 1: Productos
    const hProductos = [["Proveedor","ID","Codigo","Producto","P. Lista","Ganancia %","P. Venta","Stock"]];
    Object.values(data.productos || {}).forEach(p => {
      const gan  = gananciaMap[p.proveedor] != null ? Math.round(gananciaMap[p.proveedor] * 100) : "";
      const venta = Math.round((p.lista || 0) * (1 + (gananciaMap[p.proveedor] ?? 0.5)));
      hProductos.push([p.proveedor||"", p.id||"", p.cod||"", p.desc||"", p.lista||0, gan, venta, p.stock ?? "—"]);
    });

    // Hoja 2: Proveedores
    const hProveedores = [["Nombre","Tipo","Ganancia %","Categoría"]];
    Object.values(data.proveedores || {}).forEach(p => {
      hProveedores.push([p.nombre||"", p.tipo||"general", p.ganancia||0, p.categoria||""]);
    });

    // Hoja 3: Ventas (todas)
    const hVentas = [["Fecha","Hora","Producto","Cantidad","P. Unitario","Subtotal","Método","Total Venta"]];
    Object.entries(data.caja || {}).forEach(([fecha, dia]) => {
      if (!dia.ventas) return;
      Object.values(dia.ventas).forEach(v => {
        (v.items || []).forEach(i => {
          hVentas.push([fechaLabel(fecha), v.hora||"", i.desc||"", i.qty||0, i.precioUnit||0, i.subtotal||0, v.metodo||"", v.total||0]);
        });
      });
    });

    // Hoja 4: Caja
    const hCaja = [["Fecha","Apertura","Cierre","Turno","Fondo Inicial","Ventas","Efectivo","Débito","Mercado Pago","Total"]];
    Object.entries(data.caja || {}).sort().forEach(([fecha, dia]) => {
      if (!dia.apertura) return;
      const ventas = dia.ventas ? Object.values(dia.ventas) : [];
      let totE = 0, totD = 0, totM = 0;
      ventas.forEach(v => {
        if (v.metodo === "efectivo") totE += v.total||0;
        else if (v.metodo === "debito" || v.metodo === "credito") totD += v.total||0;
        else if (v.metodo === "mp") totM += v.total||0;
      });
      hCaja.push([fechaLabel(fecha), dia.apertura.hora||"", dia.cierre?.hora||"—", dia.apertura.turno||"", dia.apertura.fondo||0, ventas.length, totE, totD, totM, totE+totD+totM]);
    });

    exportarExcel([
      { nombre: "Productos",   data: hProductos,   colsMoney: [4, 6] },
      { nombre: "Proveedores", data: hProveedores },
      { nombre: "Ventas",      data: hVentas,       colsMoney: [4, 5, 7] },
      { nombre: "Caja",        data: hCaja,          colsMoney: [4, 6, 7, 8, 9] },
    ], `JPSoft_Tienda_Backup_${todayKey()}.xlsx`);

    // Registrar fecha backup
    const fecha = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    await setDoc(doc(db, "config", "backup"), { ultimoBackup: fecha }, { merge: true });
    ocultarAlertaBackup();

  } catch(err) {
    showToast("Error al exportar: " + err.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Descargar Excel completo"; }
  }
}

// ============================================================
//  RECORDATORIO BACKUP AUTOMÁTICO
// ============================================================
function verificarBackup(ultimoBackupStr) {
  const wrap = document.getElementById("backupAlertWrap");
  const msg  = document.getElementById("backupAlertMsg");
  if (!wrap || !msg) return;

  if (!ultimoBackupStr) {
    wrap.classList.remove("hidden");
    msg.textContent = "Nunca realizaste un backup. Te recomendamos hacerlo ahora para proteger tus datos.";
    return;
  }

  // Parsear fecha guardada (dd/mm/yyyy hh:mm)
  const partes = ultimoBackupStr.split(" ");
  const [dia, mes, anio] = partes[0].split("/").map(Number);
  const ultimaFecha = new Date(anio, mes - 1, dia);
  const hoy = new Date();
  hoy.setHours(0,0,0,0);
  ultimaFecha.setHours(0,0,0,0);
  const diffDias = Math.floor((hoy - ultimaFecha) / (1000 * 60 * 60 * 24));

  if (diffDias >= 1) {
    wrap.classList.remove("hidden");
    msg.textContent = diffDias === 1
      ? `El último backup fue ayer (${ultimoBackupStr}). Te recomendamos hacer uno hoy.`
      : `El último backup fue hace ${diffDias} días (${ultimoBackupStr}). ¡Hacé un backup ahora!`;
  } else {
    ocultarAlertaBackup();
  }
}

function ocultarAlertaBackup() {
  document.getElementById("backupAlertWrap")?.classList.add("hidden");
}

// Escuchar ultimo backup y verificar
onSnapshot(doc(db, "config", "backup"), snap => {
  verificarBackup(snap.exists() ? (snap.data().ultimoBackup || "") : "");
});

// ============================================================
//  HISTORIAL DE PRECIOS
// ============================================================
function renderHistorialPrecios() {
  const provFilt = document.getElementById("histFilterProv")?.value || "";
  const prodFilt = norm(document.getElementById("histFilterProd")?.value || "");
  const tbody    = document.getElementById("histPreciosBody");
  if (!tbody) return;

  // Recolectar todos los cambios de precio
  const cambios = [];
  allProducts.forEach(p => {
    if (provFilt && p.proveedor !== provFilt) return;
    if (prodFilt && !norm(p.desc).includes(prodFilt)) return;
    if (!p.historialPrecios) return;
    Object.values(p.historialPrecios).forEach(h => {
      cambios.push({ ...h, desc: p.desc, proveedor: p.proveedor });
    });
  });

  if (!cambios.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No hay cambios de precio registrados.</td></tr>`;
    return;
  }

  cambios.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora));

  tbody.innerHTML = cambios.map(h => {
    const diff    = h.precioNuevo - h.precioAnterior;
    const diffPct = h.precioAnterior ? Math.round((diff / h.precioAnterior) * 100) : 0;
    const color   = diff > 0 ? "var(--danger)" : diff < 0 ? "var(--success)" : "var(--text3)";
    const signo   = diff > 0 ? "▲" : diff < 0 ? "▼" : "=";
    const [fy, fm, fd] = h.fecha.split("-");
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${parseInt(fd)}/${parseInt(fm)}/${fy}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${h.hora||"—"}</td>
      <td style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${h.desc}">${h.desc}</td>
      <td><span class="badge ${badgeClass(h.proveedor)}">${h.proveedor||"—"}</span></td>
      <td class="num" style="color:var(--text3)">${fmt(h.precioAnterior)}</td>
      <td class="num" style="font-weight:500">${fmt(h.precioNuevo)} <span style="font-size:10px;color:${color}">${signo}${Math.abs(diffPct)}%</span></td>
      <td style="font-size:12px;color:var(--text2)">${h.admin||"—"}</td>
    </tr>`;
  }).join("");
}

document.getElementById("histFilterProv")?.addEventListener("change", renderHistorialPrecios);
document.getElementById("histFilterProd")?.addEventListener("input",  renderHistorialPrecios);

document.getElementById("actFiltroTipo")?.addEventListener("change", renderActividad);
document.getElementById("actFiltroUsuario")?.addEventListener("change", renderActividad);

// ============================================================
//  GASTOS DE CAJA
// ============================================================
let gastoCatActiva = "Retiro";

// Abrir modal
document.getElementById("btnRegistrarGasto")?.addEventListener("click", () => {
  // Verificar que haya un turno abierto
  const cajaHoy = cajaData[todayKey()] || {};
  const turnoAbierto = (cajaHoy.manana?.apertura && !cajaHoy.manana?.cierre) ? "manana"
    : (cajaHoy.tarde?.apertura && !cajaHoy.tarde?.cierre) ? "tarde" : null;
  if (!turnoAbierto) {
    showToast("Debés tener un turno abierto para registrar gastos.", "error");
    return;
  }

  // Resetear estado del modal
  gastoCatActiva = "Retiro";
  document.querySelectorAll(".gasto-chip").forEach(b => {
    b.classList.toggle("active", b.dataset.cat === "Retiro");
  });
  document.getElementById("gastoDescInput").value = "";
  document.getElementById("gastoMontoInput").value = "";
  document.getElementById("modalGasto").classList.remove("hidden");
  setTimeout(() => document.getElementById("gastoMontoInput").focus(), 80);
});

// Chips de categoría
document.getElementById("gastoChips")?.addEventListener("click", e => {
  const chip = e.target.closest(".gasto-chip");
  if (!chip) return;
  gastoCatActiva = chip.dataset.cat;
  document.querySelectorAll(".gasto-chip").forEach(b => {
    b.classList.toggle("active", b.dataset.cat === gastoCatActiva);
  });
});

// Cerrar modal
function cerrarModalGasto() {
  document.getElementById("modalGasto").classList.add("hidden");
}
document.getElementById("closeModalGasto")?.addEventListener("click", cerrarModalGasto);
document.getElementById("btnCancelarGasto")?.addEventListener("click", cerrarModalGasto);

// Confirmar gasto
document.getElementById("btnConfirmarGasto")?.addEventListener("click", async () => {
  const monto = parseFloat(document.getElementById("gastoMontoInput").value);
  if (isNaN(monto) || monto <= 0) {
    showToast("Ingresá un monto válido.", "error");
    document.getElementById("gastoMontoInput").focus();
    return;
  }

  const desc   = document.getElementById("gastoDescInput").value.trim();
  const cat    = gastoCatActiva;
  const etiq   = desc ? `${cat} — ${desc}` : cat;

  // Guardar en caja/{fecha}/gastos/{id}
  const gastoId  = `g_${Date.now()}`;
  const cajaRef  = doc(db, "caja", todayKey());
  setDoc(cajaRef, {
    gastos: {
      [gastoId]: {
        cat,
        desc,
        monto: Math.round(monto),
        hora:  nowHora(),
        admin: getNombreUsuario()
      }
    }
  }, { merge: true });

  registrarLog("caja", `Gasto registrado — ${fmt(monto)} · ${etiq}`);
  showToast(`Gasto registrado ✓ — ${fmt(monto)}`, "success");
  cerrarModalGasto();
});

// Enter confirma el gasto
document.getElementById("modalGasto")?.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    const active = document.activeElement;
    // Evitar activar si está en el input de descripción (puede querer seguir escribiendo)
    if (active?.id === "gastoMontoInput") {
      e.preventDefault();
      document.getElementById("btnConfirmarGasto")?.click();
    }
  }
  if (e.key === "Escape") cerrarModalGasto();
});
