#!/usr/bin/env python3
"""
Generate ROADMAP.md from the PMO database.

Usage:
    python scripts/generate-roadmap.py > ROADMAP.md

Or to update in place:
    python scripts/generate-roadmap.py --output ROADMAP.md
"""

import sqlite3
import argparse
import os
import sys

def find_workspace_db():
    """Find workspace.db by walking up from script location."""
    # Start from repo root (parent of scripts/)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)

    # Check common locations
    candidates = [
        os.path.join(repo_root, '..', '..', '.proletariat', 'workspace.db'),  # HQ level
        os.path.join(repo_root, '.proletariat', 'workspace.db'),  # Repo level
        os.path.expanduser('~/.proletariat/workspace.db'),  # Home level
    ]

    for path in candidates:
        normalized = os.path.normpath(path)
        if os.path.exists(normalized):
            return normalized

    # Walk up from repo root looking for .proletariat
    current = repo_root
    while current != '/':
        db_path = os.path.join(current, '.proletariat', 'workspace.db')
        if os.path.exists(db_path):
            return db_path
        current = os.path.dirname(current)

    return None


def priority_to_p(priority):
    """Normalize priority to P0-P3 format."""
    if not priority:
        return 'P2'
    p = priority.upper()
    if p in ['P0', 'P1', 'P2', 'P3']:
        return p
    if p == 'URGENT':
        return 'P0'
    if p == 'HIGH':
        return 'P1'
    if p == 'MEDIUM':
        return 'P2'
    if p == 'LOW':
        return 'P3'
    return 'P2'


def clean_description(desc, max_length=200):
    """Clean and truncate description for table display."""
    if not desc:
        return ''
    # Escape pipes and remove newlines
    desc = desc.replace('|', '-').replace('\n', ' ').replace('\r', '')
    # Truncate
    if len(desc) > max_length:
        desc = desc[:max_length - 3] + '...'
    return desc


def generate_roadmap(db_path, output_file=None):
    """Generate ROADMAP.md content from database."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Get projects ordered by ID
    cur.execute("SELECT id, name FROM pmo_projects ORDER BY id")
    projects = cur.fetchall()

    lines = []
    lines.append("# PRLT Roadmap")
    lines.append("")
    lines.append("Generated from PMO database. Source of truth: `workspace.db`")
    lines.append("")
    lines.append("---")
    lines.append("")

    for proj in projects:
        project_id = proj['id']
        project_name = proj['name']

        # Get tickets for this project
        # Order: status category (started first), then priority, then ticket ID
        cur.execute("""
            SELECT
                t.id,
                t.title,
                COALESCE(s.category, 'backlog') as status,
                COALESCE(t.priority, 'P2') as priority,
                COALESCE(t.category, 'feature') as type,
                COALESCE(t.description, '') as description
            FROM pmo_tickets t
            LEFT JOIN pmo_statuses s ON t.status_id = s.id
            WHERE t.project_id = ?
            ORDER BY
                CASE s.category
                    WHEN 'started' THEN 1
                    WHEN 'unstarted' THEN 2
                    WHEN 'backlog' THEN 3
                    WHEN 'completed' THEN 4
                    WHEN 'canceled' THEN 5
                    ELSE 6
                END,
                CASE
                    WHEN t.priority IN ('P0', 'URGENT') THEN 0
                    WHEN t.priority IN ('P1', 'HIGH') THEN 1
                    WHEN t.priority IN ('P2', 'MEDIUM') THEN 2
                    WHEN t.priority IN ('P3', 'LOW') THEN 3
                    ELSE 2
                END,
                t.id
        """, (project_id,))
        tickets = cur.fetchall()

        if not tickets:
            continue

        # Strip leading number prefix from project name (e.g., "1. MVP Launch" -> "MVP Launch")
        display_name = project_name
        if display_name and display_name[0].isdigit() and '. ' in display_name:
            display_name = display_name.split('. ', 1)[1]

        lines.append(f"## {display_name}")
        lines.append("")
        lines.append("| Ticket | Title | Status | Pri | Type | Description |")
        lines.append("|--------|-------|--------|-----|------|-------------|")

        for t in tickets:
            tid = t['id']
            title = t['title'].replace('|', '-') if t['title'] else ''
            status = t['status']
            priority = priority_to_p(t['priority'])
            ttype = t['type'] or 'feature'
            desc = clean_description(t['description'])

            lines.append(f"| {tid} | {title} | {status} | {priority} | {ttype} | {desc} |")

        lines.append("")

    conn.close()

    content = '\n'.join(lines)

    if output_file:
        with open(output_file, 'w') as f:
            f.write(content)
        print(f"Wrote {output_file}", file=sys.stderr)
    else:
        print(content)


def main():
    parser = argparse.ArgumentParser(description='Generate ROADMAP.md from PMO database')
    parser.add_argument('--db', help='Path to workspace.db (auto-detected if not specified)')
    parser.add_argument('--output', '-o', help='Output file path (stdout if not specified)')
    args = parser.parse_args()

    db_path = args.db or find_workspace_db()
    if not db_path:
        print("Error: Could not find workspace.db", file=sys.stderr)
        print("Specify path with --db or run from within a prlt workspace", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    generate_roadmap(db_path, args.output)


if __name__ == '__main__':
    main()
