// Guarda o renombra un contacto para guardar_contacto (Jonathan, 24/10/2026).
// Si ya hay un contacto con ese teléfono se le cambia el nombre; si no, se crea.
// Lo corre «RutaWater Contactos.app» (guardar-contacto-app.js), que tiene el permiso
// de Contactos; este archivo se puede cambiar sin volver a pedirlo.
// Lo instala instalar-guardar-contacto.sh.
(function ({ first, last, phone }) {
  const key = (s) => String(s || '').replace(/\D/g, '').slice(-8);
  const C = Application('Contacts');
  const ids = C.people.id();
  const phones = C.people.phones.value();
  const matches = ids.filter((id, i) => (phones[i] || []).some((p) => key(p) === key(phone)));
  for (const id of matches) {
    const person = C.people.byId(id);
    person.firstName = first;
    person.lastName = last;
  }
  if (!matches.length) {
    const person = C.Person({ firstName: first, lastName: last });
    C.people.push(person);
    person.phones.push(C.Phone({ label: 'mobile', value: phone }));
  }
  C.save();
  return { actualizados: matches.length, creado: !matches.length };
})
