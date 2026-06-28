#!/usr/bin/env python3
"""Convierte el organigrama (xlsx de Jefes/Gerentes/Correos) a un JSON normalizado.

Uso:
    python scripts/organigrama-to-json.py "<ruta_al_xlsx>" [salida.json]

Salida por defecto: server/data/organigrama.json (gitignored — contiene correos reales).
Requiere: openpyxl  (pip install openpyxl)
"""
import openpyxl, json, unicodedata, re, os, sys

DEFAULT_OUT = os.path.join(os.path.dirname(__file__), "..", "data", "organigrama.json")


def norm(s: str) -> str:
    if not s:
        return ""
    s = str(s).strip().lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s)


def email(v):
    if not v:
        return None
    v = str(v).strip()
    return v if "@" in v else None


def clean(v) -> str:
    if v is None:
        return ""
    v = str(v).strip()
    return "" if v in ("–", "—", "-", "�") else v


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    os.makedirs(os.path.dirname(out), exist_ok=True)

    wb = openpyxl.load_workbook(src, data_only=True)
    ws = wb["Organigrama"]
    rows = list(ws.iter_rows(values_only=True))

    recs = []
    for r in rows[1:]:
        nombre = clean(r[1])
        if not nombre:
            continue
        recs.append({
            "n": clean(r[0]),
            "nombre": nombre,
            "nombreNorm": norm(nombre),
            "puesto": clean(r[2]),
            "gerencia": clean(r[3]),
            "area": clean(r[4]),
            "supervisor": clean(r[5]),
            "jefe": clean(r[7]) or clean(r[5]),
            "gerente": clean(r[9]),
            "correoEmpleado": email(r[14]),
            "correoJefe": email(r[15]),
            "correoGerente": email(r[16]),
        })

    with open(out, "w", encoding="utf-8") as f:
        json.dump(recs, f, ensure_ascii=False, indent=0)

    con = sum(1 for x in recs if x["correoJefe"])
    print(f"OK · {len(recs)} empleados · {con} con correo de jefe · -> {out}")


if __name__ == "__main__":
    main()
