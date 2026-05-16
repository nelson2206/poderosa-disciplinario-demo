# Plantilla Carta 2 — Decisión final (post-descargo)

> Validada por Legal · v2.5 · 14 Mar 2026.
> Esta es la plantilla canónica para la **decisión final** del procedimiento disciplinario.
> Se emite **DESPUÉS** de haber recibido y evaluado el descargo del trabajador (o vencido el plazo sin descargo).

---

## Estructura común a todas las variantes

**Membrete**: Compañía Minera Poderosa S.A. · RUC 20137025354 · Gerencia de RR.HH. — {unidad}

{fecha alineada a la derecha}
Carta N° **{numeroCarta}** (típicamente termina en `/02` siguiendo a la Carta 1)

**{tratamiento}**
**{NOMBRE EN MAYÚSCULAS}**
DNI {dni}
{puestoUnidad}
Presente.—

**Asunto:** Decisión final — {tipoDecisionLegible}

{encabezado}

{introduccionReferenciaCarta1Descargo}

**Decisión.** {decisionLiteral}

**Motivación.** {motivacionDetallada}

**Norma aplicada.** {normaAplicada}

{parrafoAdicionalPorTipo}

{despedida}

___________________________
**{firma.nombre}**
{firma.cargo}
{firma.empresa}

**Copia:** {listaCopias}

---

## Variantes (campo `tipo`)

### 1. `carta2-amonestacion`
- Conservativa, leve.
- `decisionLiteral`: "Amonestación escrita por … con observación al expediente personal."
- `parrafoAdicionalPorTipo`: explicar que la amonestación quedará registrada en el expediente y se considerará para reincidencia.
- Firma: **Jefe/a de RR.HH. de la unidad** (no requiere Superintendente).
- Sin párrafo de impugnación judicial (no es sanción extintiva).

### 2. `carta2-suspension`
- Conservativa, intermedia.
- `decisionLiteral`: "Suspensión sin goce de haberes por **N días** (de **fecha inicio** a **fecha fin**), debiendo reincorporarse a sus labores el **fecha de retorno**."
- `parrafoAdicionalPorTipo`: indicar exactamente fecha de inicio, fin y retorno; advertir que la reincidencia podrá motivar sanción mayor.
- Firma: **Superintendente de la unidad**.
- Mencionar art. del sancionario interno.

### 3. `carta2-despido`
- Extintiva. **Mucho cuidado con la motivación y los plazos.**
- `decisionLiteral`: "Despido por falta grave conforme al Art. 25 inciso {x} del TUO del D.L. N° 728."
- `parrafoAdicionalPorTipo`: Citar Art. 31 D.L. 728 — la decisión es notificada por conducto notarial o con cargo recibido; indicar fecha de cese y derecho del trabajador a impugnar judicialmente en el plazo legal (30 días hábiles para la nulidad de despido, Art. 36 D.L. 728).
- Firma: **Gerencia de RR.HH. o Superintendente** según el RIT.
- **Verificar nulidades del Art. 29**: no debe haber embarazo / sindicalización / queja administrativa como motivo.

### 4. `desistimiento`
- La empresa decide NO sancionar.
- `decisionLiteral`: "Desistimiento del procedimiento disciplinario iniciado el {fecha}; no se aplicará sanción."
- `parrafoAdicionalPorTipo`: aclarar que no constituye antecedente y que el expediente se cierra.
- Firma: **Jefe/a de RR.HH.**.
- Sin párrafo de impugnación (no hay agravio para el trabajador).

## Reglas de hidratación

- `introduccionReferenciaCarta1Descargo` debe mencionar: (a) la Carta 1 (número + fecha de notificación), (b) la fecha de recepción del descargo (o el hecho de no haber presentado descargo dentro del plazo), (c) que se ha realizado evaluación motivada.
- `motivacionDetallada` debe **abordar el descargo**: aceptado, rechazado, o parcialmente aceptado, **con razones**. Sin esto, la carta es vulnerable ante SUNAFIL.
- `normaAplicada` debe incluir: artículo del D.L. 728 + artículo del RIT + número del sancionario interno cuando corresponda.
- Para `despido`: verificar que la falta tipificada es la misma que la imputada en Carta 1. No se puede despedir por hechos distintos.
- Si el `descargo` no se proporciona en el input, **warning** crítico: "No se evaluó descargo — verificar si venció el plazo y agregar referencia explícita al vencimiento."
