// Emails autorizados a entrar a la app.
// Esto es una primera barrera del lado del cliente (evita que alguien
// que no es dueño del negocio use la app aunque tenga cuenta de Google).
// La barrera real está en firestore.rules, que también valida el email
// contra esta misma lista del lado del servidor — así que para agregar
// o quitar un email hay que actualizar los DOS lugares.

export const EMAILS_AUTORIZADOS = [
  "carlosaugustocaceres65@gmail.com",
  "tucumanestanterias@hotmail.com",
  "josemariamonti@gmail.com",
  "virg7807@gmail.com"
];
