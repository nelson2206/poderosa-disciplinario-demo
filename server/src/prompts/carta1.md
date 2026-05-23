# Plantilla Carta 1 — Imputación de incumplimiento de obligaciones

> Plantilla oficial de Compañía Minera Poderosa S.A. (formato observado en CARTA N°073 / N°074 RRHH 2026).
> Usada cuando se imputa una presunta falta al trabajador antes de evaluar su descargo.

---

## Estructura exacta a respetar

```
[línea en blanco]
Pataz, {fecha en formato "07 de mayo del 2026"}
CARTA N°{numeroCorrelativo}- RRHH / {año}

Señor,
{APELLIDOS NOMBRE EN MAYÚSCULAS}
{cargo}

Asunto: Imputación de incumplimiento de obligaciones

COMPAÑIA MINERA PODEROSA S.A., identificada con RUC Nº 20137025354 y con domicilio para estos efectos en la calle Coronel Gómez Nº 409, Urb. El Molino – Trujillo, Región La Libertad, debidamente representada por su Superintendente de Recursos Humanos, Sr. BENITES REBAZA DANTE ALEX, identificado con DNI Nº 45042266, cumple con hacer de conocimiento que, en su condición de trabajador de PODEROSA, se ha advertido lo siguiente:

{párrafoToma_conocimiento — fecha en que se recibió el informe, número del informe, área que lo elaboró, fecha del hecho, lugar/unidad, breve mención del tipo de irregularidad}

{párrafoHechosAtribuidos — describe lo que el trabajador habría hecho, siempre en condicional: "habría intervenido", "habría consignado", "se habría identificado". Concreto: vales, fechas, cantidades, lugar.}

{párrafoDeteccion — cómo se detectó la situación, contexto adicional, evidencia preservada}

{párrafoObligacionInfringida — cita el PETS específico (código + numeral) o el procedimiento concreto que el trabajador debe conocer y aplicar como parte de sus funciones}

A continuación, {se adjuntan / adjuntan} {los vales / las imágenes / las capturas} observad{os/as}, en los cuales se evidenciaría una inconsistencia en los registros entre {detalle}:

{espacio para imágenes / tabla de vales — el modelo NO inserta imágenes, solo deja el espacio mencionado en el texto}

Los hechos antes descritos constituirían una trasgresión al Reglamento Interno de Trabajo y al Código de Ética y Conducta, en consecuencia, PODEROSA ha considerado que su conducta se encontraría tipificada en:

Reglamento Interno de Trabajo:

"Artículo 3°. - Para efectos de su exigencia y cumplimiento, así como del pleno conocimiento de sus derechos y obligaciones, a cada colaborador se le hará entrega de un ejemplar del RIT (…) comprometiéndose a respetar y cumplir las normas establecidas en este, así como las disposiciones verbales y escritas que de ellas se deriven."

"Artículo 62°.- Son obligaciones de los colaboradores de PODEROSA, cumplir con las siguientes normas:
3. Cumplir y observar fielmente las normas, directivas, procedimientos Código de Ética y Conducta vigente en la empresa."

"Artículo 63°.- Queda expresamente prohibido a los colaboradores, sujeto a las sanciones previstas en las disposiciones legales y reglamentarias, las siguientes acciones:
w) Incumplir las normas de carácter legal o internas de PODEROSA que imponen a los colaboradores determinadas conductas y obligaciones, incluyendo los contenidos en este reglamento."

"Artículo 76°.- Será motivo de suspensión por un mínimo de un (1) día y un máximo de seis (6) días, la reiterada comisión de faltas que determinen amonestación; o en su defecto y de acuerdo a la gravedad de la falta, se recurrirá a la suspensión sin necesidad de reiteración. Se deja constancia que esta relación solo tiene carácter enunciativo y no limitativo. Las faltas que darán lugar a suspensiones son, entre otras:
{inciso aplicable según el caso, p. ej. "v) Proporcionar información inexacta o falsa por cuyos efectos pueda ocasionar perjuicio a la empresa."}"

Código de Ética y Conducta – Cumplimiento organizacional:

"Actuamos de acuerdo con los valores y principios de Poderosa, así como con nuestras responsabilidades profesionales, prestando especial atención a lo establecido en el presente Código y en la normativa externa e interna aplicable."

"6.2. Colaboradores: Cumplimiento organizacional Actuamos de acuerdo con los valores y principios de Poderosa, así como con nuestras responsabilidades profesionales, prestando especial atención a lo establecido en el presente Código y en la normativa externa e interna aplicable."

En ese sentido, se le imputa que usted habría incumplido sus obligaciones laborales, así como las disposiciones internas antes señaladas, al haber {síntesis del hecho atribuido}, lo cual constituiría un incumplimiento del procedimiento interno aplicable.

{párrafoCierreImputacion — la conducta no se condice con los estándares; configura apartamiento de los deberes laborales}

Por lo expuesto, y de conformidad con la normativa interna vigente, usted cuenta con un plazo de tres (03) días naturales para presentar sus descargos respecto a los hechos imputados; caso contrario, se procederá con la resolución del caso correspondiente.

Atentamente,

Anexos:

Anexo 1: {Informe que originó la carta, p.ej. "Informe Log-Mina N.° 03, de fecha 03.05.2026"}
{Anexo N: anexos adicionales si los hay}
```

## Reglas obligatorias para el modelo

1. **Encabezado siempre "Pataz"**, no "Trujillo" (Trujillo es el domicilio legal, no el lugar de emisión).
2. **CARTA N°** debe seguir el formato exacto `CARTA N°NNN- RRHH / YYYY` (con espacio antes del año).
3. **Nombre del trabajador en MAYÚSCULAS**, formato `APELLIDOS NOMBRE`.
4. **Asunto literal**: "Imputación de incumplimiento de obligaciones" (no variar).
5. **Apertura formal completa** — la primera frase con RUC, domicilio, representante y DNI debe ir tal cual, EXCEPTO si el caso indica otra persona representando a la empresa (poco frecuente).
6. **Condicional siempre**: "habría", "evidenciaría", "se habría identificado", "constituiría". Nunca afirmar la culpabilidad.
7. **PETS específico**: si el input lo trae, citar código + numeral. Si no lo trae, dejar `«FALTA: código del PETS y numeral»` y advertir en `warnings[]`.
8. **Cita literal del RIT**: artículos 3°, 62°, 63°w y 76°. El inciso del 76° depende del tipo de falta:
   - Información inexacta / falsa → inc. v) "Proporcionar información inexacta o falsa por cuyos efectos pueda ocasionar perjuicio a la empresa."
   - Otros casos → buscar inciso correspondiente; si no se sabe, citar inc. w) genérico y advertir.
9. **Plazo siempre 3 (tres) días naturales** salvo que el caso indique otra cosa motivada.
10. **Cierre**: "Atentamente," sin firma específica (la firma viene en un sello aparte, no en el cuerpo de la carta).
11. **Anexos numerados**: "Anexo 1: ..." con título completo del documento y fecha en formato `DD.MM.YYYY`.

## Reglas de hidratación al JSON

El modelo debe devolver el JSON con este mapeo de campos:

- `asunto`: SIEMPRE "Imputación de incumplimiento de obligaciones"
- `fecha`: "Pataz, 07 de mayo del 2026" (incluye ciudad)
- `numeroCarta`: "CARTA N°073- RRHH / 2026"
- `destinatario.tratamiento`: "Señor," / "Señora,"
- `destinatario.nombre`: "CHIROQUE CORDOVA FRANCISCO JAVIER" (mayúsculas)
- `destinatario.dni`: opcional (las cartas reales no siempre lo muestran)
- `destinatario.puestoUnidad`: "Auxiliar de Almacén" (solo el cargo)
- `cuerpo.encabezado`: "" (en este formato no hay "De nuestra consideración:")
- `cuerpo.introduccion`: el párrafo de apertura formal con datos de la empresa
- `cuerpo.hechosImputados`: 3-4 párrafos consecutivos describiendo los hechos, detección, obligación infringida (citar PETS), y referencia a los anexos. Separados por `\n\n`.
- `cuerpo.normaAplicable`: el bloque completo con citas literales del RIT y Código de Ética. Separar artículos con `\n\n`.
- `cuerpo.derechoDefensa`: "Por lo expuesto, y de conformidad con la normativa interna vigente, usted cuenta con un plazo de tres (03) días naturales para presentar sus descargos respecto a los hechos imputados; caso contrario, se procederá con la resolución del caso correspondiente."
- `cuerpo.canalDescargo`: "" (no se especifica canal en estas cartas; el cierre genérico lo cubre)
- `cuerpo.cierreNoSancion`: "" (el formato no incluye esta cláusula)
- `cuerpo.despedida`: "Atentamente,"
- `firma.nombre`: "" (en este formato no se firma con nombre en el cuerpo)
- `firma.cargo`: ""
- `firma.empresa`: "Compañía Minera Poderosa S.A."
- `anexos`: array de strings tipo `["Anexo 1: Informe Log-Mina N.° 03, de fecha 03.05.2026"]`
