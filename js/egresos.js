import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  writeBatch,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const categoriasGastoRef = collection(db, "categoriasGasto");
const egresosRef = collection(db, "egresos");
const ventasRef = collection(db, "ventas");
const movimientosCompraRef = collection(db, "movimientosCompra");

// Caches propios de este archivo (independientes de ventas.js y
// materias-primas.js, mismo criterio de desacople de toda la app).
let categoriasCache = [];
let egresosCache = [];
let ventasCache = [];
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
const formatoMesLargo = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });

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
function claveMes(date) {
  return dateAFechaInput(date).slice(0, 7);
}
function etiquetaMes(clave) {
  const [y, m] = clave.split("-").map(Number);
  const texto = formatoMesLargo.format(new Date(y, m - 1, 1));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

// =====================================================================
// Categorías de gasto (con siembra inicial de las 12 categorías base)
// =====================================================================

const CATEGORIAS_DEFECTO = [
  { nombre: "Materia prima y materiales", noSeleccionable: true },
  { nombre: "Mano de obra" },
  { nombre: "Sueldos y cargas sociales" },
  { nombre: "Impuestos y contribuciones (AFIP/IVA/Ingresos Brutos)" },
  { nombre: "Servicios básicos (agua/luz/gas/internet)" },
  { nombre: "Alquiler" },
  { nombre: "Mantenimiento de equipos y herramientas" },
  { nombre: "Logística y transporte" },
  { nombre: "Publicidad y marketing" },
  { nombre: "Administrativos/papelería" },
  { nombre: "Gastos no esenciales" },
  { nombre: "Otros" }
];

let seedIntentado = false;

async function sembrarCategoriasPorDefecto() {
  if (seedIntentado) return;
  seedIntentado = true;
  const batch = writeBatch(db);
  CATEGORIAS_DEFECTO.forEach((cat) => {
    const ref = doc(categoriasGastoRef);
    batch.set(ref, { nombre: cat.nombre, noSeleccionable: !!cat.noSeleccionable, activo: true, creadoEn: serverTimestamp() });
  });
  await batch.commit();
}

const selectEgresoCategoria = document.getElementById("egreso-categoria");
const selectFiltroCategoria = document.getElementById("egresos-filtro-categoria");

function nombreCategoria(id) {
  const c = categoriasCache.find((x) => x.id === id);
  return c ? c.nombre : "(categoría eliminada)";
}

function renderSelectsCategoria() {
  const seleccionables = categoriasCache.filter((c) => !c.noSeleccionable);

  const valorPrevioEgreso = selectEgresoCategoria.value;
  selectEgresoCategoria.innerHTML =
    '<option value="" disabled selected>Elegir categoría...</option>' +
    seleccionables.map((c) => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join("");
  if (seleccionables.some((c) => c.id === valorPrevioEgreso)) selectEgresoCategoria.value = valorPrevioEgreso;

  const valorPrevioFiltro = selectFiltroCategoria.value;
  selectFiltroCategoria.innerHTML =
    '<option value="">Todas</option>' + categoriasCache.map((c) => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join("");
  selectFiltroCategoria.value = valorPrevioFiltro;
}

onSnapshot(query(categoriasGastoRef, orderBy("nombre")), (snapshot) => {
  if (snapshot.empty) {
    sembrarCategoriasPorDefecto();
    return;
  }
  categoriasCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderSelectsCategoria();
  renderListaCategorias();
  renderTablaEgresos();
  recalcularTodo();
});

// ---------- Modal: administrar categorías ----------

const modalCategorias = document.getElementById("modal-categorias-gasto");
const listaCategorias = document.getElementById("lista-categorias-gasto");
const formNuevaCategoria = document.getElementById("form-nueva-categoria-gasto");
const errorCategoria = document.getElementById("error-categoria-gasto");
const inputNuevaCategoriaNombre = document.getElementById("nueva-categoria-nombre");
const etiquetaFormCategoria = document.getElementById("form-categoria-etiqueta");
const btnGuardarCategoria = document.getElementById("btn-guardar-categoria-gasto");
const btnCancelarEdicionCategoria = document.getElementById("btn-cancelar-edicion-categoria");

let editandoCategoriaId = null;

function renderListaCategorias() {
  if (categoriasCache.length === 0) {
    listaCategorias.innerHTML = '<li class="fila-vacia">Todavía no hay categorías cargadas.</li>';
    return;
  }
  listaCategorias.innerHTML = categoriasCache
    .map((c) => {
      if (c.noSeleccionable) {
        return `<li><span>${escapeHtml(c.nombre)} <span class="ayuda-modal" style="display:inline">(automática, desde Compras)</span></span></li>`;
      }
      return `
      <li>
        <span>${escapeHtml(c.nombre)}</span>
        <span class="acciones-fila">
          <button type="button" class="boton-accion-fila" data-editar-categoria="${c.id}">Editar</button>
          <button type="button" class="boton-accion-fila peligro" data-eliminar-categoria="${c.id}">Eliminar</button>
        </span>
      </li>`;
    })
    .join("");
}

function resetearFormCategoria() {
  editandoCategoriaId = null;
  formNuevaCategoria.reset();
  errorCategoria.hidden = true;
  etiquetaFormCategoria.textContent = "Nueva categoría";
  btnGuardarCategoria.textContent = "Crear";
  btnCancelarEdicionCategoria.hidden = true;
}

document.getElementById("btn-abrir-categorias").addEventListener("click", () => {
  resetearFormCategoria();
  abrirModal(modalCategorias);
});
btnCancelarEdicionCategoria.addEventListener("click", resetearFormCategoria);

listaCategorias.addEventListener("click", (e) => {
  const idEditar = e.target.dataset.editarCategoria;
  const idEliminar = e.target.dataset.eliminarCategoria;

  if (idEditar) {
    const categoria = categoriasCache.find((c) => c.id === idEditar);
    if (!categoria) return;
    editandoCategoriaId = idEditar;
    inputNuevaCategoriaNombre.value = categoria.nombre;
    errorCategoria.hidden = true;
    etiquetaFormCategoria.textContent = "Editar categoría";
    btnGuardarCategoria.textContent = "Guardar cambios";
    btnCancelarEdicionCategoria.hidden = false;
    inputNuevaCategoriaNombre.focus();
  }

  if (idEliminar) {
    const categoria = categoriasCache.find((c) => c.id === idEliminar);
    if (!categoria) return;
    if (!confirm(`¿Eliminar la categoría "${categoria.nombre}"? Los egresos ya cargados con ella no se modifican.`)) return;
    deleteDoc(doc(categoriasGastoRef, idEliminar)).catch((error) => {
      console.error(error);
      alert("No se pudo eliminar la categoría. Probá de nuevo.");
    });
    if (editandoCategoriaId === idEliminar) resetearFormCategoria();
  }
});

formNuevaCategoria.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorCategoria.hidden = true;
  const nombre = inputNuevaCategoriaNombre.value.trim();
  if (!nombre) return;

  formNuevaCategoria.querySelectorAll("input,button").forEach((el) => (el.disabled = true));
  try {
    if (editandoCategoriaId) {
      await updateDoc(doc(categoriasGastoRef, editandoCategoriaId), { nombre });
    } else {
      await addDoc(categoriasGastoRef, { nombre, noSeleccionable: false, activo: true, creadoEn: serverTimestamp() });
    }
    resetearFormCategoria();
  } catch (error) {
    console.error(error);
    errorCategoria.textContent = "No se pudo guardar la categoría. Probá de nuevo.";
    errorCategoria.hidden = false;
  } finally {
    formNuevaCategoria.querySelectorAll("input,button").forEach((el) => (el.disabled = false));
  }
});

// =====================================================================
// Egresos
// =====================================================================

const tablaEgresosBody = document.getElementById("tabla-egresos-body");
const modalEgreso = document.getElementById("modal-egreso");
const formEgreso = document.getElementById("form-egreso");
const errorEgreso = document.getElementById("error-egreso");
const inputEgresoFecha = document.getElementById("egreso-fecha");
const inputEgresoDescripcion = document.getElementById("egreso-descripcion");
const inputEgresoMonto = document.getElementById("egreso-monto");
const inputEgresoMedioPago = document.getElementById("egreso-medio-pago");
const inputEgresoTieneFactura = document.getElementById("egreso-tiene-factura");
const tituloModalEgreso = document.getElementById("titulo-modal-egreso");
const btnGuardarEgreso = document.getElementById("btn-guardar-egreso");

let editandoEgresoId = null;

document.getElementById("btn-abrir-egreso").addEventListener("click", () => {
  if (categoriasCache.filter((c) => !c.noSeleccionable).length === 0) {
    alert("Todavía no hay categorías cargadas.");
    return;
  }
  editandoEgresoId = null;
  formEgreso.reset();
  inputEgresoFecha.value = dateAFechaInput(new Date());
  errorEgreso.hidden = true;
  tituloModalEgreso.textContent = "Nuevo egreso";
  btnGuardarEgreso.textContent = "Registrar";
  abrirModal(modalEgreso);
});

function renderTablaEgresos() {
  const filtradas = aplicarFiltrosEgresos(egresosCache);
  if (filtradas.length === 0) {
    tablaEgresosBody.innerHTML = '<tr><td colspan="7" class="fila-vacia">No hay egresos que coincidan con el filtro.</td></tr>';
    return;
  }
  tablaEgresosBody.innerHTML = filtradas
    .map((e) => {
      const fecha = e.fecha ? formatoFecha.format(e.fecha.toDate()) : "—";
      return `
      <tr>
        <td>${fecha}</td>
        <td>${escapeHtml(nombreCategoria(e.categoriaId))}</td>
        <td>${escapeHtml(e.descripcion)}</td>
        <td class="col-numero">${formatoMoneda.format(e.monto)}</td>
        <td>${escapeHtml(e.medioPago)}</td>
        <td>${e.tieneFactura ? "Sí" : "No"}</td>
        <td class="col-acciones">
          <button type="button" class="boton-accion-fila" data-editar-egreso="${e.id}">Editar</button>
          <button type="button" class="boton-accion-fila peligro" data-eliminar-egreso="${e.id}">Eliminar</button>
        </td>
      </tr>`;
    })
    .join("");
}

onSnapshot(query(egresosRef, orderBy("fecha", "desc"), limit(500)), (snapshot) => {
  egresosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaEgresos();
  recalcularTodo();
});

tablaEgresosBody.addEventListener("click", (e) => {
  const idEditar = e.target.dataset.editarEgreso;
  const idEliminar = e.target.dataset.eliminarEgreso;

  if (idEditar) {
    const egreso = egresosCache.find((x) => x.id === idEditar);
    if (!egreso) return;
    editandoEgresoId = idEditar;
    inputEgresoFecha.value = egreso.fecha ? dateAFechaInput(egreso.fecha.toDate()) : dateAFechaInput(new Date());
    selectEgresoCategoria.value = egreso.categoriaId;
    inputEgresoDescripcion.value = egreso.descripcion;
    inputEgresoMonto.value = egreso.monto;
    inputEgresoMedioPago.value = egreso.medioPago;
    inputEgresoTieneFactura.checked = !!egreso.tieneFactura;
    errorEgreso.hidden = true;
    tituloModalEgreso.textContent = "Editar egreso";
    btnGuardarEgreso.textContent = "Guardar cambios";
    abrirModal(modalEgreso);
  }

  if (idEliminar) {
    const egreso = egresosCache.find((x) => x.id === idEliminar);
    if (!egreso) return;
    if (!confirm(`¿Eliminar este egreso ("${egreso.descripcion}")?`)) return;
    deleteDoc(doc(egresosRef, idEliminar)).catch((error) => {
      console.error(error);
      alert("No se pudo eliminar el egreso. Probá de nuevo.");
    });
  }
});

formEgreso.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEgreso.hidden = true;

  const fechaValor = inputEgresoFecha.value;
  const categoriaId = selectEgresoCategoria.value;
  const descripcion = inputEgresoDescripcion.value.trim();
  const monto = parseFloat(inputEgresoMonto.value);
  const medioPago = inputEgresoMedioPago.value.trim();
  const tieneFactura = inputEgresoTieneFactura.checked;

  if (!fechaValor || !categoriaId || !descripcion || !(monto >= 0) || !medioPago) return;

  const fecha = fechaInputADate(fechaValor);
  const datos = { fecha, categoriaId, descripcion, monto, medioPago, tieneFactura };

  formEgreso.querySelectorAll("input,select,button").forEach((el) => (el.disabled = true));
  try {
    if (editandoEgresoId) {
      await updateDoc(doc(egresosRef, editandoEgresoId), { ...datos, actualizadoEn: serverTimestamp() });
    } else {
      await addDoc(egresosRef, { ...datos, creadoEn: serverTimestamp() });
    }
    cerrarModal(modalEgreso);
  } catch (error) {
    console.error(error);
    errorEgreso.textContent = "No se pudo guardar el egreso. Probá de nuevo.";
    errorEgreso.hidden = false;
  } finally {
    formEgreso.querySelectorAll("input,select,button").forEach((el) => (el.disabled = false));
  }
});

// ---------- Filtros del listado de egresos ----------

const inputFiltroMesEgreso = document.getElementById("egresos-filtro-mes");
const inputFiltroTextoEgreso = document.getElementById("egresos-filtro-texto");
const btnLimpiarFiltrosEgresos = document.getElementById("btn-limpiar-filtros-egresos");

function aplicarFiltrosEgresos(egresos) {
  const mes = inputFiltroMesEgreso.value;
  const categoriaId = selectFiltroCategoria.value;
  const texto = inputFiltroTextoEgreso.value.trim().toLowerCase();

  return egresos.filter((e) => {
    if (mes && e.fecha && claveMes(e.fecha.toDate()) !== mes) return false;
    if (categoriaId && e.categoriaId !== categoriaId) return false;
    if (texto && !e.descripcion.toLowerCase().includes(texto)) return false;
    return true;
  });
}
[inputFiltroMesEgreso, selectFiltroCategoria, inputFiltroTextoEgreso].forEach((input) => {
  input.addEventListener("input", renderTablaEgresos);
});
btnLimpiarFiltrosEgresos.addEventListener("click", () => {
  inputFiltroMesEgreso.value = "";
  selectFiltroCategoria.value = "";
  inputFiltroTextoEgreso.value = "";
  renderTablaEgresos();
});

// =====================================================================
// Ventas y compras (solo para los cálculos de balance/IVA)
// =====================================================================

onSnapshot(query(ventasRef, orderBy("fecha", "desc"), limit(1000)), (snapshot) => {
  ventasCache = snapshot.docs.map((d) => d.data());
  recalcularTodo();
});
onSnapshot(query(movimientosCompraRef, orderBy("fecha", "desc"), limit(1000)), (snapshot) => {
  comprasCache = snapshot.docs.map((d) => d.data());
  recalcularTodo();
});

// =====================================================================
// Balance, desglose por categoría, evolución de IVA
// =====================================================================

const tablaBalanceBody = document.getElementById("tabla-balance-body");
const tablaIvaBody = document.getElementById("tabla-iva-body");
const tablaDesgloseBody = document.getElementById("tabla-desglose-body");
const inputDesgloseMes = document.getElementById("desglose-mes");

inputDesgloseMes.value = claveMes(new Date());
inputDesgloseMes.addEventListener("input", renderTablaDesglose);

function recalcularTodo() {
  const meses = {};
  function obtenerMes(key) {
    if (!meses[key]) meses[key] = { ingresos: 0, egresosGeneral: 0, egresosMateriaPrima: 0, ivaVentas: 0, ivaCompras: 0 };
    return meses[key];
  }

  ventasCache.forEach((v) => {
    if (!v.fecha) return;
    const m = obtenerMes(claveMes(v.fecha.toDate()));
    m.ingresos += v.montoTotal || 0;
    m.ivaVentas += v.ivaTotal || 0;
  });
  comprasCache.forEach((c) => {
    if (!c.fecha) return;
    const m = obtenerMes(claveMes(c.fecha.toDate()));
    m.egresosMateriaPrima += c.precioTotalConIva || 0;
    m.ivaCompras += c.ivaTotal || 0;
  });
  egresosCache.forEach((e) => {
    if (!e.fecha) return;
    const m = obtenerMes(claveMes(e.fecha.toDate()));
    m.egresosGeneral += e.monto || 0;
  });

  const claves = Object.keys(meses).sort();
  renderTablaBalance(claves, meses);
  renderTablaIva(claves, meses);
  renderTablaDesglose();
}

function renderTablaBalance(claves, meses) {
  if (claves.length === 0) {
    tablaBalanceBody.innerHTML = '<tr><td colspan="5" class="fila-vacia">Todavía no hay datos para calcular el balance.</td></tr>';
    return;
  }
  let acumulado = 0;
  tablaBalanceBody.innerHTML = claves
    .map((clave) => {
      const m = meses[clave];
      const egresosTotal = m.egresosGeneral + m.egresosMateriaPrima;
      const resultado = m.ingresos - egresosTotal;
      acumulado += resultado;
      return `
      <tr>
        <td>${etiquetaMes(clave)}</td>
        <td class="col-numero">${formatoMoneda.format(m.ingresos)}</td>
        <td class="col-numero">${formatoMoneda.format(egresosTotal)}</td>
        <td class="col-numero">${formatoMoneda.format(resultado)}</td>
        <td class="col-numero">${formatoMoneda.format(acumulado)}</td>
      </tr>`;
    })
    .join("");
}

function renderTablaIva(claves, meses) {
  if (claves.length === 0) {
    tablaIvaBody.innerHTML = '<tr><td colspan="4" class="fila-vacia">Todavía no hay datos para calcular el IVA.</td></tr>';
    return;
  }
  tablaIvaBody.innerHTML = claves
    .map((clave) => {
      const m = meses[clave];
      const diferencia = m.ivaVentas - m.ivaCompras;
      return `
      <tr>
        <td>${etiquetaMes(clave)}</td>
        <td class="col-numero">${formatoMoneda.format(m.ivaVentas)}</td>
        <td class="col-numero">${formatoMoneda.format(m.ivaCompras)}</td>
        <td class="col-numero">${formatoMoneda.format(diferencia)}</td>
      </tr>`;
    })
    .join("");
}

function renderTablaDesglose() {
  const mes = inputDesgloseMes.value || claveMes(new Date());
  const porCategoria = {};

  egresosCache
    .filter((e) => e.fecha && claveMes(e.fecha.toDate()) === mes)
    .forEach((e) => {
      porCategoria[e.categoriaId] = (porCategoria[e.categoriaId] || 0) + (e.monto || 0);
    });

  const totalMateriaPrima = comprasCache
    .filter((c) => c.fecha && claveMes(c.fecha.toDate()) === mes)
    .reduce((acc, c) => acc + (c.precioTotalConIva || 0), 0);

  const filas = Object.entries(porCategoria).map(([categoriaId, monto]) => ({
    nombre: nombreCategoria(categoriaId),
    monto: round2(monto)
  }));
  if (totalMateriaPrima > 0) {
    filas.push({ nombre: "Materia prima y materiales", monto: round2(totalMateriaPrima) });
  }
  filas.sort((a, b) => b.monto - a.monto);

  if (filas.length === 0) {
    tablaDesgloseBody.innerHTML = '<tr><td colspan="2" class="fila-vacia">Sin gastos cargados para ese mes.</td></tr>';
    return;
  }
  tablaDesgloseBody.innerHTML = filas
    .map((f) => `<tr><td>${escapeHtml(f.nombre)}</td><td class="col-numero">${formatoMoneda.format(f.monto)}</td></tr>`)
    .join("");
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
