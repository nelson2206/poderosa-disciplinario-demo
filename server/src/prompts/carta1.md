# Plantilla Carta 1 — Imputación de falta (v3.2)

> Validada por Legal · Andrés León · 14 Mar 2026
> Esta es la plantilla canónica que tu salida JSON debe poder hidratar.

---

**Membrete**: Compañía Minera Poderosa S.A. · RUC 20137025354 · Gerencia de RR.HH. — {unidad}

{fecha alineada a la derecha}
Carta N° **{numeroCarta}**

**{tratamiento}**
**{NOMBRE EN MAYÚSCULAS}**
DNI {dni}
{puestoUnidad}
Presente.—

**Asunto:** {asunto}

{encabezado}

{introduccion}

**Hechos imputados.** {hechosImputados}

**Norma aplicable.** {normaAplicable}

**Derecho de defensa.** {derechoDefensa}

{canalDescargo} **{cierreNoSancion}**

{despedida}

___________________________
**{firma.nombre}**
{firma.cargo}
{firma.empresa}

**Anexos:** {anexos unidos por " · "}

---

## Reglas de hidratación

- `hechosImputados` debe contener fecha, hora, lugar, conducta y fuente (quién observó). Si el caso de entrada no trae alguno de esos, declara warning y deja placeholder `«FALTA: ...»`.
- `normaAplicable` debe citar al menos un artículo del D.L. 728 o del RIT. Si la falta del input no tiene norma asociada, warning + placeholder.
- `derechoDefensa` debe mencionar el plazo en letras + número y citar Art. 42 D.L. 728.
- `cierreNoSancion` es OBLIGATORIO y literal: dejar claro que la carta no es sanción.
- `firma.cargo` debe corresponder a la unidad del trabajador (Marañón / Santa María / Palca).
