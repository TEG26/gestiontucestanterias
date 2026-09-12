import { db } from "./firebase-config.js";
import { collection, onSnapshot, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const productosRef = collection(db, "productos");
const materiasPrimasRef = collection(db, "materiasPrimas");
const modulosRef = collection(db, "modulos");
const ventasRef = collection(db, "ventas");
const egresosRef = collection(db, "egresos");
const categoriasGastoRef = collection(db, "categoriasGasto");

let productosCache = [];
let materialesCache = [];
let modulosCache = [];
let ventasCache = [];
let egresosCache = [];
let categoriasCache = [];

// Precios que el usuario escribe en el simulador: { materiaId: precio }.
// Solo se aplican si el interruptor está activado; nunca se guardan.
let preciosSimulados = {};

const formatoNumero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const formatoNumero4 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });
const formatoMoneda = new Intl.NumberFormat("es-AR", {
  style: "currency", currency: "ARS", maximumFractionDigits: 2
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function dateAFechaInput(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function claveMes(d) { return dateAFechaInput(d).slice(0, 7); }
function normalizarItemComposicion(it) {
  if (it.tipo && it.refId) return it;
  return { tipo: "producto", refId: it.productoId, cantidad: it.cantidad };
}

function nombreElemento(id) {
  const m = materialesCache.find((x) => x.id === id);
  return m ? m.nombre : "(elemento eliminado)";
}

// Costo unitario de un elemento: el simulado si el simulador está
// activo y tiene un valor cargado, si no el de la última compra.
function costoElemento(id) {
  if (simActivo() && preciosSimulados[id] !== undefined && preciosSimulados[id] !== "") {
    return parseFloat(preciosSimulados[id]);
  }
  const m = materialesCache.find((x) => x.id === id);
  return m && m.ultimoCostoNeto ? m.ultimoCostoNeto : null;
}

// =====================================================================
// Suscripciones
// =====================================================================

onSnapshot(query(productosRef, orderBy("nombre")), (s) => {
  productosCache = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTodo();
});
onSnapshot(query(materiasPrimasRef, orderBy("nombre")), (s) => {
  materialesCache = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTodo();
});
onSnapshot(query(modulosRef, orderBy("nombre")), (s) => {
  modulosCache = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTodo();
});
onSnapshot(query(ventasRef, orderBy("fecha", "desc"), limit(3000)), (s) => {
  ventasCache = s.docs.map((d) => d.data());
  renderCostosFijos();
});
onSnapshot(query(egresosRef, orderBy("fecha", "desc"), limit(3000)), (s) => {
  egresosCache = s.docs.map((d) => d.data());
  renderCostosFijos();
});
onSnapshot(query(categoriasGastoRef, orderBy("nombre")), (s) => {
  categoriasCache = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderCostosFijos();
});

function renderTodo() {
  renderSimulador();
  renderSelectChapa();
  renderCosteo();
  renderTablaAnalisis();
  renderSelectAnalisisProducto();
  actualizarCalculadora();
  actualizarAprovechamiento();
}

// =====================================================================
// 1. Costo fijo de producción por unidad
// =====================================================================

const inputCfMes = document.getElementById("cf-mes");
const inputCfUnidades = document.getElementById("cf-unidades");
const btnCfRestaurar = document.getElementById("cf-restaurar");
const cfIndicadores = document.getElementById("cf-indicadores");

let costoFijoUnitario = 0;
let unidadesEditadasAMano = false;

inputCfMes.value = claveMes(new Date());
inputCfMes.addEventListener("input", () => { unidadesEditadasAMano = false; renderCostosFijos(); });
inputCfUnidades.addEventListener("input", () => { unidadesEditadasAMano = true; renderCostosFijos(); });
btnCfRestaurar.addEventListener("click", () => { unidadesEditadasAMano = false; renderCostosFijos(); });

// Todo lo gastado en el mes que NO es materia prima: esos insumos ya
// están contados dentro del costo de material de cada pieza, sumarlos
// acá los contaría dos veces.
function costosFijosDelMes(mes) {
  const idsMateriaPrima = categoriasCache
    .filter((c) => c.noSeleccionable || /materia prima/i.test(c.nombre))
    .map((c) => c.id);
  return egresosCache
    .filter((e) => e.fecha && claveMes(e.fecha.toDate()) === mes && !idsMateriaPrima.includes(e.categoriaId))
    .reduce((acc, e) => acc + (e.monto || 0), 0);
}

function unidadesVendidasDelMes(mes) {
  return ventasCache
    .filter((v) => v.fecha && claveMes(v.fecha.toDate()) === mes)
    .reduce((acc, v) => acc + (v.items || []).reduce((a, i) => a + (i.cantidad || 0), 0), 0);
}

function renderCostosFijos() {
  const mes = inputCfMes.value || claveMes(new Date());
  const fijos = costosFijosDelMes(mes);
  const vendidas = unidadesVendidasDelMes(mes);

  if (!unidadesEditadasAMano) inputCfUnidades.value = vendidas > 0 ? Math.round(vendidas) : "";

  const divisor = parseFloat(inputCfUnidades.value) || 0;
  costoFijoUnitario = divisor > 0 ? fijos / divisor : 0;

  cfIndicadores.innerHTML = `
    <div class="tarjeta-indicador">
      <p class="etiqueta">Costos fijos del mes</p>
      <p class="valor">${formatoMoneda.format(fijos)}</p>
      <p class="detalle">Todos los egresos menos materia prima</p>
    </div>
    <div class="tarjeta-indicador">
      <p class="etiqueta">Unidades vendidas en el mes</p>
      <p class="valor">${formatoNumero.format(vendidas)}</p>
      <p class="detalle">${unidadesEditadasAMano ? "estás prorrateando sobre otro número" : "es el divisor en uso"}</p>
    </div>
    <div class="tarjeta-indicador">
      <p class="etiqueta">Costo fijo por unidad</p>
      <p class="valor">${costoFijoUnitario > 0 ? formatoMoneda.format(costoFijoUnitario) : "—"}</p>
      <p class="detalle">Se suma al material de cada pieza</p>
    </div>`;

  renderCosteo();
}

// =====================================================================
// 2. Simulador de precios de materia prima
// =====================================================================

const tablaSimuladorBody = document.getElementById("tabla-simulador-body");
const checkSimActivo = document.getElementById("sim-activo");
const btnSimLimpiar = document.getElementById("sim-limpiar");

function simActivo() { return checkSimActivo.checked; }

checkSimActivo.addEventListener("change", () => { renderCosteo(); actualizarAprovechamiento(); });
btnSimLimpiar.addEventListener("click", () => {
  preciosSimulados = {};
  renderSimulador();
  renderCosteo();
  actualizarAprovechamiento();
});

function renderSimulador() {
  if (materialesCache.length === 0) {
    tablaSimuladorBody.innerHTML = '<tr><td colspan="4" class="fila-vacia">Todavía no hay elementos cargados.</td></tr>';
    return;
  }
  tablaSimuladorBody.innerHTML = materialesCache
    .map((m) => `
      <tr>
        <td>${escapeHtml(m.nombre)}</td>
        <td>${escapeHtml(m.unidad)}</td>
        <td class="col-numero">${m.ultimoCostoNeto ? formatoMoneda.format(m.ultimoCostoNeto) : "—"}</td>
        <td class="col-numero">
          <input type="number" class="input-simulado" data-materia="${m.id}" min="0" step="any"
                 value="${preciosSimulados[m.id] ?? ""}" placeholder="—" />
        </td>
      </tr>`)
    .join("");

  tablaSimuladorBody.querySelectorAll(".input-simulado").forEach((inp) => {
    inp.addEventListener("input", () => {
      preciosSimulados[inp.dataset.materia] = inp.value;
      if (simActivo()) { renderCosteo(); actualizarAprovechamiento(); }
    });
  });
}

// =====================================================================
// 3. Costeo de productos y conjuntos
// =====================================================================

const tablaCosteoProductos = document.getElementById("tabla-costeo-productos-body");
const tablaCosteoConjuntos = document.getElementById("tabla-costeo-conjuntos-body");
const alertasCosteo = document.getElementById("alertas-costeo");
const buscadorCosteoProductos = document.getElementById("costeo-productos-buscador");
const buscadorCosteoConjuntos = document.getElementById("costeo-conjuntos-buscador");

buscadorCosteoProductos.addEventListener("input", renderCosteo);
buscadorCosteoConjuntos.addEventListener("input", renderCosteo);

// Costo de material de un producto según su receta. Devuelve completo
// en false si a algún elemento le falta el precio, para no mostrar un
// número que parezca exacto cuando está incompleto.
function costoMaterialProducto(producto) {
  if (!producto.receta || producto.receta.length === 0) return { costo: 0, completo: false, sinReceta: true };
  let costo = 0, completo = true;
  producto.receta.forEach((r) => {
    const c = costoElemento(r.materiaId);
    if (c === null) { completo = false; return; }
    costo += r.cantidadPorUnidad * c;
  });
  return { costo, completo, sinReceta: false };
}

function costoMaterialConjunto(modulo) {
  if (!modulo.composicion || modulo.composicion.length === 0) return { costo: 0, completo: false, sinReceta: true };
  let costo = 0, completo = true;
  modulo.composicion.map(normalizarItemComposicion).forEach((c) => {
    if (c.tipo === "elemento") {
      const cu = costoElemento(c.refId);
      if (cu === null) { completo = false; return; }
      costo += cu * c.cantidad;
    } else {
      const p = productosCache.find((x) => x.id === c.refId);
      if (!p) { completo = false; return; }
      const r = costoMaterialProducto(p);
      if (!r.completo) completo = false;
      costo += r.costo * c.cantidad;
    }
  });
  return { costo, completo, sinReceta: false };
}

// Cuántas unidades de este conjunto equivalen a "una unidad" para el
// prorrateo del costo fijo: un conjunto es un módulo, así que lleva un
// costo fijo entero; una pieza suelta también cuenta como una unidad.
function filaCosteo(nombre, material, precioVenta) {
  const costoFijo = costoFijoUnitario;
  const costoTotal = material.costo + costoFijo;
  const precio = precioVenta || 0;
  const margen = precio > 0 ? precio - costoTotal : null;
  const margenPct = precio > 0 ? (margen / precio) * 100 : null;
  return { nombre, material, costoFijo, costoTotal, precio, margen, margenPct };
}

function pintarFilas(tbody, filas, texto) {
  if (filas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="fila-vacia">${
      texto ? "No hay coincidencias con la búsqueda." : "Todavía no hay nada cargado."
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = filas
    .map((f) => {
      const marca = f.material.sinReceta ? " (sin receta)" : f.material.completo ? "" : " (incompleto)";
      const claseMargen = f.margen === null ? "" : f.margen < 0 ? "insuficiente" : "";
      return `
      <tr>
        <td>${escapeHtml(f.nombre)}</td>
        <td class="col-numero">${formatoMoneda.format(f.material.costo)}${marca}</td>
        <td class="col-numero">${f.costoFijo > 0 ? formatoMoneda.format(f.costoFijo) : "—"}</td>
        <td class="col-numero">${formatoMoneda.format(f.costoTotal)}</td>
        <td class="col-numero">${f.precio > 0 ? formatoMoneda.format(f.precio) : "—"}</td>
        <td class="col-numero ${claseMargen}">${f.margen === null ? "—" : formatoMoneda.format(f.margen)}</td>
        <td class="col-numero ${claseMargen}">${f.margenPct === null ? "—" : formatoNumero.format(f.margenPct) + "%"}</td>
      </tr>`;
    })
    .join("");
}

function renderCosteo() {
  const tp = buscadorCosteoProductos.value.trim().toLowerCase();
  const tc = buscadorCosteoConjuntos.value.trim().toLowerCase();

  const filasProd = productosCache
    .filter((p) => !tp || p.nombre.toLowerCase().includes(tp))
    .map((p) => filaCosteo(p.nombre, costoMaterialProducto(p), p.precioVenta));
  pintarFilas(tablaCosteoProductos, filasProd, tp);

  const filasConj = modulosCache
    .filter((m) => !tc || m.nombre.toLowerCase().includes(tc))
    .map((m) => filaCosteo(m.nombre, costoMaterialConjunto(m), m.precioVenta));
  pintarFilas(tablaCosteoConjuntos, filasConj, tc);

  // Alertas: lo que se vende por debajo del costo o con margen muy fino
  const todas = [...filasProd, ...filasConj].filter((f) => f.precio > 0 && !f.material.sinReceta);
  const enPerdida = todas.filter((f) => f.margen < 0);
  const margenFino = todas.filter((f) => f.margen >= 0 && f.margenPct < 15);
  const sinPrecio = [...productosCache, ...modulosCache].filter((x) => !x.precioVenta);

  const alertas = [];
  if (enPerdida.length) {
    alertas.push({ grave: true, texto: `${enPerdida.length} ítem(s) se venden por debajo del costo: ${enPerdida.slice(0, 5).map((f) => f.nombre).join(", ")}${enPerdida.length > 5 ? "…" : ""}` });
  }
  if (margenFino.length) {
    alertas.push({ grave: false, texto: `${margenFino.length} ítem(s) con margen menor al 15%: ${margenFino.slice(0, 5).map((f) => f.nombre).join(", ")}${margenFino.length > 5 ? "…" : ""}` });
  }
  if (sinPrecio.length) {
    alertas.push({ grave: false, texto: `${sinPrecio.length} ítem(s) sin precio de venta cargado — no se puede calcular su margen.` });
  }
  alertasCosteo.innerHTML = alertas
    .map((a) => `<div class="alerta-indicador ${a.grave ? "grave" : ""}">${escapeHtml(a.texto)}</div>`)
    .join("");
}

// =====================================================================
// 4. Aprovechamiento de chapa
// =====================================================================

const apLadoA = document.getElementById("ap-lado-a");
const apLadoB = document.getElementById("ap-lado-b");
const apChapaAncho = document.getElementById("ap-chapa-ancho");
const apChapaLargo = document.getElementById("ap-chapa-largo");
const apElemento = document.getElementById("ap-elemento");
const apResultado = document.getElementById("ap-resultado");

[apLadoA, apLadoB, apChapaAncho, apChapaLargo].forEach((i) => i.addEventListener("input", actualizarAprovechamiento));
apElemento.addEventListener("change", actualizarAprovechamiento);

function renderSelectChapa() {
  const previo = apElemento.value;
  apElemento.innerHTML = '<option value="">Elegir...</option>' +
    materialesCache.map((m) => `<option value="${m.id}">${escapeHtml(m.nombre)}</option>`).join("");
  if (materialesCache.some((m) => m.id === previo)) apElemento.value = previo;
}

// Corte en grilla: se prueban las dos orientaciones de la pieza sobre
// la chapa y se toma la que rinde más. No contempla cortes rotados ni
// aprovechamiento de recortes.
function piezasPorChapa(a, b, ancho, largo) {
  const op1 = Math.floor(ancho / a) * Math.floor(largo / b);
  const op2 = Math.floor(ancho / b) * Math.floor(largo / a);
  return { cantidad: Math.max(op1, op2), orientacion: op1 >= op2 ? "A lo ancho" : "Rotada" };
}

function actualizarAprovechamiento() {
  const a = parseFloat(apLadoA.value), b = parseFloat(apLadoB.value);
  const ancho = parseFloat(apChapaAncho.value), largo = parseFloat(apChapaLargo.value);
  if (!(a > 0) || !(b > 0) || !(ancho > 0) || !(largo > 0)) { apResultado.hidden = true; return; }

  const supChapa = ancho * largo;
  const { cantidad, orientacion } = piezasPorChapa(a, b, ancho, largo);
  if (cantidad === 0) {
    apResultado.hidden = false;
    apResultado.innerHTML = '<p class="consumo-preview-titulo">La pieza no entra en una chapa de esa medida.</p>';
    return;
  }

  const supTeorica = a * b;
  const supReal = supChapa / cantidad;
  const desperdicio = ((supReal - supTeorica) / supReal) * 100;

  const costoUnit = apElemento.value ? costoElemento(apElemento.value) : null;
  const costoPieza = costoUnit !== null ? supReal * costoUnit : null;

  apResultado.hidden = false;
  apResultado.innerHTML = `
    <p class="consumo-preview-titulo">Resultado (${orientacion.toLowerCase()}):</p>
    <div class="consumo-preview-fila"><span>Piezas por chapa</span><span>${cantidad}</span></div>
    <div class="consumo-preview-fila"><span>Superficie teórica de la pieza</span><span>${formatoNumero4.format(supTeorica)} m²</span></div>
    <div class="consumo-preview-fila"><span>Superficie real que consume</span><span>${formatoNumero4.format(supReal)} m² ← va en la receta</span></div>
    <div class="consumo-preview-fila ${desperdicio > 25 ? "insuficiente" : ""}"><span>Desperdicio de corte</span><span>${formatoNumero.format(desperdicio)}%</span></div>
    ${costoPieza !== null
      ? `<div class="consumo-preview-fila"><span>Costo de material por pieza</span><span>${formatoMoneda.format(costoPieza)}</span></div>`
      : '<div class="consumo-preview-fila"><span>Costo por pieza</span><span>elegí una chapa con costo cargado</span></div>'}`;
}

// =====================================================================
// Producible hoy (se mantiene de la versión anterior)
// =====================================================================

const tablaAnalisisBody = document.getElementById("tabla-analisis-body");
const inputBuscadorAnalisis = document.getElementById("analisis-buscador");
inputBuscadorAnalisis.addEventListener("input", renderTablaAnalisis);

function resumenReceta(receta) {
  if (!receta || receta.length === 0) return "Sin receta";
  return receta.map((r) => `${nombreElemento(r.materiaId)} (${formatoNumero4.format(r.cantidadPorUnidad)})`).join(", ");
}

function producibleHoy(receta) {
  if (!receta || receta.length === 0) return null;
  let minimo = Infinity;
  for (const r of receta) {
    const el = materialesCache.find((m) => m.id === r.materiaId);
    const stock = el ? el.stockActual || 0 : 0;
    if (r.cantidadPorUnidad <= 0) continue;
    minimo = Math.min(minimo, stock / r.cantidadPorUnidad);
  }
  return minimo === Infinity ? null : minimo;
}

function renderTablaAnalisis() {
  const texto = inputBuscadorAnalisis.value.trim().toLowerCase();
  const productos = texto ? productosCache.filter((p) => p.nombre.toLowerCase().includes(texto)) : productosCache;
  if (productos.length === 0) {
    tablaAnalisisBody.innerHTML = `<tr><td colspan="3" class="fila-vacia">${
      texto ? "No hay productos que coincidan con la búsqueda." : "Todavía no hay productos cargados."
    }</td></tr>`;
    return;
  }
  tablaAnalisisBody.innerHTML = productos
    .map((p) => {
      const resumen = resumenReceta(p.receta);
      const producible = producibleHoy(p.receta);
      return `
      <tr>
        <td>${escapeHtml(p.nombre)}</td>
        <td><span class="receta-resumen" title="${escapeHtml(resumen)}">${escapeHtml(resumen)}</span></td>
        <td class="col-numero">${producible === null ? "—" : formatoNumero.format(producible)}</td>
      </tr>`;
    })
    .join("");
}

// ---------- Calculadora rápida de consumo ----------

const selectAnalisisProducto = document.getElementById("analisis-producto");
const inputAnalisisCantidad = document.getElementById("analisis-cantidad");
const previewAnalisis = document.getElementById("analisis-consumo-preview");
const previewAnalisisFilas = document.getElementById("analisis-consumo-filas");

function renderSelectAnalisisProducto() {
  const conReceta = productosCache.filter((p) => p.receta && p.receta.length > 0);
  const previo = selectAnalisisProducto.value;
  selectAnalisisProducto.innerHTML =
    '<option value="" disabled selected>Elegir producto...</option>' +
    conReceta.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("");
  if (conReceta.some((p) => p.id === previo)) selectAnalisisProducto.value = previo;
}

function actualizarCalculadora() {
  const productoId = selectAnalisisProducto.value;
  const cantidad = parseFloat(inputAnalisisCantidad.value);
  if (!productoId || !(cantidad > 0)) { previewAnalisis.hidden = true; return; }
  const producto = productosCache.find((p) => p.id === productoId);
  if (!producto || !producto.receta) { previewAnalisis.hidden = true; return; }

  previewAnalisisFilas.innerHTML = producto.receta
    .map((r) => {
      const necesario = r.cantidadPorUnidad * cantidad;
      const el = materialesCache.find((m) => m.id === r.materiaId);
      const stock = el ? el.stockActual || 0 : 0;
      return `
      <div class="consumo-preview-fila ${necesario > stock ? "insuficiente" : ""}">
        <span>${escapeHtml(nombreElemento(r.materiaId))}</span>
        <span>${formatoNumero4.format(necesario)} (stock: ${formatoNumero.format(stock)})</span>
      </div>`;
    })
    .join("");
  previewAnalisis.hidden = false;
}

selectAnalisisProducto.addEventListener("change", actualizarCalculadora);
inputAnalisisCantidad.addEventListener("input", actualizarCalculadora);
