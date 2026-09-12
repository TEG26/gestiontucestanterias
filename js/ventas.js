import { db, auth } from "./firebase-config.js";
import {
  collection,
  doc,
  runTransaction,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const ventasRef = collection(db, "ventas");
const productosRef = collection(db, "productos");
const modulosRef = collection(db, "modulos");
const materiasPrimasRef = collection(db, "materiasPrimas");

const TASA_IVA = 0.21;

// Caches propios de este archivo (independientes de los demás módulos).
let productosCache = [];
let modulosCache = [];
let materialesCache = [];
let ventasCache = [];

const formatoNumero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const formatoMoneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2
});
const formatoFecha = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function fechaInputADate(valorInput) {
  const [anio, mes, dia] = valorInput.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}
function dateAFechaInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
// Los conjuntos creados antes del cambio a composición mixta guardaban
// { productoId, cantidad } sin "tipo" — se normalizan como "producto".
function normalizarItemComposicion(item) {
  if (item.tipo && item.refId) return item;
  return { tipo: "producto", refId: item.productoId, cantidad: item.cantidad };
}

// =====================================================================
// Caches base
// =====================================================================

onSnapshot(query(productosRef, orderBy("nombre")), (snapshot) => {
  productosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  refrescarSelectsLineasVenta();
});
onSnapshot(query(modulosRef, orderBy("nombre")), (snapshot) => {
  modulosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  refrescarSelectsLineasVenta();
});
onSnapshot(query(materiasPrimasRef, orderBy("nombre")), (snapshot) => {
  materialesCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
});

function nombreDeItem(tipo, refId) {
  if (tipo === "modulo") {
    const m = modulosCache.find((x) => x.id === refId);
    return m ? m.nombre : "(conjunto eliminado)";
  }
  const p = productosCache.find((x) => x.id === refId);
  return p ? p.nombre : "(producto eliminado)";
}

// Disponible hoy para vender: stock directo si es producto, o el
// cálculo de equivalentes (mínimo entre sus componentes) si es
// conjunto — mismo criterio que en Análisis de producción y Conjuntos.
function disponibleDeItem(tipo, refId) {
  if (tipo === "producto") {
    const p = productosCache.find((x) => x.id === refId);
    return p ? p.stockActual || 0 : 0;
  }
  const modulo = modulosCache.find((x) => x.id === refId);
  if (!modulo || !modulo.composicion || modulo.composicion.length === 0) return 0;
  let minimo = Infinity;
  for (const itemCrudo of modulo.composicion) {
    const c = normalizarItemComposicion(itemCrudo);
    if (c.cantidad <= 0) continue;
    const stockComponente =
      c.tipo === "elemento"
        ? (materialesCache.find((x) => x.id === c.refId)?.stockActual ?? 0)
        : (productosCache.find((x) => x.id === c.refId)?.stockActual ?? 0);
    minimo = Math.min(minimo, stockComponente / c.cantidad);
  }
  return minimo === Infinity ? 0 : Math.floor(minimo);
}

function precioSugeridoDeItem(tipo, refId) {
  const coleccion = tipo === "producto" ? productosCache : modulosCache;
  const item = coleccion.find((x) => x.id === refId);
  return item && item.precioVenta ? item.precioVenta : "";
}

function opcionesItemsVenta() {
  const opcionesProductos = productosCache
    .map((p) => `<option value="producto:${p.id}">${escapeHtml(p.nombre)}</option>`)
    .join("");
  const opcionesModulos = modulosCache
    .map((m) => `<option value="modulo:${m.id}">${escapeHtml(m.nombre)}</option>`)
    .join("");
  return (
    '<option value="" disabled selected>Elegir...</option>' +
    `<optgroup label="Productos">${opcionesProductos}</optgroup>` +
    `<optgroup label="Conjuntos">${opcionesModulos}</optgroup>`
  );
}

function refrescarSelectsLineasVenta() {
  document.querySelectorAll(".linea-venta-item").forEach((select) => {
    const valorPrevio = select.value;
    select.innerHTML = opcionesItemsVenta();
    select.value = valorPrevio;
  });
}

// =====================================================================
// Tabla de ventas
// =====================================================================

const tablaVentasBody = document.getElementById("tabla-ventas-body");

function resumenItemsVenta(items) {
  return items.map((it) => `${it.nombreSnapshot} x${formatoNumero.format(it.cantidad)}`).join(", ");
}

function renderTablaVentas() {
  const ventasFiltradas = aplicarFiltrosVentas(ventasCache);
  if (ventasFiltradas.length === 0) {
    tablaVentasBody.innerHTML = '<tr><td colspan="6" class="fila-vacia">No hay ventas que coincidan con el filtro.</td></tr>';
    return;
  }
  tablaVentasBody.innerHTML = ventasFiltradas
    .map((v) => {
      const fecha = v.fecha ? formatoFecha.format(v.fecha.toDate()) : "—";
      const resumen = resumenItemsVenta(v.items || []);
      return `
      <tr>
        <td>${fecha}</td>
        <td>${escapeHtml(v.cliente)}</td>
        <td><span class="receta-resumen" title="${escapeHtml(resumen)}">${escapeHtml(resumen)}</span></td>
        <td>${escapeHtml(v.medioPago)}</td>
        <td class="col-numero">${formatoMoneda.format(v.montoTotal)}</td>
        <td class="col-acciones">
          <button type="button" class="boton-accion-fila" data-ver-remito="${v.id}">Remito</button>
          <button type="button" class="boton-accion-fila" data-editar-venta="${v.id}">Editar</button>
          <button type="button" class="boton-accion-fila peligro" data-eliminar-venta="${v.id}">Eliminar</button>
        </td>
      </tr>`;
    })
    .join("");
}

onSnapshot(query(ventasRef, orderBy("fecha", "desc"), limit(500)), (snapshot) => {
  ventasCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaVentas();
});

// ---------- Filtros del listado ----------

const inputFiltroMes = document.getElementById("ventas-filtro-mes");
const inputFiltroCliente = document.getElementById("ventas-filtro-cliente");
const inputFiltroTexto = document.getElementById("ventas-filtro-texto");
const btnLimpiarFiltros = document.getElementById("btn-limpiar-filtros-ventas");

function aplicarFiltrosVentas(ventas) {
  const mes = inputFiltroMes.value; // "YYYY-MM" o ""
  const cliente = inputFiltroCliente.value.trim().toLowerCase();
  const texto = inputFiltroTexto.value.trim().toLowerCase();

  return ventas.filter((v) => {
    if (mes && v.fecha) {
      const fechaMes = dateAFechaInput(v.fecha.toDate()).slice(0, 7);
      if (fechaMes !== mes) return false;
    }
    if (cliente && !v.cliente.toLowerCase().includes(cliente)) return false;
    if (texto) {
      const bolsa = `${v.cliente} ${(v.items || []).map((it) => it.nombreSnapshot).join(" ")}`.toLowerCase();
      if (!bolsa.includes(texto)) return false;
    }
    return true;
  });
}
[inputFiltroMes, inputFiltroCliente, inputFiltroTexto].forEach((input) => {
  input.addEventListener("input", renderTablaVentas);
});
btnLimpiarFiltros.addEventListener("click", () => {
  inputFiltroMes.value = "";
  inputFiltroCliente.value = "";
  inputFiltroTexto.value = "";
  renderTablaVentas();
});

// =====================================================================
// Modal: nueva venta
// =====================================================================

const modalVenta = document.getElementById("modal-venta");
const tituloModalVenta = document.getElementById("titulo-modal-venta");
const errorVenta = document.getElementById("error-venta");
const inputVentaCliente = document.getElementById("venta-cliente");
const inputVentaFecha = document.getElementById("venta-fecha");
const inputVentaMedioPago = document.getElementById("venta-medio-pago");
const selectVentaFacturaA = document.getElementById("venta-factura-a");
const lineasVentaContenedor = document.getElementById("venta-lineas");
const btnAgregarLineaVenta = document.getElementById("btn-agregar-linea-venta");
const advertenciaStock = document.getElementById("venta-advertencia-stock");
const netoCalculadoEl = document.getElementById("venta-neto-calculado");
const ivaCalculadoEl = document.getElementById("venta-iva-calculado");
const totalCalculadoEl = document.getElementById("venta-total-calculado");
const btnGuardarVenta = document.getElementById("btn-guardar-venta");

function crearLineaVenta(item = null) {
  const fila = document.createElement("div");
  fila.className = "linea-venta";
  fila.innerHTML = `
    <select class="linea-venta-item">${opcionesItemsVenta()}</select>
    <input type="number" class="linea-venta-cantidad" min="0.01" step="any" placeholder="Cantidad" value="${item ? item.cantidad : ""}" />
    <input type="number" class="linea-venta-precio" min="0" step="any" placeholder="Precio unitario" value="${item ? item.precioUnitario : ""}" />
    <span class="linea-venta-subtotal">$0</span>
    <button type="button" class="boton-quitar-fila" title="Quitar">×</button>
    <div class="linea-venta-aviso" hidden></div>
  `;
  const selectItem = fila.querySelector(".linea-venta-item");
  const inputCantidad = fila.querySelector(".linea-venta-cantidad");
  const inputPrecio = fila.querySelector(".linea-venta-precio");

  if (item) selectItem.value = `${item.tipo}:${item.refId}`;

  selectItem.addEventListener("change", () => {
    const [tipo, refId] = selectItem.value.split(":");
    const sugerido = precioSugeridoDeItem(tipo, refId);
    if (sugerido !== "") inputPrecio.value = sugerido;
    actualizarLineaVenta(fila);
  });
  inputCantidad.addEventListener("input", () => actualizarLineaVenta(fila));
  inputPrecio.addEventListener("input", () => actualizarLineaVenta(fila));
  fila.querySelector(".boton-quitar-fila").addEventListener("click", () => {
    fila.remove();
    actualizarDesgloseVenta();
  });

  if (item) actualizarLineaVenta(fila);
  return fila;
}

function actualizarLineaVenta(fila) {
  const selectItem = fila.querySelector(".linea-venta-item");
  const cantidad = parseFloat(fila.querySelector(".linea-venta-cantidad").value) || 0;
  const precio = parseFloat(fila.querySelector(".linea-venta-precio").value) || 0;
  const subtotalEl = fila.querySelector(".linea-venta-subtotal");
  const avisoEl = fila.querySelector(".linea-venta-aviso");

  subtotalEl.textContent = formatoMoneda.format(cantidad * precio);

  if (selectItem.value && cantidad > 0) {
    const [tipo, refId] = selectItem.value.split(":");
    const disponible = disponibleDeItem(tipo, refId);
    if (cantidad > disponible) {
      avisoEl.textContent = `Stock insuficiente: hay ${formatoNumero.format(disponible)} disponible(s).`;
      avisoEl.hidden = false;
    } else {
      avisoEl.hidden = true;
    }
  } else {
    avisoEl.hidden = true;
  }

  actualizarDesgloseVenta();
}

function actualizarDesgloseVenta() {
  const filas = Array.from(lineasVentaContenedor.querySelectorAll(".linea-venta"));
  let total = 0;
  let hayFaltante = false;
  filas.forEach((fila) => {
    const cantidad = parseFloat(fila.querySelector(".linea-venta-cantidad").value) || 0;
    const precio = parseFloat(fila.querySelector(".linea-venta-precio").value) || 0;
    total += cantidad * precio;
    if (!fila.querySelector(".linea-venta-aviso").hidden) hayFaltante = true;
  });

  const facturaA = selectVentaFacturaA.value === "si";
  let totalNeto = total;
  let ivaTotal = 0;
  if (facturaA) {
    totalNeto = total / (1 + TASA_IVA);
    ivaTotal = total - totalNeto;
  }
  netoCalculadoEl.textContent = formatoMoneda.format(totalNeto);
  ivaCalculadoEl.textContent = formatoMoneda.format(ivaTotal);
  totalCalculadoEl.textContent = formatoMoneda.format(total);

  if (hayFaltante) {
    advertenciaStock.textContent =
      "Uno o más ítems no tienen stock suficiente. Se puede registrar la venta igual — el stock va a quedar en negativo hasta que se repongan.";
    advertenciaStock.hidden = false;
  } else {
    advertenciaStock.hidden = true;
  }
}
selectVentaFacturaA.addEventListener("change", actualizarDesgloseVenta);

btnAgregarLineaVenta.addEventListener("click", () => {
  lineasVentaContenedor.appendChild(crearLineaVenta());
});

let editandoVentaId = null; // id de la venta original, o null si es alta
let itemsOriginalesVenta = []; // items de la venta tal cual estaba antes de editar

document.getElementById("btn-abrir-venta").addEventListener("click", () => {
  if (productosCache.length === 0 && modulosCache.length === 0) {
    alert("Primero tenés que cargar al menos un producto o un conjunto.");
    return;
  }
  editandoVentaId = null;
  itemsOriginalesVenta = [];
  inputVentaCliente.value = "";
  inputVentaFecha.value = dateAFechaInput(new Date());
  inputVentaMedioPago.value = "";
  selectVentaFacturaA.value = "no";
  lineasVentaContenedor.innerHTML = "";
  lineasVentaContenedor.appendChild(crearLineaVenta());
  errorVenta.hidden = true;
  advertenciaStock.hidden = true;
  tituloModalVenta.textContent = "Nueva venta";
  btnGuardarVenta.textContent = "Registrar venta";
  actualizarDesgloseVenta();
  abrirModal(modalVenta);
});

tablaVentasBody.addEventListener("click", (e) => {
  const idVerRemito = e.target.dataset.verRemito;
  const idEditar = e.target.dataset.editarVenta;
  const idEliminar = e.target.dataset.eliminarVenta;

  if (idVerRemito) {
    abrirModalRemito(idVerRemito);
  }

  if (idEditar) {
    const venta = ventasCache.find((v) => v.id === idEditar);
    if (!venta) return;
    editandoVentaId = venta.id;
    itemsOriginalesVenta = venta.items || [];
    inputVentaCliente.value = venta.cliente;
    inputVentaFecha.value = venta.fecha ? dateAFechaInput(venta.fecha.toDate()) : dateAFechaInput(new Date());
    inputVentaMedioPago.value = venta.medioPago;
    selectVentaFacturaA.value = venta.facturaA ? "si" : "no";
    lineasVentaContenedor.innerHTML = "";
    itemsOriginalesVenta.forEach((it) => lineasVentaContenedor.appendChild(crearLineaVenta(it)));
    errorVenta.hidden = true;
    tituloModalVenta.textContent = "Editar venta";
    btnGuardarVenta.textContent = "Guardar cambios";
    actualizarDesgloseVenta();
    abrirModal(modalVenta);
  }

  if (idEliminar) {
    const venta = ventasCache.find((v) => v.id === idEliminar);
    if (!venta) return;
    if (
      !confirm(
        `¿Eliminar esta venta de "${venta.cliente}"? Se revierte el stock descontado (puede quedar de más si ya se repuso de otra forma).`
      )
    )
      return;
    eliminarVenta(venta).catch((error) => {
      console.error(error);
      alert("No se pudo eliminar la venta. Probá de nuevo.");
    });
  }
});

function leerLineasVenta() {
  const filas = Array.from(lineasVentaContenedor.querySelectorAll(".linea-venta"));
  if (filas.length === 0) {
    errorVenta.textContent = "Agregá al menos un producto o conjunto.";
    errorVenta.hidden = false;
    return null;
  }
  const items = [];
  for (const fila of filas) {
    const valorSelect = fila.querySelector(".linea-venta-item").value;
    const cantidad = parseFloat(fila.querySelector(".linea-venta-cantidad").value);
    const precioUnitario = parseFloat(fila.querySelector(".linea-venta-precio").value);
    if (!valorSelect || !(cantidad > 0) || !(precioUnitario >= 0)) {
      errorVenta.textContent = "Completá el producto/conjunto, la cantidad y el precio en cada línea (o quitá la línea).";
      errorVenta.hidden = false;
      return null;
    }
    const [tipo, refId] = valorSelect.split(":");
    items.push({
      tipo,
      refId,
      nombreSnapshot: nombreDeItem(tipo, refId),
      cantidad,
      precioUnitario,
      subtotal: round2(cantidad * precioUnitario)
    });
  }
  return items;
}

btnGuardarVenta.addEventListener("click", async () => {
  errorVenta.hidden = true;

  const cliente = inputVentaCliente.value.trim();
  const fechaValor = inputVentaFecha.value;
  const medioPago = inputVentaMedioPago.value.trim();
  const facturaA = selectVentaFacturaA.value === "si";

  if (!cliente) {
    errorVenta.textContent = "Ingresá el cliente.";
    errorVenta.hidden = false;
    return;
  }
  if (!fechaValor) {
    errorVenta.textContent = "Elegí una fecha.";
    errorVenta.hidden = false;
    return;
  }
  if (!medioPago) {
    errorVenta.textContent = "Ingresá el medio de pago.";
    errorVenta.hidden = false;
    return;
  }

  const items = leerLineasVenta();
  if (!items) return;

  const fecha = fechaInputADate(fechaValor);

  btnGuardarVenta.disabled = true;
  try {
    if (editandoVentaId) {
      await actualizarVenta(editandoVentaId, itemsOriginalesVenta, { cliente, fecha, medioPago, facturaA, items });
    } else {
      await registrarVenta({ cliente, fecha, medioPago, facturaA, items });
    }
    cerrarModal(modalVenta);
  } catch (error) {
    console.error(error);
    errorVenta.textContent = "No se pudo guardar la venta. Probá de nuevo.";
    errorVenta.hidden = false;
  } finally {
    btnGuardarVenta.disabled = false;
  }
});

function calcularDesgloseVenta(items, facturaA) {
  const total = items.reduce((acc, it) => acc + it.subtotal, 0);
  if (!facturaA) {
    return { totalNeto: round2(total), ivaTotal: 0, totalConIva: round2(total) };
  }
  const totalNeto = total / (1 + TASA_IVA);
  const ivaTotal = total - totalNeto;
  return { totalNeto: round2(totalNeto), ivaTotal: round2(ivaTotal), totalConIva: round2(total) };
}

// Suma productos y elementos afectados por una lista de ítems de venta,
// expandiendo los conjuntos a sus componentes. `composicionesCache` se
// comparte entre llamadas dentro de la misma transacción para no leer
// dos veces el mismo conjunto (por ejemplo al comparar venta vieja vs
// nueva en una edición).
async function calcularDeltasDeItems(tx, items, composicionesCache) {
  const deltaProductos = {};
  const deltaElementos = {};
  for (const it of items) {
    if (it.tipo === "producto") {
      deltaProductos[it.refId] = (deltaProductos[it.refId] || 0) + it.cantidad;
    } else {
      if (!(it.refId in composicionesCache)) {
        const snap = await tx.get(doc(modulosRef, it.refId));
        composicionesCache[it.refId] = snap.exists() ? snap.data().composicion || [] : [];
      }
      composicionesCache[it.refId].map(normalizarItemComposicion).forEach((c) => {
        const totalComponente = c.cantidad * it.cantidad;
        if (c.tipo === "elemento") {
          deltaElementos[c.refId] = (deltaElementos[c.refId] || 0) + totalComponente;
        } else {
          deltaProductos[c.refId] = (deltaProductos[c.refId] || 0) + totalComponente;
        }
      });
    }
  }
  return { deltaProductos, deltaElementos };
}

// Descuenta stock según lo vendido: si el ítem es un producto, directo;
// si es un conjunto, se expande a sus componentes (productos y/o
// elementos) leyendo la composición ACTUAL del conjunto en el momento
// de la venta. El stock nunca bloquea la venta — puede quedar negativo
// a propósito, a diferencia del resto de la app.
async function registrarVenta({ cliente, fecha, medioPago, facturaA, items }) {
  const desglose = calcularDesgloseVenta(items, facturaA);

  await runTransaction(db, async (tx) => {
    const { deltaProductos, deltaElementos } = await calcularDeltasDeItems(tx, items, {});

    const lecturasProductos = [];
    for (const id of Object.keys(deltaProductos)) {
      const ref = doc(productosRef, id);
      const snap = await tx.get(ref);
      if (snap.exists()) lecturasProductos.push({ ref, nuevoStock: (snap.data().stockActual || 0) - deltaProductos[id] });
    }
    const lecturasElementos = [];
    for (const id of Object.keys(deltaElementos)) {
      const ref = doc(materiasPrimasRef, id);
      const snap = await tx.get(ref);
      if (snap.exists()) lecturasElementos.push({ ref, nuevoStock: (snap.data().stockActual || 0) - deltaElementos[id] });
    }

    lecturasProductos.forEach(({ ref, nuevoStock }) => {
      tx.update(ref, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    });
    lecturasElementos.forEach(({ ref, nuevoStock }) => {
      tx.update(ref, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    });

    tx.set(doc(ventasRef), {
      cliente,
      fecha,
      items,
      medioPago,
      facturaA,
      montoNeto: desglose.totalNeto,
      ivaTotal: desglose.ivaTotal,
      montoTotal: desglose.totalConIva,
      creadoPor: auth.currentUser ? auth.currentUser.uid : null
    });
  });
}

// Ajusta el stock por la diferencia entre lo que la venta descontaba
// antes y lo que va a descontar ahora (misma idea que en compras: se
// revierte lo viejo y se aplica lo nuevo en un solo neto por ítem). Ojo:
// si un conjunto involucrado cambió de composición desde la venta
// original, la reversión usa la composición ACTUAL, no la de aquel
// momento — es una simplificación asumida a propósito.
async function actualizarVenta(ventaId, itemsOriginales, { cliente, fecha, medioPago, facturaA, items }) {
  const ventaRef = doc(ventasRef, ventaId);
  const desglose = calcularDesgloseVenta(items, facturaA);

  await runTransaction(db, async (tx) => {
    const composicionesCache = {};
    const viejo = await calcularDeltasDeItems(tx, itemsOriginales, composicionesCache);
    const nuevo = await calcularDeltasDeItems(tx, items, composicionesCache);

    const idsProductos = new Set([...Object.keys(viejo.deltaProductos), ...Object.keys(nuevo.deltaProductos)]);
    const idsElementos = new Set([...Object.keys(viejo.deltaElementos), ...Object.keys(nuevo.deltaElementos)]);

    const lecturasProductos = [];
    for (const id of idsProductos) {
      const ref = doc(productosRef, id);
      const snap = await tx.get(ref);
      if (!snap.exists()) continue;
      const netoDelta = (nuevo.deltaProductos[id] || 0) - (viejo.deltaProductos[id] || 0);
      lecturasProductos.push({ ref, nuevoStock: (snap.data().stockActual || 0) - netoDelta });
    }
    const lecturasElementos = [];
    for (const id of idsElementos) {
      const ref = doc(materiasPrimasRef, id);
      const snap = await tx.get(ref);
      if (!snap.exists()) continue;
      const netoDelta = (nuevo.deltaElementos[id] || 0) - (viejo.deltaElementos[id] || 0);
      lecturasElementos.push({ ref, nuevoStock: (snap.data().stockActual || 0) - netoDelta });
    }

    lecturasProductos.forEach(({ ref, nuevoStock }) => {
      tx.update(ref, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    });
    lecturasElementos.forEach(({ ref, nuevoStock }) => {
      tx.update(ref, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    });

    tx.update(ventaRef, {
      cliente,
      fecha,
      items,
      medioPago,
      facturaA,
      montoNeto: desglose.totalNeto,
      ivaTotal: desglose.ivaTotal,
      montoTotal: desglose.totalConIva,
      actualizadoEn: serverTimestamp()
    });
  });
}

async function eliminarVenta(venta) {
  const ventaRef = doc(ventasRef, venta.id);

  await runTransaction(db, async (tx) => {
    const { deltaProductos, deltaElementos } = await calcularDeltasDeItems(tx, venta.items || [], {});

    const lecturasProductos = [];
    for (const id of Object.keys(deltaProductos)) {
      const ref = doc(productosRef, id);
      const snap = await tx.get(ref);
      if (snap.exists()) lecturasProductos.push({ ref, nuevoStock: (snap.data().stockActual || 0) + deltaProductos[id] });
    }
    const lecturasElementos = [];
    for (const id of Object.keys(deltaElementos)) {
      const ref = doc(materiasPrimasRef, id);
      const snap = await tx.get(ref);
      if (snap.exists()) lecturasElementos.push({ ref, nuevoStock: (snap.data().stockActual || 0) + deltaElementos[id] });
    }

    lecturasProductos.forEach(({ ref, nuevoStock }) => {
      tx.update(ref, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    });
    lecturasElementos.forEach(({ ref, nuevoStock }) => {
      tx.update(ref, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    });

    tx.delete(ventaRef);
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// =====================================================================
// Remito
// =====================================================================

const modalRemito = document.getElementById("modal-remito");
const remitoNumero = document.getElementById("remito-numero");
const remitoCliente = document.getElementById("remito-cliente");
const remitoFecha = document.getElementById("remito-fecha");
const remitoItemsBody = document.getElementById("remito-items-body");
const btnImprimirRemito = document.getElementById("btn-imprimir-remito");

// Si el ítem es un conjunto, se listan además sus componentes (con la
// composición ACTUAL) a modo de detalle — igual que en tu remito de
// referencia, donde debajo de "10 Módulo 30x90x200" aparecen los
// estantes, parantes y tornillería que lo arman.
function construirFilasRemito(items) {
  const filas = [];
  items.forEach((it) => {
    if (it.tipo === "producto") {
      filas.push({ producto: it.nombreSnapshot, descripcion: "", cantidad: formatoNumero.format(it.cantidad) });
      return;
    }
    filas.push({
      producto: `${formatoNumero.format(it.cantidad)} ${it.nombreSnapshot}`,
      descripcion: "",
      cantidad: ""
    });
    const modulo = modulosCache.find((m) => m.id === it.refId);
    const composicion = modulo && modulo.composicion ? modulo.composicion.map(normalizarItemComposicion) : [];
    composicion.forEach((c) => {
      const nombreComponente =
        c.tipo === "elemento"
          ? materialesCache.find((x) => x.id === c.refId)?.nombre || "(elemento eliminado)"
          : nombreDeItem("producto", c.refId);
      filas.push({
        producto: "",
        descripcion: nombreComponente,
        cantidad: formatoNumero.format(c.cantidad * it.cantidad)
      });
    });
  });
  return filas;
}

function abrirModalRemito(ventaId) {
  const venta = ventasCache.find((v) => v.id === ventaId);
  if (!venta) return;

  remitoNumero.textContent = venta.id.slice(-6).toUpperCase();
  remitoCliente.textContent = venta.cliente;
  remitoFecha.textContent = venta.fecha ? formatoFecha.format(venta.fecha.toDate()) : "—";
  remitoItemsBody.innerHTML = construirFilasRemito(venta.items || [])
    .map(
      (f) => `
      <tr class="${f.producto ? "" : "fila-descripcion"}">
        <td>${escapeHtml(f.producto)}</td>
        <td>${escapeHtml(f.descripcion)}</td>
        <td class="col-numero">${f.cantidad}</td>
      </tr>`
    )
    .join("");

  abrirModal(modalRemito);
}

const contenidoRemito = document.getElementById("contenido-remito");
const areaImpresion = document.getElementById("area-impresion");

btnImprimirRemito.addEventListener("click", () => {
  areaImpresion.innerHTML = contenidoRemito.innerHTML;
  window.print();
});

// =====================================================================
// Helpers de modal
// =====================================================================

function abrirModal(modal) {
  modal.hidden = false;
}
function cerrarModal(modal) {
  modal.hidden = true;
}
document.querySelectorAll("[data-cerrar-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    cerrarModal(document.getElementById(btn.dataset.cerrarModal));
  });
});
