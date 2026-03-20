#!/usr/bin/env python3
"""
Omegon OCI Tool: CSV Analyzer

Contract:
  - Reads JSON from stdin: {"path": "data.csv", "query": "describe"}
  - Writes JSON to stdout: {"result": "...", "error": null}
  - Exit code 0 on success, non-zero on error.

This is the reference implementation for containerized tool plugins.
"""

import json
import sys
from pathlib import Path

def main():
    try:
        # Read JSON input from stdin
        raw = sys.stdin.read()
        if not raw.strip():
            emit_error("no input received on stdin")
            return

        args = json.loads(raw)
        csv_path = args.get("path")
        query = args.get("query", "describe")

        if not csv_path:
            emit_error("'path' is required")
            return

        # Resolve path relative to /work (the mounted cwd)
        full_path = Path("/work") / csv_path
        if not full_path.exists():
            emit_error(f"file not found: {csv_path}")
            return

        if not full_path.suffix.lower() == ".csv":
            emit_error(f"expected .csv file, got: {full_path.suffix}")
            return

        # Import pandas here so startup is fast even on error paths
        import pandas as pd

        df = pd.read_csv(full_path)

        if query == "describe":
            result = df.describe().to_string()
        elif query == "correlate":
            numeric = df.select_dtypes(include="number")
            if numeric.empty:
                result = "No numeric columns found for correlation."
            else:
                result = numeric.corr().to_string()
        elif query.startswith("group_by "):
            col = query[len("group_by "):]
            if col not in df.columns:
                emit_error(f"column '{col}' not found. Available: {list(df.columns)}")
                return
            result = df.groupby(col).describe().to_string()
        elif query == "head":
            result = df.head(20).to_string()
        elif query == "columns":
            result = json.dumps({
                "columns": list(df.columns),
                "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
                "shape": list(df.shape),
            })
        else:
            # Treat as a pandas query expression
            try:
                filtered = df.query(query)
                result = filtered.to_string()
            except Exception as e:
                emit_error(f"invalid query '{query}': {e}")
                return

        emit_result(result)

    except json.JSONDecodeError as e:
        emit_error(f"invalid JSON input: {e}")
    except Exception as e:
        emit_error(f"unexpected error: {e}")


def emit_result(result: str):
    """Write a success result to stdout."""
    json.dump({"result": result, "error": None}, sys.stdout)
    sys.stdout.write("\n")


def emit_error(message: str):
    """Write an error result to stdout and exit with code 1."""
    json.dump({"result": None, "error": message}, sys.stdout)
    sys.stdout.write("\n")
    sys.exit(1)


if __name__ == "__main__":
    main()
