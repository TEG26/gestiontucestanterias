const paneles = {
  "nav-stock-produccion": document.getElementById("panel-stock-produccion"),
  "nav-analisis-produccion": document.getElementById("panel-analisis-produccion"),
  "nav-ventas-presupuestos": document.getElementById("panel-ventas-presupuestos"),
  "nav-egresos-balance": document.getElementById("panel-egresos-balance")
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
