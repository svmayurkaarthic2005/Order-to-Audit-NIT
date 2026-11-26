"""Regenerate the Mermaid block in docs/er-diagram.md from backend/prisma/schema.prisma.

    python docs/gen-er-diagram.py

Only the ```mermaid block is rewritten; the prose around it is kept, so the
diagram can never drift from the schema again.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
schema = (ROOT / "backend/prisma/schema.prisma").read_text(encoding="utf-8")
doc_path = ROOT / "docs/er-diagram.md"

blocks = dict(re.findall(r"^model (\w+) \{(.*?)^\}", schema, re.S | re.M))
enums = set(re.findall(r"^enum (\w+)", schema, re.M))
SCALARS = {"String": "string", "Int": "int", "BigInt": "bigint", "Float": "float", "Decimal": "decimal",
           "Boolean": "bool", "DateTime": "datetime", "Json": "json", "Bytes": "bytes"}


def entity(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).upper()


attrs, rels = [], []
for model, body in blocks.items():
    unique_fields = set()
    for m in re.finditer(r"@@unique\(\[([^\]]+)\]", body):
        cols = [c.strip() for c in m.group(1).split(",")]
        if len(cols) == 1:
            unique_fields.add(cols[0])
    fields = []
    for line in body.splitlines():
        line = line.split("//")[0].strip()
        if not line or line.startswith("@@"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        name, ftype = parts[0], parts[1]
        base = ftype.rstrip("?[]")
        rest = " ".join(parts[2:])
        if base in blocks:
            fk = re.search(r"fields:\s*\[([^\]]+)\]", rest)
            if fk:  # this model holds the foreign key
                fk_cols = [c.strip() for c in fk.group(1).split(",")]
                optional = ftype.endswith("?")
                one_to_one = all(c in unique_fields or re.search(rf"^\s*{c}\s+\S+.*@unique", body, re.M) for c in fk_cols)
                left = "|o" if optional else "||"
                right = "o|" if one_to_one else "o{"
                rels.append(f'    {entity(base)} {left}--{right} {entity(model)} : "{name}"')
            continue
        mtype = SCALARS.get(base, base if base in enums else "string")
        keys = []
        if "@id" in rest:
            keys.append("PK")
        if name.endswith("Id") and name != "id" and any(
            re.search(rf"fields:\s*\[[^\]]*\b{name}\b", l) for l in body.splitlines()
        ):
            keys.append("FK")
        if "@unique" in rest or name in unique_fields:
            keys.append("UK")
        fields.append(f"        {mtype}{'[]' if ftype.endswith('[]') else ''} {name}{' ' + ','.join(keys) if keys else ''}".replace("[]", "_list"))
    attrs.append(f"    {entity(model)} {{\n" + "\n".join(fields) + "\n    }")

mermaid = "```mermaid\nerDiagram\n" + "\n".join(sorted(set(rels))) + "\n\n" + "\n\n".join(attrs) + "\n```"
doc = doc_path.read_text(encoding="utf-8")
doc = re.sub(r"```mermaid\n.*?\n```", lambda _: mermaid, doc, count=1, flags=re.S)
doc_path.write_text(doc, encoding="utf-8", newline="\n")
print(f"{len(blocks)} tables, {len(rels)} relationships written to {doc_path.relative_to(ROOT)}")
