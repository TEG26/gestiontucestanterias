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

function opcionesElementos() {
  return (
    '<option value="" disabled selected>Elegir elemento...</option>' +
    materialesCache
      .map((m) => `<option value="${m.id}">${escapeHtml(m.nombre)} (${escapeHtml(m.unidad)})</option>`)
      .join("")
  );
}

// Refresca las opciones de los <select> de elemento en las líneas de
// compra ya abiertas, sin perder lo que ya estaba elegido en cada una.
function refrescarSelectsLineasCompra() {
  document.querySelectorAll(".linea-elemento").forEach((select) => {
    const valorPrevio = select.value;
    select.innerHTML = opcionesElementos();
    if (materialesCache.some((m) => m.id === valorPrevio)) select.value = valorPrevio;
  });
}

onSnapshot(query(materiasPrimasRef, orderBy("nombre")), (snapshot) => {
  materialesCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaMateriales(materialesCache);
  refrescarSelectsLineasCompra();
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
// Compras (una compra puede traer varios elementos)
// =====================================================================

const tablaComprasBody = document.getElementById("tabla-compras-body");
const modalCompra = document.getElementById("modal-compra");
const errorCompra = document.getElementById("error-compra");
const inputCompraFecha = document.getElementById("compra-fecha");
const selectTipoFactura = document.getElementById("compra-tipo-factura");
const lineasCompraContenedor = document.getElementById("compra-lineas");
const btnAgregarLineaCompra = document.getElementById("btn-agregar-linea-compra");
const netoCalculadoEl = document.getElementById("compra-neto-calculado");
const ivaCalculadoEl = document.getElementById("compra-iva-calculado");
const totalCalculadoEl = document.getElementById("compra-total-calculado");
const tituloModalCompra = document.getElementById("titulo-modal-compra");
const btnGuardarCompra = document.getElementById("btn-guardar-compra");

let editandoCompraId = null; // id de la compra original, o null si es alta
let itemsOriginalesEdicion = []; // items de la compra tal cual estaba antes de editar

// Un <input type="date"> trabaja con "YYYY-MM-DD" en horario UTC-neutral;
// convertirlo con `new Date("YYYY-MM-DD")` interpreta esa fecha en UTC y
// puede mostrar el día anterior en Argentina (UTC-3). Por eso se arma la
// fecha a mano con los componentes locales.
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

// ---- Resumen "Neto / IVA / Total" a partir de un total ya conocido ----
// (a diferencia de calcularDesglose de otras pantallas, acá el total ya
// viene calculado por línea — cantidad * monto, o el monto directo si es
// "precio total" — así que no hace falta cantidad*precioUnitario de nuevo)
function desgloseDesdeTotal(totalIngresado, tipoFactura) {
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

function crearLineaCompra(item = {}) {
  const fila = document.createElement("div");
  fila.className = "linea-compra";
  fila.innerHTML = `
    <select class="linea-elemento">${opcionesElementos()}</select>
    <input type="number" class="linea-cantidad" min="0.0001" step="any" placeholder="Cantidad" value="${item.cantidad ?? ""}" />
    <select class="linea-modo-precio">
      <option value="unitario">Precio unitario</option>
      <option value="total">Precio total</option>
    </select>
    <input type="number" class="linea-monto" min="0" step="any" placeholder="Monto" value="${item.monto ?? ""}" />
    <button type="button" class="boton-quitar-fila" title="Quitar">×</button>
  `;
  if (item.materiaId) fila.querySelector(".linea-elemento").value = item.materiaId;
  if (item.modoPrecio) fila.querySelector(".linea-modo-precio").value = item.modoPrecio;

  fila.querySelector(".boton-quitar-fila").addEventListener("click", () => {
    fila.remove();
    actualizarDesgloseCalculado();
  });
  fila.querySelectorAll("input, select").forEach((el) => el.addEventListener("input", actualizarDesgloseCalculado));
  fila.querySelectorAll("select").forEach((el) => el.addEventListener("change", actualizarDesgloseCalculado));

  return fila;
}

btnAgregarLineaCompra.addEventListener("click", () => {
  lineasCompraContenedor.appendChild(crearLineaCompra());
});

// Lee todas las líneas del formulario y devuelve un array de items
// validados, o null si falta algo (y muestra el error correspondiente).
function leerLineasCompra() {
  const filas = Array.from(lineasCompraContenedor.querySelectorAll(".linea-compra"));
  if (filas.length === 0) {
    errorCompra.textContent = "Agregá al menos un elemento a la compra.";
    errorCompra.hidden = false;
    return null;
  }
  const items = [];
  for (const fila of filas) {
    const materiaId = fila.querySelector(".linea-elemento").value;
    const cantidad = parseFloat(fila.querySelector(".linea-cantidad").value);
    const modoPrecio = fila.querySelector(".linea-modo-precio").value;
    const monto = parseFloat(fila.querySelector(".linea-monto").value);
    if (!materiaId || !(cantidad > 0) || !(monto >= 0)) {
      errorCompra.textContent = "Completá elemento, cantidad y monto en cada línea (o quitá la línea).";
      errorCompra.hidden = false;
      return null;
    }
    const montoTotalLinea = modoPrecio === "total" ? monto : cantidad * monto;
    items.push({ materiaId, cantidad, modoPrecio, monto, montoTotalLinea });
  }
  return items;
}

function actualizarDesgloseCalculado() {
  errorCompra.hidden = true;
  const filas = Array.from(lineasCompraContenedor.querySelectorAll(".linea-compra"));
  let totalNeto = 0;
  let ivaTotal = 0;
  let totalConIva = 0;

  filas.forEach((fila) => {
    const cantidad = parseFloat(fila.querySelector(".linea-cantidad").value) || 0;
    const modoPrecio = fila.querySelector(".linea-modo-precio").value;
    const monto = parseFloat(fila.querySelector(".linea-monto").value) || 0;
    const montoTotalLinea = modoPrecio === "total" ? monto : cantidad * monto;
    const d = desgloseDesdeTotal(montoTotalLinea, selectTipoFactura.value);
    totalNeto += d.totalNeto;
    ivaTotal += d.ivaTotal;
    totalConIva += d.totalConIva;
  });

  netoCalculadoEl.textContent = formatoMoneda.format(totalNeto);
  ivaCalculadoEl.textContent = formatoMoneda.format(ivaTotal);
  totalCalculadoEl.textContent = formatoMoneda.format(totalConIva);
}
selectTipoFactura.addEventListener("change", actualizarDesgloseCalculado);

function resetearFormCompra() {
  editandoCompraId = null;
  itemsOriginalesEdicion = [];
  inputCompraFecha.value = dateAFechaInput(new Date());
  selectCompraProveedor.value = "";
  selectTipoFactura.value = "con_iva_no_incluido";
  lineasCompraContenedor.innerHTML = "";
  lineasCompraContenedor.appendChild(crearLineaCompra());
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

// ---- Resumen de elementos comprados, para la tabla y las alertas ----
function resumenItemsCompra(items) {
  return items.map((it) => `${nombreMaterial(it.materiaId)} (${formatoNumero.format(it.cantidad)})`).join(", ");
}

function renderTablaCompras() {
  if (comprasCache.length === 0) {
    tablaComprasBody.innerHTML =
      '<tr><td colspan="6" class="fila-vacia">Todavía no hay compras registradas.</td></tr>';
    return;
  }
  tablaComprasBody.innerHTML = comprasCache
    .map((c) => {
      const fecha = c.fecha ? formatoFecha.format(c.fecha.toDate()) : "—";
      const resumen = resumenItemsCompra(c.items || []);
      return `
      <tr>
        <td>${fecha}</td>
        <td><span class="receta-resumen" title="${escapeHtml(resumen)}">${escapeHtml(resumen)}</span></td>
        <td>${escapeHtml(nombreProveedor(c.proveedorId))}</td>
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

tablaComprasBody.addEventListener("click", (e) => {
  const idEditar = e.target.dataset.editarCompra;
  const idEliminar = e.target.dataset.eliminarCompra;

  if (idEditar) {
    const compra = comprasCache.find((c) => c.id === idEditar);
    if (!compra) return;
    editandoCompraId = compra.id;
    itemsOriginalesEdicion = compra.items || [];
    inputCompraFecha.value = compra.fecha ? dateAFechaInput(compra.fecha.toDate()) : dateAFechaInput(new Date());
    selectCompraProveedor.value = compra.proveedorId;
    selectTipoFactura.value = compra.tipoFactura || "con_iva_no_incluido";
    lineasCompraContenedor.innerHTML = "";
    itemsOriginalesEdicion.forEach((it) => lineasCompraContenedor.appendChild(crearLineaCompra(it)));
    errorCompra.hidden = true;
    tituloModalCompra.textContent = "Editar compra";
    btnGuardarCompra.textContent = "Guardar cambios";
    actualizarDesgloseCalculado();
    abrirModal(modalCompra);
  }

  if (idEliminar) {
    const compra = comprasCache.find((c) => c.id === idEliminar);
    if (!compra) return;
    if (!confirm(`¿Eliminar esta compra (${resumenItemsCompra(compra.items || [])})? Se descuenta del stock.`))
      return;
    eliminarCompra(compra).catch((error) => {
      if (error.code === "STOCK_NEGATIVO") {
        alert(
          `No se puede eliminar: el stock de "${nombreMaterial(
            error.materiaId
          )}" ya se usó (quedaría en negativo). Revisá las producciones o compras posteriores primero.`
        );
      } else {
        console.error(error);
        alert("No se pudo eliminar la compra. Probá de nuevo.");
      }
    });
  }
});

btnGuardarCompra.addEventListener("click", async () => {
  errorCompra.hidden = true;

  const fechaValor = inputCompraFecha.value;
  const proveedorId = selectCompraProveedor.value;
  const tipoFactura = selectTipoFactura.value;
  if (!fechaValor) {
    errorCompra.textContent = "Elegí una fecha.";
    errorCompra.hidden = false;
    return;
  }
  if (!proveedorId) {
    errorCompra.textContent = "Elegí un proveedor.";
    errorCompra.hidden = false;
    return;
  }

  const items = leerLineasCompra();
  if (!items) return;

  const fecha = fechaInputADate(fechaValor);

  btnGuardarCompra.disabled = true;
  try {
    if (editandoCompraId) {
      await actualizarCompra(editandoCompraId, itemsOriginalesEdicion, { fecha, proveedorId, tipoFactura, items });
    } else {
      await registrarCompra({ fecha, proveedorId, tipoFactura, items });
    }
    cerrarModal(modalCompra);
  } catch (error) {
    if (error.code === "STOCK_NEGATIVO") {
      errorCompra.textContent = `Ese cambio dejaría el stock de "${nombreMaterial(
        error.materiaId
      )}" en negativo (ya se usó en otra producción o movimiento). Ajustá primero eso.`;
    } else {
      console.error(error);
      errorCompra.textContent = "No se pudo guardar la compra. Probá de nuevo.";
    }
    errorCompra.hidden = false;
  } finally {
    btnGuardarCompra.disabled = false;
  }
});

// Suma cantidades por elemento (si el mismo elemento aparece en más de
// una línea de la misma compra) para poder hacer una sola lectura/
// escritura de stock por elemento dentro de la transacción.
function agruparCantidadesPorElemento(items) {
  const mapa = {};
  items.forEach((it) => {
    mapa[it.materiaId] = (mapa[it.materiaId] || 0) + it.cantidad;
  });
  return mapa;
}

function calcularTotalesCompra(items, tipoFactura) {
  let totalNeto = 0;
  let ivaTotal = 0;
  let totalConIva = 0;
  items.forEach((it) => {
    const d = desgloseDesdeTotal(it.montoTotalLinea, tipoFactura);
    totalNeto += d.totalNeto;
    ivaTotal += d.ivaTotal;
    totalConIva += d.totalConIva;
  });
  return {
    precioTotalNeto: round2(totalNeto),
    ivaTotal: round2(ivaTotal),
    precioTotalConIva: round2(totalConIva)
  };
}

async function registrarCompra({ fecha, proveedorId, tipoFactura, items }) {
  const cantidadesPorElemento = agruparCantidadesPorElemento(items);
  const totales = calcularTotalesCompra(items, tipoFactura);

  await runTransaction(db, async (tx) => {
    const lecturas = [];
    for (const materiaId of Object.keys(cantidadesPorElemento)) {
      const ref = doc(materiasPrimasRef, materiaId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("Un elemento de la compra ya no existe.");
      lecturas.push({ ref, materiaId, stockActual: snap.data().stockActual || 0 });
    }

    lecturas.forEach(({ ref, materiaId, stockActual }) => {
      tx.update(ref, {
        stockActual: stockActual + cantidadesPorElemento[materiaId],
        actualizadoEn: serverTimestamp()
      });
    });

    tx.set(doc(movimientosCompraRef), {
      proveedorId,
      tipoFactura,
      tieneFactura: tipoFactura !== "sin_factura",
      items: items.map((it) => ({
        materiaId: it.materiaId,
        cantidad: it.cantidad,
        modoPrecio: it.modoPrecio,
        monto: it.monto
      })),
      ...totales,
      fecha
    });
  });
}

async function actualizarCompra(compraId, itemsOriginales, { fecha, proveedorId, tipoFactura, items }) {
  const compraRef = doc(movimientosCompraRef, compraId);
  const totales = calcularTotalesCompra(items, tipoFactura);

  const cantidadesViejas = agruparCantidadesPorElemento(itemsOriginales);
  const cantidadesNuevas = agruparCantidadesPorElemento(items);
  const idsAfectados = new Set([...Object.keys(cantidadesViejas), ...Object.keys(cantidadesNuevas)]);

  await runTransaction(db, async (tx) => {
    const lecturas = [];
    for (const materiaId of idsAfectados) {
      const ref = doc(materiasPrimasRef, materiaId);
      const snap = await tx.get(ref);
      if (!snap.exists()) continue; // el elemento pudo haberse eliminado; se ignora su ajuste
      const stockActual = snap.data().stockActual || 0;
      const delta = (cantidadesNuevas[materiaId] || 0) - (cantidadesViejas[materiaId] || 0);
      const nuevoStock = stockActual - delta;
      if (nuevoStock < 0) {
        const err = new Error("Stock negativo");
        err.code = "STOCK_NEGATIVO";
        err.materiaId = materiaId;
        throw err;
      }
      lecturas.push({ ref, nuevoStock });
    }

    lecturas.forEach(({ ref, nuevoStock }) => {
      tx.update(ref, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    });

    tx.update(compraRef, {
      proveedorId,
      tipoFactura,
      tieneFactura: tipoFactura !== "sin_factura",
      items: items.map((it) => ({
        materiaId: it.materiaId,
        cantidad: it.cantidad,
        modoPrecio: it.modoPrecio,
        monto: it.monto
      })),
      ...totales,
      fecha,
      actualizadoEn: serverTimestamp()
    });
  });
}

async function eliminarCompra(compra) {
  const compraRef = doc(movimientosCompraRef, compra.id);
  const cantidadesPorElemento = agruparCantidadesPorElemento(compra.items || []);

  await runTransaction(db, async (tx) => {
    const lecturas = [];
    for (const materiaId of Object.keys(cantidadesPorElemento)) {
      const ref = doc(materiasPrimasRef, materiaId);
      const snap = await tx.get(ref);
      if (!snap.exists()) continue;
      const stockActual = snap.data().stockActual || 0;
      const nuevoStock = stockActual - cantidadesPorElemento[materiaId];
      if (nuevoStock < 0) {
        const err = new Error("Stock negativo");
        err.code = "STOCK_NEGATIVO";
        err.materiaId = materiaId;
        throw err;
      }
      lecturas.push({ ref, nuevoStock });
    }
    lecturas.forEach(({ ref, nuevoStock }) => {
      tx.update(ref, { stockActual: nuevoStock, actualizadoEn: serverTimestamp() });
    });
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
