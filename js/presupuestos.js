import { db, auth } from "./firebase-config.js";
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

const presupuestosRef = collection(db, "presupuestos");
const ventasRef = collection(db, "ventas");
const productosRef = collection(db, "productos");
const modulosRef = collection(db, "modulos");
const materiasPrimasRef = collection(db, "materiasPrimas");

const TASA_IVA = 0.21;

// Caches propios de este archivo (independientes de ventas.js y del
// resto de módulos, mismo criterio de desacople que en toda la app).
let productosCache = [];
let modulosCache = [];
let materialesCache = [];
let presupuestosCache = [];

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
function normalizarItemComposicion(item) {
  if (item.tipo && item.refId) return item;
  return { tipo: "producto", refId: item.productoId, cantidad: item.cantidad };
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

// =====================================================================
// Caches base
// =====================================================================

onSnapshot(query(productosRef, orderBy("nombre")), (snapshot) => {
  productosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  refrescarSelectsLineasPresupuesto();
});
onSnapshot(query(modulosRef, orderBy("nombre")), (snapshot) => {
  modulosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  refrescarSelectsLineasPresupuesto();
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
function precioSugeridoDeItem(tipo, refId) {
  const coleccion = tipo === "producto" ? productosCache : modulosCache;
  const item = coleccion.find((x) => x.id === refId);
  return item && item.precioVenta ? item.precioVenta : "";
}
function opcionesItems() {
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
function refrescarSelectsLineasPresupuesto() {
  document.querySelectorAll(".linea-presupuesto-item").forEach((select) => {
    const valorPrevio = select.value;
    select.innerHTML = opcionesItems();
    select.value = valorPrevio;
  });
}

// =====================================================================
// Tabla de presupuestos
// =====================================================================

const tablaPresupuestosBody = document.getElementById("tabla-presupuestos-body");

function resumenItems(items) {
  return items.map((it) => `${it.nombreSnapshot} x${formatoNumero.format(it.cantidad)}`).join(", ");
}

function renderTablaPresupuestos() {
  if (presupuestosCache.length === 0) {
    tablaPresupuestosBody.innerHTML =
      '<tr><td colspan="6" class="fila-vacia">Todavía no hay presupuestos registrados.</td></tr>';
    return;
  }
  tablaPresupuestosBody.innerHTML = presupuestosCache
    .map((p) => {
      const fecha = p.fecha ? formatoFecha.format(p.fecha.toDate()) : "—";
      const resumen = resumenItems(p.items || []);
      const convertido = p.estado === "convertido";
      return `
      <tr>
        <td>${fecha}</td>
        <td>${escapeHtml(p.cliente)}</td>
        <td><span class="receta-resumen" title="${escapeHtml(resumen)}">${escapeHtml(resumen)}</span></td>
        <td class="col-numero">${formatoMoneda.format(p.montoTotal)}</td>
        <td>${convertido ? '<span class="estado-pendiente" style="color:var(--success)">Convertido</span>' : "Pendiente"}</td>
        <td class="col-acciones">
          ${
            convertido
              ? ""
              : `<button type="button" class="boton-accion-fila" data-convertir-presupuesto="${p.id}">Convertir a venta</button>
                 <button type="button" class="boton-accion-fila" data-editar-presupuesto="${p.id}">Editar</button>
                 <button type="button" class="boton-accion-fila peligro" data-eliminar-presupuesto="${p.id}">Eliminar</button>`
          }
        </td>
      </tr>`;
    })
    .join("");
}

onSnapshot(query(presupuestosRef, orderBy("fecha", "desc"), limit(10)), (snapshot) => {
  presupuestosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaPresupuestos();
});

// =====================================================================
// Modal: nuevo/editar presupuesto
// =====================================================================

const modalPresupuesto = document.getElementById("modal-presupuesto");
const tituloModalPresupuesto = document.getElementById("titulo-modal-presupuesto");
const errorPresupuesto = document.getElementById("error-presupuesto");
const inputPresupuestoCliente = document.getElementById("presupuesto-cliente");
const inputPresupuestoFecha = document.getElementById("presupuesto-fecha");
const inputPresupuestoPlazo = document.getElementById("presupuesto-plazo");
const inputPresupuestoCondicionesPago = document.getElementById("presupuesto-condiciones-pago");
const selectPresupuestoCondicionIva = document.getElementById("presupuesto-condicion-iva");
const inputPresupuestoCondicionEntrega = document.getElementById("presupuesto-condicion-entrega");
const inputPresupuestoNota = document.getElementById("presupuesto-nota");
const lineasPresupuestoContenedor = document.getElementById("presupuesto-lineas");
const btnAgregarLineaPresupuesto = document.getElementById("btn-agregar-linea-presupuesto");
const netoCalculadoEl = document.getElementById("presupuesto-neto-calculado");
const ivaCalculadoEl = document.getElementById("presupuesto-iva-calculado");
const totalCalculadoEl = document.getElementById("presupuesto-total-calculado");
const btnGuardarPresupuesto = document.getElementById("btn-guardar-presupuesto");

let editandoPresupuestoId = null;

function crearLineaPresupuesto(item = null) {
  const fila = document.createElement("div");
  fila.className = "linea-venta linea-presupuesto";
  fila.innerHTML = `
    <select class="linea-venta-item linea-presupuesto-item">${opcionesItems()}</select>
    <input type="number" class="linea-venta-cantidad" min="0.01" step="any" placeholder="Cantidad" value="${item ? item.cantidad : ""}" />
    <input type="number" class="linea-venta-precio" min="0" step="any" placeholder="Precio unitario" value="${item ? item.precioUnitario : ""}" />
    <span class="linea-venta-subtotal">$0</span>
    <button type="button" class="boton-quitar-fila" title="Quitar">×</button>
  `;
  const selectItem = fila.querySelector(".linea-presupuesto-item");
  const inputCantidad = fila.querySelector(".linea-venta-cantidad");
  const inputPrecio = fila.querySelector(".linea-venta-precio");
  const subtotalEl = fila.querySelector(".linea-venta-subtotal");

  if (item) selectItem.value = `${item.tipo}:${item.refId}`;

  function actualizarSubtotal() {
    const cantidad = parseFloat(inputCantidad.value) || 0;
    const precio = parseFloat(inputPrecio.value) || 0;
    subtotalEl.textContent = formatoMoneda.format(cantidad * precio);
    actualizarDesglosePresupuesto();
  }

  selectItem.addEventListener("change", () => {
    const [tipo, refId] = selectItem.value.split(":");
    const sugerido = precioSugeridoDeItem(tipo, refId);
    if (sugerido !== "") inputPrecio.value = sugerido;
    actualizarSubtotal();
  });
  inputCantidad.addEventListener("input", actualizarSubtotal);
  inputPrecio.addEventListener("input", actualizarSubtotal);
  fila.querySelector(".boton-quitar-fila").addEventListener("click", () => {
    fila.remove();
    actualizarDesglosePresupuesto();
  });

  if (item) actualizarSubtotal();
  return fila;
}

function actualizarDesglosePresupuesto() {
  const filas = Array.from(lineasPresupuestoContenedor.querySelectorAll(".linea-presupuesto"));
  let total = 0;
  filas.forEach((fila) => {
    const cantidad = parseFloat(fila.querySelector(".linea-venta-cantidad").value) || 0;
    const precio = parseFloat(fila.querySelector(".linea-venta-precio").value) || 0;
    total += cantidad * precio;
  });

  const ivaIncluido = selectPresupuestoCondicionIva.value === "incluido";
  let totalNeto = total;
  let ivaTotal = 0;
  if (ivaIncluido) {
    totalNeto = total / (1 + TASA_IVA);
    ivaTotal = total - totalNeto;
  }
  netoCalculadoEl.textContent = formatoMoneda.format(totalNeto);
  ivaCalculadoEl.textContent = formatoMoneda.format(ivaTotal);
  totalCalculadoEl.textContent = formatoMoneda.format(total);
}
selectPresupuestoCondicionIva.addEventListener("change", actualizarDesglosePresupuesto);

btnAgregarLineaPresupuesto.addEventListener("click", () => {
  lineasPresupuestoContenedor.appendChild(crearLineaPresupuesto());
});

document.getElementById("btn-abrir-presupuesto").addEventListener("click", () => {
  if (productosCache.length === 0 && modulosCache.length === 0) {
    alert("Primero tenés que cargar al menos un producto o un conjunto.");
    return;
  }
  editandoPresupuestoId = null;
  inputPresupuestoCliente.value = "";
  inputPresupuestoFecha.value = dateAFechaInput(new Date());
  inputPresupuestoPlazo.value = "";
  inputPresupuestoCondicionesPago.value = "";
  selectPresupuestoCondicionIva.value = "no_incluido";
  inputPresupuestoCondicionEntrega.value = "";
  inputPresupuestoNota.value = "";
  lineasPresupuestoContenedor.innerHTML = "";
  lineasPresupuestoContenedor.appendChild(crearLineaPresupuesto());
  errorPresupuesto.hidden = true;
  tituloModalPresupuesto.textContent = "Nuevo presupuesto";
  btnGuardarPresupuesto.textContent = "Registrar presupuesto";
  actualizarDesglosePresupuesto();
  abrirModal(modalPresupuesto);
});

function leerLineasPresupuesto() {
  const filas = Array.from(lineasPresupuestoContenedor.querySelectorAll(".linea-presupuesto"));
  if (filas.length === 0) {
    errorPresupuesto.textContent = "Agregá al menos un producto o conjunto.";
    errorPresupuesto.hidden = false;
    return null;
  }
  const items = [];
  for (const fila of filas) {
    const valorSelect = fila.querySelector(".linea-presupuesto-item").value;
    const cantidad = parseFloat(fila.querySelector(".linea-venta-cantidad").value);
    const precioUnitario = parseFloat(fila.querySelector(".linea-venta-precio").value);
    if (!valorSelect || !(cantidad > 0) || !(precioUnitario >= 0)) {
      errorPresupuesto.textContent = "Completá el producto/conjunto, la cantidad y el precio en cada línea (o quitá la línea).";
      errorPresupuesto.hidden = false;
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

tablaPresupuestosBody.addEventListener("click", (e) => {
  const idEditar = e.target.dataset.editarPresupuesto;
  const idEliminar = e.target.dataset.eliminarPresupuesto;
  const idConvertir = e.target.dataset.convertirPresupuesto;

  if (idEditar) {
    const presupuesto = presupuestosCache.find((p) => p.id === idEditar);
    if (!presupuesto) return;
    editandoPresupuestoId = idEditar;
    inputPresupuestoCliente.value = presupuesto.cliente;
    inputPresupuestoFecha.value = presupuesto.fecha ? dateAFechaInput(presupuesto.fecha.toDate()) : dateAFechaInput(new Date());
    inputPresupuestoPlazo.value = presupuesto.plazoValidezDias;
    inputPresupuestoCondicionesPago.value = presupuesto.condicionesPago;
    selectPresupuestoCondicionIva.value = presupuesto.condicionIva;
    inputPresupuestoCondicionEntrega.value = presupuesto.condicionEntrega;
    inputPresupuestoNota.value = presupuesto.notaAclaratoria || "";
    lineasPresupuestoContenedor.innerHTML = "";
    (presupuesto.items || []).forEach((it) => lineasPresupuestoContenedor.appendChild(crearLineaPresupuesto(it)));
    errorPresupuesto.hidden = true;
    tituloModalPresupuesto.textContent = "Editar presupuesto";
    btnGuardarPresupuesto.textContent = "Guardar cambios";
    actualizarDesglosePresupuesto();
    abrirModal(modalPresupuesto);
  }

  if (idEliminar) {
    const presupuesto = presupuestosCache.find((p) => p.id === idEliminar);
    if (!presupuesto) return;
    if (!confirm(`¿Eliminar el presupuesto de "${presupuesto.cliente}"? No afecta stock, solo el registro.`)) return;
    deleteDoc(doc(presupuestosRef, idEliminar)).catch((error) => {
      console.error(error);
      alert("No se pudo eliminar el presupuesto. Probá de nuevo.");
    });
  }

  if (idConvertir) {
    abrirModalConvertir(idConvertir);
  }
});

btnGuardarPresupuesto.addEventListener("click", async () => {
  errorPresupuesto.hidden = true;

  const cliente = inputPresupuestoCliente.value.trim();
  const fechaValor = inputPresupuestoFecha.value;
  const plazoValidezDias = parseInt(inputPresupuestoPlazo.value, 10);
  const condicionesPago = inputPresupuestoCondicionesPago.value.trim();
  const condicionIva = selectPresupuestoCondicionIva.value;
  const condicionEntrega = inputPresupuestoCondicionEntrega.value.trim();
  const notaAclaratoria = inputPresupuestoNota.value.trim();

  if (!cliente || !fechaValor || !(plazoValidezDias > 0) || !condicionesPago || !condicionEntrega) {
    errorPresupuesto.textContent = "Completá todos los campos obligatorios.";
    errorPresupuesto.hidden = false;
    return;
  }

  const items = leerLineasPresupuesto();
  if (!items) return;

  const fecha = fechaInputADate(fechaValor);
  const desglose = calcularDesglosePresupuesto(items, condicionIva);

  btnGuardarPresupuesto.disabled = true;
  try {
    const datos = {
      cliente,
      fecha,
      plazoValidezDias,
      condicionesPago,
      condicionIva,
      condicionEntrega,
      notaAclaratoria: notaAclaratoria || null,
      items,
      montoNeto: desglose.totalNeto,
      ivaTotal: desglose.ivaTotal,
      montoTotal: desglose.totalConIva
    };
    if (editandoPresupuestoId) {
      await updateDoc(doc(presupuestosRef, editandoPresupuestoId), { ...datos, actualizadoEn: serverTimestamp() });
    } else {
      await addDoc(presupuestosRef, {
        ...datos,
        estado: "pendiente",
        ventaGeneradaId: null,
        creadoPor: auth.currentUser ? auth.currentUser.uid : null,
        creadoEn: serverTimestamp()
      });
    }
    cerrarModal(modalPresupuesto);
  } catch (error) {
    console.error(error);
    errorPresupuesto.textContent = "No se pudo guardar el presupuesto. Probá de nuevo.";
    errorPresupuesto.hidden = false;
  } finally {
    btnGuardarPresupuesto.disabled = false;
  }
});

function calcularDesglosePresupuesto(items, condicionIva) {
  const total = items.reduce((acc, it) => acc + it.subtotal, 0);
  if (condicionIva !== "incluido") {
    return { totalNeto: round2(total), ivaTotal: 0, totalConIva: round2(total) };
  }
  const totalNeto = total / (1 + TASA_IVA);
  const ivaTotal = total - totalNeto;
  return { totalNeto: round2(totalNeto), ivaTotal: round2(ivaTotal), totalConIva: round2(total) };
}

// =====================================================================
// Modal: convertir a venta
// =====================================================================

const modalConvertir = document.getElementById("modal-convertir-presupuesto");
const formConvertir = document.getElementById("form-convertir-presupuesto");
const errorConvertir = document.getElementById("error-convertir");
const inputConvertirFecha = document.getElementById("convertir-fecha");
const inputConvertirMedioPago = document.getElementById("convertir-medio-pago");

let presupuestoAConvertir = null;

function abrirModalConvertir(presupuestoId) {
  const presupuesto = presupuestosCache.find((p) => p.id === presupuestoId);
  if (!presupuesto) return;
  presupuestoAConvertir = presupuesto;
  formConvertir.reset();
  inputConvertirFecha.value = dateAFechaInput(new Date());
  errorConvertir.hidden = true;
  abrirModal(modalConvertir);
}

formConvertir.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorConvertir.hidden = true;

  const fechaValor = inputConvertirFecha.value;
  const medioPago = inputConvertirMedioPago.value.trim();
  if (!fechaValor || !medioPago) return;

  const fecha = fechaInputADate(fechaValor);
  const facturaA = presupuestoAConvertir.condicionIva === "incluido";

  deshabilitarForm(formConvertir, true);
  try {
    await convertirPresupuestoEnVenta(presupuestoAConvertir, { fecha, medioPago, facturaA });
    cerrarModal(modalConvertir);
  } catch (error) {
    console.error(error);
    errorConvertir.textContent = "No se pudo convertir el presupuesto. Probá de nuevo.";
    errorConvertir.hidden = false;
  } finally {
    deshabilitarForm(formConvertir, false);
  }
});

// Copia cliente + ítems + precios tal cual (sin recargar nada) a una
// venta nueva, descuenta el stock correspondiente (expandiendo
// conjuntos a sus componentes, igual que una venta directa — nunca
// bloquea por falta de stock), y marca el presupuesto como convertido.
async function convertirPresupuestoEnVenta(presupuesto, { fecha, medioPago, facturaA }) {
  const items = presupuesto.items;
  const total = items.reduce((acc, it) => acc + it.subtotal, 0);
  const totalNeto = facturaA ? total / (1 + TASA_IVA) : total;
  const ivaTotal = total - totalNeto;

  const presupuestoRef = doc(presupuestosRef, presupuesto.id);
  const nuevaVentaRef = doc(ventasRef);

  await runTransaction(db, async (tx) => {
    const composicionesCache = {};
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

    tx.set(nuevaVentaRef, {
      cliente: presupuesto.cliente,
      fecha,
      items,
      medioPago,
      facturaA,
      montoNeto: round2(totalNeto),
      ivaTotal: round2(ivaTotal),
      montoTotal: round2(total),
      origenPresupuestoId: presupuesto.id,
      creadoPor: auth.currentUser ? auth.currentUser.uid : null
    });

    tx.update(presupuestoRef, {
      estado: "convertido",
      ventaGeneradaId: nuevaVentaRef.id
    });
  });
}

// =====================================================================
// Helpers
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
