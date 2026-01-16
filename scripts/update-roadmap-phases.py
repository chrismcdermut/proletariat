#!/usr/bin/env python3
"""
Update ROADMAP-PHASES.md with current status values from the database.

Preserves the manual phase organization but updates ticket statuses
and sorts completed tickets to the bottom of each priority section.

Usage:
    python scripts/update-roadmap-phases.py
"""

import sqlite3
import re
import os
import sys


def find_workspace_db():
    """Find workspace.db by walking up from script location."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)

    candidates = [
        os.path.join(repo_root, '..', '..', '.proletariat', 'workspace.db'),
        os.path.join(repo_root, '.proletariat', 'workspace.db'),
        os.path.expanduser('~/.proletariat/workspace.db'),
    ]

    for path in candidates:
        normalized = os.path.normpath(path)
        if os.path.exists(normalized):
            return normalized

    current = repo_root
    while current != '/':
        db_path = os.path.join(current, '.proletariat', 'workspace.db')
        if os.path.exists(db_path):
            return db_path
        current = os.path.dirname(current)

    return None


def find_workspace_root():
    """Find workspace root by walking up from script location."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)

    candidates = [
        os.path.normpath(os.path.join(repo_root, '..', '..')),
        repo_root,
        os.path.expanduser('~'),
    ]

    for path in candidates:
        if os.path.exists(os.path.join(path, '.proletariat', 'workspace.db')):
            return path

    current = repo_root
    while current != '/':
        if os.path.exists(os.path.join(current, '.proletariat', 'workspace.db')):
            return current
        current = os.path.dirname(current)

    return None


def get_ticket_statuses(db_path):
    """Get current status for all tickets from database."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("""
        SELECT
            t.id,
            t.title,
            COALESCE(s.category, 'backlog') as status
        FROM pmo_tickets t
        LEFT JOIN pmo_statuses s ON t.status_id = s.id
    """)

    tickets = {row['id']: {'title': row['title'], 'status': row['status']} for row in cur.fetchall()}
    conn.close()
    return tickets


def status_sort_key(status):
    """Sort key for status - completed/canceled go last."""
    order = {
        'started': 0,
        'unstarted': 1,
        'backlog': 2,
        'completed': 3,
        'canceled': 4,
    }
    return order.get(status, 2)


def update_roadmap_phases(input_path, output_path, tickets):
    """Update ROADMAP-PHASES.md with current statuses and sort completed to bottom."""
    with open(input_path, 'r') as f:
        content = f.read()

    lines = content.split('\n')
    result = []
    i = 0

    while i < len(lines):
        line = lines[i]

        # Check if this is a table header for tickets
        if line.startswith('| Ticket | Title | Status |'):
            # Found a ticket table, collect all rows
            result.append(line)
            i += 1
            # Add separator line
            if i < len(lines) and lines[i].startswith('|---'):
                result.append(lines[i])
                i += 1

            # Collect ticket rows
            ticket_rows = []
            while i < len(lines) and lines[i].startswith('| TKT-'):
                row = lines[i]
                # Extract ticket ID
                match = re.match(r'\| (TKT-\d+) \|', row)
                if match:
                    ticket_id = match.group(1)
                    if ticket_id in tickets:
                        # Update status in row
                        status = tickets[ticket_id]['status']
                        # Replace the status column (third column)
                        parts = row.split('|')
                        if len(parts) >= 4:
                            parts[3] = f' {status} '
                            row = '|'.join(parts)
                        ticket_rows.append((row, status))
                    else:
                        ticket_rows.append((row, 'backlog'))
                else:
                    ticket_rows.append((row, 'backlog'))
                i += 1

            # Sort ticket rows: non-completed first, then completed
            ticket_rows.sort(key=lambda x: status_sort_key(x[1]))

            # Add sorted rows
            for row, _ in ticket_rows:
                result.append(row)
        else:
            result.append(line)
            i += 1

    # Write output
    with open(output_path, 'w') as f:
        f.write('\n'.join(result))

    print(f"Wrote {output_path}", file=sys.stderr)


def main():
    db_path = find_workspace_db()
    if not db_path:
        print("Error: Could not find workspace.db", file=sys.stderr)
        sys.exit(1)

    workspace_root = find_workspace_root()
    if not workspace_root:
        print("Error: Could not find workspace root", file=sys.stderr)
        sys.exit(1)

    phases_path = os.path.join(workspace_root, 'pmo', 'roadmaps', 'ROADMAP-PHASES.md')
    if not os.path.exists(phases_path):
        print(f"Error: ROADMAP-PHASES.md not found at {phases_path}", file=sys.stderr)
        sys.exit(1)

    tickets = get_ticket_statuses(db_path)
    update_roadmap_phases(phases_path, phases_path, tickets)


if __name__ == '__main__':
    main()
