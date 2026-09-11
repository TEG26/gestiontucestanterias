import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  runTransaction,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const materiasPrimasRef = collection(db, "materiasPrimas");
const movimientosCompraRef = collection(db, "movimientosCompra");
const proveedoresRef = collection(db, "proveedores");

const TASA_IVA = 0.21; // IVA general Argentina.

// Caches locales: evitan reconsultar Firestore para armar los <select> y
// para mostrar nombres (elemento/proveedor) en la tabla de compras.
let materialesCache = [];
let proveedoresCache = [];
let comprasCache = [];

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

// =====================================================================
// Elementos
// =====================================================================

const tablaMaterialesBody = document.getElementById("tabla-materiales-body");
const selectCompraMateria = document.getElementById("compra-materia");

function renderTablaMateriales(materiales) {
  if (materiales.length === 0) {
    tablaMaterialesBody.innerHTML =
      '<tr><td colspan="4" class="fila-vacia">Todavía no cargaste ningún elemento.</td></tr>';
    return;
  }
  tablaMaterialesBody.innerHTML = materiales
    .map(
      (m) => `
      <tr>
        <td>${escapeHtml(m.nombre)}</td>
        <td>${escapeHtml(m.unidad)}</td>
        <td class="col-numero">${formatoNumero.format(m.stockActual || 0)}</td>
        <td class="col-acciones">
          <button type="button" class="boton-accion-fila" data-editar-elemento="${m.id}">Editar</button>
          <button type="button" class="boton-accion-fila peligro" data-eliminar-elemento="${m.id}">Eliminar</button>
        </td>
      </tr>`
    )
    .join("");
}

function renderSelectCompraMateria(materiales) {
  const valorPrevio = selectCompraMateria.value;
  selectCompraMateria.innerHTML =
    '<option value="" disabled selected>Elegir elemento...</option>' +
    materiales
      .map((m) => `<option value="${m.id}">${escapeHtml(m.nombre)} (${escapeHtml(m.unidad)})</option>`)
      .join("");
  if (materiales.some((m) => m.id === valorPrevio)) {
    selectCompraMateria.value = valorPrevio;
  }
}

onSnapshot(query(materiasPrimasRef, orderBy("nombre")), (snapshot) => {
  materialesCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaMateriales(materialesCache);
  renderSelectCompraMateria(materialesCache);
  renderTablaCompras();
});

function nombreMaterial(materiaId) {
  const material = materialesCache.find((m) => m.id === materiaId);
  return material ? material.nombre : "(elemento eliminado)";
}

// ---------- Modal: nuevo/editar elemento ----------

const modalNuevaMateria = document.getElementById("modal-nueva-materia");
const formNuevaMateria = document.getElementById("form-nueva-materia");
const errorNuevaMateria = document.getElementById("error-nueva-materia");
const inputNuevaMateriaNombre = document.getElementById("nueva-materia-nombre");
const inputNuevaMateriaUnidad = document.getElementById("nueva-materia-unidad");
const tituloModalMateria = document.getElementById("titulo-modal-materia");
const btnGuardarMateria = document.getElementById("btn-guardar-materia");

let editandoMateriaId = null;

document.getElementById("btn-abrir-nueva-materia").addEventListener("click", () => {
  editandoMateriaId = null;
  formNuevaMateria.reset();
  errorNuevaMateria.hidden = true;
  tituloModalMateria.textContent = "Nuevo elemento";
  btnGuardarMateria.textContent = "Crear";
  abrirModal(modalNuevaMateria);
});

tablaMaterialesBody.addEventListener("click", (e) => {
  const idEditar = e.target.dataset.editarElemento;
  const idEliminar = e.target.dataset.eliminarElemento;

  if (idEditar) {
    const material = materialesCache.find((m) => m.id === idEditar);
    if (!material) return;
    editandoMateriaId = idEditar;
    inputNuevaMateriaNombre.value = material.nombre;
    inputNuevaMateriaUnidad.value = material.unidad;
    errorNuevaMateria.hidden = true;
    tituloModalMateria.textContent = "Editar elemento";
    btnGuardarMateria.textContent = "Guardar cambios";
    abrirModal(modalNuevaMateria);
  }

  if (idEliminar) {
    const material = materialesCache.find((m) => m.id === idEliminar);
    if (!material) return;
    if ((material.stockActual || 0) !== 0) {
      alert(
        `No se puede eliminar "${material.nombre}" porque todavía tiene stock (${formatoNumero.format(
          material.stockActual
        )} ${material.unidad}). Para eliminarlo, primero el stock tiene que quedar en 0.`
      );
      return;
    }
    if (!confirm(`¿Eliminar el elemento "${material.nombre}"? Esta acción no se puede deshacer.`)) return;
    deleteDoc(doc(materiasPrimasRef, idEliminar)).catch((error) => {
      console.error(error);
      alert("No se pudo eliminar el elemento. Probá de nuevo.");
    });
  }
});

formNuevaMateria.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorNuevaMateria.hidden = true;
  const nombre = inputNuevaMateriaNombre.value.trim();
  const unidad = inputNuevaMateriaUnidad.value.trim();

  if (!nombre || !unidad) return;

  deshabilitarForm(formNuevaMateria, true);
  try {
    if (editandoMateriaId) {
      await updateDoc(doc(materiasPrimasRef, editandoMateriaId), {
        nombre,
        unidad,
        actualizadoEn: serverTimestamp()
      });
    } else {
      await addDoc(materiasPrimasRef, {
        nombre,
        unidad,
        stockActual: 0,
        activo: true,
        creadoEn: serverTimestamp(),
        actualizadoEn: serverTimestamp()
      });
    }
    cerrarModal(modalNuevaMateria);
  } catch (error) {
    console.error(error);
    errorNuevaMateria.textContent = "No se pudo guardar el elemento. Probá de nuevo.";
    errorNuevaMateria.hidden = false;
  } finally {
    deshabilitarForm(formNuevaMateria, false);
  }
});

// =====================================================================
// Proveedores
// =====================================================================

const selectCompraProveedor = document.getElementById("compra-proveedor");
const listaProveedores = document.getElementById("lista-proveedores");
const modalProveedores = document.getElementById("modal-nuevo-proveedor");
const formNuevoProveedor = document.getElementById("form-nuevo-proveedor");
const errorNuevoProveedor = document.getElementById("error-nuevo-proveedor");
const inputNuevoProveedorNombre = document.getElementById("nuevo-proveedor-nombre");
const etiquetaFormProveedor = document.getElementById("form-proveedor-etiqueta");
const btnGuardarProveedor = document.getElementById("btn-guardar-proveedor");
const btnCancelarEdicionProveedor = document.getElementById("btn-cancelar-edicion-proveedor");

let editandoProveedorId = null;

function renderSelectCompraProveedor(proveedores) {
  const valorPrevio = selectCompraProveedor.value;
  selectCompraProveedor.innerHTML =
    '<option value="" disabled selected>Elegir proveedor...</option>' +
    proveedores.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("");
  if (proveedores.some((p) => p.id === valorPrevio)) {
    selectCompraProveedor.value = valorPrevio;
  }
}

function renderListaProveedores(proveedores) {
  if (proveedores.length === 0) {
    listaProveedores.innerHTML = '<li class="fila-vacia">Todavía no hay proveedores cargados.</li>';
    return;
  }
  listaProveedores.innerHTML = proveedores
    .map(
      (p) => `
      <li>
        <span>${escapeHtml(p.nombre)}</span>
        <span class="acciones-fila">
          <button type="button" class="boton-accion-fila" data-editar-proveedor="${p.id}">Editar</button>
          <button type="button" class="boton-accion-fila peligro" data-eliminar-proveedor="${p.id}">Eliminar</button>
        </span>
      </li>`
    )
    .join("");
}

onSnapshot(query(proveedoresRef, orderBy("nombre")), (snapshot) => {
  proveedoresCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderSelectCompraProveedor(proveedoresCache);
  renderListaProveedores(proveedoresCache);
  renderTablaCompras();
});

function nombreProveedor(proveedorId) {
  const proveedor = proveedoresCache.find((p) => p.id === proveedorId);
  return proveedor ? proveedor.nombre : "(proveedor eliminado)";
}

function resetearFormProveedor() {
  editandoProveedorId = null;
  formNuevoProveedor.reset();
  errorNuevoProveedor.hidden = true;
  etiquetaFormProveedor.textContent = "Nuevo proveedor";
  btnGuardarProveedor.textContent = "Crear";
  btnCancelarEdicionProveedor.hidden = true;
}

document.getElementById("btn-abrir-nuevo-proveedor").addEventListener("click", () => {
  resetearFormProveedor();
  abrirModal(modalProveedores);
});

btnCancelarEdicionProveedor.addEventListener("click", resetearFormProveedor);

listaProveedores.addEventListener("click", (e) => {
  const idEditar = e.target.dataset.editarProveedor;
  const idEliminar = e.target.dataset.eliminarProveedor;

  if (idEditar) {
    const proveedor = proveedoresCache.find((p) => p.id === idEditar);
    if (!proveedor) return;
    editandoProveedorId = idEditar;
    inputNuevoProveedorNombre.value = proveedor.nombre;
    errorNuevoProveedor.hidden = true;
    etiquetaFormProveedor.textContent = "Editar proveedor";
    btnGuardarProveedor.textContent = "Guardar cambios";
    btnCancelarEdicionProveedor.hidden = false;
    inputNuevoProveedorNombre.focus();
  }

  if (idEliminar) {
    const proveedor = proveedoresCache.find((p) => p.id === idEliminar);
    if (!proveedor) return;
    if (!confirm(`¿Eliminar el proveedor "${proveedor.nombre}"? Las compras ya registradas no se modifican.`))
      return;
    deleteDoc(doc(proveedoresRef, idEliminar)).catch((error) => {
      console.error(error);
      alert("No se pudo eliminar el proveedor. Probá de nuevo.");
    });
    if (editandoProveedorId === idEliminar) resetearFormProveedor();
  }
});

formNuevoProveedor.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorNuevoProveedor.hidden = true;
  const nombre = inputNuevoProveedorNombre.value.trim();
  if (!nombre) return;

  deshabilitarForm(formNuevoProveedor, true);
  try {
    if (editandoProveedorId) {
      await updateDoc(doc(proveedoresRef, editandoProveedorId), { nombre });
    } else {
      await addDoc(proveedoresRef, { nombre, activo: true, creadoEn: serverTimestamp() });
    }
    resetearFormProveedor();
  } catch (error) {
    console.error(error);
    errorNuevoProveedor.textContent = "No se pudo guardar el proveedor. Probá de nuevo.";
    errorNuevoProveedor.hidden = false;
  } finally {
    deshabilitarForm(formNuevoProveedor, false);
  }
});

// =====================================================================
// Compras
// =====================================================================

const tablaComprasBody = document.getElementById("tabla-compras-body");
const modalCompra = document.getElementById("modal-compra");
const formCompra = document.getElementById("form-compra");
const errorCompra = document.getElementById("error-compra");
const inputCantidad = document.getElementById("compra-cantidad");
const inputPrecioUnitario = document.getElementById("compra-precio-unitario");
const selectTipoFactura = document.getElementById("compra-tipo-factura");
const netoCalculadoEl = document.getElementById("compra-neto-calculado");
const ivaCalculadoEl = document.getElementById("compra-iva-calculado");
const totalCalculadoEl = document.getElementById("compra-total-calculado");
const tituloModalCompra = document.getElementById("titulo-modal-compra");
const btnGuardarCompra = document.getElementById("btn-guardar-compra");

let editandoCompra = null; // { id, materiaId, cantidad } de la compra original, o null si es alta

function renderTablaCompras() {
  if (comprasCache.length === 0) {
    tablaComprasBody.innerHTML =
      '<tr><td colspan="7" class="fila-vacia">Todavía no hay compras registradas.</td></tr>';
    return;
  }
  tablaComprasBody.innerHTML = comprasCache
    .map((c) => {
      const fecha = c.fecha ? formatoFecha.format(c.fecha.toDate()) : "—";
      return `
      <tr>
        <td>${fecha}</td>
        <td>${escapeHtml(nombreMaterial(c.materiaId))}</td>
        <td>${escapeHtml(nombreProveedor(c.proveedorId))}</td>
        <td class="col-numero">${formatoNumero.format(c.cantidad)}</td>
        <td class="col-numero">${formatoMoneda.format(c.precioTotalConIva)}</td>
        <td class="col-numero">${formatoMoneda.format(c.ivaTotal)}</td>
        <td class="col-acciones">
          <button type="button" class="boton-accion-fila" data-editar-compra="${c.id}">Editar</button>
          <button type="button" class="boton-accion-fila peligro" data-eliminar-compra="${c.id}">Eliminar</button>
        </td>
      </tr>`;
    })
    .join("");
}

onSnapshot(query(movimientosCompraRef, orderBy("fecha", "desc"), limit(10)), (snapshot) => {
  comprasCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaCompras();
});

function resetearFormCompra() {
  editandoCompra = null;
  formCompra.reset();
  errorCompra.hidden = true;
  tituloModalCompra.textContent = "Registrar compra";
  btnGuardarCompra.textContent = "Registrar compra";
  actualizarDesgloseCalculado();
}

document.getElementById("btn-abrir-compra").addEventListener("click", () => {
  if (materialesCache.length === 0) {
    alert("Primero tenés que cargar al menos un elemento.");
    return;
  }
  if (proveedoresCache.length === 0) {
    alert("Primero tenés que cargar al menos un proveedor.");
    return;
  }
  resetearFormCompra();
  abrirModal(modalCompra);
});

tablaComprasBody.addEventListener("click", (e) => {
  const idEditar = e.target.dataset.editarCompra;
  const idEliminar = e.target.dataset.eliminarCompra;

  if (idEditar) {
    const compra = comprasCache.find((c) => c.id === idEditar);
    if (!compra) return;
    editandoCompra = { id: compra.id, materiaId: compra.materiaId, cantidad: compra.cantidad };
    selectCompraMateria.value = compra.materiaId;
    selectCompraProveedor.value = compra.proveedorId;
    inputCantidad.value = compra.cantidad;
    inputPrecioUnitario.value = compra.precioUnitario;
    selectTipoFactura.value = compra.tipoFactura || "con_iva_no_incluido";
    errorCompra.hidden = true;
    tituloModalCompra.textContent = "Editar compra";
    btnGuardarCompra.textContent = "Guardar cambios";
    actualizarDesgloseCalculado();
    abrirModal(modalCompra);
  }

  if (idEliminar) {
    const compra = comprasCache.find((c) => c.id === idEliminar);
    if (!compra) return;
    if (!confirm(`¿Eliminar esta compra de "${nombreMaterial(compra.materiaId)}"? Se descuenta del stock.`))
      return;
    eliminarCompra(compra).catch((error) => {
      if (error.code === "STOCK_NEGATIVO") {
        alert(
          `No se puede eliminar: el stock de "${nombreMaterial(
            compra.materiaId
          )}" ya se usó (quedaría en negativo). Revisá las producciones o compras posteriores primero.`
        );
      } else {
        console.error(error);
        alert("No se pudo eliminar la compra. Probá de nuevo.");
      }
    });
  }
});

function calcularDesglose(cantidad, precioUnitario, tipoFactura) {
  const totalIngresado = cantidad * precioUnitario;

  if (tipoFactura === "sin_factura") {
    return { totalNeto: totalIngresado, ivaTotal: 0, totalConIva: totalIngresado };
  }
  if (tipoFactura === "con_iva_incluido") {
    const totalNeto = totalIngresado / (1 + TASA_IVA);
    const ivaTotal = totalIngresado - totalNeto;
    return { totalNeto, ivaTotal, totalConIva: totalIngresado };
  }
  // con_iva_no_incluido
  const ivaTotal = totalIngresado * TASA_IVA;
  return { totalNeto: totalIngresado, ivaTotal, totalConIva: totalIngresado + ivaTotal };
}

function actualizarDesgloseCalculado() {
  const cantidad = parseFloat(inputCantidad.value) || 0;
  const precioUnitario = parseFloat(inputPrecioUnitario.value) || 0;
  const { totalNeto, ivaTotal, totalConIva } = calcularDesglose(cantidad, precioUnitario, selectTipoFactura.value);
  netoCalculadoEl.textContent = formatoMoneda.format(totalNeto);
  ivaCalculadoEl.textContent = formatoMoneda.format(ivaTotal);
  totalCalculadoEl.textContent = formatoMoneda.format(totalConIva);
}
inputCantidad.addEventListener("input", actualizarDesgloseCalculado);
inputPrecioUnitario.addEventListener("input", actualizarDesgloseCalculado);
selectTipoFactura.addEventListener("change", actualizarDesgloseCalculado);

formCompra.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorCompra.hidden = true;

  const materiaId = selectCompraMateria.value;
  const proveedorId = selectCompraProveedor.value;
  const cantidad = parseFloat(inputCantidad.value);
  const precioUnitario = parseFloat(inputPrecioUnitario.value);
  const tipoFactura = selectTipoFactura.value;

  if (!materiaId || !proveedorId || !(cantidad > 0) || !(precioUnitario >= 0)) return;

  deshabilitarForm(formCompra, true);
  try {
    if (editandoCompra) {
      await actualizarCompra(editandoCompra, { materiaId, proveedorId, cantidad, precioUnitario, tipoFactura });
    } else {
      await registrarCompra({ materiaId, proveedorId, cantidad, precioUnitario, tipoFactura });
    }
    cerrarModal(modalCompra);
  } catch (error) {
    if (error.code === "STOCK_NEGATIVO") {
      errorCompra.textContent =
        "Ese cambio dejaría el stock del elemento en negativo (ya se usó en otra producción o movimiento). Ajustá primero eso.";
    } else {
      console.error(error);
      errorCompra.textContent = "No se pudo guardar la compra. Probá de nuevo.";
    }
    errorCompra.hidden = false;
  } finally {
    deshabilitarForm(formCompra, false);
  }
});

async function registrarCompra({ materiaId, proveedorId, cantidad, precioUnitario, tipoFactura }) {
  const materiaRef = doc(materiasPrimasRef, materiaId);
  const { totalNeto, ivaTotal, totalConIva } = calcularDesglose(cantidad, precioUnitario, tipoFactura);

  await runTransaction(db, async (tx) => {
    const materiaSnap = await tx.get(materiaRef);
    if (!materiaSnap.exists()) {
      throw new Error("El elemento ya no existe.");
    }
    const stockActual = materiaSnap.data().stockActual || 0;

    tx.update(materiaRef, {
      stockActual: stockActual + cantidad,
      actualizadoEn: serverTimestamp()
    });

    tx.set(doc(movimientosCompraRef), {
      materiaId,
      proveedorId,
      cantidad,
      precioUnitario,
      tipoFactura,
      tieneFactura: tipoFactura !== "sin_factura",
      precioTotalNeto: round2(totalNeto),
      ivaTotal: round2(ivaTotal),
      precioTotalConIva: round2(totalConIva),
      fecha: serverTimestamp()
    });
  });
}

async function actualizarCompra(original, { materiaId, proveedorId, cantidad, precioUnitario, tipoFactura }) {
  const compraRef = doc(movimientosCompraRef, original.id);
  const { totalNeto, ivaTotal, totalConIva } = calcularDesglose(cantidad, precioUnitario, tipoFactura);
  const mismoElemento = original.materiaId === materiaId;

  await runTransaction(db, async (tx) => {
    const materiaRefOriginal = doc(materiasPrimasRef, original.materiaId);
    const snapOriginal = await tx.get(materiaRefOriginal);
    if (!snapOriginal.exists()) {
      throw new Error("El elemento original de esta compra ya no existe.");
    }

    if (mismoElemento) {
      const stockActual = snapOriginal.data().stockActual || 0;
      const nuevoStock = stockActual - original.cantidad + cantidad;
      if (nuevoStock < 0) {
        const err = new Error("Stock negativo");
        err.code = "STOCK_NEGATIVO";
        throw err;
      }
      tx.update(materiaRefOriginal, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    } else {
      const materiaRefNueva = doc(materiasPrimasRef, materiaId);
      const snapNueva = await tx.get(materiaRefNueva);
      if (!snapNueva.exists()) {
        throw new Error("El elemento nuevo ya no existe.");
      }
      const stockOriginal = snapOriginal.data().stockActual || 0;
      const nuevoStockOriginal = stockOriginal - original.cantidad;
      if (nuevoStockOriginal < 0) {
        const err = new Error("Stock negativo");
        err.code = "STOCK_NEGATIVO";
        throw err;
      }
      const stockNueva = snapNueva.data().stockActual || 0;
      tx.update(materiaRefOriginal, { stockActual: nuevoStockOriginal, actualizadoEn: serverTimestamp() });
      tx.update(materiaRefNueva, { stockActual: stockNueva + cantidad, actualizadoEn: serverTimestamp() });
    }

    tx.update(compraRef, {
      materiaId,
      proveedorId,
      cantidad,
      precioUnitario,
      tipoFactura,
      tieneFactura: tipoFactura !== "sin_factura",
      precioTotalNeto: round2(totalNeto),
      ivaTotal: round2(ivaTotal),
      precioTotalConIva: round2(totalConIva),
      actualizadoEn: serverTimestamp()
    });
  });
}

async function eliminarCompra(compra) {
  const compraRef = doc(movimientosCompraRef, compra.id);
  const materiaRef = doc(materiasPrimasRef, compra.materiaId);

  await runTransaction(db, async (tx) => {
    const materiaSnap = await tx.get(materiaRef);
    if (materiaSnap.exists()) {
      const stockActual = materiaSnap.data().stockActual || 0;
      const nuevoStock = stockActual - compra.cantidad;
      if (nuevoStock < 0) {
        const err = new Error("Stock negativo");
        err.code = "STOCK_NEGATIVO";
        throw err;
      }
      tx.update(materiaRef, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    }
    tx.delete(compraRef);
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
