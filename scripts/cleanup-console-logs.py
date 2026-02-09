#!/usr/bin/env python3
"""
Remove debug console.log statements from JavaScript files
Converts console.error to logger.error
"""

import re
import sys

def cleanup_console_logs(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    output = []
    skip_next = False

    for i, line in enumerate(lines):
        # Skip lines that are pure debug console.log (with brackets like [POST /assignments])
        if re.search(r'^\s*console\.log\(`?\[', line):
            continue

        # Skip lines that log "SUCCESS", "ERROR", "DEBUG" patterns
        if re.search(r'console\.log\(.*?(SUCCESS|ERROR|DEBUG|START|END):', line):
            continue

        # Convert console.error to logger.error (but keep the line)
        if 'console.error' in line and 'logger.error' not in line:
            # Extract the message and error variable
            match = re.search(r'console\.error\(["\']([^"\']+)["\'],\s*(\w+)\)', line)
            if match:
                msg = match.group(1).rstrip(':')
                err_var = match.group(2)
                indent = re.match(r'^\s*', line).group(0)
                new_line = f'{indent}logger.error("{msg}", {{ error: {err_var}.message, stack: {err_var}.stack }});\n'
                output.append(new_line)
                continue

        output.append(line)

    # Write back
    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(output)

    removed = len(lines) - len(output)
    print(f"Processed {filepath}: Removed {removed} console.log lines, {len(output)} lines remaining")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: cleanup-console-logs.py <filepath>")
        sys.exit(1)

    cleanup_console_logs(sys.argv[1])
