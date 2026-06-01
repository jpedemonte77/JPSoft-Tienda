// ============================================================
//  JPSoft | QBV — admin-app.js
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, onValue, get, set, update, remove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ============================================================
//  CONFIG FIREBASE
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
//  USUARIOS AUTORIZADOS PARA EL ADMIN
// ============================================================
const ADMIN_USUARIOS = [
  "joaquin@jpsoft-qbv.com",
  "carlos@jpsoft-qbv.com"
];

const ADMIN_NOMBRES = {
  "joaquin@jpsoft-qbv.com": "Joaquín",
  "carlos@jpsoft-qbv.com":  "Carlos",
};

const TODOS_USUARIOS = [
  { email: "joaquin@jpsoft-qbv.com", nombre: "Joaquín", admin: true },
  { email: "carlos@jpsoft-qbv.com",  nombre: "Carlos",  admin: true },
];

// ============================================================
//  ESTADO GLOBAL
// ============================================================
let allProducts    = [];
let proveedores    = {};
let gananciaMap    = {};
let margenesConfig = { general: 50, tabaco: 30, cigarrillos: 20 };
let cajaData       = {};
let backupData     = null;

const BADGE_COLORS = ["b0","b1","b2","b3","b4","b5","b6"];
let provColorMap   = {};

// ============================================================
//  HELPERS
// ============================================================
function fmt(n) {
  return "$" + Math.round(n).toLocaleString("es-AR");
}

function pct(part, total) {
  if (!total) return "—";
  return Math.round((part / total) * 100) + "% del total";
}

function norm(s) {
  return String(s || "").toLowerCase();
}

function fechaLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m-1, d).toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });
}

function badgeClass(provNombre) {
  const prov = Object.values(proveedores).find(p => p.nombre === provNombre);
  if (prov && prov.tabaco) return "b-tabaco";
  if (!(provNombre in provColorMap))
    provColorMap[provNombre] = BADGE_COLORS[Object.keys(provColorMap).length % BADGE_COLORS.length];
  return provColorMap[provNombre];
}

function getPrecioVenta(p) {
  const gan = gananciaMap[p.proveedor] ?? (margenesConfig.general / 100);
  return p.lista * (1 + gan);
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast" + (type ? " " + type : "");
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 3000);
}

function iniciales(nombre) {
  return (nombre || "?").trim().split(/\s+/).filter(Boolean)
    .map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

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
  if (periodo === "semana") {
    const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - hoy.getDay() + 1);
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
onAuthStateChanged(auth, user => {
  if (!user) {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app-wrapper").classList.add("hidden");
    document.getElementById("acceso-denegado").classList.add("hidden");
    return;
  }

  // Verificar acceso admin
  if (!ADMIN_USUARIOS.includes(user.email)) {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app-wrapper").classList.add("hidden");
    document.getElementById("acceso-denegado").classList.remove("hidden");
    return;
  }

  // Acceso OK
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("acceso-denegado").classList.add("hidden");
  document.getElementById("app-wrapper").classList.remove("hidden");

  const _raw  = ADMIN_NOMBRES[user.email] || user.email.split("@")[0];
  const nombre = _raw.charAt(0).toUpperCase() + _raw.slice(1);
  document.getElementById("user-nombre").textContent = nombre;
  document.getElementById("user-avatar").textContent = iniciales(nombre);

  initFirebase();
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
//  FIREBASE
// ============================================================
function initFirebase() {
  onValue(ref(db, "proveedores"), snap => {
    proveedores = snap.val() || {};
    rebuildGananciaMap();
    renderPrecios();
    renderUsuarios();
    populatePreciosFilter();
  });

  onValue(ref(db, "productos"), snap => {
    const raw = snap.val() || {};
    allProducts = Object.entries(raw).map(([id, p]) => ({ ...p, _id: id }));
    renderPrecios();
  });

  onValue(ref(db, "caja"), snap => {
    cajaData = snap.val() || {};
  });

  onValue(ref(db, "config/margenes"), snap => {
    if (snap.val()) Object.assign(margenesConfig, snap.val());
    rebuildGananciaMap();
  });

  // Último backup
  onValue(ref(db, "config/ultimoBackup"), snap => {
    const el = document.getElementById("ultimoBackup");
    if (snap.val()) el.textContent = "Último backup: " + snap.val();
    else el.textContent = "No hay backups registrados.";
  });

  // Fechas por defecto
  setDefaultDates();
}

function rebuildGananciaMap() {
  gananciaMap = {};
  Object.values(proveedores).forEach(p => {
    gananciaMap[p.nombre] = (p.ganancia ?? margenesConfig[p.tipo || "general"] ?? 50) / 100;
  });
}

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
const VIEWS = { reportes: "Reportes", precios: "Lista de precios", exportar: "Exportar Excel", usuarios: "Usuarios", backup: "Backup" };

document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-" + view).classList.add("active");
    document.getElementById("topbar-title").textContent = VIEWS[view] || view;
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("open");
  });
});

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
    if (!dia?.ventas) return;
    Object.values(dia.ventas).forEach(v => {
      ventas.push({ ...v, fecha: k });
    });
  });

  // Stats
  let totE = 0, totD = 0, totM = 0;
  ventas.forEach(v => {
    if (v.metodo === "efectivo") totE += v.total || 0;
    else if (v.metodo === "debito") totD += v.total || 0;
    else if (v.metodo === "mp") totM += v.total || 0;
  });
  const tot = totE + totD + totM;

  document.getElementById("rStatTotal").textContent     = fmt(tot);
  document.getElementById("rStatVentas").textContent    = ventas.length + " ventas";
  document.getElementById("rStatEfectivo").textContent  = fmt(totE);
  document.getElementById("rStatDebito").textContent    = fmt(totD);
  document.getElementById("rStatMp").textContent        = fmt(totM);
  document.getElementById("rStatEfectivoPct").textContent = pct(totE, tot);
  document.getElementById("rStatDebitoPct").textContent   = pct(totD, tot);
  document.getElementById("rStatMpPct").textContent       = pct(totM, tot);

  // Resumen por día
  const diasMap = {};
  ventas.forEach(v => {
    if (!diasMap[v.fecha]) diasMap[v.fecha] = { ventas: 0, total: 0 };
    diasMap[v.fecha].ventas++;
    diasMap[v.fecha].total += v.total || 0;
  });

  const diasTabla = document.getElementById("reporteDiasTabla");
  if (!Object.keys(diasMap).length) {
    diasTabla.innerHTML = `<div class="empty-row">Sin ventas en el período.</div>`;
  } else {
    diasTabla.innerHTML = Object.entries(diasMap).sort((a,b) => b[0].localeCompare(a[0])).map(([k, d]) => `
      <div style="display:grid;grid-template-columns:1fr 80px 80px 80px;padding:9px 14px;border-bottom:1px solid var(--border);font-size:13px;align-items:center">
        <span>${fechaLabel(k)}</span>
        <span style="text-align:right">${d.ventas}</span>
        <span style="text-align:right;font-weight:500">${fmt(d.total)}</span>
        <span style="text-align:right;color:var(--text3)">${fmt(d.total / d.ventas)}</span>
      </div>`).join("");
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

  // Detalle ventas
  const metLabel = { efectivo: "Efectivo", debito: "Débito", mp: "Mercado Pago" };
  const metClass = { efectivo: "metodo-efectivo", debito: "metodo-debito", mp: "metodo-mp" };
  const detalle  = document.getElementById("reporteDetalle");
  if (!ventas.length) {
    detalle.innerHTML = `<div class="empty-row">Sin ventas en el período.</div>`;
  } else {
    detalle.innerHTML = [...ventas].sort((a,b) => b.fecha.localeCompare(a.fecha) || (b.hora||"").localeCompare(a.hora||"")).map(v => `
      <div class="timeline-row" style="grid-template-columns:90px 1fr 100px 80px 90px">
        <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text3)">${fechaLabel(v.fecha)}</span>
        <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(v.items||[]).map(i=>i.desc).join(", ")}</span>
        <span class="${metClass[v.metodo]||""}">${metLabel[v.metodo]||v.metodo}</span>
        <span class="num">${(v.items||[]).reduce((s,i)=>s+i.qty,0)}</span>
        <span class="num" style="font-weight:500">${fmt(v.total)}</span>
      </div>`).join("");
  }
}

// ============================================================
//  VISTA: LISTA DE PRECIOS
// ============================================================
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

document.getElementById("preciosFilterProv").addEventListener("change", renderPrecios);

document.getElementById("btnImprimirPrecios").addEventListener("click", () => window.print());

document.getElementById("btnExportarPrecios").addEventListener("click", () => {
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

  exportarExcel([{ nombre: "Lista de Precios", data, colsMoney: [4, 6] }], `JPSoft_QBV_Precios_${todayKey()}.xlsx`);
});

// ============================================================
//  VISTA: EXPORTAR EXCEL
// ============================================================
document.getElementById("btnExpVentas").addEventListener("click", () => {
  const desde = document.getElementById("expVentasDesde").value;
  const hasta = document.getElementById("expVentasHasta").value;
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
  exportarExcel([{ nombre: "Ventas", data, colsMoney: [4, 5, 7] }], `JPSoft_QBV_Ventas_${desde}_${hasta}.xlsx`);
});

document.getElementById("btnExpCaja").addEventListener("click", () => {
  const desde = document.getElementById("expCajaDesde").value;
  const hasta = document.getElementById("expCajaHasta").value;
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
  exportarExcel([{ nombre: "Caja", data, colsMoney: [4, 6, 7, 8, 9] }], `JPSoft_QBV_Caja_${desde}_${hasta}.xlsx`);
});

document.getElementById("btnExpProductos").addEventListener("click", () => {
  const data = [["Proveedor","ID","Codigo","Producto","P. Lista","Ganancia %","P. Venta","Stock"]];
  allProducts
    .sort((a,b) => (a.proveedor||"").localeCompare(b.proveedor||"") || (a.desc||"").localeCompare(b.desc||""))
    .forEach(p => {
      const venta  = Math.round(getPrecioVenta(p));
      const ganPct = gananciaMap[p.proveedor] != null ? Math.round(gananciaMap[p.proveedor] * 100) : "";
      data.push([p.proveedor||"", p.id||"", p.cod||"", p.desc||"", p.lista||0, ganPct, venta, p.stock ?? "—"]);
    });

  if (data.length === 1) { showToast("No hay productos cargados.", "warning"); return; }
  exportarExcel([{ nombre: "Productos", data, colsMoney: [4, 6] }], `JPSoft_QBV_Productos_${todayKey()}.xlsx`);
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
    const snap = await get(ref(db));
    const data = snap.val() || {};
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `JPSoft_QBV_Backup_${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);

    // Registrar fecha último backup
    const fecha = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    await set(ref(db, "config/ultimoBackup"), fecha);
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
const importZone  = document.getElementById("importBackupZone");
const importInput = document.getElementById("importBackupInput");

importZone.addEventListener("click", () => importInput.click());
importZone.addEventListener("dragover", e => { e.preventDefault(); importZone.style.background = "var(--bg3)"; });
importZone.addEventListener("dragleave", () => { importZone.style.background = ""; });
importZone.addEventListener("drop", e => {
  e.preventDefault(); importZone.style.background = "";
  if (e.dataTransfer.files[0]) { importInput.files = e.dataTransfer.files; importInput.dispatchEvent(new Event("change")); }
});

importInput.addEventListener("change", e => {
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
    await set(ref(db), backupData);
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
    const snap = await get(ref(db));
    const data = snap.val() || {};

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
        else if (v.metodo === "debito") totD += v.total||0;
        else if (v.metodo === "mp") totM += v.total||0;
      });
      hCaja.push([fechaLabel(fecha), dia.apertura.hora||"", dia.cierre?.hora||"—", dia.apertura.turno||"", dia.apertura.fondo||0, ventas.length, totE, totD, totM, totE+totD+totM]);
    });

    exportarExcel([
      { nombre: "Productos",   data: hProductos,   colsMoney: [4, 6] },
      { nombre: "Proveedores", data: hProveedores },
      { nombre: "Ventas",      data: hVentas,       colsMoney: [4, 5, 7] },
      { nombre: "Caja",        data: hCaja,          colsMoney: [4, 6, 7, 8, 9] },
    ], `JPSoft_QBV_Backup_${todayKey()}.xlsx`);

    // Registrar fecha backup
    const fecha = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    await set(ref(db, "config/ultimoBackup"), fecha);
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
onValue(ref(db, "config/ultimoBackup"), snap => {
  verificarBackup(snap.val() || "");
});

// Cerrar modales con Escape
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("open");
  }
});
