#!/usr/bin/env python3
"""Add logger import to route files that don't have it"""

import sys
import re

def add_logger_import(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Check if logger is already imported
    if "import logger from" in content or "import logger" in content:
        print(f"{filepath}: Already has logger import")
        return False

    # Find the last import statement
    lines = content.split('\n')
    last_import_idx = -1

    for i, line in enumerate(lines):
        if line.strip().startswith('import ') or line.strip().startswith('from '):
            last_import_idx = i

    if last_import_idx == -1:
        print(f"{filepath}: No import statements found")
        return False

    # Insert logger import after the last import
    lines.insert(last_import_idx + 1, "import logger from '../utils/logger.js';")

    # Write back
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f"{filepath}: Added logger import after line {last_import_idx + 1}")
    return True

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: add-logger-import.py <filepath>")
        sys.exit(1)

    add_logger_import(sys.argv[1])
