# Plantilla Carta 2 — DECISIÓN FINAL del procedimiento disciplinario (post-descargo)

> Validada por Legal · v3 · formato real de Poderosa (ref.: "Decisión final - JULIAN SALIRROSAS").
> Se emite **DESPUÉS** de recibir y evaluar el descargo del trabajador (o de vencido el plazo sin descargo).
> A diferencia de la Carta 1 (imputación), aquí los hechos se **AFIRMAN/CONFIRMAN** — NO se usa el condicional ("habría").

---

## Estructura oficial (en este orden)

1. **Encabezado**: "Pataz, {fecha}" · "CARTA N°{NNN}- RRHH / {año}" · destinatario ("Señor:", NOMBRE EN MAYÚSCULAS, cargo).
2. **REFERENCIA**: línea en mayúsculas, p.ej. "DECISIÓN FINAL A LAS INVESTIGACIONES SOBRE EL INCUMPLIMIENTO DE OBLIGACIONES DE TRABAJO".
3. **De nuestra consideración:** (`encabezado`).
4. **Recap** (`introduccion`): "Como es de vuestro pleno conocimiento, COMPAÑIA MINERA PODEROSA S.A. … tomó conocimiento con fecha … mediante {informe} … de una presunta irregularidad … Mediante carta de imputación de fecha {fecha carta 1} se le solicitó presentar sus descargos; {presentó sus descargos el {fecha} / pese al plazo otorgado, no presentó descargo alguno}."
5. **HECHOS COMPROBADOS** (`hechosComprobados`): los hechos **afirmados** — "se identificó que usted…", "se verificó que…", "se constató…", "se acreditó…". Tiempo, lugar y modo. NADA en condicional.
6. **ANÁLISIS DE LOS HECHOS EXPUESTOS** (`analisisDescargo`):
   - Si **hay descargo**: resume los argumentos del trabajador y los evalúa **uno a uno**. Los que tengan mérito probatorio se **aceptan** (y pueden atenuar o llevar a archivo); los que no, se **refutan con fundamento** en la base normativa y las pruebas. Concluir si los hechos quedaron desvirtuados (total/parcial) o **acreditados**.
   - Si **no hay descargo** y venció el plazo: "pese al plazo otorgado … no presentó descargo alguno; en consecuencia, los hechos atribuidos en la carta de imputación, al no haber sido desvirtuados, se consideran acreditados y válidamente verificados."
7. **TIPIFICACIÓN DE LAS FALTAS LABORALES** (`tipificacion`): "Los hechos antes descritos constituirían una trasgresión al {RIT / RISST / Código de Ética}; en consecuencia, PODEROSA ha considerado que su conducta se encontraría tipificada en:" seguido de las **citas LITERALES** de los artículos/numerales (Art. 3°, 62°, 63° incisos, 76° inciso, etc.) — **tomadas de la Base normativa de Poderosa provista**. (La tipificación puede usar "se encontraría tipificada", como en el formato real.)
8. **DECISIÓN FINAL** (`decisionFinal`): "En aplicación de los principios de razonabilidad y proporcionalidad, y habiéndose efectuado el análisis de los medios probatorios y antecedentes … la empresa ha decidido {sanción según el tipo}."
9. **Exhortación** (`exhortacion`): exhortar a cumplir en adelante + advertir reincidencia; y "agradeceremos se sirva firmar la copia de la presente en señal de haber tomado conocimiento … incorporada a su legajo personal."
10. **Atentamente,** (`despedida`) + firma.

---

## Variantes (`tipo`) — texto de `decisionFinal`
- `carta2-amonestacion`: "imponerle una medida disciplinaria consistente en una AMONESTACIÓN ESCRITA, la cual quedará registrada en su legajo personal." Firma: Jefatura de RR.HH.
- `carta2-suspension`: "imponerle una medida disciplinaria consistente en una SUSPENSIÓN DE {N en letras} ({N}) DÍA(S) SIN GOCE DE HABER" (indicar fechas si vienen). Firma: Superintendencia/Jefatura según unidad.
- `carta2-despido`: "dar por concluido el vínculo laboral mediante DESPIDO por falta grave …" — citar el sustento de la base normativa; indicar derecho a impugnar en sede judicial en el plazo legal. Firma: Gerencia/Superintendencia.
- `desistimiento` (archivo): "DESISTIRSE del procedimiento disciplinario y ARCHIVAR el caso, no correspondiendo aplicar sanción" (típico cuando el descargo desvirtúa los hechos). Sin agravio.

## Salida — devuelve ÚNICAMENTE este JSON (sin texto fuera)
```json
{
  "asunto": "Decisión final — {tipo legible}",
  "fecha": "Pataz, 20 de mayo de 2026",
  "numeroCarta": "CARTA N°074.1- RRHH / 2026",
  "destinatario": { "tratamiento": "Señor:", "nombre": "JULIAN SALIRROSAS JUAN", "dni": "70 234 567", "puestoUnidad": "Bodeguero — Unidad Santa María" },
  "cuerpo": {
    "referencia": "DECISIÓN FINAL A LAS INVESTIGACIONES SOBRE EL INCUMPLIMIENTO DE OBLIGACIONES DE TRABAJO",
    "encabezado": "De nuestra consideración:",
    "introduccion": "Como es de vuestro pleno conocimiento, …",
    "hechosComprobados": "Con fecha … se identificó que usted … se verificó … se constató …",
    "analisisDescargo": "Que, con fecha … se le hizo entrega de la carta de imputación … {evaluación/refutación del descargo o ausencia de descargo} … se consideran acreditados.",
    "tipificacion": "Los hechos antes descritos constituirían una trasgresión … se encontraría tipificada en: Reglamento Interno de Trabajo: \"Artículo 62°.- …\" …",
    "decisionFinal": "En aplicación de los principios de razonabilidad y proporcionalidad … la empresa ha decidido imponerle …",
    "exhortacion": "Finalmente, le exhortamos a … Asimismo, agradeceremos se sirva firmar la copia de la presente …",
    "despedida": "Atentamente,"
  },
  "firma": { "nombre": "Perci Alvarado Arteaga", "cargo": "Superintendencia de Recursos Humanos", "empresa": "Compañía Minera Poderosa S.A." },
  "copia": ["Legajo personal", "RR.HH.", "Legal"],
  "warnings": [],
  "refused": false,
  "refusedReason": null
}
```

## Reglas
- **Confirmación**: en `hechosComprobados` y el resto, los hechos se afirman; nunca "habría/presuntamente". (`tipificacion` puede usar "se encontraría tipificada".)
- **Sustento exclusivo**: las citas de `tipificacion` provienen SOLO de la "Base normativa de Poderosa" inyectada (documento + artículo literal). Si falta sustento, `warnings[]`.
- **Descargo justo**: evaluar de verdad — si un argumento desvirtúa el hecho, reconocerlo (puede cambiar la sanción o llevar a archivo). No refutar de forma automática.
- **Proporcionalidad**: la sanción de `decisionFinal` debe ser proporcional a la gravedad y antecedentes.
- Despido: verificar que la falta es la misma imputada en la Carta 1 y que no hay nulidad (embarazo/sindicalización/queja).
