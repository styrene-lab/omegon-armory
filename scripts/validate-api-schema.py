#!/usr/bin/env python3
"""Validate generated Armory API JSON against the public schema.

This intentionally implements the subset of JSON Schema used by
schemas/armory-index.schema.json so CI does not need an additional dependency.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


def load(path: Path) -> Any:
    return json.loads(path.read_text())


def resolve_ref(schema: dict[str, Any], ref: str) -> dict[str, Any]:
    if not ref.startswith("#/"):
        raise ValueError(f"unsupported ref: {ref}")
    node: Any = schema
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def validate(instance: Any, rule: dict[str, Any], root: dict[str, Any], path: str = "$") -> list[str]:
    errors: list[str] = []
    if "$ref" in rule:
        return validate(instance, resolve_ref(root, rule["$ref"]), root, path)

    if "enum" in rule and instance not in rule["enum"]:
        errors.append(f"{path}: {instance!r} not in enum {rule['enum']!r}")

    expected_type = rule.get("type")
    if expected_type:
        type_ok = {
            "object": isinstance(instance, dict),
            "array": isinstance(instance, list),
            "string": isinstance(instance, str),
            "integer": isinstance(instance, int) and not isinstance(instance, bool),
            "boolean": isinstance(instance, bool),
        }.get(expected_type, True)
        if not type_ok:
            errors.append(f"{path}: expected {expected_type}, got {type(instance).__name__}")
            return errors

    if isinstance(instance, int) and not isinstance(instance, bool):
        if "minimum" in rule and instance < rule["minimum"]:
            errors.append(f"{path}: {instance} < minimum {rule['minimum']}")
        if "maximum" in rule and instance > rule["maximum"]:
            errors.append(f"{path}: {instance} > maximum {rule['maximum']}")

    if isinstance(instance, str) and "pattern" in rule:
        if not re.fullmatch(rule["pattern"], instance):
            errors.append(f"{path}: {instance!r} does not match {rule['pattern']!r}")

    if isinstance(instance, dict):
        for key in rule.get("required", []):
            if key not in instance:
                errors.append(f"{path}: missing required property {key!r}")
        properties = rule.get("properties", {})
        for key, value in instance.items():
            if key in properties:
                errors.extend(validate(value, properties[key], root, f"{path}.{key}"))
            elif isinstance(rule.get("additionalProperties"), dict):
                errors.extend(validate(value, rule["additionalProperties"], root, f"{path}.{key}"))
            elif rule.get("additionalProperties") is False:
                errors.append(f"{path}: unexpected property {key!r}")

    if isinstance(instance, list) and "items" in rule:
        for index, value in enumerate(instance):
            errors.extend(validate(value, rule["items"], root, f"{path}[{index}]"))

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("api_json", nargs="?", default="site/public/api/index.json")
    parser.add_argument("schema", nargs="?", default="schemas/armory-index.schema.json")
    args = parser.parse_args()

    payload = load(Path(args.api_json))
    schema = load(Path(args.schema))
    errors = validate(payload, schema, schema)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(f"Validated {len(payload.get('items', []))} Armory API item(s) against {args.schema}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
