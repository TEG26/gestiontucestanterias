const paneles = {
  "nav-stock": document.getElementById("panel-stock"),
  "nav-produccion": document.getElementById("panel-produccion"),
  "nav-analisis-produccion": document.getElementById("panel-analisis-produccion"),
  "nav-ventas": document.getElementById("panel-ventas"),
  "nav-presupuestos": document.getElementById("panel-presupuestos"),
  "nav-egresos": document.getElementById("panel-egresos"),
  "nav-balance": document.getElementById("panel-balance")
};

Object.keys(paneles).forEach((idBoton) => {
  const boton = document.getElementById(idBoton);
  boton.addEventListener("click", () => {
    Object.keys(paneles).forEach((otroId) => {
      const otroBoton = document.getElementById(otroId);
      const esActivo = otroId === idBoton;
      otroBoton.classList.toggle("activo", esActivo);
      paneles[otroId].hidden = !esActivo;
    });
  });
});
