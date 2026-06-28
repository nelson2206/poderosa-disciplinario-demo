# Plantilla Carta 1 — IMPUTACIÓN de incumplimiento de obligaciones de trabajo

> Formato oficial real de Poderosa (ref.: "IMPUTACION - BENDEZU OMAR").
> Es la carta de inicio del procedimiento disciplinario (proceso distinto al despido). Los hechos van en **condicional** (aún no probados): "habría", "configurarían", "no habría", "evidenciaría". NUNCA se afirma la culpabilidad.

---

## Estructura oficial (en este orden)

1. **Encabezado**: "Pataz, {fecha}" · destinatario ("Señor:", NOMBRE EN MAYÚSCULAS, cargo, "Presente.-").
2. **REFERENCIA** (`referencia`): "IMPUTACIÓN DE INCUMPLIMIENTO DE OBLIGACIONES DE TRABAJO".
3. **De nuestra consideración:** (`encabezado`).
4. **Introducción** (`introduccion`): "Mediante la presente carta, que le será notificada, y en atención al artículo 9° del Texto Único Ordenado del Decreto Legislativo N.° 728, Ley de Productividad y Competitividad Laboral (LPCL), COMPAÑÍA MINERA PODEROSA S.A. (en adelante, "PODEROSA" o "la empresa"), identificada con RUC N.° 20137025354 y con domicilio en la calle Coronel Gómez N.° 409, Urb. El Molino – Trujillo, Región La Libertad, cumple con hacer de su conocimiento que, en su condición de trabajador de PODEROSA, se ha advertido la presunta comisión de hechos que configurarían un incumplimiento de sus obligaciones de trabajo, motivo por el cual se da inicio al presente proceso disciplinario distinto al despido, conforme se detalla a continuación:".
5. **HECHOS DETECTADOS / IMPUTADOS** (`hechosDetectados`): narrativa detallada en **condicional**. Tiempo, lugar, modo, quién lo reportó (informe N°, fecha, área). Describe la conducta presunta y por qué configuraría incumplimiento. Varios párrafos.
6. **TIPIFICACIÓN DE LAS FALTAS / NORMATIVA PRESUNTAMENTE VULNERADA** (`tipificacion`): "Los hechos anteriormente descritos involucrarían la comisión de faltas laborales conforme a nuestro Reglamento Interno de Trabajo (RIT) … en consecuencia, corresponde considerar las siguientes disposiciones:" seguido de **citas LITERALES** de los artículos. **PRIORIZA EL RIT**: cita el mayor número posible de artículos del **RIT** que apliquen (típicamente Art. 3°, 62°, 63°, 67°, 69°, 70°, 72°, 74°, 75°), y solo luego, si aplica, RISST/RISSO y Código de Ética. Todas las citas deben provenir de la "Base normativa de Poderosa" provista.
7. **MEDIOS PROBATORIOS QUE SUSTENTAN LOS HECHOS DESCRITOS** (`mediosProbatorios`): array de strings (cada ítem = un medio: "Informe N.° 001 …, de fecha DD.MM.AAAA", capturas, registros, etc.).
8. **CONCLUSIÓN PRELIMINAR** (`conclusionPreliminar`): "En ese sentido, usted habría incumplido sus obligaciones laborales … evidenciaría una falta … configurándose un apartamiento de los deberes laborales asumidos …". En condicional.
9. **PLAZO PARA PRESENTAR DESCARGOS** (`plazoDescargos`): "Por lo expuesto, haciendo uso del poder de dirección … y en pleno respeto de su derecho de defensa, se le otorga un plazo de tres (03) días naturales, contados desde el día siguiente de recibida la presente comunicación, para presentar por escrito los descargos que estime pertinentes respecto de los hechos imputados, acompañando los medios probatorios que considere convenientes. Asimismo, se le precisa que los descargos podrán ser presentados de manera presencial o remitidos a través del correo electrónico de su jefatura inmediata … Vencido el plazo sin que haya presentado descargo alguno, la empresa procederá conforme a las disposiciones internas aplicables … Agradecemos firmar la copia de la presente en señal de haber tomado conocimiento …".
10. **Atentamente,** (`despedida`) + firma.

## Salida — devuelve ÚNICAMENTE este JSON (sin texto fuera)
```json
{
  "asunto": "Imputación de incumplimiento de obligaciones de trabajo",
  "fecha": "Pataz, 25 de junio de 2026",
  "numeroCarta": "CARTA N°XXX- RRHH / 2026",
  "destinatario": { "tratamiento": "Señor:", "nombre": "BENDEZU GUTARRA OMAR", "dni": "70 234 567", "puestoUnidad": "Ingeniero de Cierre de Minas — Unidad Marañón" },
  "cuerpo": {
    "referencia": "IMPUTACIÓN DE INCUMPLIMIENTO DE OBLIGACIONES DE TRABAJO",
    "encabezado": "De nuestra consideración:",
    "introduccion": "Mediante la presente carta, que le será notificada, y en atención al artículo 9° del Texto Único Ordenado del Decreto Legislativo N.° 728 …",
    "hechosDetectados": "Con fecha … mediante el Informe N.° … el área de Recursos Humanos tomó conocimiento de presuntos hechos … usted no habría … configurándose un presunto incumplimiento.",
    "tipificacion": "Los hechos anteriormente descritos involucrarían … conforme al RIT: \"Artículo 62°.- …\" \"Artículo 63°.- … w) …\" \"Artículo 70°.- …\" … Reglamento Interno de Seguridad y Salud Ocupacional: \"Numeral 8.- …\" Código de Ética y Conducta: \"…\"",
    "mediosProbatorios": ["Informe N.° 001 – Solicitud de Evaluación de Medida Disciplinaria, de fecha 21.06.2026."],
    "conclusionPreliminar": "En ese sentido, usted habría incumplido sus obligaciones laborales … evidenciaría una falta de diligencia …",
    "plazoDescargos": "Por lo expuesto … se le otorga un plazo de tres (03) días naturales … para presentar por escrito los descargos … Agradecemos firmar la copia de la presente …",
    "despedida": "Atentamente,"
  },
  "firma": { "nombre": "BENITES REBAZA DANTE ALEX", "cargo": "Superintendente de Recursos Humanos", "empresa": "Compañía Minera Poderosa S.A." },
  "anexos": [],
  "warnings": [],
  "refused": false,
  "refusedReason": null
}
```

## Reglas
- **Condicional siempre** (es imputación, no decisión): "habría", "configurarían", "no habría", "evidenciaría". Nunca afirmar culpabilidad.
- **Sustento exclusivo + RIT primero**: las citas de `tipificacion` provienen SOLO de la "Base normativa de Poderosa" inyectada; prioriza el **RIT** (la mayoría de citas deben ser artículos del RIT). Si falta sustento, `warnings[]`.
- **Plazo**: tres (03) días naturales por defecto (práctica de Poderosa + precedente TFL 568-2021). Solo 6 días si es preaviso de despido (Art. 31 D.L. 728).
- `mediosProbatorios` lista al menos el informe de origen.
