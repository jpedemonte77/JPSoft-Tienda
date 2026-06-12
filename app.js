// ============================================================
//  JPSoft | Tienda — app.js
//  Firestore + Auth (con soporte offline)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, collection, setDoc, addDoc, getDoc, getDocs,
  onSnapshot, deleteDoc, updateDoc, deleteField, query, orderBy, limit,
  writeBatch, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword
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
let soloActivos    = false;
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
  const gan  = gananciaMap[p.proveedor] ?? 0.2;
  const base = p.lista * (1 + gan);
  const iva  = p.iva ? parseFloat(p.iva) / 100 : 0;
  return base * (1 + iva);
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
  const badge     = document.getElementById("stockAlertBadge");
  const btnAlerta = document.getElementById("btnFiltroAlerta");
  const btnLabel  = document.getElementById("btnFiltroAlertaLabel");
  if (!badge) return;
  if (alertas > 0) {
    badge.textContent = alertas;
    badge.classList.remove("hidden");
    if (btnAlerta) {
      btnAlerta.style.color       = "var(--danger)";
      btnAlerta.style.borderColor = "rgba(192,57,26,0.3)";
      btnAlerta.style.background  = soloConAlerta ? "var(--danger-bg)" : "";
    }
    if (btnLabel) btnLabel.textContent = `Con alerta (${alertas})`;
  } else {
    badge.classList.add("hidden");
    if (btnAlerta) {
      btnAlerta.style.color       = "";
      btnAlerta.style.borderColor = "";
      btnAlerta.style.background  = "";
    }
    if (btnLabel) btnLabel.textContent = "Con alerta";
    soloConAlerta = false;
  }
}

function getNombreUsuario() {
  return document.getElementById("user-nombre")?.textContent || "";
}

let rolActual = "administrador"; // default hasta que se cargue de Firestore
let nroVentaActual = 0; // se carga desde Firestore al iniciar

const VISTAS_EMPLEADO = ["inicio","venta","caja","notas","clientes","presupuestos","gastos","compras","productos","combos","proveedores","soporte"];
const VISTAS_ADMIN    = ["inicio","venta","caja","notas","clientes","presupuestos","gastos","compras","productos","combos","proveedores","reportes","historial-precios","actividad","usuarios","soporte","backup"];

function aplicarRol(rol) {
  rolActual = rol || "empleado";
  const esAdmin = rolActual === "administrador";
  const vistasPermitidas = esAdmin ? VISTAS_ADMIN : VISTAS_EMPLEADO;

  // Mostrar/ocultar ítems del sidebar
  document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
    const view = btn.dataset.view;
    btn.style.display = vistasPermitidas.includes(view) ? "" : "none";
  });

  // Si la vista activa no está permitida, ir a Inicio
  const vistaActiva = document.querySelector(".view.active")?.id?.replace("view-","");
  if (vistaActiva && !vistasPermitidas.includes(vistaActiva)) {
    document.querySelector('[data-view="inicio"]')?.click();
  }
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
async function mostrarApp(email, uid = null) {
  // Mostrar la app inmediatamente sin esperar Firestore
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-wrapper").classList.remove("hidden");

  const _raw   = email.split("@")[0];
  const nombre = _raw.charAt(0).toUpperCase() + _raw.slice(1);
  document.getElementById("user-nombre").textContent = nombre;
  document.getElementById("user-avatar").textContent = iniciales(nombre);

  // Inicializar Firebase antes de leer el rol
  initFirebase();

  // Cargar rol desde Firestore (en segundo plano)
  if (uid) {
    try {
      const userDoc = await getDoc(doc(db, "usuarios", uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data.nombre) {
          document.getElementById("user-nombre").textContent = data.nombre;
          document.getElementById("user-avatar").textContent = iniciales(data.nombre);
        }
        aplicarRol(data.rol || "administrador");
      } else {
        // Primer login — crear documento como administrador
        await setDoc(doc(db, "usuarios", uid), {
          nombre, email, rol: "administrador", activo: true, creado: new Date().toISOString()
        });
        aplicarRol("administrador");
      }
    } catch(e) {
      console.warn("No se pudo leer el rol del usuario:", e);
      aplicarRol("administrador");
    }
  } else {
    aplicarRol("administrador");
  }

  // Actualizar vendedor en carrito
  setTimeout(() => {
    const v = document.getElementById("ventaVendedor");
    if (v) v.textContent = document.getElementById("user-nombre")?.textContent || "—";
  }, 600);
}

onAuthStateChanged(auth, user => {
  if (user) {
    mostrarApp(user.email, user.uid);
  } else if (!estaOnline) {
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
    renderInicio();
    renderNotifPanel();
  }));

  // Caja
  _unsubs.push(onSnapshot(collection(db, "caja"), snap => {
    cajaData = {};
    snap.forEach(d => { cajaData[d.id] = d.data(); });
    renderCaja();
    renderGastos();
    updateCajaTopbar();
    updateCajaSidebar();
    renderInicio();
    renderNotifPanel();
  }));

  // Clientes
  initClientesListener();

  // Anulaciones
  _unsubs.push(onSnapshot(collection(db, "anulaciones"), snap => {
    anulacionesData = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    if (histTabActiva === "anulaciones") renderHistorialAnulaciones();
  }));

  // Compras
  initComprasListener();
  initPresupuestosListener();
  initCombosListener();

  // Notas
  initNotasListener();

  // Usuarios
  initUsuariosListener();

  // Notificaciones
  initNotificaciones();

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
const VIEWS = { inicio: "Inicio", venta: "Venta", caja: "Caja", notas: "Notas", clientes: "Clientes", presupuestos: "Presupuestos", gastos: "Gastos", compras: "Compras", productos: "Productos", combos: "Combos", proveedores: "Proveedores", reportes: "Reportes", "historial-precios": "Historial", actividad: "Actividad", usuarios: "Usuarios", soporte: "Soporte", backup: "Backup" };

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
    // Renders específicos por vista
    if (view === "inicio")            renderInicio();
    if (view === "notas")             renderNotas();
    if (view === "usuarios")          renderUsuarios();
    if (view === "historial-precios") { renderHistorialPrecios(); renderHistorialVentas(); }
    if (view === "actividad")         renderActividad();
    if (view === "gastos") {
      const hoy = todayKey();
      gastoFiltroDesde = hoy; gastoFiltroHasta = hoy;
      gastoFilaActiva = -1;
      const inputDesde = document.getElementById("gastosFechaDesde");
      const inputHasta = document.getElementById("gastosFechaHasta");
      if (inputDesde) { inputDesde.value = hoy; inputDesde._initialized = false; }
      if (inputHasta) { inputHasta.value = hoy; inputHasta._initialized = false; }
      renderGastos();
      setTimeout(() => document.getElementById("gastosTableBody")?.focus(), 100);
    }
    if (view === "clientes")          { renderClientesLista(); setTimeout(() => document.getElementById("clientesLista")?.focus(), 100); }
    if (view === "compras") {
      compraFilaActiva = -1;
      renderCompras();
      setTimeout(() => document.getElementById("comprasTableBody")?.focus(), 100);
    }
    if (view === "presupuestos") {
      presupFilaActiva = -1;
      renderPresupuestos();
      setTimeout(() => document.getElementById("presupuestosTableBody")?.focus(), 100);
    }
    if (view === "combos") renderCombosGrid();
    if (view === "proveedores")       { provFilaActiva = -1; renderProveedores(); setTimeout(() => document.getElementById("proveedoresGrid")?.focus(), 100); }
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
    gasto:     { cls: "color:#7a3a00;background:#fef0e0", label: "Gasto" },
    cliente:   { cls: "color:#185FA5;background:#E6F1FB", label: "Cliente" },
    compra:    { cls: "color:#0F6E56;background:#E1F5EE", label: "Compra" },
    usuario:   { cls: "color:#3C3489;background:#EEEDFE", label: "Usuario" },
    backup:    { cls: "color:var(--text2);background:var(--surface2)", label: "Backup" },
  };
  const TIPO_DOT = {
    venta: "#1a7a50", anulacion: "#c0391a", precio: "#185fa5",
    producto: "#92580a", caja: "#7f77dd", gasto: "#c06a00", cliente: "#185FA5", compra: "#0F6E56", backup: "#888"
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
    if (p.activo === false) return false; // excluir inactivos
    if (activeFilter !== "Todos" && p.proveedor !== activeFilter) return false;
    if (!words.length) return true;
    return matchQuery(p.normDesc, words) || matchQuery(p.normCod, words) || matchQuery(p.normId, words);
  });
  page = 1;
  renderProductosVenta();
}

function renderProductosVenta() {
  const raw   = document.getElementById("searchInput").value.trim();
  const words = norm(raw).split(" ").filter(Boolean);

  // Mostrar/ocultar estado vacío
  const estadoVacio   = document.getElementById("ventaEstadoVacio");
  const listaResultados = document.getElementById("ventaListaResultados");

  if (!words.length) {
    if (estadoVacio)   estadoVacio.style.display   = "flex";
    if (listaResultados) listaResultados.style.display = "none";
    // Botón limpiar
    const btnLimpiar = document.getElementById("btnLimpiarBusqueda");
    if (btnLimpiar) btnLimpiar.style.display = "none";
    return;
  }

  if (estadoVacio)   estadoVacio.style.display   = "none";
  if (listaResultados) listaResultados.style.display = "block";
  const btnLimpiar = document.getElementById("btnLimpiarBusqueda");
  if (btnLimpiar) btnLimpiar.style.display = "block";

  const list = filtered.length ? filtered : [];

  if (!list.length) {
    listaResultados.innerHTML = `<div class="empty-row">No se encontraron productos.</div>`;
    prodFiltered = [];
    return;
  }

  prodFiltered = list;
  if (filaSeleccionada >= prodFiltered.length) filaSeleccionada = prodFiltered.length - 1;

  listaResultados.innerHTML = list.map((p, i) => {
    const venta  = Math.round(getPrecioVenta(p));
    const descHL = highlight(p.desc || "", words);
    const sinStock = typeof p.stock === "number" && p.stock <= 0;
    const inCart = !!cart[p._id];
    const idx    = getIdx(p._id);
    return `<div class="venta-result-row${filaSeleccionada === i ? " fila-activa" : ""}${sinStock ? " sin-stock" : ""}"
      data-idx="${idx}" onclick="window._addFromResult(${idx})">
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:500;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${descHL}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${p.proveedor || ""} · ${p.cod || ""}</div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;flex-shrink:0">
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:600;color:var(--text1)">${fmt(venta)}</div>
          <div style="font-size:11px;color:var(--text3)">${fmt(p.lista)}</div>
        </div>
        <div class="venta-add-btn${inCart ? " added" : ""}${sinStock ? " disabled" : ""}">
          ${inCart ? "✓" : "+"}
        </div>
      </div>
    </div>`;
  }).join("");
}

// ── Render carrito lateral (nueva vista Venta) ──
function renderCartLateral() {
  const keys   = Object.keys(cart);
  const total  = keys.reduce((s, k) => {
    const item = cart[k];
    const pv   = item.precioCombo != null ? item.precioCombo : Math.round(getPrecioVenta(item.product));
    return s + pv * item.qty;
  }, 0);
  const totalU = keys.reduce((s, k) => s + (cart[k]?.qty || 0), 0);

  const lista   = document.getElementById("ventaCartLista");
  const vacio   = document.getElementById("ventaCartVacio");
  const count   = document.getElementById("ventaCartCount");
  const totalEl = document.getElementById("ventaCartTotal");
  const btnTotal = document.getElementById("ventaBtnTotal");
  const btnVaciar = document.getElementById("btnVaciarCarrito");
  const btnCobrar = document.getElementById("btnConfirmarVenta");

  if (count)   count.textContent   = totalU > 0 ? `${totalU} ${totalU === 1 ? "ítem" : "ítems"}` : "";
  if (totalEl) totalEl.textContent = fmt(total);
  if (btnTotal) btnTotal.textContent = fmt(total);
  if (btnVaciar) btnVaciar.style.display = keys.length > 0 ? "block" : "none";
  if (btnCobrar) btnCobrar.disabled = keys.length === 0;

  if (!lista) return;

  if (!keys.length) {
    if (vacio) vacio.style.display = "flex";
    lista.innerHTML = "";
    return;
  }

  if (vacio) vacio.style.display = "none";

  lista.innerHTML = keys.map(k => {
    const { product: p, qty } = cart[k];
    const pv  = cart[k].precioCombo != null ? cart[k].precioCombo : Math.round(getPrecioVenta(p));
    const sub = pv * qty;
    const esCombo = cart[k].precioCombo != null;
    return `<div style="padding:10px 14px;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;gap:8px">
        <div style="font-size:13px;font-weight:500;color:var(--text1);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${p.desc || ""}${esCombo ? ` <span style="font-size:10px;padding:1px 6px;border-radius:8px;background:#EEEDFE;color:#3C3489;font-weight:600">COMBO</span>` : ""}
        </div>
        <div style="font-size:13px;font-weight:600;color:var(--text1);flex-shrink:0">${fmt(sub)}</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <button type="button" class="qty-btn" data-action="remove" data-key="${k}" style="width:22px;height:22px;border-radius:4px;font-size:11px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;color:var(--text3)" title="Eliminar">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
        <div style="font-size:11px;color:var(--text3)">${fmt(pv)} c/u</div>
        <div style="display:flex;align-items:center;gap:8px">
          <button type="button" class="qty-btn" data-action="minus" data-key="${k}" style="width:26px;height:26px;border-radius:50%;font-size:16px;line-height:1;padding:0;text-align:center">−</button>
          <span style="font-size:14px;font-weight:500;min-width:16px;text-align:center;color:var(--text1)">${qty}</span>
          <button type="button" class="qty-btn" data-action="plus" data-key="${k}" style="width:26px;height:26px;border-radius:50%;font-size:16px;line-height:1;padding:0;text-align:center">+</button>
        </div>
      </div>
    </div>`;
  }).join("");
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
    // Si hay otro modal abierto encima (ej: nuevo cliente), dejar pasar todo
    const otroModalAbierto = ["modalCliente", "modalGasto", "modalProducto", "modalProveedor"]
      .some(id => !document.getElementById(id)?.classList.contains("hidden"));
    if (otroModalAbierto) return;

    // Ignorar si el foco está en un input del propio modal (ej: descuento)
    const enInputModal = isInput && document.activeElement?.closest("#modalVenta");
    if (!enInputModal) {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("btnConfirmarVentaFinal")?.click();
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

  // ── Ctrl+Delete / Ctrl+Backspace — vaciar carrito ──
  if ((e.key === "Delete" || e.key === "Backspace") && e.ctrlKey && viewVenta) {
    e.preventDefault();
    if (Object.keys(cart).length === 0) return;
    if (!confirm("¿Vaciar el carrito?")) return;
    Object.keys(cart).forEach(k => delete cart[k]);
    renderCart();
    renderCartLateral();
    renderProductosVenta();
    return;
  }

  // Delete/Backspace — solo funcionan nativamente en el buscador (borrar caracteres)

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
        const query = input.value.trim();
        if (!query || !prodFiltered?.length) return; // nada que hacer si buscador vacío o sin resultados
        const idx = filaSeleccionada >= 0 && filaSeleccionada < prodFiltered.length
          ? filaSeleccionada : 0;
        addToCart(prodFiltered[idx]);
        input.blur();
        setTimeout(() => input.focus(), 50);
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

  // Detectar código de barras (texto largo sin espacios = posible código)
  const val = document.getElementById("searchInput").value.trim();
  if (val.length >= 8 && !val.includes(" ")) {
    setTimeout(() => {
      if (filtered.length === 1) {
        addToCart(filtered[0]);
        setScanState("normal");
      } else if (filtered.length === 0) {
        showToast("Producto no encontrado", "error");
      }
    }, 100);
  }
});

function resaltarFila() {
  const filas = document.querySelectorAll(".venta-result-row");
  filas.forEach((r, i) => {
    if (i === filaSeleccionada) {
      r.classList.add("fila-activa");
      r.scrollIntoView({ block: "nearest" });
    } else {
      r.classList.remove("fila-activa");
    }
  });
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
  renderCartLateral();
};

window._removeFromCart = function(key) {
  delete cart[key];
  renderProductosVenta();
  renderCart();
  renderCartLateral();
};

// Agregar desde resultado de búsqueda (nueva vista)
window._addFromResult = function(idx) {
  const key = idxMap[idx]; if (!key) return;
  const p = allProducts.find(x => x._id === key); if (!p) return;
  if (typeof p.stock === "number" && p.stock <= 0) {
    showToast("Sin stock disponible", "error"); return;
  }
  if (cart[p._id]) cart[p._id].qty += 1;
  else cart[p._id] = { product: p, qty: 1 };
  // Beep de confirmación
  playBeep();
  // Limpiar buscador y volver al estado vacío
  const input = document.getElementById("searchInput");
  if (input) { input.value = ""; input.focus(); }
  filtered = [];
  filaSeleccionada = -1;
  renderProductosVenta();
  renderCart();
  renderCartLateral();
};

function addToCart(p) {
  if (!p) return;
  if (cart[p._id]) cart[p._id].qty += 1;
  else cart[p._id] = { product: p, qty: 1 };
  playBeep();
  // En la nueva vista, limpiar buscador
  const input = document.getElementById("searchInput");
  if (input && document.getElementById("ventaEstadoVacio")) {
    input.value = "";
    filtered = [];
    filaSeleccionada = -1;
  }
  renderProductosVenta();
  renderCart();
  renderCartLateral();
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
  renderCartLateral();
}

window._changeQty = function(key, delta) {
  if (!cart[key]) return;
  const newQty = cart[key].qty + delta;
  if (newQty < 0) return;
  cart[key].qty = newQty;
  renderModalVenta();
  renderCart();
  renderCartLateral();
};

// ── Sonido de confirmación ──
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
  } catch(e) {}
}

function calcDescuento(subtotal) {
  if (!descuentoValor || descuentoValor <= 0) return 0;
  if (descuentoTipo === "pct") return Math.round(subtotal * (descuentoValor / 100));
  return Math.min(Math.round(descuentoValor), subtotal);
}

function renderCart() {
  const keys     = Object.keys(cart);
  const subtotal = keys.reduce((s, k) => {
    const pv = cart[k].precioCombo != null ? cart[k].precioCombo : getPrecioVenta(cart[k].product);
    return s + pv * cart[k].qty;
  }, 0);
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

// Delegación de eventos en carrito lateral
document.getElementById("ventaCartLista")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const key    = btn.dataset.key;
  if (action === "plus")   window._changeQty(key, 1);
  if (action === "minus")  window._changeQty(key, -1);
  if (action === "remove") window._removeFromCart(key);
});

// Vaciar carrito
document.getElementById("btnVaciarCarrito")?.addEventListener("click", () => {
  if (!confirm("¿Vaciar el carrito?")) return;
  Object.keys(cart).forEach(k => delete cart[k]);
  renderCart();
  renderCartLateral();
  renderProductosVenta();
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
  renderModalVenta();
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
  // Resetear tipo de registro
  ventaTipoActivo = "";
  document.querySelectorAll(".venta-tipo-chip").forEach(b => b.style.fontWeight = "400");
  // Cerrar panel extras
  const extrasBody    = document.getElementById("ventaExtrasBody");
  const extrasChevron = document.getElementById("ventaExtrasChevron");
  if (extrasBody)    extrasBody.style.display = "none";
  if (extrasChevron) extrasChevron.style.transform = "";

  // Popular selector de cliente
  const sel = document.getElementById("ventaClienteSelect");
  if (sel) {
    sel.innerHTML = '<option value="">Sin cliente…</option>';
    Object.entries(clientesData).sort((a,b) => (a[1].nombre||"").localeCompare(b[1].nombre||"")).forEach(([id, c]) => {
      const opt = document.createElement("option");
      opt.value = id; opt.textContent = c.nombre;
      sel.appendChild(opt);
    });
    sel.value = "";
  }
  // Ocultar cliente seleccionado
  document.getElementById("ventaClienteSelector").style.display       = "flex";
  document.getElementById("ventaClienteSeleccionado").style.display   = "none";

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
  const keys     = Object.keys(cart);
  const subtotal = keys.reduce((s, k) => {
    const pv = cart[k].precioCombo != null ? cart[k].precioCombo : getPrecioVenta(cart[k].product);
    return s + pv * cart[k].qty;
  }, 0);
  const descMonto = calcDescuento(subtotal);
  const total     = subtotal - descMonto;
  const hora      = nowHora();
  const fecha     = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });

  // ── Ítems ──
  const ventaCart = document.getElementById("ventaCartItems");
  if (ventaCart) {
    ventaCart.innerHTML = keys.map((k, i) => {
      const { product: p, qty } = cart[k];
      const pv  = cart[k].precioCombo != null ? cart[k].precioCombo : getPrecioVenta(p);
      const sub = pv * qty;
      const border = i < keys.length - 1 ? "border-bottom:1px solid var(--border);" : "";
      const esCombo = cart[k].precioCombo != null;
      return `<div style="display:flex;align-items:center;padding:8px 12px;${border}gap:8px;font-size:13px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">${p.desc}${esCombo?` <span style="font-size:10px;padding:1px 5px;border-radius:8px;background:#EEEDFE;color:#3C3489;font-weight:600">COMBO</span>`:""}</span>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <button type="button" class="qty-btn" data-action="minus" data-key="${k}" style="width:22px;height:22px">-</button>
          <input type="number" data-action="qty" data-key="${k}" value="${qty}" min="0" style="width:36px;font-size:12px;font-weight:500;text-align:center;border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-family:inherit" />
          <button type="button" class="qty-btn" data-action="plus" data-key="${k}" style="width:22px;height:22px">+</button>
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

// Toggle extras (Cliente / Nota)
document.getElementById("ventaExtrasToggle")?.addEventListener("click", () => {
  const body    = document.getElementById("ventaExtrasBody");
  const chevron = document.getElementById("ventaExtrasChevron");
  const open    = body.style.display === "flex";
  body.style.display    = open ? "none" : "flex";
  chevron.style.transform = open ? "" : "rotate(180deg)";
});

// ── Cliente en Venta ──
document.getElementById("ventaClienteSelect")?.addEventListener("change", e => {
  const id = e.target.value;
  if (!id) {
    document.getElementById("ventaClienteSelector").style.display     = "flex";
    document.getElementById("ventaClienteSeleccionado").style.display = "none";
    ventaTipoActivo = "";
    return;
  }
  const c = clientesData[id];
  if (!c) return;
  const inic = getIniciales(c.nombre || "?");
  document.getElementById("ventaClienteAvatar").textContent = inic;
  document.getElementById("ventaClienteNombre").textContent = c.nombre;
  const saldo = c.saldo || 0;
  document.getElementById("ventaClienteDeuda").textContent  = saldo < 0 ? `Deuda: ${fmt(Math.abs(saldo))}` : "Sin deuda";
  document.getElementById("ventaClienteSelector").style.display     = "none";
  document.getElementById("ventaClienteSeleccionado").style.display = "flex";
  // Resetear tipo
  ventaTipoActivo = "";
  document.querySelectorAll(".venta-tipo-chip").forEach(b => b.style.outline = "");
});

document.getElementById("btnQuitarClienteVenta")?.addEventListener("click", () => {
  const sel = document.getElementById("ventaClienteSelect");
  if (sel) sel.value = "";
  document.getElementById("ventaClienteSelector").style.display     = "flex";
  document.getElementById("ventaClienteSeleccionado").style.display = "none";
  ventaTipoActivo = "";
});

// Nuevo cliente desde el panel de cobro
document.getElementById("btnNuevoClienteVenta")?.addEventListener("click", () => {
  // Abrir modal de cliente — al guardar, el select se actualiza automáticamente
  // via el snapshot de Firestore que repopula el select
  window._abrirClienteDesdeVenta = true;
  abrirModalCliente();
});

// Chips tipo de registro
document.getElementById("ventaClienteBloque")?.addEventListener("click", e => {
  const chip = e.target.closest(".venta-tipo-chip");
  if (!chip) return;
  ventaTipoActivo = chip.dataset.tipo;
  document.querySelectorAll(".venta-tipo-chip").forEach(b => {
    b.style.outline = b.dataset.tipo === ventaTipoActivo ? "2px solid var(--accent)" : "";
  });
});
document.getElementById("btnCancelarVenta").addEventListener("click", () => document.getElementById("modalVenta").classList.add("hidden"));

// Guardar ticket como .txt
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
  const total = keysValidas.reduce((s, k) => {
    const pv = cart[k].precioCombo != null ? cart[k].precioCombo : getPrecioVenta(cart[k].product);
    return s + pv * cart[k].qty;
  }, 0) - (vDesc || 0);
  const keys = keysValidas;

  // 1. Capturar todos los datos ANTES de limpiar el carrito
  const items = keys.map(k => {
    const { product: p, qty } = cart[k];
    const pv = cart[k].precioCombo != null ? cart[k].precioCombo : Math.round(getPrecioVenta(p));
    return {
      desc:      p.desc       || "",
      qty,
      precioUnit: pv,
      subtotal:  Math.round(pv * qty),
      proveedor: p.proveedor  || "",
      esCombo:   p.esCombo    || false
    };
  });

  const stockUpdates = {};
  keys.forEach(k => {
    const { product: p, qty } = cart[k];
    if (p.esCombo && p.itemsCombo) {
      // Descontar stock de cada producto individual del combo
      p.itemsCombo.forEach(item => {
        const prod = allProducts.find(x => x._id === item.prodId);
        if (prod && typeof prod.stock === "number") {
          stockUpdates[prod._id] = Math.max(0, (stockUpdates[prod._id] ?? prod.stock) - (item.qty||1) * qty);
        }
      });
    } else if (typeof p.stock === "number") {
      stockUpdates[p._id] = Math.max(0, (stockUpdates[p._id] ?? p.stock) - qty);
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
    nro: nroVentaActual,
    hora, metodo: metodoSeleccionado,
    total:     Math.round(total),
    subtotal:  Math.round(vSubtotal || total),
    descuento: Math.round(vDesc || 0),
    items, admin: getNombreUsuario(),
    vendedor: getNombreUsuario(),
    clienteId:     document.getElementById("ventaClienteSelect")?.value || null,
    clienteNombre: document.getElementById("ventaClienteNombre")?.textContent || null,
    ventaTipo:     ventaTipoActivo || null,
    ...(_notaVenta && { nota: _notaVenta }),
  };

  // Log de actividad
  const _itemsDesc = items.map(i => i.desc).join(", ");
  registrarLog("venta", `Venta registrada — ${fmt(Math.round(total))} · ${_itemsDesc}`);

  // Vincular cliente según tipo de registro
  if (ventaTipoActivo === "fiado") {
    registrarMovimientoCliente("fiado", Math.round(total), ventaId, _notaVenta || "Venta fiada");
  } else if (ventaTipoActivo === "cobro") {
    registrarMovimientoCliente("pago", Math.round(total), ventaId, _notaVenta || "Cobro");
  }

  // 2. Cerrar modal y limpiar carrito INMEDIATAMENTE
  Object.keys(cart).forEach(k => delete cart[k]);
  descuentoValor = 0;
  const descInput = document.getElementById("descuentoInput");
  if (descInput) descInput.value = "";
  window._ventaPendiente = null;
  document.getElementById("modalVenta").classList.add("hidden");
  renderCart();
  renderCartLateral();
  renderProductosVenta();

  // Guardar datos del ticket para imprimir/guardar
  window._ultimaVenta = {
    nro: nroVentaActual,
    items, total: Math.round(total), subtotal: Math.round(vSubtotal || total),
    descuento: Math.round(vDesc || 0), metodo: metodoSeleccionado,
    hora, fecha: todayKey(), admin: getNombreUsuario()
  };

  // Mostrar modal post-venta
  const metodoLabel = { efectivo: "Efectivo", mp: "Mercado Pago", debito: "Débito", credito: "Crédito" };
  document.getElementById("ventaConfirmadaResumen").textContent =
    `${fmtNroVenta(nroVentaActual)} · ${fmt(Math.round(total))} · ${metodoLabel[metodoSeleccionado] || metodoSeleccionado}`;
  document.getElementById("modalVentaConfirmada").classList.remove("hidden");

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
          <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(v.items||[]).map(i=>i.desc).join(", ")}${v.nota ? `<span style="display:inline-block;margin-left:6px;font-size:10px;font-weight:500;padding:1px 7px;border-radius:10px;background:var(--warn-bg);color:#8a6000;border:1px solid var(--warn-border)">${v.nota}</span>` : ''}${v.clienteNombre ? `<span style="display:inline-block;margin-left:4px;font-size:10px;padding:1px 7px;border-radius:10px;background:#E6F1FB;color:#185FA5">${v.clienteNombre}${v.ventaTipo ? ` · ${v.ventaTipo}` : ""}</span>` : ''}</span>
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

// Botón limpiar buscador
document.getElementById("btnLimpiarBusqueda")?.addEventListener("click", () => {
  const input = document.getElementById("searchInput");
  if (input) { input.value = ""; input.focus(); }
  filtered = [];
  filaSeleccionada = -1;
  renderProductosVenta();
});

// Teclas en nueva vista Venta: Enter agrega primer resultado, flechas navegan
// Chips de nota y toggle eliminados — lógica unificada en ventaClienteBloque

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
  // Guardar en colección anulaciones para historial detallado
  setDoc(doc(collection(db, "anulaciones")), {
    ventaId, fecha, turno,
    total:   venta.total || 0,
    metodo:  venta.metodo || "—",
    items:   venta.items  || [],
    admin:   getNombreUsuario(),
    ts:      new Date().toISOString()
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
  const searchVal  = (document.getElementById("prodSearchInput")?.value || "").trim();
  const provFilt   = document.getElementById("prodFilterProv")?.value  || "";
  const rubroFilt  = document.getElementById("prodFilterRubro")?.value || "";
  const words      = norm(searchVal).split(" ").filter(Boolean);

  prodFiltered = allProducts.filter(p => {
    if (provFilt  && p.proveedor !== provFilt)  return false;
    if (rubroFilt && (p.rubro||"") !== rubroFilt) return false;
    if (soloConAlerta) {
      const s = getStockStatus(p);
      if (s !== "sin-stock" && s !== "bajo") return false;
    }
    if (soloActivos && p.activo === false) return false;
    if (!words.length) return true;
    return matchQuery(p.normDesc, words) || matchQuery(p.normCod, words) || matchQuery(p.normId, words);
  });

  // Actualizar datalist de rubros
  const rubros = [...new Set(allProducts.map(x => x.rubro).filter(Boolean))].sort();
  const dl = document.getElementById("rubrosList");
  if (dl) dl.innerHTML = rubros.map(r => `<option value="${r}">`).join("");
  // Actualizar filtro de rubros
  const rubroSel = document.getElementById("prodFilterRubro");
  if (rubroSel) {
    const cur = rubroSel.value;
    rubroSel.innerHTML = '<option value="">Todos los rubros</option>' +
      rubros.map(r => `<option value="${r}"${r===cur?" selected":""}>${r}</option>`).join("");
  }

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
    const venta       = getPrecioVenta(p);
    const ganPct      = gananciaMap[p.proveedor] != null ? Math.round(gananciaMap[p.proveedor] * 100) : null;
    const stock       = p.stock ?? "—";
    const stockStatus = getStockStatus(p);
    const stockClass  = stockStatus === "sin-stock" ? "badge-danger"
      : stockStatus === "bajo" ? "badge-warn"
      : stockStatus === "ok"   ? "badge-success"
      : "badge-neutral";
    const inactivo    = p.activo === false;
    const rowStyle    = inactivo ? "opacity:0.45" : "";

    const pListaHtml = ganPct != null
      ? `${fmt(p.lista)} <span style="font-size:10px;font-weight:500;color:var(--success);margin-left:4px">+${ganPct}%</span>`
      : fmt(p.lista);

    const ivaTxt = p.iva ? `${p.iva}%` : "—";

    return `<tr data-id="${p._id}" style="${rowStyle}">
      <td style="width:32px;text-align:center"><input type="checkbox" class="prod-check" data-id="${p._id}" style="cursor:pointer;width:14px;height:14px"></td>
      <td style="overflow:hidden"><span class="badge ${badgeClass(p.proveedor)}" style="overflow:hidden;text-overflow:ellipsis;max-width:100%;display:inline-block">${p.proveedor || "—"}</span></td>
      <td class="id-cell" style="text-align:center;font-size:11px">${p.id || "—"}</td>
      <td class="cod-cell" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.cod || "—"}</td>
      <td style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${inactivo ? ";color:var(--text3)" : ""}" title="${p.desc || ""}">${p.desc || "—"}${inactivo ? ' <span style="font-size:10px;color:var(--text3)">(inactivo)</span>' : ""}</td>
      <td style="font-size:12px;color:var(--text2)">${p.rubro || "—"}</td>
      <td class="num" style="font-weight:600">${fmt(venta)}</td>
      <td class="num td-editable" data-field="lista" data-id="${p._id}" data-val="${p.lista || 0}" title="Clic para editar precio de lista">
        <span class="td-val">${pListaHtml}</span>
      </td>
      <td class="num" style="font-size:12px;color:var(--text2)">${ivaTxt}</td>
      <td class="num td-editable" data-field="stock" data-id="${p._id}" data-val="${p.stock ?? ""}" title="Clic para editar stock">
        <span class="td-val"><span class="badge ${stockClass}" style="font-size:10px">${stock}</span></span>
      </td>
      <td class="num" style="font-size:12px;color:var(--text2)">${p.stockMin ?? "—"}</td>
      <td class="num" style="font-size:12px;color:var(--text2)">${p.stockMax ?? "—"}</td>
      <td style="text-align:center">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${inactivo ? 'var(--text3)' : '#22c55e'}"></span>
      </td>
      <td>
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn-secondary" style="font-size:11px;padding:4px 8px;font-weight:600" title="Ver ventas" onclick="window._verVentasProducto('${p._id}','${(p.desc||'').replace(/'/g,'&#39;')}')">V</button>
          <button class="btn-secondary" style="font-size:11px;padding:4px 8px;font-weight:600" title="Ver compras" onclick="window._verComprasProducto('${p._id}','${(p.desc||'').replace(/'/g,'&#39;')}')">C</button>
          <button class="btn-secondary" style="font-size:11px;padding:4px 8px" title="Editar producto" data-edit onclick="window._editarProducto('${p._id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-danger" style="font-size:11px;padding:4px 7px" title="Eliminar producto" onclick="window._eliminarProducto('${p._id}','${(p.desc||'').replace(/'/g,'&#39;')}')">🗑</button>
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
document.getElementById("btnActualizarSeleccionados")?.addEventListener("click", () => {
  const checks = [...document.querySelectorAll(".prod-check:checked")];
  if (!checks.length) return;
  document.getElementById("actSelCount").textContent = checks.length;
  document.getElementById("actSelPct").value = "";
  document.getElementById("actSelPreview").innerHTML = "";
  // Resetear tipo
  document.querySelectorAll(".act-sel-tipo").forEach(b => {
    const active = b.dataset.tipo === "aumento";
    b.style.background   = active ? "var(--accent)" : "var(--surface2)";
    b.style.color        = active ? "#fff" : "var(--text2)";
    b.style.border       = active ? "2px solid var(--accent)" : "1px solid var(--border2)";
  });
  window._actSelTipo = "aumento";
  document.getElementById("modalActualizarSeleccionados").classList.remove("hidden");
});

document.getElementById("modalActualizarSeleccionados")?.addEventListener("click", e => {
  const chip = e.target.closest(".act-sel-tipo");
  if (chip) {
    window._actSelTipo = chip.dataset.tipo;
    document.querySelectorAll(".act-sel-tipo").forEach(b => {
      const active = b.dataset.tipo === window._actSelTipo;
      b.style.background = active ? "var(--accent)" : "var(--surface2)";
      b.style.color      = active ? "#fff" : "var(--text2)";
      b.style.border     = active ? "2px solid var(--accent)" : "1px solid var(--border2)";
    });
    renderActSelPreview();
  }
});

document.getElementById("actSelPct")?.addEventListener("input", renderActSelPreview);

function renderActSelPreview() {
  const pct   = parseFloat(document.getElementById("actSelPct")?.value) || 0;
  const tipo  = window._actSelTipo || "aumento";
  const checks = [...document.querySelectorAll(".prod-check:checked")];
  const preview = document.getElementById("actSelPreview");
  if (!pct || !checks.length) { preview.innerHTML = ""; return; }

  const factor = tipo === "aumento" ? (1 + pct / 100) : (1 - pct / 100);
  const rows = checks.slice(0, 8).map(cb => {
    const p = allProducts.find(x => x._id === cb.dataset.id);
    if (!p) return "";
    const nuevo = Math.round(p.lista * factor);
    return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">${p.desc}</span>
      <span><span style="color:var(--text3)">${fmt(p.lista)}</span> → <strong>${fmt(nuevo)}</strong></span>
    </div>`;
  }).join("");
  const mas = checks.length > 8 ? `<div style="color:var(--text3);padding-top:4px">...y ${checks.length - 8} más</div>` : "";
  preview.innerHTML = rows + mas;
}

async function confirmarActSeleccionados() {
  const pct    = parseFloat(document.getElementById("actSelPct")?.value);
  const tipo   = window._actSelTipo || "aumento";
  const checks = [...document.querySelectorAll(".prod-check:checked")];
  if (!pct || pct <= 0) { showToast("Ingresá un porcentaje válido.", "error"); return; }
  if (!checks.length)   { showToast("No hay productos seleccionados.", "error"); return; }

  const factor = tipo === "aumento" ? (1 + pct / 100) : (1 - pct / 100);
  const btn    = document.getElementById("btnConfirmarActSeleccionados");
  btn.disabled = true; btn.textContent = "Aplicando…";

  try {
    const ahora = todayKey(); const hora = nowHora();
    for (const cb of checks) {
      const p = allProducts.find(x => x._id === cb.dataset.id);
      if (!p) continue;
      const nuevo = Math.round(p.lista * factor);
      const histId = `${ahora}_${hora.replace(":","")}_${p._id.slice(-4)}`;
      await updateDoc(doc(db, "productos", p._id), {
        lista: nuevo,
        [`historialPrecios.${histId}`]: { precioAnterior: p.lista, precioNuevo: nuevo, fecha: ahora, hora, admin: getNombreUsuario() }
      });
    }
    registrarLog("productos", `Precios actualizados — ${checks.length} productos · ${tipo} ${pct}%`);
    showToast(`Precios actualizados ✓ — ${checks.length} productos`, "success");
    document.getElementById("modalActualizarSeleccionados").classList.add("hidden");
    document.querySelectorAll(".prod-check").forEach(cb => cb.checked = false);
    document.getElementById("prodCheckAll").checked = false;
    actualizarBarraSeleccion();
  } catch(e) {
    console.error("Error actualizando precios:", e);
    showToast("Error al actualizar precios: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Aplicar";
  }
}

document.getElementById("btnConfirmarActSeleccionados")?.addEventListener("click", confirmarActSeleccionados);
document.getElementById("closeModalActSeleccionados")?.addEventListener("click",  () => document.getElementById("modalActualizarSeleccionados").classList.add("hidden"));
document.getElementById("closeModalActSeleccionados2")?.addEventListener("click", () => document.getElementById("modalActualizarSeleccionados").classList.add("hidden"));

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
document.getElementById("prodFilterProv")?.addEventListener("change",  () => { prodPage = 1; renderProductosTabla(); });
document.getElementById("prodFilterRubro")?.addEventListener("change", () => { prodPage = 1; renderProductosTabla(); });

document.getElementById("btnSoloActivos")?.addEventListener("click", function() {
  soloActivos = !soloActivos;
  this.style.background   = soloActivos ? "var(--accent)" : "";
  this.style.color        = soloActivos ? "#fff" : "";
  this.style.borderColor  = soloActivos ? "var(--accent)" : "";
  renderProductosTabla();
});

// ── Ver Compras por producto ──
window._verComprasProducto = function(prodId, desc) {
  const p = allProducts.find(x => x._id === prodId);
  document.getElementById("modalComprasProdNombre").textContent = desc;
  document.getElementById("modalComprasProdSub").textContent    = p ? `${p.proveedor||""} · Stock actual: ${p.stock ?? "—"}` : "";

  // Buscar en comprasData
  const compras = comprasData
    .filter(c => (c.items||[]).some(i => i.prodId === prodId || (i.desc||"").toLowerCase() === (desc||"").toLowerCase()))
    .sort((a,b) => (b.ts||"").localeCompare(a.ts||""));

  const totalUnidades = compras.reduce((s, c) => {
    const item = (c.items||[]).find(i => i.prodId === prodId || (i.desc||"").toLowerCase() === (desc||"").toLowerCase());
    return s + (item?.qty || 0);
  }, 0);
  const totalInvertido = compras.reduce((s, c) => {
    const item = (c.items||[]).find(i => i.prodId === prodId || (i.desc||"").toLowerCase() === (desc||"").toLowerCase());
    return s + (item?.subtotal || 0);
  }, 0);

  document.getElementById("cpStatUnidades").textContent = totalUnidades;
  document.getElementById("cpStatTrans").textContent    = compras.length;
  document.getElementById("cpStatTotal").textContent    = fmt(totalInvertido);

  const tbody = document.getElementById("cpTableBody");
  if (!compras.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Sin compras registradas para este producto.</td></tr>`;
  } else {
    tbody.innerHTML = compras.map(c => {
      const item = (c.items||[]).find(i => i.prodId === prodId || (i.desc||"").toLowerCase() === (desc||"").toLowerCase());
      const [fy,fm,fd] = (c.fecha||"").split("-");
      const fechaFmt = c.fecha ? `${parseInt(fd)}/${parseInt(fm)}/${fy}` : "—";
      const hora = c.ts ? new Date(c.ts).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}) : "—";
      return `<tr>
        <td style="font-size:12px;color:var(--text3)">${fechaFmt}</td>
        <td style="font-size:12px;color:var(--text3)">${hora}</td>
        <td><span class="badge ${badgeClass(c.proveedor)}">${c.proveedor||"—"}</span></td>
        <td class="num" style="font-weight:600">${item?.qty||0}</td>
        <td class="num">${fmt(item?.precio||0)}</td>
        <td class="num" style="font-weight:600">${fmt(item?.subtotal||0)}</td>
      </tr>`;
    }).join("");
  }

  document.getElementById("modalComprasProducto").classList.remove("hidden");
};

document.getElementById("closeModalComprasProducto")?.addEventListener("click",  () => document.getElementById("modalComprasProducto").classList.add("hidden"));
document.getElementById("closeModalComprasProducto2")?.addEventListener("click", () => document.getElementById("modalComprasProducto").classList.add("hidden"));
document.getElementById("modalComprasProducto")?.addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden"); });

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

document.getElementById("pf-iva-select")?.addEventListener("change", e => {
  const custom = document.getElementById("pf-iva-custom");
  custom.style.display = e.target.value === "custom" ? "block" : "none";
  if (e.target.value !== "custom") custom.value = "";
});

document.getElementById("historialPreciosToggle")?.addEventListener("click", () => {
  const list    = document.getElementById("historialPreciosList");
  const chevron = document.getElementById("historialPreciosChevron");
  const open    = list.style.display === "block";
  list.style.display        = open ? "none" : "block";
  chevron.style.transform   = open ? "" : "rotate(180deg)";
});

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
  document.getElementById("pf-stockMax").value  = p?.stockMax ?? "";
  document.getElementById("pf-rubro").value     = p?.rubro || "";
  document.getElementById("pf-activo").checked  = p?.activo !== false;
  document.getElementById("pf-obs") && (document.getElementById("pf-obs").value = p?.obs || "");

  // IVA
  const iva = p?.iva ?? 0;
  const ivaSelect = document.getElementById("pf-iva-select");
  const ivaCustom = document.getElementById("pf-iva-custom");
  if ([0, 10.5, 21].includes(iva)) {
    ivaSelect.value = String(iva);
    ivaCustom.style.display = "none";
  } else {
    ivaSelect.value = "custom";
    ivaCustom.value = iva;
    ivaCustom.style.display = "block";
  }

  // Popular datalist de rubros
  const rubros = [...new Set(allProducts.map(x => x.rubro).filter(Boolean))].sort();
  const dl = document.getElementById("rubrosList");
  if (dl) dl.innerHTML = rubros.map(r => `<option value="${r}">`).join("");

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
      </div>`).join("");
    // Cerrado por defecto al abrir
    histList.style.display = "none";
    const chevron = document.getElementById("historialPreciosChevron");
    if (chevron) chevron.style.transform = "";
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
  const stockMax = parseInt(document.getElementById("pf-stockMax").value);
  const activo   = document.getElementById("pf-activo").checked;
  const rubro    = document.getElementById("pf-rubro").value.trim();

  // IVA
  const ivaSelect = document.getElementById("pf-iva-select").value;
  const ivaCustom = document.getElementById("pf-iva-custom").value;
  const iva = ivaSelect === "custom" ? parseFloat(ivaCustom) || 0 : parseFloat(ivaSelect) || 0;

  const data = {
    proveedor: prov,
    id:        document.getElementById("pf-id").value.trim(),
    desc, cod: document.getElementById("pf-cod").value.trim(),
    lista, iva, rubro,
    obs:      document.getElementById("pf-obs")?.value.trim() || "",
    stock:    isNaN(stock)    ? null : stock,
    stockMin: isNaN(stockMin) ? 5    : stockMin,
    stockMax: isNaN(stockMax) ? null : stockMax,
    activo,
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

    // Detectar columna Rubro
    const headerRowData = rows[headerRow] || [];
    const colRubro = headerRowData.findIndex(h => /rubro|familia|categoria|categor/i.test(String(h)));

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
      const rubro   = colRubro >= 0 ? String(rowT[colRubro] || "").trim() : "";
      allProds.push({ proveedor: sheetName, id: pid, cod, desc, lista, stock: null, stockMin: 5, ...(rubro && { rubro }) });
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

let provFilaActiva = -1;

function renderProveedores() {
  const tbody = document.getElementById("proveedoresGrid");
  const empty = document.getElementById("proveedoresEmpty");
  const lista = Object.entries(proveedores).sort((a,b) => a[1].nombre.localeCompare(b[1].nombre));

  if (!lista.length) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = lista.map(([id, p], idx) => {
    const tipo     = p.tipo || "General";
    const cantProd = allProducts.filter(x => x.proveedor === p.nombre).length;
    const highlighted = provFilaActiva === idx;
    const tdBg = highlighted ? "background:var(--bg3)" : "";

    // WhatsApp link
    let waCell = "—";
    if (p.whatsapp) {
      let tel = p.whatsapp.replace(/\D/g, "");
      if (!tel.startsWith("549") && !tel.startsWith("541")) {
        if (tel.startsWith("54")) tel = "549" + tel.slice(2);
        else if (tel.startsWith("0")) tel = "549" + tel.slice(1);
        else if (tel.startsWith("9")) tel = "54" + tel;
        else tel = "549" + tel;
      }
      waCell = `<a href="https://wa.me/${tel}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:4px;color:#0F6E56;text-decoration:none;font-size:12px">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="#1D9E75"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.05 2C6.495 2 2 6.495 2 12.05c0 1.868.497 3.623 1.362 5.14L2 22l4.948-1.337A10.01 10.01 0 0 0 12.05 22C17.605 22 22 17.505 22 11.95 22 6.495 17.605 2 12.05 2zm0 18.385a8.33 8.33 0 0 1-4.239-1.158l-.304-.18-3.143.849.845-3.073-.198-.315A8.324 8.324 0 0 1 3.715 12.05c0-4.598 3.737-8.335 8.335-8.335 4.598 0 8.335 3.737 8.335 8.335 0 4.598-3.737 8.335-8.335 8.335z"/></svg>
        ${p.whatsapp}
      </a>`;
    }

    return `<tr class="prov-row" data-id="${id}" data-idx="${idx}" style="cursor:pointer">
      <td style="font-weight:500;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${tdBg}">${p.nombre||"—"}</td>
      <td style="font-size:12px;${tdBg}"><span style="font-size:11px;padding:2px 7px;border-radius:10px;background:var(--surface2);color:var(--text2)">${tipo}</span></td>
      <td style="font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${tdBg}">${p.email||"—"}</td>
      <td style="font-size:12px;${tdBg}">${waCell}</td>
      <td style="font-size:12px;color:var(--text2);white-space:nowrap;${tdBg}">${p.localidad||"—"}</td>
      <td class="num" style="font-weight:600;${tdBg}">${p.ganancia??0}%</td>
      <td class="num" style="${tdBg}">${cantProd}</td>
      <td style="${tdBg}">
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn-secondary" style="font-size:11px;padding:4px 7px" onclick="event.stopPropagation();window._filtrarPorProv('${p.nombre}')">Productos</button>
          <button class="btn-secondary" style="font-size:11px;padding:4px 7px" onclick="event.stopPropagation();window._editarProveedor('${id}')">Editar</button>
          <button class="btn-danger" style="font-size:11px;padding:4px 6px" onclick="event.stopPropagation();window._eliminarProveedor('${id}','${(p.nombre||'').replace(/'/g,"&#39;")}',${cantProd})">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

// ── Navegación con teclado en proveedores ──
document.getElementById("proveedoresGrid")?.addEventListener("keydown", e => {
  if (["ArrowDown","ArrowUp","Enter","Escape"].indexOf(e.key) === -1) return;
  e.preventDefault();
  e.stopPropagation();
  const lista = Object.entries(proveedores).sort((a,b) => a[1].nombre.localeCompare(b[1].nombre));
  if (!lista.length) return;
  if (e.key === "ArrowDown") {
    provFilaActiva = Math.min(provFilaActiva + 1, lista.length - 1);
  } else if (e.key === "ArrowUp") {
    provFilaActiva = Math.max(provFilaActiva - 1, 0);
  } else if (e.key === "Enter" && provFilaActiva >= 0) {
    window._editarProveedor(lista[provFilaActiva][0]); return;
  } else if (e.key === "Escape") {
    provFilaActiva = -1;
  }
  renderProveedores();
  document.querySelector(`.prov-row[data-idx="${provFilaActiva}"]`)?.scrollIntoView({ block:"nearest" });
  requestAnimationFrame(() => document.getElementById("proveedoresGrid")?.focus());
});

// Click en fila
document.getElementById("proveedoresGrid")?.addEventListener("click", e => {
  const row = e.target.closest(".prov-row");
  if (row) window._editarProveedor(row.dataset.id);
});

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

// Exportar Proveedores
document.getElementById("btnExportarProveedoresExcel")?.addEventListener("click", () => {
  const lista = Object.values(proveedores).sort((a,b) => (a.nombre||"").localeCompare(b.nombre||""));
  if (!lista.length) { showToast("No hay proveedores para exportar.", "warning"); return; }
  const data = [["Nombre","Tipo","Categoría","Margen %","WhatsApp","Email","Dirección","Localidad","CP","Productos"]];
  lista.forEach(p => {
    const cantProd = allProducts.filter(x => x.proveedor === p.nombre).length;
    data.push([p.nombre||"",p.tipo||"General",p.categoria||"",p.ganancia??0,p.whatsapp||"",p.email||"",p.direccion||"",p.localidad||"",p.cp||"",cantProd]);
  });
  exportarExcel([{ nombre:"Proveedores", data, colsMoney:[] }], `JPSoft_Tienda_Proveedores_${todayKey()}.xlsx`);
});

// Imprimir Proveedores PDF
document.getElementById("btnImprimirProveedoresPDF")?.addEventListener("click", async () => {
  const lista = Object.values(proveedores).sort((a,b) => (a.nombre||"").localeCompare(b.nombre||""));
  if (!lista.length) { showToast("No hay proveedores para imprimir.", "warning"); return; }
  const now = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });

  const filas = lista.map(p => {
    const cantProd = allProducts.filter(x => x.proveedor === p.nombre).length;
    return `<tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:5px 8px;font-weight:500">${p.nombre||"—"}</td>
      <td style="padding:5px 8px;font-size:12px">${p.tipo||"General"}</td>
      <td style="padding:5px 8px;font-size:12px;color:#666">${p.categoria||"—"}</td>
      <td style="padding:5px 8px;font-size:12px">${p.whatsapp||"—"}</td>
      <td style="padding:5px 8px;font-size:12px;color:#666">${p.localidad||"—"}</td>
      <td style="padding:5px 8px;text-align:right;font-weight:600">${p.ganancia??0}%</td>
      <td style="padding:5px 8px;text-align:right;font-size:12px">${cantProd}</td>
    </tr>`;
  }).join("");

  const content = `
    <div style="font-family:'DM Sans',sans-serif;font-size:13px;color:#111;padding:2rem;max-width:680px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <div style="font-size:18px;font-weight:600">JPSoft | Tienda</div>
        <div style="font-size:11px;color:#888">Generado el ${now}</div>
      </div>
      <div style="font-size:12px;color:#888;margin-bottom:1.25rem">Proveedores — ${lista.length} registros</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f5f5f5;font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:.05em">
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Nombre</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Tipo</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Categoría</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">WhatsApp</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Localidad</th>
            <th style="padding:6px 8px;text-align:right;font-weight:500;border-bottom:1px solid #eee">Margen%</th>
            <th style="padding:6px 8px;text-align:right;font-weight:500;border-bottom:1px solid #eee">Prods.</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;

  const btn = document.getElementById("btnImprimirProveedoresPDF");
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = "Generando…";
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:720px;background:#fff";
  container.innerHTML = content;
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, { scale:2, useCORS:true, backgroundColor:"#fff" });
    const { jsPDF } = window.jspdf;
    const pdf  = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4" });
    const imgW = 297;
    const imgH = (canvas.height * imgW) / canvas.width;
    const pages = Math.ceil(imgH / 210);
    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, -i*210, imgW, imgH);
    }
    pdf.save(`JPSoft_Tienda_Proveedores_${todayKey()}.pdf`);
    showToast("PDF generado ✓", "success");
  } catch(err) {
    showToast("Error al generar PDF: " + err.message, "error");
  } finally {
    document.body.removeChild(container);
    btn.disabled = false; btn.innerHTML = orig;
  }
});

window._editarProveedor = function(id) { abrirModalProveedor(id); };

document.getElementById("vf-tipo")?.addEventListener("change", function() {
  const tipoCustom = document.getElementById("vf-tipo-custom");
  tipoCustom.style.display = this.value === "custom" ? "block" : "none";
  if (this.value !== "custom") tipoCustom.value = "";
});

function abrirModalProveedor(id) {
  provEditId = id;
  document.getElementById("modalProveedorTitulo").textContent = id ? "Editar proveedor" : "Nuevo proveedor";
  document.getElementById("btnEliminarProveedor").classList.toggle("hidden", !id);
  const p = id ? proveedores[id] : {};

  // Popular datalist de tipos custom (excluir tipos legacy)
  const TIPOS_LEGACY = new Set(["general","tabaco","cigarrillos","Tabaco","Cigarrillo","Cigarrillos"]);
  const tiposDl = document.getElementById("provTipoList");
  const tiposUsados = new Set();
  Object.values(proveedores).forEach(pv => {
    if (pv.tipo && pv.tipo !== "General" && !TIPOS_LEGACY.has(pv.tipo)) tiposUsados.add(pv.tipo);
  });
  if (tiposDl) tiposDl.innerHTML = [...tiposUsados].sort().map(t => `<option value="${t}">`).join("");

  // Popular select de tipos
  const tipoSel    = document.getElementById("vf-tipo");
  const tipoCustom = document.getElementById("vf-tipo-custom");
  // Si el tipo guardado es legacy, tratarlo como General
  const tipoRaw    = p?.tipo || "General";
  const tipoActual = TIPOS_LEGACY.has(tipoRaw) ? "General" : tipoRaw;
  // Reconstruir opciones
  tipoSel.innerHTML = '<option value="General">General</option>';
  [...tiposUsados].sort().forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    tipoSel.appendChild(opt);
  });
  const optCustom = document.createElement("option");
  optCustom.value = "custom"; optCustom.textContent = "+ Nuevo tipo…";
  tipoSel.appendChild(optCustom);
  if (tipoActual === "General" || tiposUsados.has(tipoActual)) {
    tipoSel.value = tipoActual;
    tipoCustom.style.display = "none";
    tipoCustom.value = "";
  } else {
    tipoSel.value = "custom";
    tipoCustom.style.display = "block";
    tipoCustom.value = tipoActual;
  }

  document.getElementById("vf-nombre").value    = p?.nombre    || "";
  document.getElementById("vf-whatsapp").value  = p?.whatsapp  || "";
  document.getElementById("vf-email").value     = p?.email     || "";
  document.getElementById("vf-direccion").value = p?.direccion || "";
  document.getElementById("vf-localidad").value = p?.localidad || "";
  document.getElementById("vf-cp").value        = p?.cp        || "";

  if (id) {
    document.getElementById("vf-ganancia").value = p?.ganancia ?? "";
    document.getElementById("vf-ganancia-hint").textContent = "Margen actual del proveedor";
  } else {
    const margenDefault = margenesConfig["general"] ?? 50;
    document.getElementById("vf-ganancia").value = margenDefault;
    document.getElementById("vf-ganancia-hint").textContent = `Pre-cargado desde márgenes globales (${margenDefault}%)`;
  }
  document.getElementById("modalProveedor").classList.remove("hidden");
  setTimeout(() => document.getElementById("vf-nombre").focus(), 80);
}

function cerrarModalProveedor() {
  provEditId = null;
  document.getElementById("modalProveedor").classList.add("hidden");
}

document.getElementById("btnGuardarProveedor").addEventListener("click", async () => {
  const nombre   = document.getElementById("vf-nombre").value.trim();
  const ganancia = parseFloat(document.getElementById("vf-ganancia").value);
  if (!nombre) { showToast("Ingresá el nombre del proveedor.", "error"); return; }
  if (isNaN(ganancia) || ganancia < 0) { showToast("Ingresá un margen válido (0 o más).", "error"); return; }

  const tipoSel    = document.getElementById("vf-tipo").value;
  const tipoCustom = document.getElementById("vf-tipo-custom").value.trim();
  const tipo = tipoSel === "custom" ? (tipoCustom || "General") : tipoSel;

  const data = {
    nombre, ganancia, tipo,
    tabaco: false,
    whatsapp:  document.getElementById("vf-whatsapp").value.trim(),
    email:     document.getElementById("vf-email").value.trim(),
    direccion: document.getElementById("vf-direccion").value.trim(),
    localidad: document.getElementById("vf-localidad").value.trim(),
    cp:        document.getElementById("vf-cp").value.trim(),
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

  // Comparación con período anterior
  if (periodo !== "custom") renderReporteComparacion(periodo, desde, hasta, tot, ventas.length, totE + totM + totD + totC, tot > 0 ? Math.round(tot / Math.max(ventas.length, 1)) : 0, totE, totM + totD);
  else ocultarReporteComparacion();
}

// ── Comparación de períodos ──
function calcVentasPeriodo(desde, hasta) {
  const keys   = dateRange(desde, hasta);
  let tot = 0, cant = 0, totE = 0, totDigital = 0, gastos = 0;
  keys.forEach(k => {
    const dia = cajaData[k]; if (!dia) return;
    ["manana","tarde"].forEach(turno => {
      Object.values(dia[turno]?.ventas || {}).forEach(v => {
        tot += v.total || 0; cant++;
        if (v.metodo === "efectivo") totE += v.total || 0;
        else totDigital += v.total || 0;
      });
    });
    Object.values(dia.gastos || {}).forEach(g => { gastos += g.monto || 0; });
  });
  return { tot, cant, totE, totDigital, gastos, promedio: cant > 0 ? Math.round(tot / cant) : 0 };
}

function getPeriodAnterior(periodo) {
  const hoy  = new Date();
  if (periodo === "hoy") {
    const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
    const k = ayer.toISOString().slice(0,10);
    return { desde: k, hasta: k, label: "Ayer" };
  }
  if (periodo === "semana") {
    const lun = new Date(hoy); lun.setDate(hoy.getDate() - hoy.getDay() + 1 - 7);
    const dom = new Date(lun); dom.setDate(lun.getDate() + 6);
    return { desde: lun.toISOString().slice(0,10), hasta: dom.toISOString().slice(0,10), label: "Semana anterior" };
  }
  if (periodo === "mes") {
    const primerMesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const ultiMesAnt   = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    return { desde: primerMesAnt.toISOString().slice(0,10), hasta: ultiMesAnt.toISOString().slice(0,10), label: meses[primerMesAnt.getMonth()] };
  }
  if (periodo === "anio") {
    const anioAnt = hoy.getFullYear() - 1;
    return { desde: `${anioAnt}-01-01`, hasta: `${anioAnt}-12-31`, label: `${anioAnt}` };
  }
  return null;
}

function labelPeriodo(periodo) {
  if (periodo === "hoy")   return "Hoy";
  if (periodo === "semana") return "Esta semana";
  if (periodo === "mes") {
    const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    return meses[new Date().getMonth()];
  }
  if (periodo === "anio") return String(new Date().getFullYear());
  return periodo;
}

function varBadge(actual, anterior) {
  if (!anterior) return "";
  const diff = Math.round(((actual - anterior) / anterior) * 100);
  const sube = diff >= 0;
  const color = sube ? { bg: "#EAF3DE", text: "#3B6D11" } : { bg: "#FCEBEB", text: "#A32D2D" };
  const arrow = sube
    ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>`
    : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
  return `<div style="display:flex;align-items:center;gap:3px;padding:2px 7px;border-radius:10px;background:${color.bg};color:${color.text};font-size:12px;font-weight:500">
    ${arrow}${sube ? "+" : ""}${diff}%
  </div>`;
}

function renderReporteComparacion(periodo, desde, hasta, tot, cant, _tot, promedio, totE, totDigital) {
  const ant = getPeriodAnterior(periodo);
  if (!ant) { ocultarReporteComparacion(); return; }

  const a = calcVentasPeriodo(ant.desde, ant.hasta);
  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const hoy   = new Date();

  // Recalcular gastos período actual
  let gastosAct = 0;
  dateRange(desde, hasta).forEach(k => {
    Object.values(cajaData[k]?.gastos || {}).forEach(g => { gastosAct += g.monto || 0; });
  });

  const metricas = [
    { label: "Ventas totales",       actual: tot,        anterior: a.tot,        fmt: v => fmt(v), danger: false },
    { label: "Transacciones",        actual: cant,       anterior: a.cant,       fmt: v => String(v), danger: false },
    { label: "Gastos",               actual: gastosAct,  anterior: a.gastos,     fmt: v => fmt(v), danger: true },
    { label: "Ticket promedio",      actual: promedio,   anterior: a.promedio,   fmt: v => fmt(v), danger: false },
    { label: "Efectivo",             actual: totE,       anterior: a.totE,       fmt: v => fmt(v), danger: false },
    { label: "Digital (MP + débito)",actual: totDigital, anterior: a.totDigital, fmt: v => fmt(v), danger: false },
  ];

  const grid  = document.getElementById("reporteComparacionGrid");
  const banda = document.getElementById("reporteComparacionBanda");
  const p1    = document.getElementById("reporteComparacionP1");
  const p2    = document.getElementById("reporteComparacionP2");

  if (p1) p1.textContent = labelPeriodo(periodo);
  if (p2) p2.textContent = ant.label;
  if (banda) { banda.style.display = "flex"; }

  grid.style.display = "grid";
  grid.innerHTML = metricas.map(m => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px">
      <div style="font-size:12px;color:var(--text3);margin-bottom:6px">${m.label}</div>
      <div style="font-size:24px;font-weight:500;color:${m.danger && m.actual > 0 ? "var(--danger)" : "var(--text1)"};margin-bottom:6px">${m.fmt(m.actual)}</div>
      <div style="display:flex;align-items:center;gap:6px">
        ${varBadge(m.actual, m.anterior)}
        <span style="font-size:11px;color:var(--text3)">vs ${m.fmt(m.anterior)}</span>
      </div>
    </div>`).join("");
}

function ocultarReporteComparacion() {
  const grid  = document.getElementById("reporteComparacionGrid");
  const banda = document.getElementById("reporteComparacionBanda");
  if (grid)  grid.style.display  = "none";
  if (banda) banda.style.display = "none";
}
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

document.getElementById("btnExportarListaExcel")?.addEventListener("click", () => {
  if (!allProducts.length) { showToast("No hay productos cargados.", "warning"); return; }

  const porProv = {};
  allProducts
    .sort((a, b) => (a.desc || "").localeCompare(b.desc || ""))
    .forEach(p => {
      const prov = p.proveedor || "Sin proveedor";
      if (!porProv[prov]) porProv[prov] = [];
      porProv[prov].push(p);
    });

  const hojas = Object.entries(porProv)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prov, prods]) => {
      const data = [["ID", "CODIGO", "PRODUCTO", "P. LISTA", "P. VENTA", "STOCK"]];
      prods.forEach((p, i) => {
        data.push([
          String(i + 1).padStart(3, "0"),
          p.cod || "",
          p.desc || "",
          p.lista || 0,
          Math.round(getPrecioVenta(p)),
          p.stock ?? ""
        ]);
      });
      const nombre = prov.replace(/[:\\\/?*\[\]]/g, "").substring(0, 31);
      return { nombre, data, colsMoney: [3, 4] };
    });

  exportarExcel(hojas, `JPSoft_Tienda_Productos_${todayKey()}.xlsx`);
});

document.getElementById("btnImprimirListaPrecios")?.addEventListener("click", () => {
  if (!allProducts.length) { showToast("No hay productos cargados.", "warning"); return; }

  const provFilt  = document.getElementById("prodFilterProv")?.value  || "";
  const rubroFilt = document.getElementById("prodFilterRubro")?.value || "";

  const fuente = allProducts
    .filter(p => {
      if (provFilt  && p.proveedor !== provFilt)  return false;
      if (rubroFilt && (p.rubro || "") !== rubroFilt) return false;
      return true;
    })
    .sort((a, b) => (a.desc || "").localeCompare(b.desc || ""));

  const porProv = {};
  fuente.forEach(p => {
    const prov = p.proveedor || "Sin proveedor";
    if (!porProv[prov]) porProv[prov] = [];
    porProv[prov].push(p);
  });

  const now = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });

  const seccionesHtml = Object.entries(porProv)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prov, prods]) => {
      const filas = prods.map(p => {
        const venta = Math.round(getPrecioVenta(p));
        return `<tr>
          <td class="cod" style="width:45px">${p.id || "—"}</td>
          <td class="cod" style="width:110px">${p.cod || "—"}</td>
          <td>${p.desc || "—"}</td>
          <td style="width:90px">${p.rubro || "—"}</td>
          <td class="num" style="width:75px">${fmt(p.lista || 0)}</td>
          <td class="venta" style="width:75px">${fmt(venta)}</td>
        </tr>`;
      }).join("");

      return `<div class="p-section">
        <div class="p-section-header">${prov} &nbsp;(${prods.length} productos)</div>
        <table>
          <thead>
            <tr>
              <th style="width:45px">ID</th>
              <th style="width:110px">Código</th>
              <th>Producto</th>
              <th style="width:90px">Rubro</th>
              <th class="num" style="width:75px">P. Lista</th>
              <th class="num" style="width:75px">P. Venta</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
    }).join("");

  const printArea = document.getElementById("printArea");
  printArea.innerHTML = `
    <div class="p-brand">JPSoft | Tienda</div>
    <div class="p-sub">Lista de precios — ${now} &nbsp;·&nbsp; ${fuente.length} productos${provFilt ? ` &nbsp;·&nbsp; ${provFilt}` : ""}${rubroFilt ? ` &nbsp;·&nbsp; ${rubroFilt}` : ""}</div>
    ${seccionesHtml}
    <div class="p-footer">JPSoft | Tienda &nbsp;·&nbsp; ${now}</div>`;

  setTimeout(() => {
    window.print();
    setTimeout(() => { printArea.innerHTML = ""; }, 500);
  }, 150);
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

document.getElementById("histFilterProv")?.addEventListener("change", () => { renderHistorialPrecios(); renderHistorialVentas(); });
document.getElementById("histFilterProd")?.addEventListener("input",  () => { renderHistorialPrecios(); renderHistorialVentas(); });

// ── Pestañas del Historial ──
let histTabActiva   = "ventas";
let histPeriodoActivo = "7";

function switchHistTab(tab) {
  histTabActiva = tab;
  ["precios","ventas","gastos","anulaciones","descuentos","compras"].forEach(t => {
    document.getElementById(`histTab${t.charAt(0).toUpperCase()+t.slice(1)}`)?.classList.toggle("active", t === tab);
    document.getElementById(`histPanel${t.charAt(0).toUpperCase()+t.slice(1)}`).style.display = t === tab ? "block" : "none";
  });
  const pw = document.getElementById("histVentasPeriodoWrap");
  if (pw) pw.style.display = ["ventas","gastos","anulaciones","descuentos","compras"].includes(tab) ? "flex" : "none";
  if (tab === "ventas")      renderHistorialVentas();
  if (tab === "gastos")      renderHistorialGastos();
  if (tab === "anulaciones") renderHistorialAnulaciones();
  if (tab === "descuentos") {
    if (histPeriodoActivo === "7") {
      histPeriodoActivo = "mes";
      document.querySelectorAll(".hist-periodo").forEach(b => b.classList.toggle("active", b.dataset.periodo === "mes"));
    }
    renderHistorialDescuentos();
  }
  if (tab === "compras") renderHistorialCompras();
}

document.getElementById("histTabPrecios")?.addEventListener("click",     () => switchHistTab("precios"));
document.getElementById("histTabVentas")?.addEventListener("click",      () => switchHistTab("ventas"));
document.getElementById("histTabGastos")?.addEventListener("click",      () => switchHistTab("gastos"));
document.getElementById("histTabAnulaciones")?.addEventListener("click", () => switchHistTab("anulaciones"));
document.getElementById("histTabDescuentos")?.addEventListener("click",  () => switchHistTab("descuentos"));
document.getElementById("histTabCompras")?.addEventListener("click",     () => switchHistTab("compras"));

document.querySelectorAll(".hist-periodo").forEach(btn => {
  btn.addEventListener("click", () => {
    histPeriodoActivo = btn.dataset.periodo;
    document.querySelectorAll(".hist-periodo").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    if (histTabActiva === "ventas")      renderHistorialVentas();
    if (histTabActiva === "gastos")      renderHistorialGastos();
    if (histTabActiva === "anulaciones") renderHistorialAnulaciones();
    if (histTabActiva === "descuentos")  renderHistorialDescuentos();
    if (histTabActiva === "compras")     renderHistorialCompras();
  });
});

// ── Render historial de ventas ──
function renderHistorialVentas() {
  const tbody    = document.getElementById("histVentasBody");
  if (!tbody) return;
  const provFilt = document.getElementById("histFilterProv")?.value || "";
  const prodFilt = norm(document.getElementById("histFilterProd")?.value || "");

  // Calcular rango de fechas según período
  const hoy  = new Date();
  let desde;
  if (histPeriodoActivo === "7") {
    desde = new Date(hoy); desde.setDate(hoy.getDate() - 6);
  } else if (histPeriodoActivo === "30") {
    desde = new Date(hoy); desde.setDate(hoy.getDate() - 29);
  } else if (histPeriodoActivo === "mes") {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  } else {
    desde = new Date(hoy.getFullYear(), 0, 1);
  }
  const desdeKey = desde.toISOString().slice(0, 10);
  const hoyKey   = hoy.toISOString().slice(0, 10);

  // Acumular ventas por producto desde cajaData
  const porProducto = {};

  Object.entries(cajaData).forEach(([fecha, diaData]) => {
    if (fecha < desdeKey || fecha > hoyKey) return;
    ["manana", "tarde"].forEach(turno => {
      const ventas = diaData[turno]?.ventas || {};
      Object.values(ventas).forEach(v => {
        if (!v.items) return;
        v.items.forEach(item => {
          if (provFilt && item.proveedor !== provFilt) return;
          if (prodFilt && !norm(item.desc || "").includes(prodFilt)) return;
          const key = item.desc || "Sin nombre";
          if (!porProducto[key]) {
            porProducto[key] = {
              desc: item.desc || "—",
              proveedor: item.proveedor || "—",
              unidades: 0,
              total: 0,
              precioVenta: item.precioUnit || 0,
              ultimaVenta: ""
            };
          }
          porProducto[key].unidades += item.qty || 1;
          porProducto[key].total    += (item.subtotal || (item.precioUnit || 0) * (item.qty || 1));
          const ts = `${fecha} ${v.hora || "00:00"}`;
          if (ts > porProducto[key].ultimaVenta) {
            porProducto[key].ultimaVenta = ts;
            porProducto[key].precioVenta = item.precioUnit || 0;
          }
        });
      });
    });
  });

  const lista = Object.values(porProducto).sort((a, b) => b.unidades - a.unidades);

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No hay ventas en el período seleccionado.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(p => {
    const [fechaStr, horaStr] = p.ultimaVenta.split(" ");
    const [fy, fm, fd] = (fechaStr || "").split("-");
    const fechaFmt = fechaStr ? `${parseInt(fd)}/${parseInt(fm)} ${horaStr || ""}` : "—";
    return `<tr>
      <td style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.desc}">${p.desc}</td>
      <td><span class="badge ${badgeClass(p.proveedor)}">${p.proveedor}</span></td>
      <td class="num" style="font-weight:600">${p.unidades}</td>
      <td class="num" style="font-weight:500">${fmt(Math.round(p.total))}</td>
      <td class="num" style="color:var(--text2)">${fmt(Math.round(p.precioVenta))}</td>
      <td style="font-size:12px;color:var(--text2);font-family:'DM Mono',monospace">${fechaFmt}</td>
    </tr>`;
  }).join("");
}

// ── Render historial de gastos ──
function renderHistorialGastos() {
  const tbody = document.getElementById("histGastosBody");
  if (!tbody) return;

  // Calcular rango según período activo
  const hoy = new Date();
  let desde;
  if (histPeriodoActivo === "7")        { desde = new Date(hoy); desde.setDate(hoy.getDate() - 6); }
  else if (histPeriodoActivo === "30")  { desde = new Date(hoy); desde.setDate(hoy.getDate() - 29); }
  else if (histPeriodoActivo === "mes") { desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); }
  else                                  { desde = new Date(hoy.getFullYear(), 0, 1); }
  const desdeKey = desde.toISOString().slice(0, 10);
  const hoyKey   = hoy.toISOString().slice(0, 10);

  // Recolectar gastos de cajaData
  const gastos = [];
  Object.entries(cajaData).forEach(([fecha, diaData]) => {
    if (fecha < desdeKey || fecha > hoyKey) return;
    const gs = diaData.gastos || {};
    Object.values(gs).forEach(g => {
      gastos.push({ ...g, fecha });
    });
  });

  if (!gastos.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No hay gastos en el período seleccionado.</td></tr>`;
    return;
  }

  // Ordenar por fecha y hora descendente
  gastos.sort((a, b) => {
    const fa = `${a.fecha} ${a.hora || ""}`;
    const fb = `${b.fecha} ${b.hora || ""}`;
    return fb.localeCompare(fa);
  });

  const CAT_STYLE = {
    "Pago de impuesto": "color:#3C3489;background:#EEEDFE",
    "Pago de servicio": "color:#0C447C;background:#E6F1FB",
    "Insumo":           "color:#27500A;background:#EAF3DE",
    "Retiro":           "color:#7a3a00;background:#fef0e0",
    "Otro":             "color:var(--text2);background:var(--surface2)",
    "Pago proveedor":   "color:#0C447C;background:#E6F1FB",
    "Insumos":          "color:#27500A;background:#EAF3DE",
  };

  tbody.innerHTML = gastos.map(g => {
    const [fy, fm, fd] = (g.fecha || "").split("-");
    const fechaFmt = g.fecha ? `${parseInt(fd)}/${parseInt(fm)}/${fy}` : "—";
    const catStyle = CAT_STYLE[g.cat] || CAT_STYLE["Otro"];
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fechaFmt}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${g.hora || "—"}</td>
      <td><span style="font-size:11px;font-weight:500;padding:2px 8px;border-radius:10px;${catStyle}">${g.cat || "—"}</span></td>
      <td style="font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${g.desc || "—"}</td>
      <td class="num" style="font-weight:600">${fmt(g.monto || 0)}</td>
      <td style="font-size:12px;color:var(--text2)">${g.admin || "—"}</td>
    </tr>`;
  }).join("");
}

// ── Render historial de anulaciones ──
let anulacionesData = [];

function renderHistorialAnulaciones() {
  const tbody = document.getElementById("histAnulacionesBody");
  if (!tbody) return;

  const hoy = new Date();
  let desde;
  if (histPeriodoActivo === "7")        { desde = new Date(hoy); desde.setDate(hoy.getDate() - 6); }
  else if (histPeriodoActivo === "30")  { desde = new Date(hoy); desde.setDate(hoy.getDate() - 29); }
  else if (histPeriodoActivo === "mes") { desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); }
  else                                  { desde = new Date(hoy.getFullYear(), 0, 1); }
  const desdeKey = desde.toISOString().slice(0, 10);
  const hoyKey   = hoy.toISOString().slice(0, 10);

  // Combinar anulaciones de Firestore + logs antiguos
  const deFirestore = anulacionesData.filter(a => a.fecha >= desdeKey && a.fecha <= hoyKey);

  // Anulaciones antiguas solo de logs (las que no tienen entrada en anulacionesData)
  const ventaIdsNuevos = new Set(anulacionesData.map(a => a.ventaId));
  const deLogs = logsData
    .filter(l => l.tipo === "anulacion" && l.fecha >= desdeKey && l.fecha <= hoyKey)
    .filter(l => !ventaIdsNuevos.has(l.ventaId))
    .map(l => ({
      fecha:  l.fecha || l.ts?.slice(0,10) || "—",
      hora:   l.ts ? new Date(l.ts).toLocaleTimeString("es-AR", {hour:"2-digit",minute:"2-digit"}) : "—",
      total:  null,
      metodo: "—",
      items:  [],
      desc:   l.desc || "—",
      admin:  l.usuario || "—",
      deLogs: true
    }));

  const lista = [...deFirestore, ...deLogs].sort((a, b) => {
    const fa = a.ts || `${a.fecha}T${a.hora || "00:00"}`;
    const fb = b.ts || `${b.fecha}T${b.hora || "00:00"}`;
    return fb.localeCompare(fa);
  });

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No hay anulaciones en el período seleccionado.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(a => {
    const [fy, fm, fd] = (a.fecha || "").split("-");
    const fechaFmt = a.fecha ? `${parseInt(fd)}/${parseInt(fm)}/${fy}` : "—";
    const hora     = a.hora || (a.ts ? new Date(a.ts).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}) : "—");
    const productos = a.deLogs
      ? (a.desc || "—").replace("Venta anulada — ", "").replace(/^\$[\d.,]+ · /, "")
      : (a.items||[]).map(i => `${i.desc}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ") || "—";
    const total = a.total != null ? fmt(a.total) : "—";
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fechaFmt}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${hora}</td>
      <td style="font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${productos}">${productos}</td>
      <td class="num" style="font-weight:600;color:var(--danger)">${total}</td>
      <td style="font-size:12px;color:var(--text2)">${a.metodo || "—"}</td>
      <td style="font-size:12px;color:var(--text2)">${a.admin || "—"}</td>
    </tr>`;
  }).join("");
}

// ── Render historial de descuentos ──
function renderHistorialDescuentos() {
  const tbody = document.getElementById("histDescuentosBody");
  if (!tbody) return;

  const hoy = new Date();
  let desde;
  if (histPeriodoActivo === "7")        { desde = new Date(hoy); desde.setDate(hoy.getDate() - 6); }
  else if (histPeriodoActivo === "30")  { desde = new Date(hoy); desde.setDate(hoy.getDate() - 29); }
  else if (histPeriodoActivo === "mes") { desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); }
  else                                  { desde = new Date(hoy.getFullYear(), 0, 1); }
  const desdeKey = desde.toISOString().slice(0, 10);
  const hoyKey   = hoy.toISOString().slice(0, 10);

  // Recolectar ventas con descuento > 0 desde cajaData
  const lista = [];
  Object.entries(cajaData).forEach(([fecha, diaData]) => {
    if (fecha < desdeKey || fecha > hoyKey) return;
    ["manana", "tarde"].forEach(turno => {
      const ventas = diaData[turno]?.ventas || {};
      Object.values(ventas).forEach(v => {
        const desc = parseFloat(v.descuento) || 0;
        if (desc <= 0) return;
        lista.push({ ...v, descuento: desc, fecha });
      });
    });
  });

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No hay ventas con descuento en el período seleccionado.</td></tr>`;
    return;
  }

  lista.sort((a, b) => {
    const fa = `${a.fecha} ${a.hora || ""}`;
    const fb = `${b.fecha} ${b.hora || ""}`;
    return fb.localeCompare(fa);
  });

  tbody.innerHTML = lista.map(v => {
    const [fy, fm, fd] = (v.fecha || "").split("-");
    const fechaFmt  = v.fecha ? `${parseInt(fd)}/${parseInt(fm)}/${fy}` : "—";
    const productos = (v.items || []).map(i => `${i.desc}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ") || "—";
    const pct       = v.subtotal ? Math.round((v.descuento / v.subtotal) * 100) : 0;
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fechaFmt}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${v.hora || "—"}</td>
      <td style="font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${productos}">${productos}</td>
      <td class="num" style="color:var(--text3)">${fmt(v.subtotal || 0)}</td>
      <td class="num" style="color:var(--danger);font-weight:600">-${fmt(v.descuento)} <span style="font-size:10px">(${pct}%)</span></td>
      <td class="num" style="font-weight:600">${fmt(v.total || 0)}</td>
      <td style="font-size:12px;color:var(--text2)">${v.admin || "—"}</td>
    </tr>`;
  }).join("");
}

// ============================================================
//  DASHBOARD — INICIO
// ============================================================
function renderInicio() {
  const hoy     = todayKey();
  const diaData = cajaData[hoy] || {};

  // ── Stats ventas del día ──
  let totalVentas = 0, cantVentas = 0;
  const ultimasVentas = [];
  ["manana", "tarde"].forEach(turno => {
    const ventas = diaData[turno]?.ventas || {};
    Object.values(ventas).forEach(v => {
      totalVentas += v.total || 0;
      cantVentas++;
      ultimasVentas.push({ ...v, turno });
    });
  });

  const elV  = document.getElementById("inicioStatVentas");
  const elVS = document.getElementById("inicioStatVentasSub");
  if (elV)  elV.textContent  = fmt(Math.round(totalVentas));
  if (elVS) elVS.textContent = `${cantVentas} ${cantVentas === 1 ? "transacción" : "transacciones"}`;

  // ── Stats caja ──
  const turnoAbierto = (diaData.manana?.apertura && !diaData.manana?.cierre) ? "manana"
    : (diaData.tarde?.apertura && !diaData.tarde?.cierre) ? "tarde" : null;
  const elC  = document.getElementById("inicioStatCaja");
  const elCS = document.getElementById("inicioStatCajaSub");
  if (elC)  elC.textContent  = fmt(Math.round(totalVentas));
  if (elCS) elCS.textContent = turnoAbierto
    ? `Turno ${turnoAbierto === "manana" ? "mañana" : "tarde"} · Abierto`
    : "Sin turno abierto";

  // ── Stats gastos del día ──
  const gastos    = Object.values(diaData.gastos || {});
  const totalGastos = gastos.reduce((s, g) => s + (g.monto || 0), 0);
  const elG  = document.getElementById("inicioStatGastos");
  const elGS = document.getElementById("inicioStatGastosSub");
  if (elG)  elG.textContent  = fmt(Math.round(totalGastos));
  if (elGS) elGS.textContent = `${gastos.length} ${gastos.length === 1 ? "registro" : "registros"}`;

  // ── Stats fiado ──
  const clientesConDeuda = Object.values(clientesData).filter(c => (c.saldo || 0) < 0);
  const totalFiado = clientesConDeuda.reduce((s, c) => s + Math.abs(c.saldo || 0), 0);
  const elF  = document.getElementById("inicioStatFiado");
  const elFS = document.getElementById("inicioStatFiadoSub");
  if (elF)  elF.textContent  = fmt(Math.round(totalFiado));
  if (elFS) elFS.textContent = `${clientesConDeuda.length} ${clientesConDeuda.length === 1 ? "cliente" : "clientes"}`;

  // ── Últimas ventas ──
  const wrapVentas = document.getElementById("inicioUltimasVentas");
  if (wrapVentas) {
    const recientes = ultimasVentas
      .sort((a, b) => (b.hora || "").localeCompare(a.hora || ""))
      .slice(0, 5);
    if (!recientes.length) {
      wrapVentas.innerHTML = '<div class="empty-row">Sin ventas registradas hoy.</div>';
    } else {
      wrapVentas.innerHTML = recientes.map((v, i) => {
        const prods  = (v.items || []).map(i => `${i.desc}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ") || "—";
        const metodo = { efectivo: "Efectivo", mp: "Mercado Pago", debito: "Débito", credito: "Crédito" }[v.metodo] || v.metodo || "—";
        const isLast = i === recientes.length - 1;
        const nroTxt = v.nro ? `${fmtNroVenta(v.nro)} · ` : "";
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border-bottom:${isLast ? "none" : "1px solid var(--border)"}">
          <div style="min-width:0;flex:1;padding-right:10px">
            <div style="font-size:13px;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${prods}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:1px">${nroTxt}${v.hora || "—"} · ${metodo}</div>
          </div>
          <div style="font-size:13px;font-weight:600;color:var(--text1);flex-shrink:0">${fmt(v.total || 0)}</div>
        </div>`;
      }).join("");
    }
  }

  // ── Stock crítico ──
  const wrapStock = document.getElementById("inicioStockCritico");
  const badgeStock = document.getElementById("inicioStockBadge");
  if (wrapStock) {
    const criticos = allProducts
      .filter(p => typeof p.stock === "number" && p.stock <= (p.stockMin || 5))
      .sort((a, b) => (a.stock || 0) - (b.stock || 0))
      .slice(0, 5);

    if (badgeStock) {
      if (criticos.length) { badgeStock.textContent = `${criticos.length} productos`; badgeStock.style.display = "inline"; }
      else badgeStock.style.display = "none";
    }

    if (!criticos.length) {
      wrapStock.innerHTML = '<div class="empty-row">Sin productos en stock crítico.</div>';
    } else {
      wrapStock.innerHTML = criticos.map((p, i) => {
        const isLast  = i === criticos.length - 1;
        const color   = p.stock <= 0 ? "#A32D2D" : "#854F0B";
        const bg      = p.stock <= 0 ? "#FCEBEB" : "#FAEEDA";
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:${isLast ? "none" : "1px solid var(--border)"}">
          <div style="font-size:13px;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;padding-right:10px">${p.desc}</div>
          <span style="font-size:11px;font-weight:500;padding:2px 8px;border-radius:10px;background:${bg};color:${color};flex-shrink:0">${p.stock} unid.</span>
        </div>`;
      }).join("");
    }
  }

  // ── Clientes con deuda ──
  const wrapClientes = document.getElementById("inicioClientesDeuda");
  if (wrapClientes) {
    const conDeuda = Object.entries(clientesData)
      .filter(([, c]) => (c.saldo || 0) < 0)
      .sort((a, b) => (a[1].saldo || 0) - (b[1].saldo || 0))
      .slice(0, 4);

    if (!conDeuda.length) {
      wrapClientes.innerHTML = '<div class="empty-row">Sin deudas pendientes.</div>';
    } else {
      wrapClientes.innerHTML = conDeuda.map(([, c], i) => {
        const isLast = i === conDeuda.length - 1;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:${isLast ? "none" : "1px solid var(--border)"}">
          <div style="font-size:13px;color:var(--text1)">${c.nombre}</div>
          <div style="font-size:13px;font-weight:600;color:#A32D2D">${fmt(Math.abs(c.saldo || 0))}</div>
        </div>`;
      }).join("");
    }
  }
  // ── Notas pendientes ──
  renderNotasDashboard();
}

// ── Render historial de compras ──
function renderHistorialCompras() {
  const tbody = document.getElementById("histComprasBody");
  if (!tbody) return;

  const hoy = new Date();
  let desde;
  if (histPeriodoActivo === "7")        { desde = new Date(hoy); desde.setDate(hoy.getDate() - 6); }
  else if (histPeriodoActivo === "30")  { desde = new Date(hoy); desde.setDate(hoy.getDate() - 29); }
  else if (histPeriodoActivo === "mes") { desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); }
  else                                  { desde = new Date(hoy.getFullYear(), 0, 1); }
  const desdeKey = desde.toISOString().slice(0, 10);
  const hoyKey   = hoy.toISOString().slice(0, 10);

  const lista = comprasData
    .filter(c => c.fecha >= desdeKey && c.fecha <= hoyKey)
    .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No hay compras en el período seleccionado.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(c => {
    const [fy, fm, fd] = (c.fecha || "").split("-");
    const fechaFmt  = c.fecha ? `${parseInt(fd)}/${parseInt(fm)}/${fy}` : "—";
    const hora      = c.ts ? new Date(c.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "—";
    const productos = (c.items || []).map(i => `${i.desc}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ") || "—";
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fechaFmt}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${hora}</td>
      <td><span class="badge ${badgeClass(c.proveedor)}">${c.proveedor || "—"}</span></td>
      <td style="font-size:12.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${productos}">${productos}</td>
      <td class="num" style="font-weight:600">${fmt(c.total || 0)}</td>
      <td style="font-size:12px;color:var(--text2)">${c.admin || "—"}</td>
    </tr>`;
  }).join("");
}

document.getElementById("actFiltroUsuario")?.addEventListener("change", renderActividad);

// ============================================================
//  CLIENTES
// ============================================================
let clientesData    = {};
let clienteActivoId = null;

// ── Helpers ──
function getIniciales(nombre) {
  return nombre.trim().split(/\s+/).slice(0, 2).map(p => p[0].toUpperCase()).join("");
}
function getAvatarColor(nombre) {
  const colors = [
    { bg: "#FCEBEB", color: "#A32D2D" },
    { bg: "#FAEEDA", color: "#854F0B" },
    { bg: "#E6F1FB", color: "#185FA5" },
    { bg: "#EAF3DE", color: "#3B6D11" },
    { bg: "#EEEDFE", color: "#3C3489" },
    { bg: "#E1F5EE", color: "#0F6E56" },
  ];
  let hash = 0;
  for (const c of nombre) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

// ── Render lista ──
let clienteExpandidoId = null;
let clienteFilaActiva  = -1;
let ventaTipoActivo    = ""; // "", "fiado", "cobro", "cortesia"

function buildWA(tel) {
  if (!tel) return null;
  let t = tel.replace(/\D/g, "");
  if (t.startsWith("549") || t.startsWith("541")) {}
  else if (t.startsWith("54")) t = "549" + t.slice(2);
  else if (t.startsWith("0"))  t = "549" + t.slice(1);
  else if (t.startsWith("9"))  t = "54"  + t;
  else                          t = "549" + t;
  return t;
}

function renderClientesLista() {
  const tbody = document.getElementById("clientesLista");
  const empty = document.getElementById("clientesListaEmpty");
  if (!tbody) return;
  const clientes = Object.entries(clientesData).sort((a, b) => (a[1].nombre || "").localeCompare(b[1].nombre || ""));

  // Stats
  let totalDeuda = 0, deudores = 0;
  clientes.forEach(([, c]) => { if ((c.saldo || 0) < 0) { totalDeuda += Math.abs(c.saldo); deudores++; } });
  document.getElementById("cStatTotal").textContent    = fmt(totalDeuda);
  document.getElementById("cStatDeudores").textContent = deudores;
  const hoy    = new Date();
  const mesIni = new Date(hoy.getFullYear(), hoy.getMonth(), 1).getTime();
  let cobrado  = 0;
  clientes.forEach(([id]) => {
    Object.values(clientesData[id]?.movimientos || {}).forEach(m => {
      if (m.tipo === "pago" && m.fecha >= mesIni) cobrado += m.monto || 0;
    });
  });
  document.getElementById("cStatCobrado").textContent = fmt(cobrado);

  if (!clientes.length) {
    tbody.innerHTML = ""; if (empty) empty.style.display = "block"; return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = clientes.map(([id, c], idx) => {
    const saldo      = c.saldo || 0;
    const saldoColor = saldo < 0 ? "#A32D2D" : saldo > 0 ? "#3B6D11" : "var(--text3)";
    const saldoTxt   = saldo < 0 ? fmt(saldo) : saldo > 0 ? `+${fmt(saldo)}` : "$0";
    const ivaShort   = (c.iva || "—").replace("IVA ", "").replace("Responsable ", "Resp. ");
    const expanded   = clienteExpandidoId === id;
    const highlighted = clienteFilaActiva === idx;

    // Movimientos
    const movs = Object.entries(c.movimientos || {}).sort((a,b) => (b[1].fecha||0)-(a[1].fecha||0));
    const TIPO_STYLE = {
      fiado: { bg:"#FCEBEB", color:"#A32D2D", label:"Fiado" },
      pago:  { bg:"#EAF3DE", color:"#3B6D11", label:"Pago" },
    };

    // Ventas vinculadas al cliente
    const ventasCliente = [];
    Object.entries(cajaData).forEach(([fecha, dia]) => {
      ["manana","tarde"].forEach(turno => {
        Object.values(dia[turno]?.ventas || {}).forEach(v => {
          if (v.clienteId === id || v.clienteNombre === c.nombre) {
            ventasCliente.push({ ...v, fecha });
          }
        });
      });
    });
    ventasCliente.sort((a,b) => (b.hora||"").localeCompare(a.hora||""));

    const waNum = buildWA(c.telefono);
    const expandRow = expanded ? `
    <tr class="cliente-expand-row" data-expand-id="${id}">
      <td colspan="6" style="padding:0;border-bottom:1px solid var(--border)">
        <div style="padding:10px 14px;background:var(--surface2)">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap">
            ${waNum ? `<a href="https://wa.me/${waNum}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:var(--radius-sm);background:#E1F5EE;border:1px solid #9FE1CB;font-size:11.5px;color:#0F6E56;text-decoration:none">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="#1D9E75"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.05 2C6.495 2 2 6.495 2 12.05c0 1.868.497 3.623 1.362 5.14L2 22l4.948-1.337A10.01 10.01 0 0 0 12.05 22C17.605 22 22 17.505 22 11.95 22 6.495 17.605 2 12.05 2zm0 18.385a8.33 8.33 0 0 1-4.239-1.158l-.304-.18-3.143.849.845-3.073-.198-.315A8.324 8.324 0 0 1 3.715 12.05c0-4.598 3.737-8.335 8.335-8.335 4.598 0 8.335 3.737 8.335 8.335 0 4.598-3.737 8.335-8.335 8.335z"/></svg>
              Contactar
            </a>` : ""}
            <button type="button" class="btn-primary cliente-cobrar-btn" data-id="${id}" style="font-size:11.5px;padding:5px 10px">Cobrar</button>
            <button type="button" class="btn-secondary cliente-ver-btn" data-id="${id}" style="font-size:11.5px;padding:5px 10px;background:#E6F1FB;color:#0C447C;border-color:#B5D4F4">Ver</button>
            <button type="button" class="btn-danger cliente-eliminar-btn" data-id="${id}" style="font-size:11.5px;padding:5px 8px">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Movimientos</div>
              <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
                ${!movs.length ? `<div class="empty-row" style="font-size:12px">Sin movimientos.</div>` :
                  movs.slice(0,5).map(([,m]) => {
                    const st = TIPO_STYLE[m.tipo] || {bg:"var(--surface2)",color:"var(--text2)",label:m.tipo};
                    const col = m.tipo==="pago" ? "#3B6D11" : "#A32D2D";
                    const signo = m.tipo==="pago" ? "-" : "+";
                    const fecha = m.fecha ? new Date(m.fecha).toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"}) : "—";
                    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid var(--border)">
                      <div style="font-size:11.5px;color:var(--text2)">${fecha} · ${m.concepto||"—"}</div>
                      <div style="display:flex;align-items:center;gap:6px">
                        <span style="font-size:11px;padding:1px 6px;border-radius:8px;background:${st.bg};color:${st.color}">${st.label}</span>
                        <span style="font-size:12px;font-weight:600;color:${col}">${signo}${fmt(m.monto||0)}</span>
                      </div>
                    </div>`;
                  }).join("")}
              </div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Compras registradas</div>
              <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
                ${!ventasCliente.length ? `<div class="empty-row" style="font-size:12px">Sin compras vinculadas.</div>` :
                  ventasCliente.slice(0,5).map(v => {
                    const [fy,fm,fd] = (v.fecha||"").split("-");
                    const fechaFmt = v.fecha ? `${parseInt(fd)}/${parseInt(fm)}` : "—";
                    const prods = (v.items||[]).map(i=>i.desc).join(", ").substring(0,40)||"—";
                    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid var(--border)">
                      <div>
                        <div style="font-size:11.5px;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">${prods}</div>
                        <div style="font-size:10.5px;color:var(--text3)">${fechaFmt} · ${v.hora||""}</div>
                      </div>
                      <span style="font-size:12px;font-weight:600;color:var(--text1)">${fmt(v.total||0)}</span>
                    </div>`;
                  }).join("")}
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>` : "";

    const tdStyle = highlighted ? "background:var(--bg3)" : "";
    return `<tr class="cliente-row" data-id="${id}" data-idx="${idx}" style="cursor:pointer">
      <td class="cliente-nombre-cell" style="font-weight:500;color:var(--text1);white-space:nowrap;overflow:visible;${tdStyle}">
        <span style="display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom">${c.nombre||"—"}</span>
        <div class="cliente-tooltip">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-size:11.5px">
            ${c.razonSocial ? `<div><div style="color:var(--text3);font-size:10px">Razón Social</div><div style="color:var(--text1)">${c.razonSocial}</div></div>` : ""}
            ${c.email ? `<div><div style="color:var(--text3);font-size:10px">Email</div><div style="color:var(--text1)">${c.email}</div></div>` : ""}
            ${c.cuit ? `<div><div style="color:var(--text3);font-size:10px">CUIT/CUIL</div><div style="color:var(--text1)">${c.cuit}</div></div>` : ""}
            ${c.dni ? `<div><div style="color:var(--text3);font-size:10px">DNI</div><div style="color:var(--text1)">${c.dni}</div></div>` : ""}
            ${c.domicilio ? `<div><div style="color:var(--text3);font-size:10px">Domicilio</div><div style="color:var(--text1)">${c.domicilio}</div></div>` : ""}
            ${c.iva ? `<div><div style="color:var(--text3);font-size:10px">Condición IVA</div><div style="color:var(--text1)">${c.iva}</div></div>` : ""}
          </div>
        </div>
      </td>
      <td style="font-size:12px;color:var(--text2);white-space:nowrap;${tdStyle}">${c.telefono||"—"}</td>
      <td style="font-size:12px;color:var(--text2);white-space:nowrap;${tdStyle}">${c.localidad||"—"}</td>
      <td style="white-space:nowrap;${tdStyle}"><span style="font-size:11px;padding:2px 7px;border-radius:10px;background:var(--surface2);color:var(--text2)">${ivaShort}</span></td>
      <td class="num" style="font-weight:600;color:${saldoColor};white-space:nowrap;${tdStyle}">${saldoTxt}</td>
      <td style="text-align:center;padding:0 8px;${tdStyle}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(${expanded?"90":"0"}deg);transition:transform .2s;color:var(--text3)"><polyline points="9 18 15 12 9 6"/></svg>
      </td>
    </tr>${expandRow}`;
  }).join("");
}

function toggleClienteExpand(id) {
  clienteExpandidoId = clienteExpandidoId === id ? null : id;
  clienteActivoId = clienteExpandidoId;
  renderClientesLista();
}

// ── Delegación en tabla ──
document.getElementById("clientesLista")?.addEventListener("click", e => {
  const cobrarBtn   = e.target.closest(".cliente-cobrar-btn");
  const verBtn      = e.target.closest(".cliente-ver-btn");
  const editarBtn   = e.target.closest(".cliente-editar-btn");
  const eliminarBtn = e.target.closest(".cliente-eliminar-btn");
  if (cobrarBtn)   { clienteActivoId = cobrarBtn.dataset.id; abrirModalCobrar(); return; }
  if (verBtn)      { abrirModalVerCliente(verBtn.dataset.id); return; }
  if (editarBtn)   { abrirModalCliente(editarBtn.dataset.id); return; }
  if (eliminarBtn) { eliminarCliente(eliminarBtn.dataset.id); return; }
  const row = e.target.closest(".cliente-row");
  if (row) toggleClienteExpand(row.dataset.id);
});

// ── Navegación con teclado ──
document.getElementById("clientesLista")?.addEventListener("keydown", e => {
  const clientes = Object.entries(clientesData).sort((a,b) => (a[1].nombre||"").localeCompare(b[1].nombre||""));
  if (!clientes.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    clienteFilaActiva = Math.min(clienteFilaActiva + 1, clientes.length - 1);
    window._clienteActivoId = clientes[clienteFilaActiva]?.[0] || null;
    renderClientesLista();
    document.querySelector(`.cliente-row[data-idx="${clienteFilaActiva}"]`)?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    clienteFilaActiva = Math.max(clienteFilaActiva - 1, 0);
    window._clienteActivoId = clientes[clienteFilaActiva]?.[0] || null;
    renderClientesLista();
    document.querySelector(`.cliente-row[data-idx="${clienteFilaActiva}"]`)?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && clienteFilaActiva >= 0) {
    e.preventDefault();
    toggleClienteExpand(clientes[clienteFilaActiva][0]);
  } else if (e.key === "Escape") {
    clienteExpandidoId = null; clienteFilaActiva = -1; renderClientesLista();
  }
});

async function eliminarCliente(id) {
  const c = clientesData[id];
  if (!confirm(`¿Eliminar a ${c?.nombre}?\n\nSe eliminarán todos sus movimientos. Esta acción no se puede deshacer.`)) return;
  const mSnap = await getDocs(collection(db, "clientes", id, "movimientos"));
  const batch = writeBatch(db);
  mSnap.forEach(d => batch.delete(d.ref));
  batch.delete(doc(db, "clientes", id));
  await batch.commit();
  if (clienteExpandidoId === id) { clienteExpandidoId = null; clienteFilaActiva = -1; }
  registrarLog("cliente", `Cliente eliminado — ${c?.nombre}`);
  showToast(`Cliente eliminado ✓`, "success");
}

// ── Firestore listener ──
function initClientesListener() {
  onSnapshot(collection(db, "clientes"), snap => {
    clientesData = {};
    snap.forEach(d => {
      clientesData[d.id] = { ...d.data(), movimientos: {} };
    });
    // Cargar subcolecciones de movimientos
    const promises = snap.docs.map(d =>
      getDocs(collection(db, "clientes", d.id, "movimientos")).then(mSnap => {
        clientesData[d.id].movimientos = {};
        mSnap.forEach(m => { clientesData[d.id].movimientos[m.id] = m.data(); });
      })
    );
    Promise.all(promises).then(() => {
      renderClientesLista();
      if (clienteActivoId && clientesData[clienteActivoId]) renderClientesLista();
    });
  });
}

// ── Modal nuevo/editar cliente ──
function abrirModalCliente(id = null) {
  const c = id ? clientesData[id] : null;
  document.getElementById("clienteEditId").value       = id || "";
  document.getElementById("modalClienteTitulo").textContent = id ? "Editar cliente" : "Nuevo cliente";
  document.getElementById("clienteNombreInput").value      = c?.nombre       || "";
  document.getElementById("clienteTelInput").value         = c?.telefono     || "";
  document.getElementById("clienteEmailInput").value       = c?.email        || "";
  document.getElementById("clienteRazonSocialInput").value = c?.razonSocial  || "";
  document.getElementById("clienteIvaSelect").value        = c?.iva          || "";
  document.getElementById("clienteCuitInput").value        = c?.cuit         || "";
  document.getElementById("clienteDniInput").value         = c?.dni          || "";
  document.getElementById("clienteDomicilioInput").value   = c?.domicilio    || "";
  document.getElementById("clienteLocalidadInput").value   = c?.localidad    || "";
  document.getElementById("btnConfirmarCliente").textContent = id ? "Guardar cambios" : "Guardar cliente";
  document.getElementById("modalCliente").classList.remove("hidden");
  // Si se abre encima de otro modal, subirle el z-index
  if (window._abrirClienteDesdePresup || window._abrirClienteDesdeVenta) {
    document.getElementById("modalCliente").style.zIndex = "400";
  }
  setTimeout(() => document.getElementById("clienteNombreInput").focus(), 80);
}
function cerrarModalCliente() {
  document.getElementById("modalCliente").classList.add("hidden");
  document.getElementById("modalCliente").style.zIndex = "";
}
document.getElementById("btnNuevoCliente")?.addEventListener("click",  () => abrirModalCliente());

// Cuando se guarda un cliente nuevo desde el modal de presupuesto, actualizar el select
window._onClienteGuardado = function(id) {
  if (window._abrirClienteDesdePresup) {
    window._abrirClienteDesdePresup = false;
    // Re-popular el select y seleccionar el nuevo cliente
    const sel = document.getElementById("presupClienteSelect");
    if (sel) {
      sel.innerHTML = '<option value="">Seleccioná un cliente…</option>';
      Object.entries(clientesData).forEach(([cid, c]) => {
        const opt = document.createElement("option");
        opt.value = cid; opt.textContent = c.nombre;
        if (cid === id) opt.selected = true;
        sel.appendChild(opt);
      });
    }
  }
};

// Enter para guardar, Escape para cancelar en el modal de cliente
document.getElementById("modalCliente")?.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && e.target.tagName !== "SELECT") {
    e.preventDefault();
    document.getElementById("btnConfirmarCliente")?.click();
  }
  if (e.key === "Escape") cerrarModalCliente();
});

// ── Modal Ver cliente ──
function abrirModalVerCliente(id) {
  const c = clientesData[id];
  if (!c) return;
  const inic  = getIniciales(c.nombre || "?");
  const av    = getAvatarColor(c.nombre || "?");
  const saldo = c.saldo || 0;

  const avatar = document.getElementById("verClienteAvatar");
  avatar.textContent        = inic;
  avatar.style.background   = av.bg;
  avatar.style.color        = av.color;
  document.getElementById("verClienteNombre").textContent = c.nombre || "—";
  const saldoEl = document.getElementById("verClienteSaldo");
  saldoEl.textContent = saldo < 0 ? `Debe ${fmt(Math.abs(saldo))}` : saldo > 0 ? `A favor: ${fmt(saldo)}` : "Sin deuda";
  saldoEl.style.color = saldo < 0 ? "var(--danger)" : saldo > 0 ? "var(--success)" : "var(--text3)";

  // Guardar id para el botón editar
  document.getElementById("btnVerClienteEditar").dataset.id = id;

  // Grid de campos
  const campos = [
    { label: "Razón Social",    val: c.razonSocial },
    { label: "WhatsApp",        val: c.telefono },
    { label: "Email",           val: c.email },
    { label: "Condición IVA",   val: c.iva },
    { label: "CUIT / CUIL",     val: c.cuit },
    { label: "DNI",             val: c.dni },
    { label: "Domicilio",       val: c.domicilio },
    { label: "Localidad",       val: c.localidad },
  ].filter(f => f.val);

  const grid = document.getElementById("verClienteGrid");
  if (!campos.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text3);font-size:13px;padding:12px">Sin datos adicionales.</div>`;
  } else {
    grid.innerHTML = campos.map(f => `
      <div style="padding:8px 10px;background:var(--surface2);border-radius:var(--radius-sm)">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${f.label}</div>
        <div style="font-size:13px;color:var(--text1)">${f.val}</div>
      </div>`).join("");
  }

  document.getElementById("modalVerCliente").classList.remove("hidden");
}

function cerrarModalVerCliente() {
  document.getElementById("modalVerCliente").classList.add("hidden");
}

document.getElementById("closeModalVerCliente")?.addEventListener("click", cerrarModalVerCliente);
document.getElementById("btnVerClienteEditar")?.addEventListener("click", e => {
  cerrarModalVerCliente();
  abrirModalCliente(e.currentTarget.dataset.id);
});
document.getElementById("modalVerCliente")?.addEventListener("keydown", e => {
  if (e.key === "Escape") cerrarModalVerCliente();
});
document.getElementById("closeModalCliente")?.addEventListener("click",  cerrarModalCliente);
document.getElementById("btnCancelarCliente")?.addEventListener("click", cerrarModalCliente);

document.getElementById("btnConfirmarCliente")?.addEventListener("click", async () => {
  const nombre     = document.getElementById("clienteNombreInput").value.trim();
  if (!nombre) { showToast("Ingresá un nombre.", "error"); return; }
  const tel        = document.getElementById("clienteTelInput").value.trim();
  const email      = document.getElementById("clienteEmailInput").value.trim();
  const razonSocial= document.getElementById("clienteRazonSocialInput").value.trim();
  const iva        = document.getElementById("clienteIvaSelect").value;
  const cuit       = document.getElementById("clienteCuitInput").value.trim();
  const dni        = document.getElementById("clienteDniInput").value.trim();
  const domicilio  = document.getElementById("clienteDomicilioInput").value.trim();
  const localidad  = document.getElementById("clienteLocalidadInput").value.trim();
  const id         = document.getElementById("clienteEditId").value;

  const datos = { nombre, telefono: tel, email, razonSocial, iva, cuit, dni, domicilio, localidad };

  if (id) {
    await updateDoc(doc(db, "clientes", id), datos);
    registrarLog("cliente", `Cliente editado — ${nombre}`);
    showToast("Cliente actualizado ✓", "success");
  } else {
    const nuevoRef = doc(collection(db, "clientes"));
    await setDoc(nuevoRef, { ...datos, saldo: 0, creado: Date.now(), ultimoMov: Date.now() });
    registrarLog("cliente", `Cliente creado — ${nombre}`);
    showToast(`Cliente creado ✓ — ${nombre}`, "success");

    // Si fue creado desde el panel de cobro, seleccionarlo automáticamente
    if (window._abrirClienteDesdeVenta) {
      window._abrirClienteDesdeVenta = false;
      setTimeout(() => {
        const sel = document.getElementById("ventaClienteSelect");
        if (sel) {
          // Repopular y seleccionar
          sel.innerHTML = '<option value="">Sin cliente…</option>';
          Object.entries(clientesData).sort((a,b) => (a[1].nombre||"").localeCompare(b[1].nombre||"")).forEach(([id, c]) => {
            const opt = document.createElement("option");
            opt.value = id; opt.textContent = c.nombre;
            sel.appendChild(opt);
          });
          sel.value = nuevoRef.id;
          sel.dispatchEvent(new Event("change"));
        }
      }, 500);
    }
    // Si fue creado desde el modal de presupuesto
    if (window._abrirClienteDesdePresup) {
      setTimeout(() => window._onClienteGuardado?.(nuevoRef.id), 500);
    }
  }
  cerrarModalCliente();
});

// eliminarCliente ahora manejado via delegación en tabla

// ── Modal cobrar ──
function abrirModalCobrar() {
  if (!clienteActivoId) return;
  const saldo = clientesData[clienteActivoId]?.saldo || 0;
  const deuda = saldo < 0 ? Math.abs(saldo) : 0;
  document.getElementById("cobrarDeudaActual").textContent  = fmt(deuda);
  document.getElementById("cobrarSaldoRestante").textContent = fmt(deuda);
  document.getElementById("cobrarMontoInput").value = "";
  document.getElementById("modalCobrarCliente").classList.remove("hidden");
  setTimeout(() => document.getElementById("cobrarMontoInput").focus(), 80);
}
function cerrarModalCobrar() {
  document.getElementById("modalCobrarCliente").classList.add("hidden");
}
document.getElementById("closeModalCobrarCliente")?.addEventListener("click", cerrarModalCobrar);
document.getElementById("btnCancelarCobrar")?.addEventListener("click",       cerrarModalCobrar);

document.getElementById("cobrarMontoInput")?.addEventListener("input", () => {
  const monto = parseFloat(document.getElementById("cobrarMontoInput").value) || 0;
  const saldo = clientesData[clienteActivoId]?.saldo || 0;
  const deuda = saldo < 0 ? Math.abs(saldo) : 0;
  const restante = deuda - monto;
  const el = document.getElementById("cobrarSaldoRestante");
  el.textContent = fmt(Math.max(0, restante));
  el.style.color = restante <= 0 ? "var(--success)" : "var(--danger)";
});

document.getElementById("btnConfirmarCobrar")?.addEventListener("click", async () => {
  const monto = parseFloat(document.getElementById("cobrarMontoInput").value);
  if (isNaN(monto) || monto <= 0) { showToast("Ingresá un monto válido.", "error"); return; }

  const c      = clientesData[clienteActivoId];
  const saldoActual = c?.saldo || 0;
  const nuevoSaldo  = saldoActual + monto; // pago suma (saldo negativo se reduce)

  // Guardar movimiento
  const movRef = doc(collection(db, "clientes", clienteActivoId, "movimientos"));
  await setDoc(movRef, { tipo: "pago", monto: Math.round(monto), concepto: "Pago", fecha: Date.now(), admin: getNombreUsuario() });
  await updateDoc(doc(db, "clientes", clienteActivoId), { saldo: nuevoSaldo, ultimoMov: Date.now() });

  registrarLog("cliente", `Pago registrado — ${fmt(Math.round(monto))} · ${c?.nombre}`);
  showToast(`Pago registrado ✓ — ${fmt(Math.round(monto))}`, "success");
  cerrarModalCobrar();
});

document.getElementById("modalCobrarCliente")?.addEventListener("keydown", e => {
  if (e.key === "Enter" && document.activeElement?.id === "cobrarMontoInput") {
    e.preventDefault(); document.getElementById("btnConfirmarCobrar")?.click();
  }
  if (e.key === "Escape") cerrarModalCobrar();
});

// ── Selector de cliente en panel de cobro ──
function actualizarSelectorClientes() {
  const sel = document.getElementById("cobroClienteSelect");
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = '<option value="">Seleccioná un cliente…</option>';
  Object.entries(clientesData)
    .sort((a, b) => (a[1].nombre || "").localeCompare(b[1].nombre || ""))
    .forEach(([id, c]) => {
      const opt = document.createElement("option");
      opt.value = id; opt.textContent = c.nombre;
      if (id === actual) opt.selected = true;
      sel.appendChild(opt);
    });
}

document.getElementById("cobroClienteSelect")?.addEventListener("change", () => {
  const id    = document.getElementById("cobroClienteSelect").value;
  const wrap  = document.getElementById("cobroClienteDeuda");
  const monto = document.getElementById("cobroClienteDeudaMonto");
  if (id && clientesData[id]) {
    const saldo = clientesData[id].saldo || 0;
    if (saldo < 0) {
      monto.textContent = fmt(Math.abs(saldo));
      wrap.style.display = "block";
    } else {
      wrap.style.display = "none";
    }
  } else {
    wrap.style.display = "none";
  }
});

// Mostrar/ocultar selector según chip seleccionado
function actualizarCobroClienteWrap(notaActiva) {
  const wrap = document.getElementById("cobroClienteWrap");
  if (!wrap) return;
  if (notaActiva === "Fiado" || notaActiva === "Pago") {
    actualizarSelectorClientes();
    wrap.style.display = "block";
  } else {
    wrap.style.display = "none";
  }
}

// Botón nuevo cliente desde panel de cobro
document.getElementById("btnCobroNuevoCliente")?.addEventListener("click", () => {
  abrirModalCliente();
});

// ── Vincular cliente al confirmar venta ──
// Esta función se llama desde confirmarVentaFinal cuando hay Fiado o Pago
async function registrarMovimientoCliente(tipo, monto, ventaId, nota) {
  const clienteId = document.getElementById("ventaClienteSelect")?.value;
  if (!clienteId) return;
  const c = clientesData[clienteId];
  if (!c) return;

  const saldoActual = c.saldo || 0;
  const nuevoSaldo  = tipo === "fiado" ? saldoActual - monto : saldoActual + monto;

  const movRef = doc(collection(db, "clientes", clienteId, "movimientos"));
  await setDoc(movRef, {
    tipo, monto: Math.round(monto),
    concepto: nota || (tipo === "fiado" ? "Venta fiada" : "Cobro"),
    ventaId, fecha: Date.now(), admin: getNombreUsuario()
  });
  await updateDoc(doc(db, "clientes", clienteId), { saldo: nuevoSaldo, ultimoMov: Date.now() });
}

// ============================================================
//  GASTOS DE CAJA
// ============================================================
let gastoCatActiva  = "Pago de impuesto";
let gastoFechaKey   = todayKey();
let gastoEditando   = null;
let gastoFiltroDesde = todayKey();
let gastoFiltroHasta = todayKey();

// ── Helpers ──
function getGastos(fechaKey) {
  return cajaData[fechaKey]?.gastos || {};
}

function calcTotalesGastos(fechaKey) {
  const gastos = Object.entries(getGastos(fechaKey)).map(([id, g]) => ({ ...g, _id: id }));
  const tots = { "Pago de impuesto": 0, "Pago de servicio": 0, Insumo: 0, Retiro: 0, Otro: 0 };
  let total = 0;
  gastos.forEach(g => {
    tots[g.cat] = (tots[g.cat] || 0) + (g.monto || 0);
    total += g.monto || 0;
  });
  return { tots, total, gastos };
}

// ── Render vista Gastos ──
function renderGastos() {
  // Actualizar inputs de fecha
  const inputDesde = document.getElementById("gastosFechaDesde");
  const inputHasta = document.getElementById("gastosFechaHasta");
  if (inputDesde && !inputDesde._initialized) { inputDesde.value = gastoFiltroDesde; inputDesde._initialized = true; }
  if (inputHasta && !inputHasta._initialized) { inputHasta.value = gastoFiltroHasta; inputHasta._initialized = true; }

  // Recopilar gastos del rango
  const gastosTodos = [];
  Object.entries(cajaData).forEach(([fecha, dia]) => {
    if (fecha < gastoFiltroDesde || fecha > gastoFiltroHasta) return;
    Object.entries(dia.gastos || {}).forEach(([id, g]) => {
      gastosTodos.push({ ...g, _id: id, _fecha: fecha });
    });
  });
  gastosTodos.sort((a, b) => b._fecha.localeCompare(a._fecha) || (b.hora||"").localeCompare(a.hora||""));

  // Título
  const mismaFecha = gastoFiltroDesde === gastoFiltroHasta;
  document.getElementById("gastosTituloFecha").textContent = mismaFecha
    ? "Gastos — " + fechaLabel(gastoFiltroDesde)
    : `Gastos — ${fechaLabel(gastoFiltroDesde)} al ${fechaLabel(gastoFiltroHasta)}`;

  // Stats
  const statsWrap = document.getElementById("gastosStatsWrap");
  const total = gastosTodos.reduce((s, g) => s + (g.monto || 0), 0);
  if (gastosTodos.length) {
    statsWrap.classList.remove("hidden");
    document.getElementById("gStatTotal").textContent = fmt(total);
    document.getElementById("gStatCant").textContent  = gastosTodos.length + (gastosTodos.length === 1 ? " gasto" : " gastos");
    const tots = {};
    gastosTodos.forEach(g => { tots[g.cat] = (tots[g.cat] || 0) + (g.monto || 0); });
    const statIds = { "Impuesto / Tasa":"gStatPagoImp","Servicio":"gStatPagoServ","Insumo":"gStatInsumo","Retiro":"gStatRetiro","Otro":"gStatOtro" };
    Object.entries(statIds).forEach(([cat, id]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmt(tots[cat] || 0);
    });
  } else {
    statsWrap.classList.add("hidden");
  }

  const tbody = document.getElementById("gastosTableBody");
  const empty = document.getElementById("gastosEmptyMsg");
  const pie   = document.getElementById("gastosTotalPie");

  if (!gastosTodos.length) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    if (pie) pie.style.display = "none";
    return;
  }

  empty.style.display = "none";
  if (pie) {
    pie.style.display = "flex";
    document.getElementById("gastosTotalCant").textContent = `${gastosTodos.length} gasto${gastosTodos.length !== 1 ? "s" : ""}`;
    document.getElementById("gastosTotalMonto").textContent = fmt(total);
  }

  const CAT_BADGE = {
    "Impuesto / Tasa":            "color:#3C3489;background:#EEEDFE",
    "Servicio":                   "color:#0C447C;background:#E6F1FB",
    "Seguro":                     "color:#7a3a00;background:#fef0e0",
    "Mantenimiento / Reparación": "color:#27500A;background:#EAF3DE",
    "Insumo":                     "color:#27500A;background:#EAF3DE",
    "Retiro":                     "color:#7a3a00;background:#fef0e0",
    "Otro":                       "color:var(--text2);background:var(--surface2)",
  };
  const FP_BADGE = {
    "Efectivo":         "color:#27500A;background:#EAF3DE",
    "Transferencia":    "color:#0C447C;background:#E6F1FB",
    "Débito":           "color:#3C3489;background:#EEEDFE",
    "Crédito":          "color:#7a3a00;background:#fef0e0",
    "QR":               "color:#0C447C;background:#E6F1FB",
    "Billetera virtual":"color:#0C447C;background:#E6F1FB",
    "Cheque":           "color:var(--text2);background:var(--surface2)",
    "Depósito":         "color:#0C447C;background:#E6F1FB",
    "Cuenta corriente": "color:var(--text2);background:var(--surface2)",
  };

  tbody.innerHTML = gastosTodos.map(g => {
    const badgeCat = CAT_BADGE[g.cat] || "color:var(--text2);background:var(--surface2)";
    const badgeFP  = g.formaPago ? (FP_BADGE[g.formaPago] || "color:var(--text2);background:var(--surface2)") : "";
    const [fy,fm,fd] = g._fecha.split("-");
    const fechaFmt = `${parseInt(fd)}/${parseInt(fm)}/${fy}`;
    return `<tr>
      <td style="font-size:12px;color:var(--text2)">${fechaFmt}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fmtHora(g.hora)||"—"}</td>
      <td><span style="font-size:11px;font-weight:500;padding:2px 8px;border-radius:10px;${badgeCat}">${g.cat}</span></td>
      <td style="font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${g.desc||''}">${g.desc||"—"}</td>
      <td>${g.formaPago ? `<span style="font-size:11px;padding:2px 7px;border-radius:10px;${badgeFP}">${g.formaPago}</span>` : "—"}</td>
      <td class="num" style="font-weight:600">${fmt(g.monto||0)}</td>
      <td style="font-size:12px;color:var(--text2)">${g.admin||"—"}</td>
      <td>
        <div style="display:flex;gap:5px;justify-content:flex-end">
          <button class="btn-secondary" style="font-size:11px;padding:4px 8px;white-space:nowrap" data-gasto-edit="${g._id}" data-fecha="${g._fecha}">Editar</button>
          <button class="btn-danger" style="font-size:11px;padding:4px 7px;opacity:.8;white-space:nowrap" data-gasto-anular="${g._id}" data-fecha="${g._fecha}" data-desc="${(g.desc||g.cat).replace(/"/g,'&quot;')}" data-monto="${g.monto||0}">✕</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}
// Delegación de eventos en la tabla de gastos
document.getElementById("gastosTableBody")?.addEventListener("click", async e => {
  // Editar
  const btnEdit = e.target.closest("[data-gasto-edit]");
  if (btnEdit) {
    const id     = btnEdit.dataset.gastoEdit;
    const fecha  = btnEdit.dataset.fecha;
    const gasto  = getGastos(fecha)[id];
    if (!gasto) return;
    abrirModalGasto(id, gasto);
    return;
  }
  // Anular
  const btnAnular = e.target.closest("[data-gasto-anular]");
  if (btnAnular) {
    const id    = btnAnular.dataset.gastoAnular;
    const fecha = btnAnular.dataset.fecha;
    const desc  = btnAnular.dataset.desc;
    const monto = btnAnular.dataset.monto;
    if (!confirm(`¿Anular este gasto?\n${desc}\nMonto: ${fmt(Number(monto))}\n\nEsta acción no se puede deshacer.`)) return;
    await updateDoc(doc(db, "caja", fecha), {
      [`gastos.${id}`]: deleteField()
    });
    registrarLog("gasto", `Gasto anulado — ${fmt(Number(monto))} · ${desc}`);
    showToast("Gasto anulado ✓", "success");
  }
});

// Navegación de fechas en Gastos
document.getElementById("btnGastosAnterior")?.addEventListener("click", () => {
  const hoy = todayKey();
  gastoFiltroDesde = offsetFecha(gastoFiltroDesde, -1);
  gastoFiltroHasta = offsetFecha(gastoFiltroHasta, -1);
  const inputDesde = document.getElementById("gastosFechaDesde");
  const inputHasta = document.getElementById("gastosFechaHasta");
  if (inputDesde) inputDesde.value = gastoFiltroDesde;
  if (inputHasta) inputHasta.value = gastoFiltroHasta;
  renderGastos();
});
document.getElementById("btnGastosSiguiente")?.addEventListener("click", () => {
  const hoy = todayKey();
  if (gastoFiltroHasta >= hoy) return;
  gastoFiltroDesde = offsetFecha(gastoFiltroDesde, 1);
  gastoFiltroHasta = offsetFecha(gastoFiltroHasta, 1);
  const inputDesde = document.getElementById("gastosFechaDesde");
  const inputHasta = document.getElementById("gastosFechaHasta");
  if (inputDesde) inputDesde.value = gastoFiltroDesde;
  if (inputHasta) inputHasta.value = gastoFiltroHasta;
  renderGastos();
});

document.getElementById("btnGastosFiltrarFecha")?.addEventListener("click", () => {
  const desde = document.getElementById("gastosFechaDesde").value;
  const hasta = document.getElementById("gastosFechaHasta").value;
  if (!desde || !hasta) { showToast("Completá ambas fechas.", "warning"); return; }
  if (desde > hasta)    { showToast("La fecha desde no puede ser mayor a hasta.", "warning"); return; }
  gastoFiltroDesde = desde;
  gastoFiltroHasta = hasta;
  renderGastos();
});

document.getElementById("btnGastosHoy")?.addEventListener("click", () => {
  const hoy = todayKey();
  gastoFiltroDesde = hoy;
  gastoFiltroHasta = hoy;
  const inputDesde = document.getElementById("gastosFechaDesde");
  const inputHasta = document.getElementById("gastosFechaHasta");
  if (inputDesde) { inputDesde.value = hoy; inputDesde._initialized = false; }
  if (inputHasta) { inputHasta.value = hoy; inputHasta._initialized = false; }
  renderGastos();
});

// ── Modal gasto — abrir para nuevo o editar ──
function abrirModalGasto(id = null, gasto = null) {
  gastoEditando = id;
  document.getElementById("modalGastoTitulo").textContent  = id ? "Editar gasto" : "Registrar gasto";
  document.getElementById("btnConfirmarGasto").textContent = id ? "Guardar cambios" : "Registrar";
  document.getElementById("gastoEditId").value = id || "";

  // Categoría
  const catGuardada = gasto?.cat || "Impuesto / Tasa";
  const CATS_BASE = ["Impuesto / Tasa","Servicio","Seguro","Mantenimiento / Reparación","Insumo","Retiro","Otro"];
  const esBase = CATS_BASE.includes(catGuardada);
  gastoCatActiva = catGuardada;
  document.querySelectorAll(".gasto-chip").forEach(b => {
    b.classList.toggle("active", b.dataset.cat === gastoCatActiva);
  });
  const catCustomInput = document.getElementById("gastoCatCustom");
  catCustomInput.value = esBase ? "" : catGuardada;

  // Popular datalist de categorías custom
  const catsDl = document.getElementById("gastoCatList");
  if (catsDl) {
    const catsUsadas = new Set();
    Object.values(cajaData).forEach(dia => {
      Object.values(dia.gastos || {}).forEach(g => { if (g.cat && !CATS_BASE.includes(g.cat)) catsUsadas.add(g.cat); });
    });
    catsDl.innerHTML = [...catsUsadas].sort().map(c => `<option value="${c}">`).join("");
  }

  // Forma de pago
  const fp = gasto?.formaPago || "Efectivo";
  const FPS_BASE = ["Efectivo","Transferencia","Débito","Crédito","QR","Billetera virtual","Cheque","Depósito","Cuenta corriente","Otro"];
  const fpSel = document.getElementById("gastoFormaPagoSelect");
  const fpCustom = document.getElementById("gastoFormaPagoCustom");
  if (FPS_BASE.includes(fp)) {
    fpSel.value = fp;
    fpCustom.style.display = "none";
    fpCustom.value = "";
  } else {
    fpSel.value = "custom";
    fpCustom.style.display = "block";
    fpCustom.value = fp;
  }
  // Popular datalist de formas de pago custom
  const fpDl = document.getElementById("gastoFPList");
  if (fpDl) {
    const fpsUsadas = new Set();
    Object.values(cajaData).forEach(dia => {
      Object.values(dia.gastos || {}).forEach(g => { if (g.formaPago && !FPS_BASE.includes(g.formaPago)) fpsUsadas.add(g.formaPago); });
    });
    fpDl.innerHTML = [...fpsUsadas].sort().map(f => `<option value="${f}">`).join("");
  }

  document.getElementById("gastoDescInput").value  = gasto?.desc  || "";
  document.getElementById("gastoMontoInput").value = gasto?.monto || "";

  document.getElementById("modalGasto").classList.remove("hidden");
  setTimeout(() => document.getElementById("gastoMontoInput").focus(), 80);
}

// Abrir modal para nuevo gasto desde el botón de la vista
document.getElementById("btnRegistrarGasto")?.addEventListener("click", () => {
  abrirModalGasto(null, null);
});

// Chips de categoría
document.getElementById("gastoChips")?.addEventListener("click", e => {
  const chip = e.target.closest(".gasto-chip");
  if (!chip) return;
  gastoCatActiva = chip.dataset.cat;
  document.querySelectorAll(".gasto-chip").forEach(b => {
    b.classList.toggle("active", b.dataset.cat === gastoCatActiva);
  });
  document.getElementById("gastoCatCustom").value = "";
});

// Categoría custom
document.getElementById("gastoCatCustom")?.addEventListener("input", e => {
  if (e.target.value.trim()) {
    gastoCatActiva = e.target.value.trim();
    document.querySelectorAll(".gasto-chip").forEach(b => b.classList.remove("active"));
  }
});

// Forma de pago custom
document.getElementById("gastoFormaPagoSelect")?.addEventListener("change", e => {
  const fpCustom = document.getElementById("gastoFormaPagoCustom");
  fpCustom.style.display = e.target.value === "custom" ? "block" : "none";
  if (e.target.value !== "custom") fpCustom.value = "";
});

// Cerrar modal
function cerrarModalGasto() {
  gastoEditando = null;
  document.getElementById("modalGasto").classList.add("hidden");
}
document.getElementById("closeModalGasto")?.addEventListener("click", cerrarModalGasto);
document.getElementById("btnCancelarGasto")?.addEventListener("click", cerrarModalGasto);

document.getElementById("btnConfirmarGasto")?.addEventListener("click", async () => {
  const monto = parseFloat(document.getElementById("gastoMontoInput").value);
  if (isNaN(monto) || monto <= 0) {
    showToast("Ingresá un monto válido.", "error");
    document.getElementById("gastoMontoInput").focus();
    return;
  }

  const desc  = document.getElementById("gastoDescInput").value.trim();
  const cat   = gastoCatActiva || "Otro";
  const fpSel = document.getElementById("gastoFormaPagoSelect").value;
  const formaPago = fpSel === "custom"
    ? document.getElementById("gastoFormaPagoCustom").value.trim() || "Otro"
    : fpSel;
  const etiq  = desc ? `${cat} — ${desc}` : cat;
  const fecha = todayKey();

  const gastoData = {
    cat, desc, monto: Math.round(monto), formaPago,
    hora: nowHora(), admin: getNombreUsuario()
  };

  if (gastoEditando) {
    const fechaOrig = document.getElementById("gastoEditId").dataset?.fecha || fecha;
    gastoData.hora = getGastos(fechaOrig)[gastoEditando]?.hora || nowHora();
    await updateDoc(doc(db, "caja", fechaOrig), {
      [`gastos.${gastoEditando}`]: gastoData
    });
    registrarLog("gasto", `Gasto editado — ${fmt(Math.round(monto))} · ${etiq}`);
    showToast("Gasto actualizado ✓", "success");
  } else {
    const gastoId = `g_${Date.now()}`;
    await setDoc(doc(db, "caja", fecha), {
      gastos: { [gastoId]: gastoData }
    }, { merge: true });
    registrarLog("gasto", `Gasto registrado — ${fmt(Math.round(monto))} · ${etiq}`);
    showToast(`Gasto registrado ✓ — ${fmt(Math.round(monto))}`, "success");
  }

  cerrarModalGasto();
});

// ── Navegación con teclado en tabla de gastos ──
let gastoFilaActiva = -1;

function getGastosOrdenados() {
  const lista = [];
  Object.entries(cajaData).forEach(([fecha, dia]) => {
    if (fecha < gastoFiltroDesde || fecha > gastoFiltroHasta) return;
    Object.entries(dia.gastos || {}).forEach(([id, g]) => lista.push({ ...g, _id: id, _fecha: fecha }));
  });
  return lista.sort((a, b) => b._fecha.localeCompare(a._fecha) || (b.hora||"").localeCompare(a.hora||""));
}

document.getElementById("gastosTableBody")?.addEventListener("keydown", e => {
  const gastos = getGastosOrdenados();
  if (!gastos.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    gastoFilaActiva = Math.min(gastoFilaActiva + 1, gastos.length - 1);
    resaltarFilaGasto(gastoFilaActiva);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    gastoFilaActiva = Math.max(gastoFilaActiva - 1, 0);
    resaltarFilaGasto(gastoFilaActiva);
  } else if (e.key === "Enter" && gastoFilaActiva >= 0) {
    e.preventDefault();
    const g = gastos[gastoFilaActiva];
    if (g) abrirModalGasto(g._id, g);
  } else if (e.key === "Escape") {
    gastoFilaActiva = -1;
    resaltarFilaGasto(-1);
  }
});

function resaltarFilaGasto(idx) {
  document.querySelectorAll("#gastosTableBody tr").forEach((tr, i) => {
    tr.querySelectorAll("td").forEach(td => {
      td.style.background = i === idx ? "var(--bg3)" : "";
    });
    if (i === idx) tr.scrollIntoView({ block: "nearest" });
  });
}

// Enfocar tbody al entrar a Gastos y resetear fila activa
// (ya se maneja en el listener de navegación de vistas)

// Enter en monto confirma; Escape cierra
document.getElementById("modalGasto")?.addEventListener("keydown", e => {
  if (e.key === "Enter" && document.activeElement?.id === "gastoMontoInput") {
    e.preventDefault();
    document.getElementById("btnConfirmarGasto")?.click();
  }
  if (e.key === "Escape") cerrarModalGasto();
});

// ── Exportar Gastos Excel ──
document.getElementById("btnExportarGastosExcel")?.addEventListener("click", () => {
  const gastosTodos = [];
  Object.entries(cajaData).forEach(([fecha, dia]) => {
    if (fecha < gastoFiltroDesde || fecha > gastoFiltroHasta) return;
    Object.entries(dia.gastos || {}).forEach(([id, g]) => gastosTodos.push({ ...g, _fecha: fecha }));
  });
  if (!gastosTodos.length) { showToast("No hay gastos para exportar.", "warning"); return; }
  gastosTodos.sort((a, b) => b._fecha.localeCompare(a._fecha) || (b.hora||"").localeCompare(a.hora||""));

  const data = [["Fecha","Hora","Categoría","Detalle","Forma de pago","Monto","Usuario"]];
  gastosTodos.forEach(g => {
    const [fy,fm,fd] = g._fecha.split("-");
    data.push([
      `${parseInt(fd)}/${parseInt(fm)}/${fy}`,
      fmtHora(g.hora) || "—",
      g.cat || "",
      g.desc || "",
      g.formaPago || "",
      g.monto || 0,
      g.admin || ""
    ]);
  });
  const total = gastosTodos.reduce((s, g) => s + (g.monto||0), 0);
  data.push(["","","","","TOTAL", total, ""]);

  exportarExcel(
    [{ nombre: "Gastos", data, colsMoney: [5] }],
    `JPSoft_Tienda_Gastos_${gastoFiltroDesde}_${gastoFiltroHasta}.xlsx`
  );
});

// ── Imprimir Gastos PDF ──
document.getElementById("btnImprimirGastosPDF")?.addEventListener("click", async () => {
  const gastosTodos = [];
  Object.entries(cajaData).forEach(([fecha, dia]) => {
    if (fecha < gastoFiltroDesde || fecha > gastoFiltroHasta) return;
    Object.entries(dia.gastos || {}).forEach(([id, g]) => gastosTodos.push({ ...g, _fecha: fecha }));
  });
  if (!gastosTodos.length) { showToast("No hay gastos para imprimir.", "warning"); return; }
  gastosTodos.sort((a, b) => b._fecha.localeCompare(a._fecha) || (b.hora||"").localeCompare(a.hora||""));

  const total = gastosTodos.reduce((s, g) => s + (g.monto||0), 0);
  const mismaFecha = gastoFiltroDesde === gastoFiltroHasta;
  const periodoLbl = mismaFecha ? fechaLabel(gastoFiltroDesde) : `${fechaLabel(gastoFiltroDesde)} al ${fechaLabel(gastoFiltroHasta)}`;
  const now = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });

  const CAT_COLOR = {
    "Impuesto / Tasa": "#3C3489", "Servicio": "#0C447C", "Seguro": "#7a3a00",
    "Mantenimiento / Reparación": "#27500A", "Insumo": "#27500A",
    "Retiro": "#7a3a00", "Otro": "#555555",
  };

  const filas = gastosTodos.map(g => {
    const [fy,fm,fd] = g._fecha.split("-");
    const fechaFmt = `${parseInt(fd)}/${parseInt(fm)}/${fy}`;
    return `<tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:5px 8px;font-size:11px;color:#888">${fechaFmt}</td>
      <td style="padding:5px 8px;font-family:monospace;font-size:11px;color:#888">${fmtHora(g.hora)||"—"}</td>
      <td style="padding:5px 8px"><span style="font-size:11px;font-weight:500;color:${CAT_COLOR[g.cat]||'#555'}">${g.cat}</span></td>
      <td style="padding:5px 8px;font-size:12px;color:#444">${g.desc||"—"}</td>
      <td style="padding:5px 8px;font-size:11px;color:#666">${g.formaPago||"—"}</td>
      <td style="padding:5px 8px;text-align:right;font-weight:600;font-size:13px">${fmt(g.monto||0)}</td>
      <td style="padding:5px 8px;font-size:11px;color:#888">${g.admin||"—"}</td>
    </tr>`;
  }).join("");

  const content = `
    <div style="font-family:'DM Sans',sans-serif;font-size:13px;color:#111;padding:2rem;max-width:680px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
        <div style="font-size:18px;font-weight:600">JPSoft | Tienda</div>
        <div style="font-size:11px;color:#888">Generado el ${now}</div>
      </div>
      <div style="font-size:12px;color:#888;margin-bottom:1.25rem">Gastos — ${periodoLbl} · ${gastosTodos.length} registros</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f5f5f5;font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:.05em">
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee;width:70px">Fecha</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee;width:50px">Hora</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee;width:130px">Categoría</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Detalle</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee;width:100px">Forma de pago</th>
            <th style="padding:6px 8px;text-align:right;font-weight:500;border-bottom:1px solid #eee;width:80px">Monto</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee;width:80px">Usuario</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
        <tfoot>
          <tr style="border-top:2px solid #111">
            <td colspan="5" style="padding:8px;font-weight:600;font-size:13px">TOTAL</td>
            <td style="padding:8px;text-align:right;font-weight:700;font-size:15px">${fmt(total)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;

  const btn  = document.getElementById("btnImprimirGastosPDF");
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = "Generando…";

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:720px;background:#fff";
  container.innerHTML = content;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale:2, useCORS:true, backgroundColor:"#fff" });
    const { jsPDF } = window.jspdf;
    const pdf  = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4" });
    const imgW = 297;
    const imgH = (canvas.height * imgW) / canvas.width;
    const pages = Math.ceil(imgH / 210);
    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, -i*210, imgW, imgH);
    }
    pdf.save(`JPSoft_Tienda_Gastos_${gastoFiltroDesde}_${gastoFiltroHasta}.pdf`);
    showToast("PDF generado ✓", "success");
  } catch(err) {
    showToast("Error al generar PDF: " + err.message, "error");
  } finally {
    document.body.removeChild(container);
    btn.disabled = false; btn.innerHTML = orig;
  }
});



// ── Exportar Compras Excel ──
document.getElementById("btnExportarComprasExcel")?.addEventListener("click", () => {
  if (!comprasData.length) { showToast("No hay compras para exportar.", "warning"); return; }

  const lista = [...comprasData].sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  const data  = [["Fecha", "Hora", "Proveedor", "Productos", "Total", "Nota", "Usuario"]];
  lista.forEach(c => {
    const [fy, fm, fd] = (c.fecha || "").split("-");
    const fechaFmt  = c.fecha ? `${parseInt(fd)}/${parseInt(fm)}/${fy}` : "—";
    const hora      = c.ts ? new Date(c.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "—";
    const productos = (c.items || []).map(i => `${i.desc} ×${i.qty} ($${i.precio})`).join("; ") || "—";
    data.push([fechaFmt, hora, c.proveedor || "—", productos, c.total || 0, c.nota || "", c.admin || "—"]);
  });

  exportarExcel([{ nombre: "Compras", data, colsMoney: [4] }], `JPSoft_Tienda_Compras_${todayKey()}.xlsx`);
});

// ── Imprimir Compras PDF ──
document.getElementById("btnImprimirComprasPDF")?.addEventListener("click", async () => {
  if (!comprasData.length) { showToast("No hay compras para imprimir.", "warning"); return; }

  const lista    = [...comprasData].sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  const now      = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const totalGen = lista.reduce((s, c) => s + (c.total || 0), 0);

  const filas = lista.map(c => {
    const [fy, fm, fd] = (c.fecha || "").split("-");
    const fechaFmt  = c.fecha ? `${parseInt(fd)}/${parseInt(fm)}/${fy}` : "—";
    const hora      = c.ts ? new Date(c.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "—";
    const productos = (c.items || []).map(i => `${i.desc} ×${i.qty}`).join(", ") || "—";
    return `<tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:5px 8px;font-family:monospace;font-size:11px;color:#888">${fechaFmt}</td>
      <td style="padding:5px 8px;font-family:monospace;font-size:11px;color:#888">${hora}</td>
      <td style="padding:5px 8px;font-size:12px;font-weight:500">${c.proveedor || "—"}</td>
      <td style="padding:5px 8px;font-size:12px;color:#444">${productos}</td>
      <td style="padding:5px 8px;text-align:right;font-weight:600">${fmt(c.total || 0)}</td>
      <td style="padding:5px 8px;font-size:11px;color:#888">${c.admin || "—"}</td>
    </tr>`;
  }).join("");

  const content = `
    <div style="font-family:'DM Sans',sans-serif;font-size:13px;color:#111;padding:2rem;max-width:620px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
        <div style="font-size:18px;font-weight:600">JPSoft | Tienda</div>
        <div style="font-size:11px;color:#888;text-align:right">Generado el ${now}</div>
      </div>
      <div style="font-size:12px;color:#888;margin-bottom:1.25rem">Registro de compras</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f5f5f5;font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:.05em">
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Fecha</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Hora</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Proveedor</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Productos</th>
            <th style="padding:6px 8px;text-align:right;font-weight:500;border-bottom:1px solid #eee">Total</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Usuario</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
        <tfoot>
          <tr style="border-top:2px solid #111">
            <td colspan="4" style="padding:8px 8px;font-weight:600;font-size:13px">TOTAL</td>
            <td style="padding:8px 8px;text-align:right;font-weight:700;font-size:15px">${fmt(totalGen)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;

  const btn  = document.getElementById("btnImprimirComprasPDF");
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = "Generando…";

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:660px;background:#fff";
  container.innerHTML = content;
  document.body.appendChild(container);

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
    pdf.save(`JPSoft_Tienda_Compras_${todayKey()}.pdf`);
    showToast("PDF generado ✓", "success");
  } catch(err) {
    showToast("Error al generar PDF: " + err.message, "error");
  } finally {
    document.body.removeChild(container);
    btn.disabled = false; btn.innerHTML = orig;
  }
});

// ============================================================
//  NOTAS Y RECORDATORIOS
// ============================================================
let notasData = [];

function getNotaUrgencia(fechaStr) {
  if (!fechaStr) return "sin-fecha";
  const hoy    = new Date(); hoy.setHours(0,0,0,0);
  const fecha  = new Date(fechaStr + "T00:00:00");
  const diff   = Math.round((fecha - hoy) / 86400000);
  if (diff < 0)  return "vencida";
  if (diff === 0) return "hoy";
  if (diff === 1) return "manana";
  return "proxima";
}

function fmtFechaNota(fechaStr) {
  if (!fechaStr) return "Sin fecha de vencimiento";
  const [y, m, d] = fechaStr.split("-");
  const urg = getNotaUrgencia(fechaStr);
  const base = `${parseInt(d)}/${parseInt(m)}/${y}`;
  if (urg === "vencida") return `Vencida · ${base}`;
  if (urg === "hoy")     return `Vence hoy · ${base}`;
  if (urg === "manana")  return `Mañana · ${base}`;
  return base;
}

function colorNota(nota) {
  if (nota.completada) return { dot: "var(--border2)", text: "var(--text3)", label: "Completada" };
  const urg = getNotaUrgencia(nota.fecha);
  if (urg === "vencida" || urg === "hoy") return { dot: "#E24B4A", text: "var(--danger)", label: fmtFechaNota(nota.fecha) };
  if (urg === "manana")  return { dot: "#BA7517", text: "var(--warn, #BA7517)", label: fmtFechaNota(nota.fecha) };
  return { dot: "var(--text3)", text: "var(--text3)", label: fmtFechaNota(nota.fecha) };
}

// ── Render vista Notas ──
function renderNotas() {
  const grid = document.getElementById("notasGrid");
  if (!grid) return;

  const pendientes   = notasData.filter(n => !n.completada).sort((a,b) => {
    if (!a.fecha && !b.fecha) return 0;
    if (!a.fecha) return 1;
    if (!b.fecha) return -1;
    return a.fecha.localeCompare(b.fecha);
  });
  const completadas  = notasData.filter(n => n.completada).sort((a,b) => (b.ts||"").localeCompare(a.ts||""));
  const lista = [...pendientes, ...completadas];

  if (!lista.length) {
    grid.innerHTML = '<div class="empty-row" style="grid-column:1/-1">No hay notas registradas.</div>';
    return;
  }

  grid.innerHTML = lista.map(n => {
    const col = colorNota(n);
    const comp = n.completada;
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;${comp ? "opacity:.65" : ""}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
        <div style="font-size:13px;font-weight:500;color:var(--text1);${comp ? "text-decoration:line-through;color:var(--text3)" : ""}">${n.texto || "—"}</div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${!comp ? `<button type="button" class="nota-accion-btn" data-nota-edit="${n._id}" style="background:none;border:none;cursor:pointer;padding:3px;color:var(--text3)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>` : ""}
          <button type="button" class="nota-accion-btn" data-nota-del="${n._id}" style="background:none;border:none;cursor:pointer;padding:3px;color:var(--text3)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
      <div style="font-size:12px;color:${col.text};margin-bottom:10px;display:flex;align-items:center;gap:4px">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${col.label}
      </div>
      <button type="button" class="nota-accion-btn btn-${comp ? "secondary" : "primary"}" data-nota-toggle="${n._id}"
        style="width:100%;padding:6px;font-size:12px;text-align:center;${comp ? "" : "background:var(--success,#1D9E75);color:#fff;border:none;border-radius:var(--radius-sm)"}">
        ${comp ? "↩ Desmarcar" : "✓ Marcar como completada"}
      </button>
    </div>`;
  }).join("");
}

// ── Render bloque notas en Dashboard ──
function renderNotasDashboard() {
  const wrap = document.getElementById("inicioNotasWrap");
  if (!wrap) return;

  const pendientes = notasData
    .filter(n => !n.completada)
    .sort((a,b) => {
      if (!a.fecha && !b.fecha) return 0;
      if (!a.fecha) return 1;
      if (!b.fecha) return -1;
      return a.fecha.localeCompare(b.fecha);
    })
    .slice(0, 4);

  if (!pendientes.length) {
    wrap.innerHTML = '<div class="empty-row">Sin notas pendientes.</div>';
    return;
  }

  wrap.innerHTML = pendientes.map((n, i) => {
    const col    = colorNota(n);
    const isLast = i === pendientes.length - 1;
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 14px;border-bottom:${isLast ? "none" : "1px solid var(--border)"}">
      <div style="width:7px;height:7px;border-radius:50%;background:${col.dot};flex-shrink:0;margin-top:4px"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.texto || "—"}</div>
        <div style="font-size:11px;color:${col.text};margin-top:1px">${col.label}</div>
      </div>
    </div>`;
  }).join("");
}

// ── Firestore listener ──
function initNotasListener() {
  _unsubs.push(onSnapshot(collection(db, "notas"), snap => {
    notasData = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    if (document.getElementById("view-notas")?.classList.contains("active")) renderNotas();
    renderNotasDashboard();
  }));
}

// ── Modal nueva/editar nota ──
function abrirModalNota(id = null) {
  const n = id ? notasData.find(x => x._id === id) : null;
  document.getElementById("notaEditId").value    = id || "";
  document.getElementById("modalNotaTitulo").textContent = id ? "Editar nota" : "Nueva nota";
  document.getElementById("notaTextoInput").value = n?.texto || "";
  document.getElementById("notaFechaInput").value = n?.fecha || "";
  document.getElementById("btnConfirmarNota").textContent = id ? "Guardar cambios" : "Guardar nota";
  document.getElementById("modalNota").classList.remove("hidden");
  setTimeout(() => document.getElementById("notaTextoInput").focus(), 80);
}
function cerrarModalNota() {
  document.getElementById("modalNota").classList.add("hidden");
}

document.getElementById("btnNuevaNota")?.addEventListener("click",  () => abrirModalNota());
document.getElementById("closeModalNota")?.addEventListener("click",  cerrarModalNota);
document.getElementById("btnCancelarNota")?.addEventListener("click", cerrarModalNota);

document.getElementById("btnConfirmarNota")?.addEventListener("click", async () => {
  const texto = document.getElementById("notaTextoInput").value.trim();
  if (!texto) { showToast("Escribí al menos una nota.", "error"); return; }
  const fecha = document.getElementById("notaFechaInput").value;
  const id    = document.getElementById("notaEditId").value;

  if (id) {
    await updateDoc(doc(db, "notas", id), { texto, fecha });
    showToast("Nota actualizada ✓", "success");
  } else {
    await setDoc(doc(collection(db, "notas")), {
      texto, fecha, completada: false,
      ts: new Date().toISOString(), admin: getNombreUsuario()
    });
    showToast("Nota guardada ✓", "success");
  }
  cerrarModalNota();
});

// ── Delegación en grid de notas ──
document.getElementById("notasGrid")?.addEventListener("click", async e => {
  const btnEdit   = e.target.closest("[data-nota-edit]");
  const btnDel    = e.target.closest("[data-nota-del]");
  const btnToggle = e.target.closest("[data-nota-toggle]");

  if (btnEdit) { abrirModalNota(btnEdit.dataset.notaEdit); return; }

  if (btnDel) {
    if (!confirm("¿Eliminar esta nota?")) return;
    await deleteDoc(doc(db, "notas", btnDel.dataset.notaDel));
    showToast("Nota eliminada ✓", "success");
    return;
  }

  if (btnToggle) {
    const n = notasData.find(x => x._id === btnToggle.dataset.notaToggle);
    if (!n) return;
    await updateDoc(doc(db, "notas", n._id), { completada: !n.completada });
  }
});

// ============================================================
//  TICKET DE VENTA
// ============================================================

function cerrarModalVentaConfirmada() {
  document.getElementById("modalVentaConfirmada").classList.add("hidden");
  showToast("Venta registrada ✓", "success");
}

document.getElementById("btnCerrarVentaConfirmada")?.addEventListener("click", cerrarModalVentaConfirmada);

// ── Ticket térmico (.txt) ──
document.getElementById("btnImprimirTicket")?.addEventListener("click", () => {
  const v = window._ultimaVenta;
  if (!v) return;

  const W = 40;
  const centro = s => s.padStart(Math.floor((W + s.length) / 2)).padEnd(W);
  const linea  = () => "-".repeat(W);
  const lineaPuntos = () => "- ".repeat(W / 2);
  const fila   = (izq, der) => {
    const esp = W - izq.length - der.length;
    return izq + " ".repeat(Math.max(1, esp)) + der;
  };

  const [fy, fm, fd] = v.fecha.split("-");
  const fechaFmt = `${parseInt(fd)}/${parseInt(fm)}/${fy}  ${v.hora || ""}`;
  const metodoLabel = { efectivo: "Efectivo", mp: "Mercado Pago", debito: "Débito", credito: "Crédito" };

  let txt = "";
  txt += centro("JPSoft | Tienda") + "\n";
  txt += centro(fechaFmt) + "\n";
  if (v.nro) txt += centro(fmtNroVenta(v.nro)) + "\n";
  txt += lineaPuntos() + "\n";

  v.items.forEach(item => {
    txt += (item.desc || "").substring(0, W) + "\n";
    const precioStr = fmt(item.precioUnit || 0);
    const subStr    = fmt((item.precioUnit || 0) * (item.qty || 1));
    txt += fila(`  ${item.qty} x ${precioStr}`, subStr) + "\n";
  });

  txt += lineaPuntos() + "\n";
  if (v.descuento > 0) {
    txt += fila("Subtotal", fmt(v.subtotal)) + "\n";
    txt += fila("Descuento", "-" + fmt(v.descuento)) + "\n";
  }
  txt += linea() + "\n";
  txt += fila("TOTAL", fmt(v.total)) + "\n";
  txt += `Metodo: ${metodoLabel[v.metodo] || v.metodo || "—"}` + "\n";
  txt += lineaPuntos() + "\n";
  txt += centro("Gracias por su compra") + "\n";
  txt += centro("JPSoft | Tienda") + "\n";

  // Imprimir via ventana auxiliar
  const win = window.open("", "_blank", "width=400,height=600");
  win.document.write(`<html><head><title>Ticket</title>
    <style>body{font-family:monospace;font-size:12px;white-space:pre;padding:10px}
    @media print{@page{margin:5mm}}</style></head>
    <body>${txt.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
  cerrarModalVentaConfirmada();
});

// ── Ticket PDF ──
document.getElementById("btnGuardarTicketPDF")?.addEventListener("click", async () => {
  const v = window._ultimaVenta;
  if (!v) return;

  const btn  = document.getElementById("btnGuardarTicketPDF");
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = "Generando…";

  const [fy, fm, fd] = v.fecha.split("-");
  const fechaFmt  = `${parseInt(fd)}/${parseInt(fm)}/${fy}`;
  const metodoLabel = { efectivo: "Efectivo", mp: "Mercado Pago", debito: "Débito", credito: "Crédito" };

  const filas = v.items.map(item => `<tr style="border-bottom:1px solid #f5f5f5">
    <td style="padding:5px 0;font-size:12px">${item.desc || "—"}</td>
    <td style="text-align:center;font-size:12px">${item.qty || 1}</td>
    <td style="text-align:right;font-size:12px">${fmt((item.precioUnit||0)*(item.qty||1))}</td>
  </tr>`).join("");

  const descRow = v.descuento > 0 ? `
    <tr><td colspan="2" style="padding:3px 0;font-size:11px;color:#888">Subtotal</td><td style="text-align:right;font-size:11px;color:#888">${fmt(v.subtotal)}</td></tr>
    <tr><td colspan="2" style="padding:3px 0;font-size:11px;color:#888">Descuento</td><td style="text-align:right;font-size:11px;color:#888">-${fmt(v.descuento)}</td></tr>` : "";

  const content = `<div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:#111;padding:24px;max-width:320px;margin:0 auto">
    <div style="font-size:18px;font-weight:600;margin-bottom:2px">JPSoft | Tienda</div>
    <div style="font-size:11px;color:#888;margin-bottom:2px">${fechaFmt} · ${v.hora || ""}</div>
    ${v.nro ? `<div style="font-size:12px;font-weight:600;color:#111;margin-bottom:10px;font-family:monospace">${fmtNroVenta(v.nro)}</div>` : '<div style="margin-bottom:10px"></div>'}
    <div style="border-top:1px solid #eee;margin-bottom:10px"></div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:.05em">
        <th style="text-align:left;padding-bottom:5px;font-weight:400">Producto</th>
        <th style="text-align:center;padding-bottom:5px;font-weight:400">Cant.</th>
        <th style="text-align:right;padding-bottom:5px;font-weight:400">Subtotal</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div style="border-top:1px solid #eee;margin:8px 0 4px"></div>
    <table style="width:100%;border-collapse:collapse">${descRow}
      <tr style="border-top:2px solid #111">
        <td colspan="2" style="padding:6px 0;font-weight:500;font-size:15px">Total</td>
        <td style="text-align:right;font-weight:500;font-size:18px">${fmt(v.total)}</td>
      </tr>
    </table>
    <div style="font-size:11px;color:#888;margin-top:4px">${metodoLabel[v.metodo] || v.metodo || "—"} · ${v.admin || ""}</div>
    <div style="border-top:1px solid #eee;margin-top:14px;padding-top:8px;text-align:center;font-size:10px;color:#bbb">Gracias por su compra · JPSoft | Tienda</div>
  </div>`;

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:360px;background:#fff";
  container.innerHTML = content;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: "#fff" });
    const { jsPDF } = window.jspdf;
    const pdf   = new jsPDF({ orientation: "portrait", unit: "mm", format: [80, 200] });
    const imgW  = 80;
    const imgH  = (canvas.height * imgW) / canvas.width;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, imgW, imgH);
    pdf.save(`Ticket_${v.fecha}_${v.hora?.replace(":", "") || ""}.pdf`);
    cerrarModalVentaConfirmada();
  } catch(err) {
    showToast("Error al generar PDF: " + err.message, "error");
  } finally {
    document.body.removeChild(container);
    btn.disabled = false; btn.innerHTML = orig;
  }
});

// ============================================================
//  ACTUALIZACIÓN MASIVA DE PRECIOS
// ============================================================
let actPreciosTipo = "aumento";

function cerrarModalActualizarPrecios() {
  document.getElementById("modalActualizarPrecios").classList.add("hidden");
}

function abrirModalActualizarPrecios() {
  // Popular proveedores
  const sel = document.getElementById("actPreciosProvSelect");
  sel.innerHTML = '<option value="">Seleccioná un proveedor…</option>';
  Object.values(proveedores).sort((a,b) => a.nombre.localeCompare(b.nombre)).forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.nombre; opt.textContent = p.nombre;
    sel.appendChild(opt);
  });
  // Reset
  actPreciosTipo = "aumento";
  document.querySelectorAll(".act-precio-tipo").forEach(b => {
    const isAumento = b.dataset.tipo === "aumento";
    b.style.background    = isAumento ? "#EEEDFE" : "var(--surface2)";
    b.style.color         = isAumento ? "#3C3489" : "var(--text2)";
    b.style.borderColor   = isAumento ? "#C5C2F5" : "var(--border2)";
    b.style.fontWeight    = isAumento ? "500" : "400";
  });
  document.getElementById("actPreciosPct").value = "0";
  document.getElementById("actPreciosPreview").style.display = "none";
  document.getElementById("modalActualizarPrecios").classList.remove("hidden");
  setTimeout(() => document.getElementById("actPreciosPct").focus(), 80);
}

function renderActPreciosPreview() {
  const prov   = document.getElementById("actPreciosProvSelect").value;
  const pct    = parseFloat(document.getElementById("actPreciosPct").value) || 0;
  const preview = document.getElementById("actPreciosPreview");
  const lista   = document.getElementById("actPreciosPreviewLista");
  const label   = document.getElementById("actPreciosPreviewLabel");

  if (!prov || pct <= 0) { preview.style.display = "none"; return; }

  const productos = allProducts.filter(p => p.proveedor === prov && p.lista > 0);
  if (!productos.length) { preview.style.display = "none"; return; }

  preview.style.display = "block";
  label.textContent = `Vista previa — ${productos.length} producto${productos.length > 1 ? "s" : ""} afectado${productos.length > 1 ? "s" : ""}`;

  lista.innerHTML = productos.slice(0, 8).map(p => {
    const nuevo = actPreciosTipo === "aumento"
      ? Math.round(p.lista * (1 + pct / 100))
      : Math.round(p.lista * (1 - pct / 100));
    return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px">
      <span style="color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;padding-right:10px">${p.desc}</span>
      <span style="color:var(--text3);white-space:nowrap">${fmt(p.lista)} → <strong style="color:var(--text1)">${fmt(nuevo)}</strong></span>
    </div>`;
  }).join("") + (productos.length > 8 ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">... y ${productos.length - 8} más</div>` : "");
}

document.getElementById("btnActualizarPrecios")?.addEventListener("click", abrirModalActualizarPrecios);
document.getElementById("closeModalActualizarPrecios")?.addEventListener("click", cerrarModalActualizarPrecios);
document.getElementById("btnCancelarActualizarPrecios")?.addEventListener("click", cerrarModalActualizarPrecios);

// Chips tipo
document.querySelectorAll(".act-precio-tipo").forEach(btn => {
  btn.addEventListener("click", () => {
    actPreciosTipo = btn.dataset.tipo;
    document.querySelectorAll(".act-precio-tipo").forEach(b => {
      const active = b.dataset.tipo === actPreciosTipo;
      b.style.background  = active ? "#EEEDFE" : "var(--surface2)";
      b.style.color       = active ? "#3C3489" : "var(--text2)";
      b.style.borderColor = active ? "#C5C2F5" : "var(--border2)";
      b.style.fontWeight  = active ? "500" : "400";
    });
    renderActPreciosPreview();
  });
});

document.getElementById("actPreciosProvSelect")?.addEventListener("change", renderActPreciosPreview);
document.getElementById("actPreciosPct")?.addEventListener("input", renderActPreciosPreview);

// Aplicar actualización
document.getElementById("btnConfirmarActualizarPrecios")?.addEventListener("click", async () => {
  const prov = document.getElementById("actPreciosProvSelect").value;
  const pct  = parseFloat(document.getElementById("actPreciosPct").value) || 0;

  if (!prov) { showToast("Seleccioná un proveedor.", "error"); return; }
  if (pct <= 0) { showToast("Ingresá un porcentaje mayor a 0.", "error"); return; }

  const productos = allProducts.filter(p => p.proveedor === prov && p.lista > 0);
  if (!productos.length) { showToast("No hay productos con precio para este proveedor.", "error"); return; }

  const tipoLabel = actPreciosTipo === "aumento" ? `+${pct}%` : `-${pct}%`;
  if (!confirm(`¿Aplicar ${tipoLabel} al P. Lista de ${productos.length} productos de ${prov}?\n\nEsta acción no se puede deshacer.`)) return;

  const btn  = document.getElementById("btnConfirmarActualizarPrecios");
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Aplicando…";

  try {
    const batch = writeBatch(db);
    const admin = getNombreUsuario();
    productos.forEach(p => {
      const nuevo = actPreciosTipo === "aumento"
        ? Math.round(p.lista * (1 + pct / 100))
        : Math.round(p.lista * (1 - pct / 100));
      // Guardar historial de precio
      const histRef = doc(collection(db, "productos", p._id, "historialPrecios"));
      batch.set(histRef, {
        anterior: p.lista, nuevo, ts: new Date().toISOString(),
        usuario: admin, motivo: `Actualización masiva ${tipoLabel} — ${prov}`
      });
      // Actualizar precio
      batch.update(doc(db, "productos", p._id), { lista: nuevo });
    });
    await batch.commit();
    registrarLog("precio", `Actualización masiva ${tipoLabel} — ${productos.length} productos · ${prov}`);
    showToast(`Precios actualizados ✓ — ${productos.length} productos de ${prov}`, "success");
    cerrarModalActualizarPrecios();
  } catch(err) {
    showToast("Error al actualizar: " + err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

// ============================================================
//  BÚSQUEDA GLOBAL
// ============================================================
function abrirBusquedaGlobal() {
  document.getElementById("globalSearchBtn").style.display    = "none";
  document.getElementById("globalSearchActive").style.display = "flex";
  document.getElementById("globalSearchInput").focus();
}

function cerrarBusquedaGlobal() {
  document.getElementById("globalSearchBtn").style.display    = "flex";
  document.getElementById("globalSearchActive").style.display = "none";
  document.getElementById("globalSearchInput").value = "";
  document.getElementById("globalSearchResults").style.display = "none";
}

function renderBusquedaGlobal(query) {
  const results = document.getElementById("globalSearchResults");
  if (!query.trim()) { results.style.display = "none"; return; }

  const q = norm(query);
  let html = "";

  // Productos
  const prods = allProducts.filter(p =>
    norm(p.desc||"").includes(q) || norm(String(p.cod||"")).includes(q)
  ).slice(0, 5);

  if (prods.length) {
    html += `<div style="padding:6px 12px;background:var(--surface2);font-size:10px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Productos</div>`;
    html += prods.map(p => {
      const venta = Math.round(getPrecioVenta(p));
      const stock = typeof p.stock === "number" ? `Stock: ${p.stock}` : "";
      return `<div class="global-search-result" data-tipo="producto" data-id="${p._id}"
        style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-bottom:1px solid var(--border);cursor:pointer">
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--text1)">${p.desc || "—"}</div>
          <div style="font-size:11px;color:var(--text3)">${p.proveedor || ""}${stock ? ` · ${stock}` : ""}</div>
        </div>
        <div style="font-size:13px;font-weight:500;color:var(--text1)">${fmt(venta)}</div>
      </div>`;
    }).join("");
  }

  // Clientes
  const clientes = Object.entries(clientesData)
    .filter(([, c]) => norm(c.nombre||"").includes(q))
    .slice(0, 4);

  if (clientes.length) {
    html += `<div style="padding:6px 12px;background:var(--surface2);font-size:10px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Clientes</div>`;
    html += clientes.map(([id, c]) => {
      const saldo = c.saldo || 0;
      const saldoTxt = saldo < 0
        ? `<span style="color:var(--danger);font-size:12px">Deuda: ${fmt(Math.abs(saldo))}</span>`
        : `<span style="color:var(--text3);font-size:12px">Sin deuda</span>`;
      return `<div class="global-search-result" data-tipo="cliente" data-id="${id}"
        style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-bottom:1px solid var(--border);cursor:pointer">
        <div style="font-size:13px;color:var(--text1)">${c.nombre}</div>
        ${saldoTxt}
      </div>`;
    }).join("");
  }

  // Proveedores
  const provs = Object.entries(proveedores)
    .filter(([, p]) => norm(p.nombre||"").includes(q))
    .slice(0, 3);

  if (provs.length) {
    html += `<div style="padding:6px 12px;background:var(--surface2);font-size:10px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Proveedores</div>`;
    html += provs.map(([id, p]) => `
      <div class="global-search-result" data-tipo="proveedor" data-id="${id}"
        style="display:flex;align-items:center;padding:9px 14px;border-bottom:1px solid var(--border);cursor:pointer">
        <div style="font-size:13px;color:var(--text1)">${p.nombre}</div>
      </div>`).join("");
  }

  if (!html) {
    html = `<div style="padding:14px;text-align:center;font-size:13px;color:var(--text3)">Sin resultados para "${query}"</div>`;
  } else {
    html += `<div style="padding:7px 14px;border-top:1px solid var(--border);text-align:center;font-size:11px;color:var(--text3)">
      Presioná <kbd style="font-size:10px;background:var(--surface2);border:1px solid var(--border2);border-radius:3px;padding:1px 5px">Enter</kbd> para ir a Productos
    </div>`;
  }

  results.innerHTML = html;
  results.style.display = "block";
}

// Eventos
document.getElementById("globalSearchBtn")?.addEventListener("click", abrirBusquedaGlobal);

document.getElementById("globalSearchClear")?.addEventListener("click", cerrarBusquedaGlobal);

let globalSearchFila = -1;

document.getElementById("globalSearchInput")?.addEventListener("input", e => {
  globalSearchFila = -1;
  renderBusquedaGlobal(e.target.value);
});

document.getElementById("globalSearchInput")?.addEventListener("keydown", e => {
  const results = document.getElementById("globalSearchResults");
  const filas   = results?.querySelectorAll(".global-search-result");

  if (e.key === "ArrowDown") {
    e.preventDefault();
    globalSearchFila = Math.min(globalSearchFila + 1, (filas?.length || 1) - 1);
    resaltarFilaGlobal(filas);
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    globalSearchFila = Math.max(globalSearchFila - 1, 0);
    resaltarFilaGlobal(filas);
    return;
  }
  if (e.key === "Escape") { cerrarBusquedaGlobal(); return; }
  if (e.key === "Enter") {
    // Si hay una fila seleccionada, activarla
    if (globalSearchFila >= 0 && filas && filas[globalSearchFila]) {
      filas[globalSearchFila].click();
      return;
    }
    // Si no, ir a Productos con el texto
    const val = e.target.value;
    cerrarBusquedaGlobal();
    document.querySelector('[data-view="productos"]')?.click();
    setTimeout(() => {
      const input = document.getElementById("prodSearchInput");
      if (input) { input.value = val; input.dispatchEvent(new Event("input")); }
    }, 100);
  }
});

function resaltarFilaGlobal(filas) {
  if (!filas) return;
  filas.forEach((f, i) => {
    f.style.background = i === globalSearchFila ? "var(--bg3)" : "";
    if (i === globalSearchFila) f.scrollIntoView({ block: "nearest" });
  });
}

// Click en resultado
document.getElementById("globalSearchResults")?.addEventListener("click", e => {
  const row = e.target.closest(".global-search-result");
  if (!row) return;
  const tipo = row.dataset.tipo;
  const id   = row.dataset.id;
  cerrarBusquedaGlobal();

  if (tipo === "producto") {
    document.querySelector('[data-view="productos"]')?.click();
    setTimeout(() => {
      const p = allProducts.find(x => x._id === id);
      if (p) {
        const input = document.getElementById("prodSearchInput");
        if (input) { input.value = p.desc; input.dispatchEvent(new Event("input")); }
      }
    }, 100);
  }
  if (tipo === "cliente") {
    document.querySelector('[data-view="clientes"]')?.click();
    setTimeout(() => { clienteExpandidoId = id; renderClientesLista(); }, 300);
  }
  if (tipo === "proveedor") {
    document.querySelector('[data-view="proveedores"]')?.click();
  }
});

// Cerrar al hacer click fuera
document.addEventListener("click", e => {
  if (!document.getElementById("globalSearchWrap")?.contains(e.target)) {
    cerrarBusquedaGlobal();
  }
});

// Atajo Ctrl+F
document.addEventListener("keydown", e => {
  if (e.key === "f" && e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    abrirBusquedaGlobal();
  }
});

// ============================================================
//  USUARIOS Y ROLES
// ============================================================
let usuariosData = [];

function renderUsuarios() {
  const tbody = document.getElementById("usuariosTableBody");
  const empty = document.getElementById("usuariosEmpty");
  if (!tbody) return;

  if (!usuariosData.length) {
    tbody.innerHTML = ""; empty.style.display = "block"; return;
  }
  empty.style.display = "none";

  const ROL_BADGE = {
    administrador: { bg: "#EAF3DE", color: "#3B6D11", label: "Administrador" },
    empleado:      { bg: "#E6F1FB", color: "#185FA5", label: "Empleado" },
  };
  const EST_BADGE = {
    true:  { bg: "#E6F1FB", color: "#185FA5", label: "Activo" },
    false: { bg: "#FCEBEB", color: "#A32D2D", label: "Inactivo" },
  };

  const usuarios = [...usuariosData].sort((a,b) => {
    if (a.rol === "administrador" && b.rol !== "administrador") return -1;
    if (b.rol === "administrador" && a.rol !== "administrador") return 1;
    return (a.nombre||"").localeCompare(b.nombre||"");
  });

  tbody.innerHTML = usuarios.map(u => {
    const rolB = ROL_BADGE[u.rol] || ROL_BADGE.empleado;
    const estB = EST_BADGE[String(u.activo !== false)];
    const inic = iniciales(u.nombre || u.email || "?");
    const esAdmin = u.rol === "administrador" && auth.currentUser?.uid === u._id;
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:9px">
          <div style="width:30px;height:30px;border-radius:50%;background:#EAF3DE;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#3B6D11;flex-shrink:0">${inic}</div>
          <div style="font-size:13px;font-weight:500;color:var(--text1)">${u.nombre || "—"}</div>
        </div>
      </td>
      <td style="font-size:12px;color:var(--text2)">${u.email || "—"}</td>
      <td style="text-align:center"><span style="font-size:11px;font-weight:500;padding:2px 10px;border-radius:10px;background:${rolB.bg};color:${rolB.color}">${rolB.label}</span></td>
      <td style="text-align:center"><span style="font-size:11px;font-weight:500;padding:2px 10px;border-radius:10px;background:${estB.bg};color:${estB.color}">${estB.label}</span></td>
      <td style="text-align:center">
        ${esAdmin ? "<span style='font-size:11px;color:var(--text3)'>—</span>" : `
          <div style="display:flex;gap:6px;justify-content:center">
            <button type="button" class="usr-edit-btn" data-uid="${u._id}" style="background:none;border:none;cursor:pointer;padding:3px;color:var(--text3)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button type="button" class="usr-toggle-btn" data-uid="${u._id}" data-activo="${u.activo !== false}" style="background:none;border:none;cursor:pointer;padding:3px;color:var(--text3)" title="${u.activo !== false ? 'Desactivar' : 'Activar'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${u.activo !== false ? 'M18.36 6.64A9 9 0 0 1 20.77 15' : 'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z'}"/>${u.activo !== false ? '<path d="M12 22a10 10 0 0 1-7.07-2.93"/>' : ''}</svg>
            </button>
          </div>`}
      </td>
    </tr>`;
  }).join("");
}

// ── Firestore listener ──
function initUsuariosListener() {
  _unsubs.push(onSnapshot(collection(db, "usuarios"), snap => {
    usuariosData = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    if (document.getElementById("view-usuarios")?.classList.contains("active")) renderUsuarios();
  }));
}

// ── Modal nuevo/editar usuario ──
function abrirModalUsuario(uid = null) {
  const u = uid ? usuariosData.find(x => x._id === uid) : null;
  document.getElementById("usuarioEditUid").value = uid || "";
  document.getElementById("modalUsuarioTitulo").textContent = uid ? "Editar usuario" : "Nuevo usuario";
  document.getElementById("usuarioNombreInput").value = u?.nombre || "";
  document.getElementById("usuarioEmailInput").value  = u?.email  || "";
  document.getElementById("usuarioPassInput").value   = "";
  document.getElementById("usuarioRolSelect").value   = u?.rol || "empleado";
  document.getElementById("btnConfirmarUsuario").textContent = uid ? "Guardar cambios" : "Crear usuario";
  // Al editar, ocultar email y pass
  document.getElementById("usuarioEmailWrap").style.display = uid ? "none" : "block";
  document.getElementById("usuarioPassWrap").style.display  = uid ? "none" : "block";
  document.getElementById("modalUsuario").classList.remove("hidden");
  setTimeout(() => document.getElementById("usuarioNombreInput").focus(), 80);
}

function cerrarModalUsuario() {
  document.getElementById("modalUsuario").classList.add("hidden");
}

document.getElementById("btnNuevoUsuario")?.addEventListener("click", () => abrirModalUsuario());
document.getElementById("closeModalUsuario")?.addEventListener("click", cerrarModalUsuario);
document.getElementById("btnCancelarUsuario")?.addEventListener("click", cerrarModalUsuario);

document.getElementById("btnConfirmarUsuario")?.addEventListener("click", async () => {
  const nombre = document.getElementById("usuarioNombreInput").value.trim();
  const email  = document.getElementById("usuarioEmailInput").value.trim();
  const pass   = document.getElementById("usuarioPassInput").value;
  const rol    = document.getElementById("usuarioRolSelect").value;
  const uid    = document.getElementById("usuarioEditUid").value;

  if (!nombre) { showToast("Ingresá un nombre.", "error"); return; }

  const btn  = document.getElementById("btnConfirmarUsuario");
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Procesando…";

  try {
    if (uid) {
      // Solo editar nombre y rol
      await updateDoc(doc(db, "usuarios", uid), { nombre, rol });
      showToast("Usuario actualizado ✓", "success");
    } else {
      // Crear nuevo usuario con segunda instancia de Firebase
      if (!email) { showToast("Ingresá un email.", "error"); return; }
      if (pass.length < 6) { showToast("La contraseña debe tener al menos 6 caracteres.", "error"); return; }

      const { initializeApp: initApp2 } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const { getAuth: getAuth2, createUserWithEmailAndPassword: createUser } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");

      const app2  = initApp2(firebaseConfig, "app2-" + Date.now());
      const auth2 = getAuth2(app2);
      const cred  = await createUser(auth2, email, pass);
      const newUid = cred.user.uid;

      // Guardar en Firestore
      await setDoc(doc(db, "usuarios", newUid), {
        nombre, email, rol, activo: true, creado: new Date().toISOString()
      });

      // Cerrar la segunda instancia
      await auth2.signOut();

      registrarLog("usuario", `Usuario creado — ${nombre} (${rol})`);
      showToast(`Usuario creado ✓ — ${nombre}`, "success");
    }
    cerrarModalUsuario();
  } catch(err) {
    const msg = err.code === "auth/email-already-in-use" ? "Ese email ya está en uso." :
                err.code === "auth/invalid-email" ? "Email inválido." : err.message;
    showToast("Error: " + msg, "error");
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

// Delegación en tabla de usuarios
document.getElementById("usuariosTableBody")?.addEventListener("click", async e => {
  const editBtn   = e.target.closest(".usr-edit-btn");
  const toggleBtn = e.target.closest(".usr-toggle-btn");

  if (editBtn) { abrirModalUsuario(editBtn.dataset.uid); return; }

  if (toggleBtn) {
    const uid    = toggleBtn.dataset.uid;
    const activo = toggleBtn.dataset.activo === "true";
    await updateDoc(doc(db, "usuarios", uid), { activo: !activo });
    showToast(`Usuario ${!activo ? "activado" : "desactivado"} ✓`, "success");
  }
});

// ============================================================
//  NOTIFICACIONES Y ALERTAS
// ============================================================
let notifPermiso     = false;
let notifEnviadas    = new Set(); // IDs ya notificados en esta sesión
let alertasActivas   = [];

// ── Pedir permiso ──
async function pedirPermisoNotificaciones() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") { notifPermiso = true; return; }
  if (Notification.permission === "denied") return;
  const result = await Notification.requestPermission();
  notifPermiso = result === "granted";
}

// ── Enviar notificación nativa ──
function enviarNotif(titulo, cuerpo, id) {
  if (!notifPermiso) return;
  if (notifEnviadas.has(id)) return;
  notifEnviadas.add(id);
  try {
    const n = new Notification(titulo, {
      body: cuerpo,
      icon: "/icon-192.png",
      tag: id
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch(e) {}
}

// ── Calcular todas las alertas ──
function calcularAlertas() {
  const alertas = [];
  const hoy     = new Date(); hoy.setHours(0,0,0,0);
  const manana  = new Date(hoy); manana.setDate(hoy.getDate() + 1);
  const hoyKey  = hoy.toISOString().slice(0,10);

  // 1. Stock bajo
  const sinStock   = allProducts.filter(p => typeof p.stock === "number" && p.stock <= 0);
  const stockBajo  = allProducts.filter(p => typeof p.stock === "number" && p.stock > 0 && p.stock <= (p.stockMin || 5));
  sinStock.forEach(p => alertas.push({ id: `stock-0-${p._id}`, tipo: "stock", nivel: "critico", texto: `Sin stock — ${p.desc}`, accion: "productos" }));
  stockBajo.forEach(p => alertas.push({ id: `stock-bajo-${p._id}`, tipo: "stock", nivel: "warning", texto: `Stock bajo — ${p.desc} (${p.stock} unid.)`, accion: "productos" }));

  // 2. Notas vencidas o que vencen hoy/mañana
  notasData.filter(n => !n.completada && n.fecha).forEach(n => {
    const fechaN = new Date(n.fecha + "T00:00:00");
    if (fechaN <= hoy) alertas.push({ id: `nota-venc-${n._id}`, tipo: "nota", nivel: "critico", texto: `Nota vencida — ${n.texto?.substring(0,50)}`, accion: "notas" });
    else if (fechaN.getTime() === manana.getTime()) alertas.push({ id: `nota-manana-${n._id}`, tipo: "nota", nivel: "warning", texto: `Recordatorio mañana — ${n.texto?.substring(0,50)}`, accion: "notas" });
  });

  // 3. Clientes con deuda hace más de 7 días sin movimiento
  Object.values(clientesData).forEach(c => {
    if ((c.saldo || 0) >= 0) return;
    const ultimoMov = c.ultimoMov || c.creado || 0;
    const diasSinMov = Math.floor((Date.now() - ultimoMov) / 86400000);
    if (diasSinMov >= 7) alertas.push({
      id: `cliente-deuda-${c.nombre}`, tipo: "cliente", nivel: "warning",
      texto: `${c.nombre} debe ${fmt(Math.abs(c.saldo))} sin movimiento hace ${diasSinMov} días`, accion: "clientes"
    });
  });

  // 4. Caja — turno no abierto después de las 9hs
  const horaActual = new Date().getHours();
  const diaData    = cajaData[hoyKey] || {};
  const turnoAbierto = (diaData.manana?.apertura && !diaData.manana?.cierre) ||
                       (diaData.tarde?.apertura  && !diaData.tarde?.cierre);
  const ningunoAbierto = !diaData.manana?.apertura && !diaData.tarde?.apertura;
  if (ningunoAbierto && horaActual >= 9 && horaActual < 22) {
    alertas.push({ id: `caja-sin-abrir-${hoyKey}`, tipo: "caja", nivel: "warning", texto: "Caja sin abrir — recordá abrir el turno", accion: "caja" });
  }

  // 5. Turno abierto hace más de 12hs
  ["manana","tarde"].forEach(turno => {
    const ap = diaData[turno]?.apertura;
    if (ap && !diaData[turno]?.cierre && ap.hora) {
      const [h, m] = ap.hora.split(":").map(Number);
      const apertura = new Date(); apertura.setHours(h, m, 0, 0);
      const horasAbierto = (Date.now() - apertura.getTime()) / 3600000;
      if (horasAbierto > 12) alertas.push({
        id: `caja-turno-largo-${turno}-${hoyKey}`, tipo: "caja", nivel: "warning",
        texto: `Turno ${turno === "manana" ? "mañana" : "tarde"} abierto hace más de 12 horas`, accion: "caja"
      });
    }
  });

  return alertas;
}

// ── Render panel de alertas ──
function renderNotifPanel() {
  alertasActivas = calcularAlertas();
  const badge = document.getElementById("notifBadge");
  const body  = document.getElementById("notifPanelBody");

  // Badge
  if (badge) {
    if (alertasActivas.length > 0) {
      badge.textContent = alertasActivas.length;
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }
  }

  if (!body) return;
  if (!alertasActivas.length) {
    body.innerHTML = '<div class="empty-row">Sin alertas activas.</div>';
    return;
  }

  const TIPO_ICON = {
    stock:   "ti-box",
    nota:    "ti-notes",
    cliente: "ti-users",
    caja:    "ti-cash",
  };
  const TIPO_COLOR = {
    critico: { bg: "#FCEBEB", color: "#A32D2D", dot: "#E24B4A" },
    warning: { bg: "#FAEEDA", color: "#854F0B", dot: "#BA7517" },
  };
  const ACCION_LABEL = { productos: "Ver Productos", notas: "Ver Notas", clientes: "Ver Clientes", caja: "Ver Caja" };

  body.innerHTML = alertasActivas.map((a, i) => {
    const col    = TIPO_COLOR[a.nivel] || TIPO_COLOR.warning;
    const icon   = TIPO_ICON[a.tipo]   || "ti-bell";
    const isLast = i === alertasActivas.length - 1;
    return `<div class="notif-fila" style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:${isLast ? "none" : "1px solid var(--border)"}">
      <div style="width:8px;height:8px;border-radius:50%;background:${col.dot};flex-shrink:0;margin-top:4px"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.texto}</div>
        <button type="button" class="notif-accion-btn" data-accion="${a.accion}"
          style="font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;padding:0;margin-top:3px;font-family:inherit">
          ${ACCION_LABEL[a.accion] || "Ver"} →
        </button>
      </div>
    </div>`;
  }).join("");

  // Enviar notificaciones nativas para las nuevas
  const grupos = {};
  alertasActivas.forEach(a => {
    if (!grupos[a.tipo]) grupos[a.tipo] = [];
    grupos[a.tipo].push(a);
  });
  Object.entries(grupos).forEach(([tipo, lista]) => {
    const id = `grupo-${tipo}-${lista.map(a=>a.id).join("")}`;
    const titulos = { stock: "⚠️ Stock bajo", nota: "📝 Recordatorios", cliente: "💰 Clientes con deuda", caja: "🏪 Alerta de caja" };
    const cuerpo = lista.map(a => a.texto).join("\n");
    enviarNotif(titulos[tipo] || "Alerta", cuerpo, id);
  });
}

// ── Toggle panel ──
let notifFilaActiva = -1;

function resaltarFilaNotif() {
  const filas = document.querySelectorAll("#notifPanelBody .notif-fila");
  filas.forEach((f, i) => {
    f.style.background = i === notifFilaActiva ? "var(--bg3)" : "";
  });
  if (notifFilaActiva >= 0 && filas[notifFilaActiva]) {
    filas[notifFilaActiva].scrollIntoView({ block: "nearest" });
  }
}

document.addEventListener("keydown", e => {
  const panel = document.getElementById("notifPanel");
  if (!panel || panel.style.display === "none") return;
  const filas = document.querySelectorAll("#notifPanelBody .notif-fila");
  if (!filas.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    notifFilaActiva = Math.min(notifFilaActiva + 1, filas.length - 1);
    resaltarFilaNotif();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    notifFilaActiva = Math.max(notifFilaActiva - 1, 0);
    resaltarFilaNotif();
  } else if (e.key === "Enter" && notifFilaActiva >= 0) {
    e.preventDefault();
    filas[notifFilaActiva]?.querySelector(".notif-accion-btn")?.click();
  } else if (e.key === "Escape") {
    panel.style.display = "none";
    notifFilaActiva = -1;
  }
});
document.getElementById("btnNotificaciones")?.addEventListener("click", e => {
  e.stopPropagation();
  const panel = document.getElementById("notifPanel");
  if (panel.style.display === "none") {
    notifFilaActiva = -1;
    renderNotifPanel();
    panel.style.display = "block";
  } else {
    panel.style.display = "none";
    notifFilaActiva = -1;
  }
});

document.getElementById("btnCerrarNotifPanel")?.addEventListener("click", () => {
  document.getElementById("notifPanel").style.display = "none";
});

// Cerrar al hacer click fuera
document.addEventListener("click", e => {
  const panel = document.getElementById("notifPanel");
  const btn   = document.getElementById("btnNotificaciones");
  if (panel && !panel.contains(e.target) && !btn?.contains(e.target)) {
    panel.style.display = "none";
  }
});

// Navegar al hacer click en acción
document.getElementById("notifPanelBody")?.addEventListener("click", e => {
  const btn = e.target.closest(".notif-accion-btn");
  if (!btn) return;
  document.getElementById("notifPanel").style.display = "none";
  document.querySelector(`[data-view="${btn.dataset.accion}"]`)?.click();
});

// ── Modal de permiso ──
function mostrarModalPermiso() {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "default") return;
  if (localStorage.getItem("notif-rechazado")) return;

  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:3000;display:flex;align-items:center;justify-content:center";
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:var(--radius);padding:0;width:420px;overflow:hidden;border:1px solid var(--border)">
      <div style="padding:16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;border-radius:50%;background:#EAF3DE;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B6D11" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </div>
        <div>
          <div style="font-size:14px;font-weight:500;color:var(--text1)">Activar alertas de stock</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">Recibí notificaciones de stock bajo, notas vencidas y más</div>
        </div>
      </div>
      <div style="padding:12px 16px;display:flex;gap:8px;justify-content:flex-end">
        <button id="notifRechazar" style="font-size:13px;padding:7px 14px">Ahora no</button>
        <button id="notifAceptar" style="font-size:13px;padding:7px 14px;background:#1D9E75;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;font-family:inherit">Activar notificaciones</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("#notifAceptar").addEventListener("click", async () => {
    document.body.removeChild(overlay);
    await pedirPermisoNotificaciones();
    renderNotifPanel();
  });
  overlay.querySelector("#notifRechazar").addEventListener("click", () => {
    localStorage.setItem("notif-rechazado", "1");
    document.body.removeChild(overlay);
  });
}

// ── Inicialización ──
function initNotificaciones() {
  // Pedir permiso después de 3 segundos
  setTimeout(mostrarModalPermiso, 3000);
  // Verificar permisos existentes
  if (Notification.permission === "granted") notifPermiso = true;
  // Calcular badge inicial
  setTimeout(renderNotifPanel, 2000);
  // Recalcular cada 5 minutos
  setInterval(renderNotifPanel, 5 * 60 * 1000);
}

// ============================================================
//  Nº DE VENTA CORRELATIVO
// ============================================================
async function getNroVenta() {
  try {
    const ref  = doc(db, "config", "contadores");
    const snap = await getDoc(ref);
    const actual = snap.exists() ? (snap.data().nroVenta || 0) : 0;
    const nuevo  = actual + 1;
    await setDoc(ref, { nroVenta: nuevo }, { merge: true });
    nroVentaActual = nuevo;
    return nuevo;
  } catch(e) {
    nroVentaActual = Math.floor(Math.random() * 9000) + 1000; // fallback
    return nroVentaActual;
  }
}

function fmtNroVenta(n) {
  return `#${String(n).padStart(5, "0")}`;
}

// ── Mostrar Nº de venta al abrir el modal de cobro ──
const _origRenderModalVenta = window.renderModalVenta;
document.getElementById("btnConfirmarVenta")?.addEventListener("click", async () => {
  const nro = await getNroVenta();
  const el  = document.getElementById("modalVentaNro");
  if (el) el.textContent = fmtNroVenta(nro);
}, true); // capture = true para que corra antes del listener principal

// Botón Caja en topbar
document.getElementById("btnCajaTopbar")?.addEventListener("click", () => {
  document.querySelector('[data-view="caja"]')?.click();
});

function updateCajaTopbar() {
  const badge = document.getElementById("cajaBadgeTopbar");
  const total = document.getElementById("cajaTotalTopbar");
  if (!badge || !total) return;
  const hoy = cajaData[todayKey()];
  const mañanaAbierta = hoy?.manana?.apertura && !hoy?.manana?.cierre;
  const tardeAbierta  = hoy?.tarde?.apertura  && !hoy?.tarde?.cierre;
  const turnoAbierto  = mañanaAbierta || tardeAbierta;
  const turno = mañanaAbierta ? "manana" : "tarde";
  badge.style.background = turnoAbierto ? "#22c55e" : "var(--text3)";
  if (turnoAbierto && hoy?.[turno]?.ventas) {
    const t = Object.values(hoy[turno].ventas).reduce((s, v) => s + (v.total||0), 0);
    total.textContent = fmt(Math.round(t));
  } else {
    total.textContent = turnoAbierto ? fmt(0) : "—";
  }
}

// ── Cotización del dólar — carga automática desde dolarapi.com ──
const cotizInput = document.getElementById("cotizacionDolar");

// Cargar del localStorage como valor inicial
const _cotizGuardada = localStorage.getItem("jpsoft_cotiz_dolar");
if (cotizInput && _cotizGuardada) cotizInput.value = _cotizGuardada;

// Guardar al editar manualmente
cotizInput?.addEventListener("change", () => {
  localStorage.setItem("jpsoft_cotiz_dolar", cotizInput.value);
});

// Cargar cotización en tiempo real desde dolarapi.com
async function cargarCotizacionDolar() {
  try {
    const res  = await fetch("https://dolarapi.com/v1/dolares/oficial");
    const data = await res.json();
    const venta = data?.venta;
    if (venta && cotizInput) {
      cotizInput.value = Math.round(venta);
      localStorage.setItem("jpsoft_cotiz_dolar", Math.round(venta));
    }
  } catch(e) {
    // Si falla la API usa el valor guardado en localStorage
    console.warn("No se pudo cargar la cotización del dólar:", e);
  }
}

// Cargar al iniciar (con un pequeño delay para no bloquear el boot)
setTimeout(cargarCotizacionDolar, 2000);

// ============================================================
//  EXPORTAR / IMPRIMIR CLIENTES
// ============================================================
document.getElementById("btnExportarClientesExcel")?.addEventListener("click", () => {
  const lista = Object.values(clientesData).sort((a,b) => (a.nombre||"").localeCompare(b.nombre||""));
  if (!lista.length) { showToast("No hay clientes para exportar.", "warning"); return; }

  const data = [["Nombre","Razón Social","WhatsApp","Email","Condición IVA","CUIT/CUIL","DNI","Domicilio","Localidad","Saldo"]];
  lista.forEach(c => {
    data.push([
      c.nombre || "", c.razonSocial || "", c.telefono || "", c.email || "",
      c.iva || "", c.cuit || "", c.dni || "", c.domicilio || "", c.localidad || "",
      c.saldo || 0
    ]);
  });

  exportarExcel([{ nombre: "Clientes", data, colsMoney: [9] }], `JPSoft_Tienda_Clientes_${todayKey()}.xlsx`);
});

document.getElementById("btnImprimirClientesPDF")?.addEventListener("click", async () => {
  const lista = Object.values(clientesData).sort((a,b) => (a.nombre||"").localeCompare(b.nombre||""));
  if (!lista.length) { showToast("No hay clientes para imprimir.", "warning"); return; }

  const now = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });
  const filas = lista.map(c => {
    const saldoColor = (c.saldo||0) < 0 ? "#A32D2D" : "#111";
    return `<tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:5px 8px;font-size:12px;font-weight:500">${c.nombre||"—"}</td>
      <td style="padding:5px 8px;font-size:11px;color:#666">${c.razonSocial||"—"}</td>
      <td style="padding:5px 8px;font-size:11px;color:#666">${c.telefono||"—"}</td>
      <td style="padding:5px 8px;font-size:11px;color:#666">${c.localidad||"—"}</td>
      <td style="padding:5px 8px;font-size:11px;color:#666">${c.iva||"—"}</td>
      <td style="padding:5px 8px;text-align:right;font-weight:600;color:${saldoColor}">${fmt(c.saldo||0)}</td>
    </tr>`;
  }).join("");

  const content = `
    <div style="font-family:'DM Sans',sans-serif;font-size:13px;color:#111;padding:2rem;max-width:720px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
        <div style="font-size:18px;font-weight:600">JPSoft | Tienda</div>
        <div style="font-size:11px;color:#888">Generado el ${now}</div>
      </div>
      <div style="font-size:12px;color:#888;margin-bottom:1.25rem">Listado de clientes</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f5f5f5;font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:.05em">
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Nombre</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Razón Social</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">WhatsApp</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Localidad</th>
            <th style="padding:6px 8px;text-align:left;font-weight:500;border-bottom:1px solid #eee">Cond. IVA</th>
            <th style="padding:6px 8px;text-align:right;font-weight:500;border-bottom:1px solid #eee">Saldo</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;

  const btn  = document.getElementById("btnImprimirClientesPDF");
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = "Generando…";

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:760px;background:#fff";
  container.innerHTML = content;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: "#fff" });
    const { jsPDF } = window.jspdf;
    const pdf  = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const imgW = 297;
    const imgH = (canvas.height * imgW) / canvas.width;
    const pages = Math.ceil(imgH / 210);
    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, -i * 210, imgW, imgH);
    }
    pdf.save(`JPSoft_Tienda_Clientes_${todayKey()}.pdf`);
    showToast("PDF generado ✓", "success");
  } catch(err) {
    showToast("Error al generar PDF: " + err.message, "error");
  } finally {
    document.body.removeChild(container);
    btn.disabled = false; btn.innerHTML = orig;
  }
});

// ============================================================
//  VALORIZAR STOCK
// ============================================================
document.getElementById("btnValorizarStock")?.addEventListener("click", () => {
  const prods = allProducts.filter(p => p.activo !== false && typeof p.stock === "number" && p.stock > 0);
  let totalLista = 0, totalVenta = 0, totalUnits = 0;
  prods.forEach(p => {
    const units = p.stock || 0;
    totalLista  += (p.lista || 0) * units;
    totalVenta  += getPrecioVenta(p) * units;
    totalUnits  += units;
  });
  const ganancia = totalVenta - totalLista;
  document.getElementById("valStockLista").textContent    = fmt(Math.round(totalLista));
  document.getElementById("valStockVenta").textContent    = fmt(Math.round(totalVenta));
  document.getElementById("valStockProds").textContent    = prods.length;
  document.getElementById("valStockUnits").textContent    = totalUnits;
  document.getElementById("valStockGanancia").textContent = fmt(Math.round(ganancia));
  document.getElementById("modalValorizarStock").classList.remove("hidden");
});
document.getElementById("closeModalValorizarStock")?.addEventListener("click",  () => document.getElementById("modalValorizarStock").classList.add("hidden"));
document.getElementById("closeModalValorizarStock2")?.addEventListener("click", () => document.getElementById("modalValorizarStock").classList.add("hidden"));
document.getElementById("modalValorizarStock")?.addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden"); });

// ============================================================
//  VER VENTAS POR PRODUCTO
// ============================================================
let vpProdId   = null;
let vpPeriodo  = "7";

window._verVentasProducto = function(id, desc) {
  vpProdId  = id;
  vpPeriodo = "7";
  document.getElementById("modalVentasProdNombre").textContent = desc;
  // Resetear chips
  document.querySelectorAll(".vp-periodo").forEach(b => {
    const active = b.dataset.periodo === vpPeriodo;
    b.style.background = active ? "var(--accent)" : "var(--surface2)";
    b.style.color      = active ? "#fff" : "var(--text2)";
  });
  renderVentasProducto();
  document.getElementById("modalVentasProducto").classList.remove("hidden");
};

function renderVentasProducto() {
  const p    = allProducts.find(x => x._id === vpProdId);
  const desc = p?.desc || "";
  const now  = new Date();
  let desde;
  if (vpPeriodo === "7")    desde = new Date(now - 7 * 86400000);
  else if (vpPeriodo === "30") desde = new Date(now - 30 * 86400000);
  else if (vpPeriodo === "mes")  desde = new Date(now.getFullYear(), now.getMonth(), 1);
  else desde = new Date(now.getFullYear(), 0, 1);

  const ventas = [];
  Object.entries(cajaData).forEach(([fecha, dia]) => {
    const [y, m, d] = fecha.split("-").map(Number);
    const fechaDate = new Date(y, m - 1, d);
    if (fechaDate < desde) return;
    ["manana", "tarde"].forEach(turno => {
      Object.values(dia[turno]?.ventas || {}).forEach(v => {
        (v.items || []).forEach(item => {
          const matchDesc = (item.desc || "").toLowerCase() === desc.toLowerCase();
          const matchId   = vpProdId && item.prodId === vpProdId;
          if (matchDesc || matchId) {
            ventas.push({ fecha, hora: v.hora || "", qty: item.qty || 1, precioUnit: item.precioUnit || 0, subtotal: item.subtotal || 0 });
          }
        });
      });
    });
  });

  ventas.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora));

  const totalUnidades = ventas.reduce((s, v) => s + v.qty, 0);
  const totalRecaudado = ventas.reduce((s, v) => s + v.subtotal, 0);
  document.getElementById("vpStatUnidades").textContent = totalUnidades;
  document.getElementById("vpStatTrans").textContent    = ventas.length;
  document.getElementById("vpStatTotal").textContent    = fmt(Math.round(totalRecaudado));

  const sub = p ? `${p.proveedor || ""} · Stock actual: ${p.stock ?? "—"}` : "";
  document.getElementById("modalVentasProdSub").textContent = sub;

  const tbody = document.getElementById("vpTableBody");
  if (!ventas.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">Sin ventas en el período.</td></tr>`;
    return;
  }
  tbody.innerHTML = ventas.map(v => {
    const [fy, fm, fd] = v.fecha.split("-");
    return `<tr>
      <td style="font-size:12px;font-family:'DM Mono',monospace">${parseInt(fd)}/${parseInt(fm)}/${fy}</td>
      <td style="font-size:12px;color:var(--text3)">${v.hora}</td>
      <td class="num" style="font-weight:600">${v.qty}</td>
      <td class="num">${fmt(v.precioUnit)}</td>
      <td class="num" style="font-weight:600">${fmt(v.subtotal)}</td>
    </tr>`;
  }).join("");
}

// Chips de período
document.getElementById("modalVentasProducto")?.addEventListener("click", e => {
  const chip = e.target.closest(".vp-periodo");
  if (chip) {
    vpPeriodo = chip.dataset.periodo;
    document.querySelectorAll(".vp-periodo").forEach(b => {
      const active = b.dataset.periodo === vpPeriodo;
      b.style.background = active ? "var(--accent)" : "var(--surface2)";
      b.style.color      = active ? "#fff" : "var(--text2)";
    });
    renderVentasProducto();
  }
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});
document.getElementById("closeModalVentasProducto")?.addEventListener("click",  () => document.getElementById("modalVentasProducto").classList.add("hidden"));
document.getElementById("closeModalVentasProducto2")?.addEventListener("click", () => document.getElementById("modalVentasProducto").classList.add("hidden"));

// ============================================================
//  MODALES ARRASTRABLES — aplica a todos los modales del sistema
// ============================================================
function hacerArrastrable(overlay) {
  const modal = overlay.querySelector(".modal");
  if (!modal) return;
  const header = modal.querySelector(".modal-header");
  if (!header) return;

  header.style.cursor = "grab";

  let isDragging = false, startX, startY, origLeft, origTop;

  header.addEventListener("mousedown", e => {
    if (e.target.closest("button")) return; // no arrastrar si click en botón
    isDragging = true;
    header.style.cursor = "grabbing";

    // Posicionar el modal absolutamente si no lo está
    const rect = modal.getBoundingClientRect();
    modal.style.position   = "fixed";
    modal.style.margin     = "0";
    modal.style.left       = rect.left + "px";
    modal.style.top        = rect.top  + "px";
    modal.style.transform  = "none";

    startX   = e.clientX;
    startY   = e.clientY;
    origLeft = rect.left;
    origTop  = rect.top;

    e.preventDefault();
  });

  document.addEventListener("mousemove", e => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // Límites para que no salga de la pantalla
    const newLeft = Math.max(0, Math.min(window.innerWidth  - modal.offsetWidth,  origLeft + dx));
    const newTop  = Math.max(0, Math.min(window.innerHeight - modal.offsetHeight, origTop  + dy));

    modal.style.left = newLeft + "px";
    modal.style.top  = newTop  + "px";
  });

  document.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    header.style.cursor = "grab";
  });
}

// Aplicar a todos los modales existentes
document.querySelectorAll(".modal-overlay").forEach(hacerArrastrable);

// Resetear posición al cerrar (para que la próxima vez abra centrado)
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  const observer = new MutationObserver(() => {
    if (overlay.classList.contains("hidden")) {
      const modal = overlay.querySelector(".modal");
      if (modal) {
        modal.style.position  = "";
        modal.style.margin    = "";
        modal.style.left      = "";
        modal.style.top       = "";
        modal.style.transform = "";
      }
    }
  });
  observer.observe(overlay, { attributes: true, attributeFilter: ["class"] });
});

// ============================================================
//  COMPRAS
// ============================================================
let comprasData = [];
let compraItems = [];

function calcTotalCompra() {
  return compraItems.reduce((s, item) => s + (parseFloat(item.precio) || 0) * (parseInt(item.qty) || 0), 0);
}

function renderCompraItemsModal() {
  const wrap = document.getElementById("compraItems");
  if (!wrap) return;
  const provId    = document.getElementById("compraProvSelect")?.value;
  const provNombre = proveedores[provId]?.nombre;
  const provProds  = allProducts.filter(p => p.proveedor === provNombre);

  wrap.innerHTML = compraItems.map((item, i) => `
    <div style="display:grid;grid-template-columns:1fr 80px 100px 28px;gap:6px;align-items:center">
      <select class="form-select" data-ci-prod="${i}" style="font-size:12px">
        <option value="">Seleccioná producto…</option>
        ${provProds.map(p => `<option value="${p._id}" ${item.prodId === p._id ? "selected" : ""}>${p.desc}</option>`).join("")}
      </select>
      <input type="number" class="form-input" data-ci-qty="${i}" value="${item.qty || 1}" min="1"
        placeholder="Cant." style="font-size:12px;text-align:center" />
      <input type="number" class="form-input" data-ci-precio="${i}" value="${item.precio || ""}"
        placeholder="$ costo" style="font-size:12px" />
      <button type="button" data-ci-del="${i}"
        style="background:none;border:none;cursor:pointer;color:var(--text3);padding:4px;display:flex;align-items:center">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>`).join("");

  const total = document.getElementById("compraTotalDisplay");
  if (total) total.textContent = fmt(Math.round(calcTotalCompra()));
}

let compraFilaActiva = -1;

function renderCompras() {
  const tbody = document.getElementById("comprasTableBody");
  const empty = document.getElementById("comprasEmptyMsg");
  if (!tbody) return;

  const hoy    = new Date();
  const mesIni = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0,10);
  const hoyKey = hoy.toISOString().slice(0,10);
  const delMes = comprasData.filter(c => c.fecha >= mesIni && c.fecha <= hoyKey);
  const totalMes = delMes.reduce((s, c) => s + (c.total || 0), 0);
  document.getElementById("cmpStatTotal").textContent = fmt(totalMes);
  document.getElementById("cmpStatCant").textContent  = delMes.length;
  const ultimo = [...comprasData].sort((a,b) => (b.ts||"").localeCompare(a.ts||""))[0];
  document.getElementById("cmpStatProv").textContent  = ultimo?.proveedor || "—";

  if (!comprasData.length) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const lista = [...comprasData].sort((a,b) => (b.ts||"").localeCompare(a.ts||""));
  tbody.innerHTML = lista.map((c, idx) => {
    const [fy,fm,fd] = (c.fecha||"").split("-");
    const fechaFmt = c.fecha ? `${parseInt(fd)}/${parseInt(fm)}/${fy}` : "—";
    const hora     = c.ts ? new Date(c.ts).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}) : "—";
    const prods    = (c.items||[]).map(i => `${i.desc}${i.qty>1?` ×${i.qty}`:""}`).join(", ") || "—";
    const fpBadge  = c.formaPago ? `<span style="font-size:11px;padding:2px 7px;border-radius:10px;background:var(--surface2);color:var(--text2)">${c.formaPago}</span>` : "—";
    const tdBg = compraFilaActiva === idx ? "background:var(--bg3)" : "";
    return `<tr class="compra-row" data-idx="${idx}">
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3);${tdBg}">${fechaFmt}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3);${tdBg}">${hora}</td>
      <td style="${tdBg}"><span class="badge ${badgeClass(c.proveedor)}">${c.proveedor||"—"}</span></td>
      <td style="font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${tdBg}">${c.nroFactura||"—"}</td>
      <td style="font-size:12.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${tdBg}" title="${prods}">${prods}</td>
      <td class="num" style="font-weight:600;${tdBg}">${fmt(c.total||0)}</td>
      <td style="${tdBg}">${fpBadge}</td>
      <td style="font-size:12px;color:var(--text2);${tdBg}">${c.admin||"—"}</td>
    </tr>`;
  }).join("");
}

// Navegación con teclado en Compras
document.getElementById("comprasTableBody")?.addEventListener("keydown", e => {
  if (["ArrowDown","ArrowUp","Escape"].indexOf(e.key) === -1) return;
  e.preventDefault(); e.stopPropagation();
  const lista = [...comprasData].sort((a,b) => (b.ts||"").localeCompare(a.ts||""));
  if (!lista.length) return;
  if (e.key === "ArrowDown")  compraFilaActiva = Math.min(compraFilaActiva + 1, lista.length - 1);
  else if (e.key === "ArrowUp") compraFilaActiva = Math.max(compraFilaActiva - 1, 0);
  else if (e.key === "Escape")  compraFilaActiva = -1;
  renderCompras();
  document.querySelector(`.compra-row[data-idx="${compraFilaActiva}"]`)?.scrollIntoView({ block:"nearest" });
  requestAnimationFrame(() => document.getElementById("comprasTableBody")?.focus());
});

function initComprasListener() {
  _unsubs.push(onSnapshot(collection(db, "compras"), snap => {
    comprasData = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    if (document.getElementById("view-compras")?.classList.contains("active")) renderCompras();
  }));
}

function abrirModalCompra() {
  compraItems = [{ prodId: "", qty: 1, precio: "", desc: "" }];
  document.getElementById("compraNotaInput").value = "";
  document.getElementById("compraNroFactura").value = "";
  document.getElementById("compraFormaPago").value = "Efectivo";
  const sel = document.getElementById("compraProvSelect");
  sel.innerHTML = '<option value="">Seleccioná un proveedor…</option>';
  Object.entries(proveedores).forEach(([id, p]) => {
    const opt = document.createElement("option");
    opt.value = id; opt.textContent = p.nombre;
    sel.appendChild(opt);
  });
  renderCompraItemsModal();
  document.getElementById("modalCompra").classList.remove("hidden");
}

function cerrarModalCompra() {
  document.getElementById("modalCompra").classList.add("hidden");
  compraItems = [];
}

document.getElementById("btnNuevaCompra")?.addEventListener("click", abrirModalCompra);
document.getElementById("closeModalCompra")?.addEventListener("click", cerrarModalCompra);
document.getElementById("btnCancelarCompra")?.addEventListener("click", cerrarModalCompra);

document.getElementById("compraProvSelect")?.addEventListener("change", () => {
  compraItems = [{ prodId: "", qty: 1, precio: "", desc: "" }];
  renderCompraItemsModal();
});

document.getElementById("btnAgregarItemCompra")?.addEventListener("click", () => {
  compraItems.push({ prodId: "", qty: 1, precio: "", desc: "" });
  renderCompraItemsModal();
});

document.getElementById("compraItems")?.addEventListener("change", e => {
  const iProd   = e.target.dataset.ciProd;
  const iQty    = e.target.dataset.ciQty;
  const iPrecio = e.target.dataset.ciPrecio;
  if (iProd !== undefined) {
    const p = allProducts.find(x => x._id === e.target.value);
    compraItems[iProd].prodId = e.target.value;
    compraItems[iProd].desc   = p?.desc || "";
    compraItems[iProd].precio = p?.lista || "";
    renderCompraItemsModal();
  }
  if (iQty !== undefined)    { compraItems[iQty].qty       = parseInt(e.target.value) || 1; renderCompraItemsModal(); }
  if (iPrecio !== undefined) { compraItems[iPrecio].precio = e.target.value;               renderCompraItemsModal(); }
});

document.getElementById("compraItems")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-ci-del]");
  if (!btn) return;
  compraItems.splice(parseInt(btn.dataset.ciDel), 1);
  if (!compraItems.length) compraItems.push({ prodId: "", qty: 1, precio: "", desc: "" });
  renderCompraItemsModal();
});

document.getElementById("btnConfirmarCompra")?.addEventListener("click", async () => {
  const provId = document.getElementById("compraProvSelect")?.value;
  if (!provId) { showToast("Seleccioná un proveedor.", "error"); return; }

  const itemsValidos = compraItems.filter(i => i.prodId && (parseInt(i.qty)||0) > 0);
  if (!itemsValidos.length) { showToast("Agregá al menos un producto.", "error"); return; }

  const prov       = proveedores[provId]?.nombre || "—";
  const nota       = document.getElementById("compraNotaInput")?.value.trim();
  const nroFactura = document.getElementById("compraNroFactura")?.value.trim();
  const formaPago  = document.getElementById("compraFormaPago")?.value || "Efectivo";
  const total      = Math.round(calcTotalCompra());
  const fecha      = todayKey();

  const compraRef = doc(collection(db, "compras"));
  await setDoc(compraRef, {
    proveedor: prov, provId, nota, nroFactura, formaPago,
    items: itemsValidos.map(i => ({
      prodId: i.prodId, desc: i.desc,
      qty: parseInt(i.qty)||1,
      precio: parseFloat(i.precio)||0,
      subtotal: Math.round((parseFloat(i.precio)||0) * (parseInt(i.qty)||1))
    })),
    total, fecha, ts: new Date().toISOString(),
    admin: getNombreUsuario()
  });

  for (const item of itemsValidos) {
    const prod = allProducts.find(p => p._id === item.prodId);
    if (prod && typeof prod.stock === "number") {
      await updateDoc(doc(db, "productos", item.prodId), {
        stock: prod.stock + (parseInt(item.qty) || 0),
        lista: parseFloat(item.precio) || prod.lista
      });
    }
  }

  registrarLog("compra", `Compra registrada — ${fmt(total)} · ${prov}${nroFactura ? ` · Fact. ${nroFactura}` : ""}`);
  showToast(`Compra registrada ✓ — ${fmt(total)}`, "success");
  cerrarModalCompra();
});

// ============================================================
//  PRESUPUESTOS
// ============================================================
let presupuestosData = [];
let presupItemsActuales = [];
let presupEditId = null;

function calcTotalPresup() {
  return presupItemsActuales.reduce((s, i) => s + (parseFloat(i.precio)||0) * (parseInt(i.qty)||0), 0);
}

function renderPresupItems() {
  const wrap = document.getElementById("presupItems");
  if (!wrap) return;
  wrap.innerHTML = presupItemsActuales.map((item, i) => `
    <div style="display:grid;grid-template-columns:1fr 70px 100px 28px;gap:6px;align-items:center">
      <select class="form-select" data-pi-prod="${i}" style="font-size:12px">
        <option value="">Seleccioná producto…</option>
        ${allProducts.filter(p => p.activo !== false).map(p =>
          `<option value="${p._id}" ${item.prodId===p._id?"selected":""}>${p.desc}</option>`
        ).join("")}
      </select>
      <input type="number" class="form-input" data-pi-qty="${i}" value="${item.qty||1}" min="1"
        style="font-size:12px;text-align:center" />
      <input type="number" class="form-input" data-pi-precio="${i}" value="${item.precio||""}"
        placeholder="$ precio" style="font-size:12px" />
      <button type="button" data-pi-del="${i}"
        style="background:none;border:none;cursor:pointer;color:var(--text3);padding:4px;display:flex;align-items:center">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>`).join("");
  const total = document.getElementById("presupTotalDisplay");
  if (total) total.textContent = fmt(Math.round(calcTotalPresup()));
}

let presupFilaActiva = -1;

function renderPresupuestos() {
  const tbody = document.getElementById("presupuestosTableBody");
  const empty = document.getElementById("presupuestosEmpty");
  if (!tbody) return;
  const q = (document.getElementById("presupuestosSearch")?.value||"").toLowerCase();
  const lista = [...presupuestosData]
    .filter(p => !q || (p.clienteNombre||"").toLowerCase().includes(q) || (p.nro||"").toString().includes(q))
    .sort((a,b) => (b.ts||"").localeCompare(a.ts||""));
  if (!lista.length) {
    tbody.innerHTML = ""; empty.style.display = "block"; return;
  }
  empty.style.display = "none";
  tbody.innerHTML = lista.map((p, idx) => {
    const [fy,fm,fd] = (p.fecha||"").split("-");
    const fechaFmt = p.fecha ? `${parseInt(fd)}/${parseInt(fm)}/${fy}` : "—";
    const prods = (p.items||[]).map(i => `${i.desc}${i.qty>1?` ×${i.qty}`:""}`).join(", ")||"—";
    const tdBg = presupFilaActiva === idx ? "background:var(--bg3)" : "";
    return `<tr class="presup-row" data-id="${p._id}" data-idx="${idx}" style="cursor:pointer">
      <td style="font-family:'DM Mono',monospace;font-size:12px;font-weight:600;color:var(--text2);${tdBg}">#${String(p.nro||0).padStart(4,"0")}</td>
      <td style="font-size:12px;color:var(--text3);${tdBg}">${fechaFmt}</td>
      <td style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${tdBg}">${p.clienteNombre||"—"}</td>
      <td style="font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${tdBg}" title="${prods}">${prods}</td>
      <td class="num" style="font-weight:600;${tdBg}">${fmt(p.total||0)}</td>
      <td style="${tdBg}">
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn-secondary" style="font-size:11px;padding:4px 7px" onclick="event.stopPropagation();window._imprimirPresupuesto('${p._id}')">PDF</button>
          <button class="btn-secondary" style="font-size:11px;padding:4px 7px" onclick="event.stopPropagation();window._convertirPresupuestoEnVenta('${p._id}')">→ Venta</button>
          <button class="btn-secondary" style="font-size:11px;padding:4px 7px" onclick="event.stopPropagation();window._editarPresupuesto('${p._id}')">Editar</button>
          <button class="btn-danger" style="font-size:11px;padding:4px 6px" onclick="event.stopPropagation();window._eliminarPresupuesto('${p._id}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function initPresupuestosListener() {
  _unsubs.push(onSnapshot(collection(db, "presupuestos"), snap => {
    presupuestosData = snap.docs.map(d => ({...d.data(), _id: d.id}));
    if (document.getElementById("view-presupuestos")?.classList.contains("active")) renderPresupuestos();
  }));
}

function abrirModalPresupuesto(id = null, clienteIdInicial = null) {
  presupEditId = id;
  presupItemsActuales = id
    ? [...(presupuestosData.find(p => p._id === id)?.items || []).map(i => ({...i}))]
    : [{prodId:"", qty:1, precio:"", desc:""}];

  document.getElementById("modalPresupuestoTitulo").textContent = id ? "Editar presupuesto" : "Nuevo presupuesto";
  document.getElementById("btnGuardarPresupuesto").textContent  = id ? "Guardar cambios" : "Guardar presupuesto";
  document.getElementById("presupObs").value = id ? (presupuestosData.find(p=>p._id===id)?.obs||"") : "";

  // Popular selector de clientes
  const sel = document.getElementById("presupClienteSelect");
  sel.innerHTML = '<option value="">Seleccioná un cliente…</option>';
  Object.entries(clientesData).forEach(([cid, c]) => {
    const opt = document.createElement("option");
    opt.value = cid; opt.textContent = c.nombre;
    if (id) {
      const pData = presupuestosData.find(p=>p._id===id);
      if (pData?.clienteId === cid) opt.selected = true;
    } else if (clienteIdInicial === cid) {
      opt.selected = true;
    }
    sel.appendChild(opt);
  });

  renderPresupItems();
  document.getElementById("modalPresupuesto").classList.remove("hidden");
  setTimeout(() => document.getElementById("presupObs")?.focus(), 80);
}

function cerrarModalPresupuesto() {
  document.getElementById("modalPresupuesto").classList.add("hidden");
  presupEditId = null; presupItemsActuales = [];
  requestAnimationFrame(() => document.getElementById("presupuestosTableBody")?.focus());
}

// Listeners del modal
document.getElementById("btnNuevoPresupuesto")?.addEventListener("click", () => abrirModalPresupuesto());
document.getElementById("btnNuevoPresupuestoDesdeClientes")?.addEventListener("click", () => {
  document.querySelector('[data-view="presupuestos"]')?.click();
  setTimeout(() => abrirModalPresupuesto(null, window._clienteActivoId || null), 200);
});
document.getElementById("closeModalPresupuesto")?.addEventListener("click", cerrarModalPresupuesto);
document.getElementById("btnCancelarPresupuesto")?.addEventListener("click", cerrarModalPresupuesto);
document.getElementById("modalPresupuesto")?.addEventListener("click", e => { if (e.target===e.currentTarget) cerrarModalPresupuesto(); });

// Teclado: escuchar en document para capturar sin importar dónde esté el foco
document.addEventListener("keydown", e => {
  const modal = document.getElementById("modalPresupuesto");
  if (!modal || modal.classList.contains("hidden")) return;
  if (e.key === "Escape") {
    e.preventDefault(); e.stopPropagation();
    cerrarModalPresupuesto();
  }
  if (e.key === "Enter") {
    // No interferir con select, textarea ni inputs dentro de los items
    const tag = e.target.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.target.closest("#presupItems")) return;
    e.preventDefault(); e.stopPropagation();
    document.getElementById("btnGuardarPresupuesto")?.click();
  }
});

// + Nuevo cliente desde modal presupuesto
document.getElementById("btnNuevoClientePresup")?.addEventListener("click", () => {
  window._abrirClienteDesdePresup = true;
  abrirModalCliente();
});

document.getElementById("btnAgregarItemPresup")?.addEventListener("click", () => {
  presupItemsActuales.push({prodId:"", qty:1, precio:"", desc:""});
  renderPresupItems();
});

document.getElementById("presupItems")?.addEventListener("change", e => {
  const iProd   = e.target.dataset.piProd;
  const iQty    = e.target.dataset.piQty;
  const iPrecio = e.target.dataset.piPrecio;
  if (iProd !== undefined) {
    const p = allProducts.find(x => x._id === e.target.value);
    presupItemsActuales[iProd].prodId = e.target.value;
    presupItemsActuales[iProd].desc   = p?.desc || "";
    presupItemsActuales[iProd].precio = p ? getPrecioVenta(p) : "";
    renderPresupItems();
  }
  if (iQty !== undefined)    { presupItemsActuales[iQty].qty       = parseInt(e.target.value)||1; renderPresupItems(); }
  if (iPrecio !== undefined) { presupItemsActuales[iPrecio].precio = e.target.value;              renderPresupItems(); }
});

document.getElementById("presupItems")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-pi-del]");
  if (!btn) return;
  presupItemsActuales.splice(parseInt(btn.dataset.piDel), 1);
  if (!presupItemsActuales.length) presupItemsActuales.push({prodId:"", qty:1, precio:"", desc:""});
  renderPresupItems();
});

document.getElementById("presupuestosSearch")?.addEventListener("input", renderPresupuestos);

// Navegación con teclado
document.getElementById("presupuestosTableBody")?.addEventListener("keydown", e => {
  if (["ArrowDown","ArrowUp","Enter","Escape"].indexOf(e.key) === -1) return;
  e.preventDefault(); e.stopPropagation();
  const q = (document.getElementById("presupuestosSearch")?.value||"").toLowerCase();
  const lista = [...presupuestosData]
    .filter(p => !q || (p.clienteNombre||"").toLowerCase().includes(q) || (p.nro||"").toString().includes(q))
    .sort((a,b) => (b.ts||"").localeCompare(a.ts||""));
  if (!lista.length) return;
  if (e.key === "ArrowDown")  presupFilaActiva = Math.min(presupFilaActiva + 1, lista.length - 1);
  else if (e.key === "ArrowUp") presupFilaActiva = Math.max(presupFilaActiva - 1, 0);
  else if (e.key === "Enter" && presupFilaActiva >= 0) { window._editarPresupuesto(lista[presupFilaActiva]._id); return; }
  else if (e.key === "Escape") { presupFilaActiva = -1; }
  renderPresupuestos();
  document.querySelector(`.presup-row[data-idx="${presupFilaActiva}"]`)?.scrollIntoView({ block:"nearest" });
  requestAnimationFrame(() => document.getElementById("presupuestosTableBody")?.focus());
});

// Click en fila abre editar
document.getElementById("presupuestosTableBody")?.addEventListener("click", e => {
  const row = e.target.closest(".presup-row");
  if (row && !e.target.closest("button")) {
    presupFilaActiva = parseInt(row.dataset.idx);
    window._editarPresupuesto(row.dataset.id);
  }
});

// Guardar presupuesto
document.getElementById("btnGuardarPresupuesto")?.addEventListener("click", async () => {
  const clienteId = document.getElementById("presupClienteSelect").value;
  if (!clienteId) { showToast("Seleccioná un cliente.", "error"); return; }
  const itemsValidos = presupItemsActuales.filter(i => i.prodId && (parseInt(i.qty)||0) > 0);
  if (!itemsValidos.length) { showToast("Agregá al menos un producto.", "error"); return; }

  const clienteNombre = clientesData[clienteId]?.nombre || "—";
  const obs   = document.getElementById("presupObs").value.trim();
  const total = Math.round(calcTotalPresup());
  const fecha = todayKey();

  const data = {
    clienteId, clienteNombre, obs, total, fecha,
    ts: new Date().toISOString(),
    admin: getNombreUsuario(),
    items: itemsValidos.map(i => ({
      prodId: i.prodId, desc: i.desc,
      qty: parseInt(i.qty)||1,
      precio: parseFloat(i.precio)||0,
      subtotal: Math.round((parseFloat(i.precio)||0) * (parseInt(i.qty)||1))
    }))
  };

  if (presupEditId) {
    await updateDoc(doc(db, "presupuestos", presupEditId), data);
    showToast("Presupuesto actualizado ✓", "success");
  } else {
    // Generar número correlativo
    const confRef  = doc(db, "config", "contadores");
    const confSnap = await getDoc(confRef);
    const nro      = (confSnap.data()?.nroPresupuesto || 0) + 1;
    data.nro = nro;
    await setDoc(doc(collection(db, "presupuestos")), data);
    await setDoc(confRef, { nroPresupuesto: nro }, { merge: true });
    showToast(`Presupuesto #${String(nro).padStart(4,"0")} creado ✓`, "success");
  }
  registrarLog("presupuesto", `Presupuesto ${presupEditId?"editado":"creado"} — ${fmt(total)} · ${clienteNombre}`);
  cerrarModalPresupuesto();
});

// Editar
window._editarPresupuesto = function(id) { abrirModalPresupuesto(id); };

// Eliminar
window._eliminarPresupuesto = async function(id) {
  const p = presupuestosData.find(x => x._id === id);
  if (!confirm(`¿Eliminar presupuesto #${String(p?.nro||0).padStart(4,"0")} de ${p?.clienteNombre}?\nEsta acción no se puede deshacer.`)) return;
  await deleteDoc(doc(db, "presupuestos", id));
  showToast("Presupuesto eliminado.", "success");
  registrarLog("presupuesto", `Presupuesto #${String(p?.nro||0).padStart(4,"0")} eliminado`);
};

// Convertir en Venta
window._convertirPresupuestoEnVenta = function(id) {
  const p = presupuestosData.find(x => x._id === id);
  if (!p) return;
  // Limpiar carrito y cargar productos del presupuesto
  Object.keys(cart).forEach(k => delete cart[k]);
  p.items.forEach(item => {
    const prod = allProducts.find(x => x._id === item.prodId);
    if (prod) cart[prod._id] = { product: prod, qty: item.qty };
  });
  document.querySelector('[data-view="venta"]')?.click();
  renderCartLateral();
  showToast(`Presupuesto #${String(p.nro||0).padStart(4,"0")} cargado en Venta ✓`, "success");
};

// Imprimir PDF
window._imprimirPresupuesto = async function(id) {
  const p = presupuestosData.find(x => x._id === id);
  if (!p) return;
  const now = new Date().toLocaleDateString("es-AR", {day:"2-digit",month:"2-digit",year:"numeric"});
  const [fy,fm,fd] = (p.fecha||"").split("-");
  const fechaFmt = p.fecha ? `${parseInt(fd)}/${parseInt(fm)}/${fy}` : "—";
  const nroFmt = `#${String(p.nro||0).padStart(4,"0")}`;

  const filas = (p.items||[]).map(i => `
    <tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:7px 10px">${i.desc||"—"}</td>
      <td style="padding:7px 10px;text-align:center">${i.qty}</td>
      <td style="padding:7px 10px;text-align:right">${fmt(i.precio||0)}</td>
      <td style="padding:7px 10px;text-align:right;font-weight:600">${fmt(i.subtotal||0)}</td>
    </tr>`).join("");

  const content = `
    <div style="font-family:'DM Sans',sans-serif;color:#111;padding:2.5rem;max-width:600px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div>
          <div style="font-size:22px;font-weight:700">JPSoft | Tienda</div>
          <div style="font-size:13px;color:#888;margin-top:2px">Presupuesto ${nroFmt}</div>
        </div>
        <div style="text-align:right;font-size:12px;color:#888">
          <div>Fecha: ${fechaFmt}</div>
          <div>Generado: ${now}</div>
        </div>
      </div>
      <div style="margin:16px 0;padding:12px 14px;background:#f8f8f8;border-radius:8px">
        <div style="font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Cliente</div>
        <div style="font-size:15px;font-weight:600">${p.clienteNombre||"—"}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px">
        <thead>
          <tr style="background:#f0f0f0;font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:.05em">
            <th style="padding:8px 10px;text-align:left;font-weight:500">Producto</th>
            <th style="padding:8px 10px;text-align:center;font-weight:500">Cant.</th>
            <th style="padding:8px 10px;text-align:right;font-weight:500">Precio</th>
            <th style="padding:8px 10px;text-align:right;font-weight:500">Subtotal</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
        <tfoot>
          <tr style="border-top:2px solid #111">
            <td colspan="3" style="padding:10px;font-weight:600;font-size:14px">TOTAL</td>
            <td style="padding:10px;text-align:right;font-weight:700;font-size:18px">${fmt(p.total||0)}</td>
          </tr>
        </tfoot>
      </table>
      ${p.obs ? `<div style="margin-top:12px;padding:10px 14px;background:#fffde7;border-left:3px solid #f9c74f;border-radius:4px;font-size:12px;color:#555">${p.obs}</div>` : ""}
    </div>`;

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:650px;background:#fff";
  container.innerHTML = content;
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, {scale:2, useCORS:true, backgroundColor:"#fff"});
    const {jsPDF} = window.jspdf;
    const pdf  = new jsPDF({orientation:"portrait", unit:"mm", format:"a4"});
    const imgW = 210;
    const imgH = (canvas.height * imgW) / canvas.width;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, imgW, imgH);
    pdf.save(`Presupuesto_${nroFmt}_${p.clienteNombre||"cliente"}.pdf`);
    showToast("PDF generado ✓", "success");
  } catch(err) {
    showToast("Error al generar PDF: " + err.message, "error");
  } finally {
    document.body.removeChild(container);
  }
};

// Inicializar al navegar

// ============================================================
//  COMBOS
// ============================================================
let combosData   = {};
let comboItemsActuales = [];
let comboEditId  = null;

function renderCombosGrid() {
  const grid  = document.getElementById("combosGrid");
  const empty = document.getElementById("combosEmpty");
  if (!grid) return;
  const lista = Object.entries(combosData).sort((a,b) => (a[1].nombre||"").localeCompare(b[1].nombre||""));
  if (!lista.length) {
    grid.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  grid.innerHTML = lista.map(([id, c]) => {
    const prods = (c.items||[]).map(i => `${i.desc}${i.qty>1?` ×${i.qty}`:""}`).join(" · ") || "—";
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="font-size:15px;font-weight:600;color:var(--text1)">${c.nombre||"—"}</div>
        <div style="font-size:18px;font-weight:700;font-family:'DM Mono',monospace;color:var(--accent)">${fmt(c.precio||0)}</div>
      </div>
      ${c.desc ? `<div style="font-size:12px;color:var(--text3);margin-bottom:6px">${c.desc}</div>` : ""}
      <div style="font-size:12px;color:var(--text2);margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${prods}">${prods}</div>
      <div style="display:flex;gap:6px">
        <button class="btn-secondary" style="font-size:11px;padding:4px 10px;flex:1" onclick="window._editarCombo('${id}')">Editar</button>
        <button class="btn-danger" style="font-size:11px;padding:4px 8px" onclick="window._eliminarCombo('${id}','${(c.nombre||'').replace(/'/g,"&#39;")}')">🗑</button>
      </div>
    </div>`;
  }).join("");
}

function renderComboItemsModal() {
  const wrap = document.getElementById("comboItems");
  if (!wrap) return;
  wrap.innerHTML = comboItemsActuales.map((item, i) => `
    <div style="display:grid;grid-template-columns:1fr 80px 28px;gap:6px;align-items:center">
      <select class="form-select" data-ci-prod="${i}" style="font-size:12px">
        <option value="">Seleccioná producto…</option>
        ${allProducts.filter(p => p.activo !== false).map(p =>
          `<option value="${p._id}" ${item.prodId===p._id?"selected":""}>${p.desc}</option>`
        ).join("")}
      </select>
      <input type="number" class="form-input" data-ci-qty="${i}" value="${item.qty||1}" min="1"
        style="font-size:12px;text-align:center" />
      <button type="button" data-ci-del="${i}"
        style="background:none;border:none;cursor:pointer;color:var(--text3);padding:4px;display:flex;align-items:center">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
        </svg>
      </button>
    </div>`).join("");
}

function abrirModalCombo(id = null) {
  comboEditId = id;
  const c = id ? combosData[id] : null;
  comboItemsActuales = c ? (c.items||[]).map(i => ({...i})) : [{prodId:"", qty:1, desc:""}];
  document.getElementById("modalComboTitulo").textContent = id ? "Editar combo" : "Nuevo combo";
  document.getElementById("btnGuardarCombo").textContent  = id ? "Guardar cambios" : "Guardar combo";
  document.getElementById("comboNombre").value = c?.nombre || "";
  document.getElementById("comboPrecio").value = c?.precio || "";
  document.getElementById("comboDesc").value   = c?.desc   || "";
  renderComboItemsModal();
  document.getElementById("modalCombo").classList.remove("hidden");
  setTimeout(() => document.getElementById("comboNombre")?.focus(), 80);
}

function cerrarModalCombo() {
  document.getElementById("modalCombo").classList.add("hidden");
  comboEditId = null; comboItemsActuales = [];
}

// Listeners modal combo
document.getElementById("btnNuevoCombo")?.addEventListener("click", () => abrirModalCombo());
document.getElementById("closeModalCombo")?.addEventListener("click", cerrarModalCombo);
document.getElementById("btnCancelarCombo")?.addEventListener("click", cerrarModalCombo);

document.getElementById("btnAgregarItemCombo")?.addEventListener("click", () => {
  comboItemsActuales.push({prodId:"", qty:1, desc:""});
  renderComboItemsModal();
});

document.getElementById("comboItems")?.addEventListener("change", e => {
  const iProd = e.target.dataset.ciProd;
  const iQty  = e.target.dataset.ciQty;
  if (iProd !== undefined) {
    const p = allProducts.find(x => x._id === e.target.value);
    comboItemsActuales[iProd].prodId = e.target.value;
    comboItemsActuales[iProd].desc   = p?.desc || "";
  }
  if (iQty !== undefined) comboItemsActuales[iQty].qty = parseInt(e.target.value)||1;
});

document.getElementById("comboItems")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-ci-del]");
  if (!btn) return;
  comboItemsActuales.splice(parseInt(btn.dataset.ciDel), 1);
  if (!comboItemsActuales.length) comboItemsActuales.push({prodId:"", qty:1, desc:""});
  renderComboItemsModal();
});

document.getElementById("modalCombo")?.addEventListener("keydown", e => {
  if (e.key === "Escape") { e.preventDefault(); cerrarModalCombo(); }
  if (e.key === "Enter" && e.target.tagName !== "SELECT") {
    e.preventDefault(); document.getElementById("btnGuardarCombo")?.click();
  }
});

// Guardar combo
document.getElementById("btnGuardarCombo")?.addEventListener("click", async () => {
  const nombre = document.getElementById("comboNombre").value.trim();
  const precio = parseFloat(document.getElementById("comboPrecio").value);
  const desc   = document.getElementById("comboDesc").value.trim();
  if (!nombre)         { showToast("Ingresá el nombre del combo.", "error"); return; }
  if (isNaN(precio) || precio <= 0) { showToast("Ingresá un precio válido.", "error"); return; }
  const itemsValidos = comboItemsActuales.filter(i => i.prodId && (parseInt(i.qty)||0) > 0);
  if (itemsValidos.length < 2) { showToast("Agregá al menos 2 productos al combo.", "error"); return; }

  const data = { nombre, precio, desc, items: itemsValidos };
  if (comboEditId) {
    await updateDoc(doc(db, "combos", comboEditId), data);
    showToast("Combo actualizado ✓", "success");
  } else {
    await setDoc(doc(collection(db, "combos")), data);
    showToast(`Combo "${nombre}" creado ✓`, "success");
  }
  registrarLog("combo", `Combo ${comboEditId?"editado":"creado"} — ${nombre} · ${fmt(precio)}`);
  cerrarModalCombo();
});

window._editarCombo = function(id) { abrirModalCombo(id); };
window._eliminarCombo = async function(id, nombre) {
  if (!confirm(`¿Eliminar el combo "${nombre}"?\nEsta acción no se puede deshacer.`)) return;
  await deleteDoc(doc(db, "combos", id));
  showToast("Combo eliminado.", "success");
};

// Firestore listener
function initCombosListener() {
  _unsubs.push(onSnapshot(collection(db, "combos"), snap => {
    combosData = {};
    snap.forEach(d => { combosData[d.id] = d.data(); });
    if (document.getElementById("view-combos")?.classList.contains("active")) renderCombosGrid();
  }));
}

// ── Selector de Combo desde Venta ──
document.getElementById("btnCargarCombo")?.addEventListener("click", () => {
  const lista = Object.entries(combosData).sort((a,b) => (a[1].nombre||"").localeCompare(b[1].nombre||""));
  const wrap  = document.getElementById("combosListaSelector");
  if (!lista.length) { showToast("No hay combos registrados.", "warning"); return; }

  wrap.innerHTML = lista.map(([id, c]) => {
    const prods = (c.items||[]).map(i => `${i.desc}${i.qty>1?` ×${i.qty}`:""}`).join(" · ");
    return `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;cursor:pointer;transition:background .15s"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''"
      onclick="window._cargarComboEnVenta('${id}')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-size:14px;font-weight:600">${c.nombre}</div>
        <div style="font-size:15px;font-weight:700;font-family:'DM Mono',monospace;color:var(--accent)">${fmt(c.precio||0)}</div>
      </div>
      ${c.desc ? `<div style="font-size:11px;color:var(--text3);margin-bottom:3px">${c.desc}</div>` : ""}
      <div style="font-size:11.5px;color:var(--text2)">${prods}</div>
    </div>`;
  }).join("");

  document.getElementById("modalSelectorCombo").classList.remove("hidden");
});

document.getElementById("closeModalSelectorCombo")?.addEventListener("click", () =>
  document.getElementById("modalSelectorCombo").classList.add("hidden"));
document.getElementById("modalSelectorCombo")?.addEventListener("click", e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});

window._cargarComboEnVenta = function(id) {
  const c = combosData[id];
  if (!c) return;

  // Verificar stock de cada producto
  const sinStock = (c.items||[]).filter(item => {
    const p = allProducts.find(x => x._id === item.prodId);
    return p && typeof p.stock === "number" && p.stock < (item.qty||1);
  });
  if (sinStock.length) {
    const nombres = sinStock.map(i => i.desc).join(", ");
    showToast(`Stock insuficiente: ${nombres}`, "error");
    return;
  }

  // Agregar el combo como una sola línea con precio especial
  const comboKey = `combo_${id}_${Date.now()}`;
  cart[comboKey] = {
    product: { _id: comboKey, desc: c.nombre, esCombo: true, comboId: id, itemsCombo: c.items },
    qty: 1,
    precioCombo: c.precio
  };

  document.getElementById("modalSelectorCombo").classList.add("hidden");
  renderCartLateral();
  showToast(`Combo "${c.nombre}" cargado · ${fmt(c.precio)} ✓`, "success");
};
