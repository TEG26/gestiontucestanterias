import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const productosRef = collection(db, "productos");
const materiasPrimasRef = collection(db, "materiasPrimas");

// Cache propio de elementos (independiente del de materias-primas.js) para
// no acoplar los dos archivos: acá solo se usa para armar los <select> de
// la receta y para mostrar nombres en el resumen de la tabla.
let materialesCache = [];
let productosCache = [];

const formatoNumero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const formatoMoneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2
});

onSnapshot(query(materiasPrimasRef, orderBy("nombre")), (snapshot) => {
  materialesCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Si hay filas de receta abiertas en el modal, refrescar sus opciones
  // sin perder lo ya seleccionado.
  document.querySelectorAll(".receta-elemento").forEach((select) => {
    const valorPrevio = select.value;
    select.innerHTML = opcionesElementos();
    if (materialesCache.some((m) => m.id === valorPrevio)) select.value = valorPrevio;
  });
  renderTablaProductos();
});

function opcionesElementos() {
  return (
    '<option value="" disabled selected>Elegir elemento...</option>' +
    materialesCache.map((m) => `<option value="${m.id}">${escapeHtml(m.nombre)} (${escapeHtml(m.unidad)})</option>`).join("")
  );
}

function nombreElemento(materiaId) {
  const m = materialesCache.find((x) => x.id === materiaId);
  return m ? m.nombre : "(elemento eliminado)";
}

// =====================================================================
// Tabla de productos
// =====================================================================

const tablaProductosBody = document.getElementById("tabla-productos-body");

function resumenReceta(receta) {
  if (!receta || receta.length === 0) return "Sin receta cargada";
  return receta.map((r) => `${nombreElemento(r.materiaId)} (${formatoNumero.format(r.cantidadPorUnidad)})`).join(", ");
}

// Costo de fabricación = suma de (cantidad de receta × último costo neto
// conocido de ese elemento). Si algún elemento nunca tuvo una compra
// registrada, ese costo cuenta como 0 — el número entonces queda
// incompleto, así que se lo marca aparte en vez de mostrarlo como si
// fuera exacto.
function calcularCosto(receta) {
  if (!receta || receta.length === 0) return { costo: 0, completo: false };
  let costo = 0;
  let completo = true;
  receta.forEach((r) => {
    const elemento = materialesCache.find((m) => m.id === r.materiaId);
    if (!elemento || !elemento.ultimoCostoNeto) {
      completo = false;
      return;
    }
    costo += r.cantidadPorUnidad * elemento.ultimoCostoNeto;
  });
  return { costo, completo };
}

function renderTablaProductos() {
  if (productosCache.length === 0) {
    tablaProductosBody.innerHTML =
      '<tr><td colspan="7" class="fila-vacia">Todavía no cargaste ningún producto.</td></tr>';
    return;
  }
  tablaProductosBody.innerHTML = productosCache
    .map((p) => {
      const resumen = resumenReceta(p.receta);
      const { costo, completo } = calcularCosto(p.receta);
      const costoTexto =
        !p.receta || p.receta.length === 0
          ? "—"
          : `${formatoMoneda.format(costo)}${completo ? "" : " (incompleto)"}`;
      return `
      <tr>
        <td>${escapeHtml(p.nombre)}</td>
        <td>${escapeHtml(p.unidad)}</td>
        <td class="col-numero">${formatoNumero.format(p.stockActual || 0)}</td>
        <td><span class="receta-resumen" title="${escapeHtml(resumen)}">${escapeHtml(resumen)}</span></td>
        <td class="col-numero">${costoTexto}</td>
        <td class="col-numero">${p.precioVenta ? formatoMoneda.format(p.precioVenta) : "—"}</td>
        <td class="col-acciones">
          <button type="button" class="boton-accion-fila" data-editar-producto="${p.id}">Editar</button>
          <button type="button" class="boton-accion-fila" data-editar-receta="${p.id}">Receta</button>
          <button type="button" class="boton-accion-fila" data-editar-precio="${p.id}">Precio</button>
          <button type="button" class="boton-accion-fila peligro" data-eliminar-producto="${p.id}">Eliminar</button>
        </td>
      </tr>`;
    })
    .join("");
}

onSnapshot(query(productosRef, orderBy("nombre")), (snapshot) => {
  productosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaProductos();
});

// =====================================================================
// Modal: nuevo/editar producto
// =====================================================================

const modalProducto = document.getElementById("modal-nuevo-producto");
const formProducto = document.getElementById("form-nuevo-producto");
const errorProducto = document.getElementById("error-nuevo-producto");
const inputProductoNombre = document.getElementById("nuevo-producto-nombre");
const inputProductoUnidad = document.getElementById("nuevo-producto-unidad");
const tituloModalProducto = document.getElementById("titulo-modal-producto");
const btnGuardarProducto = document.getElementById("btn-guardar-producto");

let editandoProductoId = null;

document.getElementById("btn-abrir-nuevo-producto").addEventListener("click", () => {
  editandoProductoId = null;
  formProducto.reset();
  inputProductoUnidad.value = "unidad";
  errorProducto.hidden = true;
  tituloModalProducto.textContent = "Nuevo producto";
  btnGuardarProducto.textContent = "Crear";
  abrirModal(modalProducto);
});

tablaProductosBody.addEventListener("click", (e) => {
  const idEditar = e.target.dataset.editarProducto;
  const idReceta = e.target.dataset.editarReceta;
  const idPrecio = e.target.dataset.editarPrecio;
  const idEliminar = e.target.dataset.eliminarProducto;

  if (idEditar) {
    const producto = productosCache.find((p) => p.id === idEditar);
    if (!producto) return;
    editandoProductoId = idEditar;
    inputProductoNombre.value = producto.nombre;
    inputProductoUnidad.value = producto.unidad;
    errorProducto.hidden = true;
    tituloModalProducto.textContent = "Editar producto";
    btnGuardarProducto.textContent = "Guardar cambios";
    abrirModal(modalProducto);
  }

  if (idReceta) {
    abrirModalReceta(idReceta);
  }

  if (idPrecio) {
    abrirModalPrecio(idPrecio);
  }

  if (idEliminar) {
    const producto = productosCache.find((p) => p.id === idEliminar);
    if (!producto) return;
    if ((producto.stockActual || 0) !== 0) {
      alert(
        `No se puede eliminar "${producto.nombre}" porque todavía tiene stock (${formatoNumero.format(
          producto.stockActual
        )} ${producto.unidad}). Para eliminarlo, primero el stock tiene que quedar en 0.`
      );
      return;
    }
    if (!confirm(`¿Eliminar el producto "${producto.nombre}" y su receta? Esta acción no se puede deshacer.`)) return;
    deleteDoc(doc(productosRef, idEliminar)).catch((error) => {
      console.error(error);
      alert("No se pudo eliminar el producto. Probá de nuevo.");
    });
  }
});

formProducto.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorProducto.hidden = true;
  const nombre = inputProductoNombre.value.trim();
  const unidad = inputProductoUnidad.value.trim();
  if (!nombre || !unidad) return;

  deshabilitarForm(formProducto, true);
  try {
    if (editandoProductoId) {
      await updateDoc(doc(productosRef, editandoProductoId), {
        nombre,
        unidad,
        actualizadoEn: serverTimestamp()
      });
    } else {
      await addDoc(productosRef, {
        nombre,
        unidad,
        receta: [],
        stockActual: 0,
        activo: true,
        creadoEn: serverTimestamp(),
        actualizadoEn: serverTimestamp()
      });
    }
    cerrarModal(modalProducto);
  } catch (error) {
    console.error(error);
    errorProducto.textContent = "No se pudo guardar el producto. Probá de nuevo.";
    errorProducto.hidden = false;
  } finally {
    deshabilitarForm(formProducto, false);
  }
});

// =====================================================================
// Modal: receta
// =====================================================================

const modalReceta = document.getElementById("modal-receta");
const tituloModalReceta = document.getElementById("titulo-modal-receta");
const recetaFilas = document.getElementById("receta-filas");
const errorReceta = document.getElementById("error-receta");
const btnAgregarFilaReceta = document.getElementById("btn-agregar-fila-receta");
const btnGuardarReceta = document.getElementById("btn-guardar-receta");

let productoRecetaActualId = null;

function crearFilaReceta(materiaId = "", cantidad = "") {
  const fila = document.createElement("div");
  fila.className = "fila-receta";
  fila.innerHTML = `
    <select class="receta-elemento">${opcionesElementos()}</select>
    <input type="number" class="receta-cantidad" min="0.0001" step="any" placeholder="Cantidad" value="${cantidad}" />
    <button type="button" class="boton-quitar-fila" title="Quitar">×</button>
  `;
  if (materiaId) fila.querySelector(".receta-elemento").value = materiaId;
  fila.querySelector(".boton-quitar-fila").addEventListener("click", () => fila.remove());
  return fila;
}

function abrirModalReceta(productoId) {
  if (materialesCache.length === 0) {
    alert("Primero tenés que cargar al menos un elemento en la sección de arriba.");
    return;
  }
  const producto = productosCache.find((p) => p.id === productoId);
  if (!producto) return;

  productoRecetaActualId = productoId;
  tituloModalReceta.textContent = `Receta de ${producto.nombre}`;
  errorReceta.hidden = true;
  recetaFilas.innerHTML = "";

  const receta = producto.receta && producto.receta.length > 0 ? producto.receta : [{ materiaId: "", cantidadPorUnidad: "" }];
  receta.forEach((r) => recetaFilas.appendChild(crearFilaReceta(r.materiaId, r.cantidadPorUnidad)));

  abrirModal(modalReceta);
}

btnAgregarFilaReceta.addEventListener("click", () => {
  recetaFilas.appendChild(crearFilaReceta());
});

btnGuardarReceta.addEventListener("click", async () => {
  errorReceta.hidden = true;
  const filas = Array.from(recetaFilas.querySelectorAll(".fila-receta"));
  const receta = [];

  for (const fila of filas) {
    const materiaId = fila.querySelector(".receta-elemento").value;
    const cantidad = parseFloat(fila.querySelector(".receta-cantidad").value);
    if (!materiaId || !(cantidad > 0)) {
      errorReceta.textContent = "Completá el elemento y una cantidad mayor a 0 en cada fila (o quitá la fila).";
      errorReceta.hidden = false;
      return;
    }
    receta.push({ materiaId, cantidadPorUnidad: cantidad });
  }

  btnGuardarReceta.disabled = true;
  try {
    await updateDoc(doc(productosRef, productoRecetaActualId), {
      receta,
      actualizadoEn: serverTimestamp()
    });
    cerrarModal(modalReceta);
  } catch (error) {
    console.error(error);
    errorReceta.textContent = "No se pudo guardar la receta. Probá de nuevo.";
    errorReceta.hidden = false;
  } finally {
    btnGuardarReceta.disabled = false;
  }
});

// =====================================================================
// Modal: precio de venta
// =====================================================================

const modalPrecio = document.getElementById("modal-precio-producto");
const formPrecio = document.getElementById("form-precio-producto");
const errorPrecio = document.getElementById("error-precio-producto");
const inputPrecioValor = document.getElementById("precio-producto-valor");
const textoPrecioCosto = document.getElementById("precio-producto-costo");
const tituloModalPrecio = document.getElementById("titulo-modal-precio-producto");

let productoPrecioActualId = null;

function abrirModalPrecio(productoId) {
  const producto = productosCache.find((p) => p.id === productoId);
  if (!producto) return;

  productoPrecioActualId = productoId;
  tituloModalPrecio.textContent = `Precio de venta — ${producto.nombre}`;
  const { costo, completo } = calcularCosto(producto.receta);
  textoPrecioCosto.textContent =
    !producto.receta || producto.receta.length === 0
      ? "Este producto todavía no tiene receta cargada."
      : `Costo de fabricación: ${formatoMoneda.format(costo)}${completo ? "" : " (incompleto — falta el costo de algún elemento)"}`;
  inputPrecioValor.value = producto.precioVenta || "";
  errorPrecio.hidden = true;
  abrirModal(modalPrecio);
}

formPrecio.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorPrecio.hidden = true;
  const precioVenta = parseFloat(inputPrecioValor.value);
  if (!(precioVenta >= 0)) return;

  deshabilitarForm(formPrecio, true);
  try {
    await updateDoc(doc(productosRef, productoPrecioActualId), {
      precioVenta,
      actualizadoEn: serverTimestamp()
    });
    cerrarModal(modalPrecio);
  } catch (error) {
    console.error(error);
    errorPrecio.textContent = "No se pudo guardar el precio. Probá de nuevo.";
    errorPrecio.hidden = false;
  } finally {
    deshabilitarForm(formPrecio, false);
  }
});

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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
