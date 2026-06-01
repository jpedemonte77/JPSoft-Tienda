// ============================================================
//  JPSoft | QBV — app.js
//  Firebase Realtime Database + Auth
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, set, push, onValue, remove, update, get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ============================================================
//  CONFIGURACIÓN FIREBASE
// ============================================================
const firebaseConfig = {
  apiKey:            "AIzaSyAN_v8c9UCo_d2wxVzoIGFXFU3jT_zjZg8",
  authDomain:        "jpsoft-qbv.firebaseapp.com",
  databaseURL:       "https://jpsoft-qbv-default-rtdb.firebaseio.com",
  projectId:         "jpsoft-qbv",
  storageBucket:     "jpsoft-qbv.firebasestorage.app",
  messagingSenderId: "201162012438",
  appId:             "1:201162012438:web:f11b5381cfef640f1e0237"
};

const app  = initializeApp(firebaseConfig);
const db   = getDatabase(app);
const auth = getAuth(app);

// ============================================================
//  ESTADO GLOBAL
// ============================================================
let allProducts   = [];
let proveedores   = {};   // { id: { nombre, tipo, ganancia, categoria } }
let gananciaMap   = {};   // { nombreProv: pct (0-1) }
let provColorMap  = {};
let margenesConfig = { general: 50, tabaco: 30, cigarrillos: 20 }; // valores por defecto
let cajaData      = {};   // cache: { "YYYY-MM-DD": { apertura, ventas, cierre } }
let cajaFechaKey  = todayKey(); // fecha activa en la vista

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
//  AUTH
// ============================================================
onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app-wrapper").classList.remove("hidden");
    const _raw = ADMIN_NOMBRES[user.email] || user.email.split("@")[0];
    const nombre = _raw.charAt(0).toUpperCase() + _raw.slice(1);
    document.getElementById("user-nombre").textContent = nombre;
    document.getElementById("user-avatar").textContent = iniciales(nombre);
    initFirebase();
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
  btn.textContent = "Ingresando…";
  try {
    await signInWithEmailAndPassword(auth, email, pwd);
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
//  FIREBASE: ESCUCHAR CAMBIOS EN TIEMPO REAL
// ============================================================
function initFirebase() {
  // Proveedores
  onValue(ref(db, "proveedores"), snap => {
    proveedores = snap.val() || {};
    rebuildGananciaMap();
    renderProveedores();
    buildFilterBar();
    populateProvSelect();
    renderProductosVenta();
    renderProductosTabla();
  });

  // Productos
  onValue(ref(db, "productos"), snap => {
    const raw = snap.val() || {};
    allProducts = Object.entries(raw).map(([id, p]) => ({
      ...p,
      _id: id,
      normDesc: norm(p.desc || ""),
      normCod:  norm(String(p.cod || "")),
      normId:   norm(String(p.id || ""))
    }));
    buildFilterBar();
    renderProductosVenta();
    renderProductosTabla();
    updateStockBadge();
  });

  // Caja — escucha toda la rama para soportar historial
  onValue(ref(db, "caja"), snap => {
    cajaData = snap.val() || {};
    renderCaja();
    updateCajaSidebar();
  });

  // Config márgenes globales
  onValue(ref(db, "config/margenes"), snap => {
    if (snap.val()) {
      Object.assign(margenesConfig, snap.val());
    }
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
  const now = Date.now();
  const input = document.getElementById("searchInput");
  if (!input) return;
  if (document.activeElement === input) {
    if (e.key === "Enter") { e.preventDefault(); applyFilters(); }
    return;
  }
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
  if (e.key.length === 1) {
    if (gap > SCAN_SPEED * 3 && scanBuffer.length > 0) { scanBuffer = ""; setScanState("normal"); }
    if (scanBuffer.length === 0) setScanState("scanning");
    scanBuffer += e.key;
  } else { scanBuffer = ""; }
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

  if (!cajaData[todayKey()]?.apertura) {
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
  const { keys, total, hora } = window._ventaPendiente || {};
  if (!keys) return;

  const items = keys.map(k => {
    const { product: p, qty } = cart[k];
    return { desc: p.desc, qty, precioUnit: Math.round(getPrecioVenta(p)), subtotal: Math.round(getPrecioVenta(p) * qty), proveedor: p.proveedor };
  });

  // Descontar stock
  const stockUpdates = {};
  keys.forEach(k => {
    const { product: p, qty } = cart[k];
    if (typeof p.stock === "number") {
      stockUpdates[`productos/${p._id}/stock`] = Math.max(0, p.stock - qty);
    }
  });
  if (Object.keys(stockUpdates).length) {
    await update(ref(db), stockUpdates);
  }

  // Guardar venta en Firebase
  const { subtotal: vSubtotal, descMonto: vDesc } = window._ventaPendiente || {};
  await push(ref(db, `caja/${todayKey()}/ventas`), {
    hora,
    metodo:     metodoSeleccionado,
    total:      Math.round(total),
    subtotal:   Math.round(vSubtotal || total),
    descuento:  Math.round(vDesc || 0),
    items,
    admin:      getNombreUsuario()
  });

  // Limpiar carrito y descuento
  Object.keys(cart).forEach(k => delete cart[k]);
  descuentoValor = 0;
  const descInput = document.getElementById("descuentoInput");
  if (descInput) descInput.value = "";
  window._ventaPendiente = null;
  document.getElementById("modalVenta").classList.add("hidden");
  renderCart();
  renderProductosVenta();
  showToast("Venta registrada ✓", "success");
}

// ============================================================
//  VISTA CAJA
// ============================================================
function renderCaja() {
  const esHoy  = cajaFechaKey === todayKey();
  const caja   = cajaData[cajaFechaKey] || null;

  // Título y navegación
  document.getElementById("cajaTituloFecha").textContent = "Caja — " + fechaLabel(cajaFechaKey);
  document.getElementById("btnCajaSiguiente").disabled = esHoy;

  const apertura = caja?.apertura;
  const cierre   = caja?.cierre;
  const ventas   = caja?.ventas ? Object.values(caja.ventas) : [];

  if (!apertura) {
    document.getElementById("cajaAperturaWrap").classList.toggle("hidden", !esHoy);
    document.getElementById("cajaAbiertaWrap").classList.add("hidden");
    document.getElementById("btnCerrarCaja").classList.add("hidden");
    document.getElementById("btnReabrirCaja").classList.add("hidden");
    document.getElementById("cajaEstadoBadge").innerHTML = `<span class="badge badge-neutral">Sin registros</span>`;
    document.getElementById("aperturaFecha").textContent =
      new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });
    document.getElementById("cajaSubtitulo").textContent = esHoy ? "La caja no fue abierta hoy" : "No hay datos para este día";
    return;
  }

  // Hay apertura
  document.getElementById("cajaAperturaWrap").classList.add("hidden");
  document.getElementById("cajaAbiertaWrap").classList.remove("hidden");
  document.getElementById("cajaSubtitulo").textContent = apertura.turno + " · Apertura " + fmtHora(apertura.hora);

  const yaHayCierre = !!cierre;

  // Botones según estado y si es hoy
  document.getElementById("btnCerrarCaja").classList.toggle("hidden",  yaHayCierre || !esHoy);
  document.getElementById("btnReabrirCaja").classList.toggle("hidden", !yaHayCierre);

  document.getElementById("cajaEstadoBadge").innerHTML = yaHayCierre
    ? `<span class="badge badge-neutral">Cerrada ${fmtHora(cierre.hora)}</span>`
    : `<span class="badge badge-success">Abierta</span>`;

  // Stats
  let totEfectivo = 0, totDebito = 0, totMp = 0;
  ventas.forEach(v => {
    if (v.metodo === "efectivo") totEfectivo += v.total || 0;
    else if (v.metodo === "debito") totDebito += v.total || 0;
    else if (v.metodo === "mp") totMp += v.total || 0;
  });
  const totTotal = totEfectivo + totDebito + totMp;

  document.getElementById("statTotal").textContent    = fmt(totTotal);
  document.getElementById("statVentas").textContent   = ventas.length + (ventas.length === 1 ? " venta" : " ventas");
  document.getElementById("statEfectivo").textContent = fmt(totEfectivo);
  document.getElementById("statDebito").textContent   = fmt(totDebito);
  document.getElementById("statMp").textContent       = fmt(totMp);
  document.getElementById("statEfectivoPct").textContent = pct(totEfectivo, totTotal);
  document.getElementById("statDebitoPct").textContent   = pct(totDebito, totTotal);
  document.getElementById("statMpPct").textContent       = pct(totMp, totTotal);

  // Info apertura
  document.getElementById("infoAperturaHora").textContent  = fmtHora(apertura.hora);
  document.getElementById("infoAperturaFondo").textContent = apertura.fondo ? fmt(apertura.fondo) : "—";
  document.getElementById("infoAperturaTurno").textContent = apertura.turno || "—";

  // Timeline
  const timeline = document.getElementById("ventasTimeline");
  if (!ventas.length) {
    timeline.innerHTML = `<div class="empty-row">No hay ventas registradas este día.</div>`;
  } else {
    const metLabel = { efectivo: "Efectivo", debito: "Débito", mp: "Mercado Pago" };
    const metClass = { efectivo: "metodo-efectivo", debito: "metodo-debito", mp: "metodo-mp" };
    timeline.innerHTML = [...ventas].reverse().map(v => `
      <div class="timeline-row">
        <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${(v.items || []).map(i => i.desc).join(", ")}
        </span>
        <span style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fmtHora(v.hora)}</span>
        <span class="${metClass[v.metodo] || ""}">${metLabel[v.metodo] || v.metodo}</span>
        <span class="num">${(v.items || []).reduce((s, i) => s + i.qty, 0)}</span>
        <span class="num" style="font-weight:500">${fmt(v.total)}</span>
      </div>`).join("");
  }

  // Resumen cierre
  document.getElementById("cierreSummaryWrap").classList.toggle("hidden", !yaHayCierre);
  if (yaHayCierre) {
    document.getElementById("cierreSummaryContent").innerHTML = `
      <div style="font-size:13px;color:var(--text2);line-height:2">
        <div style="display:flex;justify-content:space-between"><span>Hora de cierre</span><span style="font-family:'DM Mono',monospace">${fmtHora(cierre.hora)}</span></div>
        <div style="display:flex;justify-content:space-between"><span>Total recaudado</span><span style="font-weight:600">${fmt(totTotal)}</span></div>
        <div style="display:flex;justify-content:space-between"><span>Efectivo</span><span>${fmt(totEfectivo)}</span></div>
        <div style="display:flex;justify-content:space-between"><span>Débito</span><span>${fmt(totDebito)}</span></div>
        <div style="display:flex;justify-content:space-between"><span>Transf. / MP</span><span>${fmt(totMp)}</span></div>
      </div>`;
  }
}

function updateCajaSidebar() {
  const hoy    = cajaData[todayKey()] || null;
  const ventas = hoy?.ventas ? Object.values(hoy.ventas) : [];
  const total  = ventas.reduce((s, v) => s + (v.total || 0), 0);
  document.getElementById("caja-sidebar-total").textContent = fmt(total);
  const state = document.getElementById("caja-sidebar-state");
  if (hoy?.apertura && !hoy?.cierre) {
    state.textContent = "Abierta";
    state.className = "caja-sidebar-state caja-open";
  } else {
    state.textContent = hoy?.cierre ? "Cerrada" : "Sin abrir";
    state.className = "caja-sidebar-state caja-closed";
  }
}

// ── Navegación de fechas ──
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
  if (siguiente > todayKey()) return; // no ir al futuro
  cajaFechaKey = siguiente;
  renderCaja();
});

// Turno selector
document.querySelectorAll(".turno-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".turno-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// Abrir caja
document.getElementById("btnAbrirCaja").addEventListener("click", async () => {
  const turno = document.querySelector(".turno-btn.active")?.dataset.turno || "Mañana";
  const fondo = parseFloat(document.getElementById("aperturaFondo").value) || 0;
  const hora  = nowHora();
  await set(ref(db, `caja/${todayKey()}/apertura`), { hora, fondo, turno, admin: getNombreUsuario() });
  showToast("Caja abierta ✓", "success");
});

// Reabrir caja
document.getElementById("btnReabrirCaja").addEventListener("click", async () => {
  const fecha = cajaFechaKey;
  if (!confirm(`¿Reabrir la caja del ${fechaLabel(fecha)}?\nSe eliminará el cierre registrado.`)) return;
  await remove(ref(db, `caja/${fecha}/cierre`));
  showToast("Caja reabierta ✓", "success");
});

// Cerrar caja → modal confirmación
document.getElementById("btnCerrarCaja").addEventListener("click", () => {
  const caja   = cajaData[cajaFechaKey] || {};
  const ventas = caja.ventas ? Object.values(caja.ventas) : [];
  let totE = 0, totD = 0, totM = 0;
  ventas.forEach(v => {
    if (v.metodo === "efectivo") totE += v.total || 0;
    else if (v.metodo === "debito") totD += v.total || 0;
    else if (v.metodo === "mp") totM += v.total || 0;
  });
  const tot = totE + totD + totM;
  document.getElementById("cierreResumenTexto").innerHTML = `
    <p style="margin-bottom:10px">Vas a cerrar la caja del día. No podrás registrar más ventas hasta que la abras mañana.</p>
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:13px;line-height:2">
      <div style="display:flex;justify-content:space-between"><span>Total recaudado</span><span style="font-weight:600">${fmt(tot)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Efectivo</span><span>${fmt(totE)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Débito</span><span>${fmt(totD)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Transf. / MP</span><span>${fmt(totM)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Ventas totales</span><span>${ventas.length}</span></div>
    </div>`;
  document.getElementById("modalCierreCaja").classList.remove("hidden");
});

document.getElementById("closeModalCierre").addEventListener("click", () => document.getElementById("modalCierreCaja").classList.add("hidden"));
document.getElementById("btnCancelarCierre").addEventListener("click", () => document.getElementById("modalCierreCaja").classList.add("hidden"));

document.getElementById("btnConfirmarCierre").addEventListener("click", async () => {
  await set(ref(db, `caja/${cajaFechaKey}/cierre`), {
    hora:  nowHora(),
    admin: getNombreUsuario()
  });
  document.getElementById("modalCierreCaja").classList.add("hidden");
  showToast("Caja cerrada ✓");
});

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
    await update(ref(db, `productos/${prodEditId}`), data);
    showToast("Producto actualizado ✓", "success");
  } else {
    await push(ref(db, "productos"), data);
    showToast("Producto agregado ✓", "success");
  }
  cerrarModalProducto();
});

document.getElementById("btnEliminarProducto").addEventListener("click", async () => {
  if (!prodEditId) return;
  if (!confirm("¿Eliminar este producto?")) return;
  await remove(ref(db, `productos/${prodEditId}`));
  showToast("Producto eliminado");
  cerrarModalProducto();
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
        await push(ref(db, "proveedores"), { nombre: pNombre, ganancia: gan != null ? Math.round(gan * 100) : 20, tabaco: false, categoria: "" });
      }
    }
    // Guardar productos
    const batch = {};
    parsedImport.allProds.forEach(p => { batch[push(ref(db, "productos")).key] = p; });
    await update(ref(db, "productos"), batch);
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
  await set(ref(db, `config/margenes/${tipo}`), val);
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
    await update(ref(db, `proveedores/${provEditId}`), data);
    const ant = proveedores[provEditId]?.nombre;
    if (ant && ant !== nombre) {
      const updates = {};
      allProducts.filter(p => p.proveedor === ant).forEach(p => { updates[`productos/${p._id}/proveedor`] = nombre; });
      if (Object.keys(updates).length) await update(ref(db), updates);
    }
    showToast("Proveedor actualizado ✓", "success");
  } else {
    await push(ref(db, "proveedores"), data);
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
  await remove(ref(db, `proveedores/${provEditId}`));
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
