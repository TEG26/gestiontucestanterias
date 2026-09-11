import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
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

const TASA_IVA = 0.21; // IVA general Argentina. Avisar si el rubro usa otra tasa.

// Cache local de materiales y proveedores, para no reconsultar al armar
// los <select> del modal de compra ni al mostrar nombres en las tablas.
let materialesCache = [];
let proveedoresCache = [];

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

// ---------- Tabla de materiales ----------

const tablaMaterialesBody = document.getElementById("tabla-materiales-body");
const selectCompraMateria = document.getElementById("compra-materia");

function renderTablaMateriales(materiales) {
  if (materiales.length === 0) {
    tablaMaterialesBody.innerHTML =
      '<tr><td colspan="3" class="fila-vacia">Todavía no cargaste ninguna materia prima.</td></tr>';
    return;
  }
  tablaMaterialesBody.innerHTML = materiales
    .map(
      (m) => `
      <tr>
        <td>${escapeHtml(m.nombre)}</td>
        <td>${escapeHtml(m.unidad)}</td>
        <td class="col-numero">${formatoNumero.format(m.stockActual || 0)}</td>
      </tr>`
    )
    .join("");
}

function renderSelectCompraMateria(materiales) {
  const valorPrevio = selectCompraMateria.value;
  selectCompraMateria.innerHTML =
    '<option value="" disabled selected>Elegir material...</option>' +
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

// ---------- Proveedores ----------

const selectCompraProveedor = document.getElementById("compra-proveedor");

function renderSelectCompraProveedor(proveedores) {
  const valorPrevio = selectCompraProveedor.value;
  selectCompraProveedor.innerHTML =
    '<option value="" disabled selected>Elegir proveedor...</option>' +
    proveedores.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("");
  if (proveedores.some((p) => p.id === valorPrevio)) {
    selectCompraProveedor.value = valorPrevio;
  }
}

onSnapshot(query(proveedoresRef, orderBy("nombre")), (snapshot) => {
  proveedoresCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderSelectCompraProveedor(proveedoresCache);
  renderTablaCompras();
});

function nombreProveedor(proveedorId) {
  const proveedor = proveedoresCache.find((p) => p.id === proveedorId);
  return proveedor ? proveedor.nombre : "(proveedor eliminado)";
}

const modalNuevoProveedor = document.getElementById("modal-nuevo-proveedor");
const formNuevoProveedor = document.getElementById("form-nuevo-proveedor");
const errorNuevoProveedor = document.getElementById("error-nuevo-proveedor");

document.getElementById("btn-abrir-nuevo-proveedor").addEventListener("click", () => {
  formNuevoProveedor.reset();
  errorNuevoProveedor.hidden = true;
  abrirModal(modalNuevoProveedor);
});

formNuevoProveedor.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorNuevoProveedor.hidden = true;
  const nombre = document.getElementById("nuevo-proveedor-nombre").value.trim();
  if (!nombre) return;

  deshabilitarForm(formNuevoProveedor, true);
  try {
    await addDoc(proveedoresRef, {
      nombre,
      activo: true,
      creadoEn: serverTimestamp()
    });
    cerrarModal(modalNuevoProveedor);
  } catch (error) {
    console.error(error);
    errorNuevoProveedor.textContent = "No se pudo crear el proveedor. Probá de nuevo.";
    errorNuevoProveedor.hidden = false;
  } finally {
    deshabilitarForm(formNuevoProveedor, false);
  }
});

// ---------- Tabla de compras recientes ----------

const tablaComprasBody = document.getElementById("tabla-compras-body");

function nombreMaterial(materiaId) {
  const material = materialesCache.find((m) => m.id === materiaId);
  return material ? material.nombre : "(material eliminado)";
}

let comprasCache = [];

function renderTablaCompras() {
  if (comprasCache.length === 0) {
    tablaComprasBody.innerHTML =
      '<tr><td colspan="6" class="fila-vacia">Todavía no hay compras registradas.</td></tr>';
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
      </tr>`;
    })
    .join("");
}

onSnapshot(query(movimientosCompraRef, orderBy("fecha", "desc"), limit(10)), (snapshot) => {
  comprasCache = snapshot.docs.map((d) => d.data());
  renderTablaCompras();
});

// ---------- Modal: nueva materia prima ----------

const modalNuevaMateria = document.getElementById("modal-nueva-materia");
const formNuevaMateria = document.getElementById("form-nueva-materia");
const errorNuevaMateria = document.getElementById("error-nueva-materia");

document.getElementById("btn-abrir-nueva-materia").addEventListener("click", () => {
  formNuevaMateria.reset();
  errorNuevaMateria.hidden = true;
  abrirModal(modalNuevaMateria);
});

formNuevaMateria.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorNuevaMateria.hidden = true;
  const nombre = document.getElementById("nueva-materia-nombre").value.trim();
  const unidad = document.getElementById("nueva-materia-unidad").value.trim();

  if (!nombre || !unidad) return;

  deshabilitarForm(formNuevaMateria, true);
  try {
    await addDoc(materiasPrimasRef, {
      nombre,
      unidad,
      stockActual: 0,
      activo: true,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    });
    cerrarModal(modalNuevaMateria);
  } catch (error) {
    console.error(error);
    errorNuevaMateria.textContent = "No se pudo crear el material. Probá de nuevo.";
    errorNuevaMateria.hidden = false;
  } finally {
    deshabilitarForm(formNuevaMateria, false);
  }
});

// ---------- Modal: registrar compra ----------

const modalCompra = document.getElementById("modal-compra");
const formCompra = document.getElementById("form-compra");
const errorCompra = document.getElementById("error-compra");
const inputCantidad = document.getElementById("compra-cantidad");
const inputPrecioUnitario = document.getElementById("compra-precio-unitario");
const checkboxIvaIncluido = document.getElementById("compra-iva-incluido");
const netoCalculadoEl = document.getElementById("compra-neto-calculado");
const ivaCalculadoEl = document.getElementById("compra-iva-calculado");
const totalCalculadoEl = document.getElementById("compra-total-calculado");

document.getElementById("btn-abrir-compra").addEventListener("click", () => {
  if (materialesCache.length === 0) {
    alert("Primero tenés que cargar al menos un elemento.");
    return;
  }
  if (proveedoresCache.length === 0) {
    alert("Primero tenés que cargar al menos un proveedor.");
    return;
  }
  formCompra.reset();
  errorCompra.hidden = true;
  actualizarDesgloseCalculado();
  abrirModal(modalCompra);
});

// A partir del precio unitario ingresado + el checkbox de IVA, calcula
// neto / IVA / total de la compra. Si el precio ya incluye IVA, se
// "desarma" dividiendo por 1 + tasa; si no lo incluye, se le suma.
function calcularDesglose(cantidad, precioUnitario, ivaIncluido) {
  const totalIngresado = cantidad * precioUnitario;
  const totalNeto = ivaIncluido ? totalIngresado / (1 + TASA_IVA) : totalIngresado;
  const ivaTotal = ivaIncluido ? totalIngresado - totalNeto : totalIngresado * TASA_IVA;
  const totalConIva = totalNeto + ivaTotal;
  return { totalNeto, ivaTotal, totalConIva };
}

function actualizarDesgloseCalculado() {
  const cantidad = parseFloat(inputCantidad.value) || 0;
  const precioUnitario = parseFloat(inputPrecioUnitario.value) || 0;
  const { totalNeto, ivaTotal, totalConIva } = calcularDesglose(
    cantidad,
    precioUnitario,
    checkboxIvaIncluido.checked
  );
  netoCalculadoEl.textContent = formatoMoneda.format(totalNeto);
  ivaCalculadoEl.textContent = formatoMoneda.format(ivaTotal);
  totalCalculadoEl.textContent = formatoMoneda.format(totalConIva);
}
inputCantidad.addEventListener("input", actualizarDesgloseCalculado);
inputPrecioUnitario.addEventListener("input", actualizarDesgloseCalculado);
checkboxIvaIncluido.addEventListener("change", actualizarDesgloseCalculado);

formCompra.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorCompra.hidden = true;

  const materiaId = selectCompraMateria.value;
  const proveedorId = selectCompraProveedor.value;
  const cantidad = parseFloat(inputCantidad.value);
  const precioUnitario = parseFloat(inputPrecioUnitario.value);
  const ivaIncluido = checkboxIvaIncluido.checked;

  if (!materiaId || !proveedorId || !(cantidad > 0) || !(precioUnitario >= 0)) return;

  deshabilitarForm(formCompra, true);
  try {
    await registrarCompra({ materiaId, proveedorId, cantidad, precioUnitario, ivaIncluido });
    cerrarModal(modalCompra);
  } catch (error) {
    console.error(error);
    errorCompra.textContent = "No se pudo registrar la compra. Probá de nuevo.";
    errorCompra.hidden = false;
  } finally {
    deshabilitarForm(formCompra, false);
  }
});

async function registrarCompra({ materiaId, proveedorId, cantidad, precioUnitario, ivaIncluido }) {
  const materiaRef = doc(db, "materiasPrimas", materiaId);
  const { totalNeto, ivaTotal, totalConIva } = calcularDesglose(cantidad, precioUnitario, ivaIncluido);

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
      ivaIncluido,
      precioTotalNeto: Math.round(totalNeto * 100) / 100,
      ivaTotal: Math.round(ivaTotal * 100) / 100,
      precioTotalConIva: Math.round(totalConIva * 100) / 100,
      fecha: serverTimestamp()
    });
  });
}

// ---------- Helpers de modal ----------

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
