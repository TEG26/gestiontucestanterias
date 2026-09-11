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

const productosRef = collection(db, "productos");
const materiasPrimasRef = collection(db, "materiasPrimas");
const movimientosProduccionRef = collection(db, "movimientosProduccion");
const movimientosDescarteRef = collection(db, "movimientosDescarte");

// Caches propios de este archivo (independientes de productos.js y
// materias-primas.js) para no acoplar los módulos entre sí.
let productosCache = [];
let materialesCache = [];
let produccionCache = [];
let descarteCache = [];

const formatoNumero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const formatoFecha = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

function nombreProducto(id) {
  const p = productosCache.find((x) => x.id === id);
  return p ? p.nombre : "(producto eliminado)";
}
function nombreElemento(id) {
  const m = materialesCache.find((x) => x.id === id);
  return m ? m.nombre : "(elemento eliminado)";
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
// Ver nota equivalente en materias-primas.js: se arma la fecha a mano
// con los componentes locales para no correr un día por el uso de UTC.
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

// =====================================================================
// Caches base: productos y elementos
// =====================================================================

const selectProduccionProducto = document.getElementById("produccion-producto");
const selectDescarteProducto = document.getElementById("descarte-producto");

function renderSelectsProducto() {
  const productosConReceta = productosCache.filter((p) => p.receta && p.receta.length > 0);

  const valorPrevioProduccion = selectProduccionProducto.value;
  selectProduccionProducto.innerHTML =
    '<option value="" disabled selected>Elegir producto...</option>' +
    productosConReceta.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("");
  if (productosConReceta.some((p) => p.id === valorPrevioProduccion)) {
    selectProduccionProducto.value = valorPrevioProduccion;
  }

  const valorPrevioDescarte = selectDescarteProducto.value;
  selectDescarteProducto.innerHTML =
    '<option value="" disabled selected>Elegir producto...</option>' +
    productosCache.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("");
  if (productosCache.some((p) => p.id === valorPrevioDescarte)) {
    selectDescarteProducto.value = valorPrevioDescarte;
  }
}

onSnapshot(query(productosRef, orderBy("nombre")), (snapshot) => {
  productosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderSelectsProducto();
  renderTablaProduccion();
});

onSnapshot(query(materiasPrimasRef, orderBy("nombre")), (snapshot) => {
  materialesCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  actualizarPreviewConsumo();
});

// =====================================================================
// Tabla combinada: producción + descarte
// =====================================================================

const tablaProduccionBody = document.getElementById("tabla-produccion-body");

function renderTablaProduccion() {
  const filasProduccion = produccionCache
    .filter((p) => p.fechaInicio)
    .map((p) => ({ ...p, tipo: "produccion", fechaOrden: p.fechaInicio }));
  const filasDescarte = descarteCache
    .filter((d) => d.fecha)
    .map((d) => ({ ...d, tipo: "descarte", fechaOrden: d.fecha }));

  const combinado = [...filasProduccion, ...filasDescarte]
    .sort((a, b) => b.fechaOrden.toMillis() - a.fechaOrden.toMillis())
    .slice(0, 10);

  if (combinado.length === 0) {
    tablaProduccionBody.innerHTML =
      '<tr><td colspan="7" class="fila-vacia">Todavía no hay producción registrada.</td></tr>';
    return;
  }

  tablaProduccionBody.innerHTML = combinado
    .map((f) => {
      const fecha = formatoFecha.format(f.fechaOrden.toDate());
      if (f.tipo === "descarte") {
        return `
        <tr>
          <td>${fecha}</td>
          <td>${escapeHtml(nombreProducto(f.productoId))}</td>
          <td>Descarte</td>
          <td class="col-numero">—</td>
          <td class="col-numero">${formatoNumero.format(f.cantidad)}</td>
          <td class="col-numero">—</td>
          <td class="col-acciones"></td>
        </tr>`;
      }
      const pendiente = f.estado === "pendiente_confirmacion";
      return `
      <tr>
        <td>${fecha}</td>
        <td>${escapeHtml(nombreProducto(f.productoId))}</td>
        <td>Producción</td>
        <td class="col-numero">${formatoNumero.format(f.cantidadTeorica)}</td>
        <td class="col-numero">${
          pendiente ? '<span class="estado-pendiente">Pendiente</span>' : formatoNumero.format(f.cantidadReal)
        }</td>
        <td class="col-numero">${pendiente ? "—" : formatoNumero.format(f.merma)}</td>
        <td class="col-acciones">
          ${pendiente ? `<button type="button" class="boton-accion-fila" data-confirmar-produccion="${f.id}">Confirmar</button>` : ""}
          <button type="button" class="boton-accion-fila" data-editar-produccion="${f.id}">Editar</button>
          <button type="button" class="boton-accion-fila peligro" data-eliminar-produccion="${f.id}">Eliminar</button>
        </td>
      </tr>`;
    })
    .join("");
}

onSnapshot(query(movimientosProduccionRef, orderBy("fechaInicio", "desc"), limit(10)), (snapshot) => {
  produccionCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaProduccion();
});

onSnapshot(query(movimientosDescarteRef, orderBy("fecha", "desc"), limit(10)), (snapshot) => {
  descarteCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaProduccion();
});

// =====================================================================
// Modal: nueva producción
// =====================================================================

const modalProduccion = document.getElementById("modal-produccion");
const formProduccion = document.getElementById("form-produccion");
const errorProduccion = document.getElementById("error-produccion");
const inputProduccionFecha = document.getElementById("produccion-fecha");
const inputProduccionCantidad = document.getElementById("produccion-cantidad");
const previewConsumo = document.getElementById("produccion-consumo-preview");
const previewConsumoFilas = document.getElementById("produccion-consumo-filas");

document.getElementById("btn-abrir-produccion").addEventListener("click", () => {
  if (productosCache.filter((p) => p.receta && p.receta.length > 0).length === 0) {
    alert("Primero tenés que cargar al menos un producto con receta.");
    return;
  }
  formProduccion.reset();
  inputProduccionFecha.value = dateAFechaInput(new Date());
  errorProduccion.hidden = true;
  previewConsumo.hidden = true;
  abrirModal(modalProduccion);
});

function calcularConsumo(productoId, cantidadTeorica) {
  const producto = productosCache.find((p) => p.id === productoId);
  if (!producto || !producto.receta) return [];
  return producto.receta.map((r) => {
    const cantidadDescontada = r.cantidadPorUnidad * cantidadTeorica;
    const elemento = materialesCache.find((m) => m.id === r.materiaId);
    const stockDisponible = elemento ? elemento.stockActual || 0 : 0;
    return {
      materiaId: r.materiaId,
      cantidadDescontada,
      stockDisponible,
      insuficiente: cantidadDescontada > stockDisponible
    };
  });
}

function actualizarPreviewConsumo() {
  const productoId = selectProduccionProducto.value;
  const cantidad = parseFloat(inputProduccionCantidad.value);
  if (!productoId || !(cantidad > 0)) {
    previewConsumo.hidden = true;
    return;
  }
  const consumo = calcularConsumo(productoId, cantidad);
  previewConsumoFilas.innerHTML = consumo
    .map(
      (c) => `
      <div class="consumo-preview-fila ${c.insuficiente ? "insuficiente" : ""}">
        <span>${escapeHtml(nombreElemento(c.materiaId))}</span>
        <span>-${formatoNumero.format(c.cantidadDescontada)} (stock: ${formatoNumero.format(c.stockDisponible)})</span>
      </div>`
    )
    .join("");
  previewConsumo.hidden = consumo.length === 0;
}
selectProduccionProducto.addEventListener("change", actualizarPreviewConsumo);
inputProduccionCantidad.addEventListener("input", actualizarPreviewConsumo);

formProduccion.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorProduccion.hidden = true;

  const productoId = selectProduccionProducto.value;
  const cantidadTeorica = parseFloat(inputProduccionCantidad.value);
  if (!productoId || !(cantidadTeorica > 0) || !inputProduccionFecha.value) return;

  const consumo = calcularConsumo(productoId, cantidadTeorica);
  if (consumo.some((c) => c.insuficiente)) {
    errorProduccion.textContent = "No hay stock suficiente de uno o más elementos para esta cantidad.";
    errorProduccion.hidden = false;
    return;
  }

  const fechaInicio = fechaInputADate(inputProduccionFecha.value);

  deshabilitarForm(formProduccion, true);
  try {
    await iniciarProduccion(productoId, cantidadTeorica, consumo, fechaInicio);
    cerrarModal(modalProduccion);
  } catch (error) {
    if (error.code === "STOCK_INSUFICIENTE") {
      errorProduccion.textContent = "El stock cambió justo ahora y ya no alcanza. Revisá y probá de nuevo.";
    } else {
      console.error(error);
      errorProduccion.textContent = "No se pudo registrar la producción. Probá de nuevo.";
    }
    errorProduccion.hidden = false;
  } finally {
    deshabilitarForm(formProduccion, false);
  }
});

async function iniciarProduccion(productoId, cantidadTeorica, consumoPlaneado, fechaInicio) {
  await runTransaction(db, async (tx) => {
    const refsYSnaps = [];
    for (const c of consumoPlaneado) {
      const ref = doc(materiasPrimasRef, c.materiaId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("Un elemento de la receta ya no existe.");
      const stockActual = snap.data().stockActual || 0;
      if (stockActual < c.cantidadDescontada) {
        const err = new Error("Stock insuficiente");
        err.code = "STOCK_INSUFICIENTE";
        throw err;
      }
      refsYSnaps.push({ ref, stockActual });
    }

    refsYSnaps.forEach(({ ref, stockActual }, i) => {
      tx.update(ref, {
        stockActual: stockActual - consumoPlaneado[i].cantidadDescontada,
        actualizadoEn: serverTimestamp()
      });
    });

    tx.set(doc(movimientosProduccionRef), {
      productoId,
      cantidadTeorica,
      consumoMateriales: consumoPlaneado.map((c) => ({
        materiaId: c.materiaId,
        cantidadDescontada: c.cantidadDescontada
      })),
      estado: "pendiente_confirmacion",
      cantidadReal: null,
      merma: null,
      fechaInicio,
      fechaConfirmacion: null,
      creadoPor: auth.currentUser ? auth.currentUser.uid : null
    });
  });
}

// =====================================================================
// Modal: confirmar producción
// =====================================================================

const modalConfirmarProduccion = document.getElementById("modal-confirmar-produccion");
const formConfirmarProduccion = document.getElementById("form-confirmar-produccion");
const errorConfirmarProduccion = document.getElementById("error-confirmar-produccion");
const resumenConfirmarProduccion = document.getElementById("confirmar-produccion-resumen");
const inputCantidadReal = document.getElementById("confirmar-cantidad-real");
const mermaCalculadaEl = document.getElementById("confirmar-merma-calculada");

let produccionAConfirmar = null;

tablaProduccionBody.addEventListener("click", (e) => {
  const id = e.target.dataset.confirmarProduccion;
  if (!id) return;
  const produccion = produccionCache.find((p) => p.id === id);
  if (!produccion) return;

  produccionAConfirmar = produccion;
  resumenConfirmarProduccion.textContent = `${nombreProducto(produccion.productoId)} — cantidad teórica: ${formatoNumero.format(
    produccion.cantidadTeorica
  )}`;
  formConfirmarProduccion.reset();
  errorConfirmarProduccion.hidden = true;
  actualizarMermaCalculada();
  abrirModal(modalConfirmarProduccion);
});

function actualizarMermaCalculada() {
  if (!produccionAConfirmar) return;
  const real = parseFloat(inputCantidadReal.value) || 0;
  const merma = produccionAConfirmar.cantidadTeorica - real;
  mermaCalculadaEl.textContent = `Merma: ${formatoNumero.format(merma)}`;
}
inputCantidadReal.addEventListener("input", actualizarMermaCalculada);

formConfirmarProduccion.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorConfirmarProduccion.hidden = true;

  const cantidadReal = parseFloat(inputCantidadReal.value);
  if (!(cantidadReal >= 0) || !produccionAConfirmar) return;

  deshabilitarForm(formConfirmarProduccion, true);
  try {
    await confirmarProduccion(produccionAConfirmar, cantidadReal);
    cerrarModal(modalConfirmarProduccion);
  } catch (error) {
    console.error(error);
    errorConfirmarProduccion.textContent = "No se pudo confirmar la producción. Probá de nuevo.";
    errorConfirmarProduccion.hidden = false;
  } finally {
    deshabilitarForm(formConfirmarProduccion, false);
  }
});

async function confirmarProduccion(produccion, cantidadReal) {
  const produccionRef = doc(movimientosProduccionRef, produccion.id);
  const productoRef = doc(productosRef, produccion.productoId);
  const merma = produccion.cantidadTeorica - cantidadReal;

  await runTransaction(db, async (tx) => {
    const produccionSnap = await tx.get(produccionRef);
    if (!produccionSnap.exists() || produccionSnap.data().estado !== "pendiente_confirmacion") {
      throw new Error("Esta producción ya fue confirmada.");
    }
    const productoSnap = await tx.get(productoRef);
    if (!productoSnap.exists()) throw new Error("El producto ya no existe.");
    const stockActual = productoSnap.data().stockActual || 0;

    tx.update(productoRef, {
      stockActual: stockActual + cantidadReal,
      actualizadoEn: serverTimestamp()
    });

    tx.update(produccionRef, {
      estado: "confirmada",
      cantidadReal,
      merma,
      fechaConfirmacion: serverTimestamp()
    });
  });
}

// =====================================================================
// Modal: editar producción
// =====================================================================

const modalEditarProduccion = document.getElementById("modal-editar-produccion");
const formEditarProduccion = document.getElementById("form-editar-produccion");
const errorEditarProduccion = document.getElementById("error-editar-produccion");
const inputEditarProduccionFecha = document.getElementById("editar-produccion-fecha");
const labelEditarProduccionProducto = document.getElementById("label-editar-produccion-producto");
const selectEditarProduccionProducto = document.getElementById("editar-produccion-producto");
const textoEditarProduccionProductoFijo = document.getElementById("editar-produccion-producto-fijo");
const inputEditarProduccionTeorica = document.getElementById("editar-produccion-teorica");
const labelEditarProduccionReal = document.getElementById("label-editar-produccion-real");
const inputEditarProduccionReal = document.getElementById("editar-produccion-real");
const mermaEditarProduccionEl = document.getElementById("editar-produccion-merma");
const previewEditarConsumo = document.getElementById("editar-produccion-consumo-preview");
const previewEditarConsumoFilas = document.getElementById("editar-produccion-consumo-filas");

let produccionAEditar = null;

tablaProduccionBody.addEventListener("click", (e) => {
  const id = e.target.dataset.editarProduccion;
  if (!id) return;
  const produccion = produccionCache.find((p) => p.id === id);
  if (!produccion) return;

  produccionAEditar = produccion;
  const esConfirmada = produccion.estado === "confirmada";

  // El producto solo se puede cambiar si todavía no se confirmó: una vez
  // confirmada, el stock del producto ya se movió con la receta original.
  if (esConfirmada) {
    labelEditarProduccionProducto.hidden = true;
    textoEditarProduccionProductoFijo.hidden = false;
    textoEditarProduccionProductoFijo.textContent = `Producto: ${nombreProducto(produccion.productoId)} (no se puede cambiar en una producción ya confirmada)`;
  } else {
    labelEditarProduccionProducto.hidden = false;
    textoEditarProduccionProductoFijo.hidden = true;
    renderSelectEditarProducto();
    selectEditarProduccionProducto.value = produccion.productoId;
  }

  inputEditarProduccionTeorica.value = produccion.cantidadTeorica;
  inputEditarProduccionFecha.value = produccion.fechaInicio
    ? dateAFechaInput(produccion.fechaInicio.toDate())
    : dateAFechaInput(new Date());
  labelEditarProduccionReal.hidden = !esConfirmada;
  mermaEditarProduccionEl.hidden = !esConfirmada;
  inputEditarProduccionReal.value = esConfirmada ? produccion.cantidadReal : "";

  errorEditarProduccion.hidden = true;
  actualizarPreviewEditarConsumo();
  abrirModal(modalEditarProduccion);
});

function renderSelectEditarProducto() {
  const productosConReceta = productosCache.filter((p) => p.receta && p.receta.length > 0);
  selectEditarProduccionProducto.innerHTML =
    '<option value="" disabled selected>Elegir producto...</option>' +
    productosConReceta.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("");
}

function productoIdEnEdicion() {
  return produccionAEditar.estado === "confirmada" ? produccionAEditar.productoId : selectEditarProduccionProducto.value;
}

function actualizarPreviewEditarConsumo() {
  if (!produccionAEditar) return;
  const productoId = productoIdEnEdicion();
  const cantidad = parseFloat(inputEditarProduccionTeorica.value);
  if (!productoId || !(cantidad > 0)) {
    previewEditarConsumo.hidden = true;
    return;
  }
  const consumo = calcularConsumo(productoId, cantidad);
  previewEditarConsumoFilas.innerHTML = consumo
    .map(
      (c) => `
      <div class="consumo-preview-fila">
        <span>${escapeHtml(nombreElemento(c.materiaId))}</span>
        <span>-${formatoNumero.format(c.cantidadDescontada)}</span>
      </div>`
    )
    .join("");
  previewEditarConsumo.hidden = consumo.length === 0;

  if (produccionAEditar.estado === "confirmada") {
    const real = parseFloat(inputEditarProduccionReal.value) || 0;
    mermaEditarProduccionEl.textContent = `Merma: ${formatoNumero.format(cantidad - real)}`;
  }
}
selectEditarProduccionProducto.addEventListener("change", actualizarPreviewEditarConsumo);
inputEditarProduccionTeorica.addEventListener("input", actualizarPreviewEditarConsumo);
inputEditarProduccionReal.addEventListener("input", actualizarPreviewEditarConsumo);

formEditarProduccion.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEditarProduccion.hidden = true;

  const esConfirmada = produccionAEditar.estado === "confirmada";
  const productoId = productoIdEnEdicion();
  const cantidadTeorica = parseFloat(inputEditarProduccionTeorica.value);
  const cantidadReal = esConfirmada ? parseFloat(inputEditarProduccionReal.value) : null;
  const fechaInicio = inputEditarProduccionFecha.value ? fechaInputADate(inputEditarProduccionFecha.value) : null;

  if (!productoId || !(cantidadTeorica > 0) || !fechaInicio) return;
  if (esConfirmada && !(cantidadReal >= 0)) return;

  deshabilitarForm(formEditarProduccion, true);
  try {
    await actualizarProduccionExistente(produccionAEditar, { productoId, cantidadTeorica, cantidadReal, fechaInicio });
    cerrarModal(modalEditarProduccion);
  } catch (error) {
    if (error.code === "STOCK_NEGATIVO") {
      errorEditarProduccion.textContent = `Ese cambio dejaría el stock de "${nombreElemento(
        error.materiaId
      )}" en negativo. Revisá compras o producciones posteriores primero.`;
    } else {
      console.error(error);
      errorEditarProduccion.textContent = "No se pudo guardar el cambio. Probá de nuevo.";
    }
    errorEditarProduccion.hidden = false;
  } finally {
    deshabilitarForm(formEditarProduccion, false);
  }
});

// Recalcula el consumo de elementos desde cero con los valores nuevos y
// ajusta el stock por la diferencia contra lo que ya se había
// descontado originalmente (consumoMateriales de la producción tal como
// quedó guardada). Si además está confirmada, también ajusta el stock
// del producto por la diferencia de cantidad real.
async function actualizarProduccionExistente(original, { productoId, cantidadTeorica, cantidadReal, fechaInicio }) {
  const produccionRef = doc(movimientosProduccionRef, original.id);
  const nuevoConsumo = calcularConsumo(productoId, cantidadTeorica);
  const consumoViejoPorElemento = {};
  (original.consumoMateriales || []).forEach((c) => {
    consumoViejoPorElemento[c.materiaId] = (consumoViejoPorElemento[c.materiaId] || 0) + c.cantidadDescontada;
  });
  const consumoNuevoPorElemento = {};
  nuevoConsumo.forEach((c) => {
    consumoNuevoPorElemento[c.materiaId] = (consumoNuevoPorElemento[c.materiaId] || 0) + c.cantidadDescontada;
  });
  const idsAfectados = new Set([...Object.keys(consumoViejoPorElemento), ...Object.keys(consumoNuevoPorElemento)]);

  const esConfirmada = original.estado === "confirmada";
  const merma = esConfirmada ? cantidadTeorica - cantidadReal : null;

  await runTransaction(db, async (tx) => {
    const lecturasElementos = [];
    for (const materiaId of idsAfectados) {
      const ref = doc(materiasPrimasRef, materiaId);
      const snap = await tx.get(ref);
      if (!snap.exists()) continue;
      const stockActual = snap.data().stockActual || 0;
      const delta = (consumoNuevoPorElemento[materiaId] || 0) - (consumoViejoPorElemento[materiaId] || 0);
      const nuevoStock = stockActual - delta;
      if (nuevoStock < 0) {
        const err = new Error("Stock negativo");
        err.code = "STOCK_NEGATIVO";
        err.materiaId = materiaId;
        throw err;
      }
      lecturasElementos.push({ ref, nuevoStock });
    }

    let productoRef = null;
    let nuevoStockProducto = null;
    if (esConfirmada) {
      productoRef = doc(productosRef, original.productoId);
      const productoSnap = await tx.get(productoRef);
      if (!productoSnap.exists()) throw new Error("El producto ya no existe.");
      const stockProductoActual = productoSnap.data().stockActual || 0;
      const deltaReal = cantidadReal - original.cantidadReal;
      nuevoStockProducto = stockProductoActual + deltaReal;
      if (nuevoStockProducto < 0) {
        const err = new Error("Stock negativo");
        err.code = "STOCK_NEGATIVO";
        err.materiaId = original.productoId;
        throw err;
      }
    }

    lecturasElementos.forEach(({ ref, nuevoStock }) => {
      tx.update(ref, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    });

    if (productoRef) {
      tx.update(productoRef, { stockActual: nuevoStockProducto, actualizadoEn: serverTimestamp() });
    }

    tx.update(produccionRef, {
      productoId,
      cantidadTeorica,
      fechaInicio,
      consumoMateriales: nuevoConsumo.map((c) => ({ materiaId: c.materiaId, cantidadDescontada: c.cantidadDescontada })),
      ...(esConfirmada ? { cantidadReal, merma } : {})
    });
  });
}

// ---- Eliminar producción ----

tablaProduccionBody.addEventListener("click", (e) => {
  const id = e.target.dataset.eliminarProduccion;
  if (!id) return;
  const produccion = produccionCache.find((p) => p.id === id);
  if (!produccion) return;

  const mensaje =
    produccion.estado === "confirmada"
      ? `¿Eliminar esta producción de "${nombreProducto(produccion.productoId)}"? Se revierte el stock de elementos consumidos y el stock del producto ya confirmado.`
      : `¿Eliminar esta producción de "${nombreProducto(produccion.productoId)}"? Se revierte el stock de elementos consumidos.`;
  if (!confirm(mensaje)) return;

  eliminarProduccion(produccion).catch((error) => {
    if (error.code === "STOCK_NEGATIVO") {
      alert(
        `No se puede eliminar: el stock de "${nombreProducto(
          error.materiaId
        )}" ya se usó (quedaría en negativo). Revisá ventas o módulos que lo hayan consumido primero.`
      );
    } else {
      console.error(error);
      alert("No se pudo eliminar la producción. Probá de nuevo.");
    }
  });
});

// Revierte lo que la producción había descontado de elementos (siempre
// suma, así que nunca puede quedar negativo ahí). Si además ya estaba
// confirmada, también resta del stock del producto lo que esa
// confirmación había sumado — y ahí sí puede rechazarse si ese stock ya
// se usó en otro lado (venta, módulo, etc.).
async function eliminarProduccion(produccion) {
  const produccionRef = doc(movimientosProduccionRef, produccion.id);

  await runTransaction(db, async (tx) => {
    const lecturasElementos = [];
    for (const c of produccion.consumoMateriales || []) {
      const ref = doc(materiasPrimasRef, c.materiaId);
      const snap = await tx.get(ref);
      if (!snap.exists()) continue;
      const stockActual = snap.data().stockActual || 0;
      lecturasElementos.push({ ref, nuevoStock: stockActual + c.cantidadDescontada });
    }

    let productoRef = null;
    let nuevoStockProducto = null;
    if (produccion.estado === "confirmada") {
      productoRef = doc(productosRef, produccion.productoId);
      const productoSnap = await tx.get(productoRef);
      if (productoSnap.exists()) {
        const stockProductoActual = productoSnap.data().stockActual || 0;
        nuevoStockProducto = stockProductoActual - produccion.cantidadReal;
        if (nuevoStockProducto < 0) {
          const err = new Error("Stock negativo");
          err.code = "STOCK_NEGATIVO";
          err.materiaId = produccion.productoId;
          throw err;
        }
      }
    }

    lecturasElementos.forEach(({ ref, nuevoStock }) => {
      tx.update(ref, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    });
    if (productoRef && nuevoStockProducto !== null) {
      tx.update(productoRef, { stockActual: nuevoStockProducto, actualizadoEn: serverTimestamp() });
    }

    tx.delete(produccionRef);
  });
}

// =====================================================================
// Modal: hecho con descarte
// =====================================================================

const modalDescarte = document.getElementById("modal-descarte");
const formDescarte = document.getElementById("form-descarte");
const errorDescarte = document.getElementById("error-descarte");

document.getElementById("btn-abrir-descarte").addEventListener("click", () => {
  if (productosCache.length === 0) {
    alert("Primero tenés que cargar al menos un producto.");
    return;
  }
  formDescarte.reset();
  errorDescarte.hidden = true;
  abrirModal(modalDescarte);
});

formDescarte.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorDescarte.hidden = true;

  const productoId = selectDescarteProducto.value;
  const cantidad = parseFloat(document.getElementById("descarte-cantidad").value);
  const nota = document.getElementById("descarte-nota").value.trim();
  if (!productoId || !(cantidad > 0)) return;

  deshabilitarForm(formDescarte, true);
  try {
    await registrarDescarte(productoId, cantidad, nota);
    cerrarModal(modalDescarte);
  } catch (error) {
    console.error(error);
    errorDescarte.textContent = "No se pudo registrar el descarte. Probá de nuevo.";
    errorDescarte.hidden = false;
  } finally {
    deshabilitarForm(formDescarte, false);
  }
});

async function registrarDescarte(productoId, cantidad, nota) {
  const productoRef = doc(productosRef, productoId);

  await runTransaction(db, async (tx) => {
    const productoSnap = await tx.get(productoRef);
    if (!productoSnap.exists()) throw new Error("El producto ya no existe.");
    const stockActual = productoSnap.data().stockActual || 0;

    tx.update(productoRef, {
      stockActual: stockActual + cantidad,
      actualizadoEn: serverTimestamp()
    });

    tx.set(doc(movimientosDescarteRef), {
      productoId,
      cantidad,
      nota: nota || null,
      fecha: serverTimestamp(),
      creadoPor: auth.currentUser ? auth.currentUser.uid : null
    });
  });
}

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

function deshabilitarForm(form, disabled) {
  form.querySelectorAll("input, select, button").forEach((el) => (el.disabled = disabled));
}
