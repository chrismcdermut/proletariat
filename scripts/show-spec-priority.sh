#!/bin/bash

# Show specs ordered by priority with completion status

DB="../../../.proletariat/workspace.db"

echo ""
echo "📊 Spec Prioritization Dashboard"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"

echo ""
echo "Foundation"
echo "───────────────────────────────────────────────────────────────────────────────"

sqlite3 "$DB" << 'EOF'
.mode column
SELECT
  CASE
    WHEN s.id = 'pmo-schema-refactor' THEN '✅'
    ELSE '❌'
  END as '│',
  '[P0]' as Pri,
  s.id as Spec,
  'DONE' as MoSCoW,
  COUNT(t.id) || '/' || COUNT(t.id) as Tickets,
  '100%' as Progress
FROM pmo_specs s
LEFT JOIN pmo_tickets t ON t.spec_id = s.id
WHERE s.id = 'pmo-schema-refactor'
GROUP BY s.id;
EOF

echo ""
echo "Core CRUD"
echo "───────────────────────────────────────────────────────────────────────────────"

sqlite3 "$DB" << 'EOF'
.mode column
SELECT
  CASE
    WHEN COUNT(t.id) > 0 AND SUM(CASE WHEN c.name IN ('Merged', 'Published') THEN 1 ELSE 0 END) = COUNT(t.id) THEN '✅'
    WHEN SUM(CASE WHEN c.name IN ('Merged', 'Published') THEN 1 ELSE 0 END) > 0 THEN '🟡'
    ELSE '❌'
  END as '│',
  CASE
    WHEN s.id = 'pmo-ticket-commands' THEN '[P1]'
    WHEN s.id = 'pmo-board-commands' THEN '[P2]'
    WHEN s.id = 'pmo-spec-commands' THEN '[P3]'
    WHEN s.id = 'pmo-project-commands' THEN '[P4]'
  END as Pri,
  s.id as Spec,
  CASE
    WHEN s.id IN ('pmo-ticket-commands', 'pmo-board-commands') THEN 'MUST'
    ELSE 'SHOULD'
  END as MoSCoW,
  COALESCE(SUM(CASE WHEN c.name IN ('Merged', 'Published') THEN 1 ELSE 0 END), 0) || '/' || COUNT(t.id) as Tickets,
  CASE
    WHEN COUNT(t.id) > 0
    THEN ROUND(CAST(SUM(CASE WHEN c.name IN ('Merged', 'Published') THEN 1 ELSE 0 END) AS REAL) / COUNT(t.id) * 100) || '%'
    ELSE '0%'
  END as Progress
FROM pmo_specs s
LEFT JOIN pmo_tickets t ON t.spec_id = s.id
LEFT JOIN pmo_board_tickets bt ON bt.ticket_id = t.id
LEFT JOIN pmo_columns c ON c.id = bt.column_id
WHERE s.id IN ('pmo-ticket-commands', 'pmo-board-commands', 'pmo-spec-commands', 'pmo-project-commands')
GROUP BY s.id
ORDER BY
  CASE s.id
    WHEN 'pmo-ticket-commands' THEN 1
    WHEN 'pmo-board-commands' THEN 2
    WHEN 'pmo-spec-commands' THEN 3
    WHEN 'pmo-project-commands' THEN 4
  END;
EOF

echo ""
echo "Views & Filtering"
echo "───────────────────────────────────────────────────────────────────────────────"

sqlite3 "$DB" << 'EOF'
.mode column
SELECT
  '❌' as '│',
  '[P5]' as Pri,
  s.id as Spec,
  'COULD' as MoSCoW,
  COALESCE(COUNT(t.id), 0) || '/' || COALESCE(COUNT(t.id), 0) as Tickets,
  '0%' as Progress
FROM pmo_specs s
LEFT JOIN pmo_tickets t ON t.spec_id = s.id
WHERE s.id = 'pmo-board-views'
GROUP BY s.id;
EOF

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "💡 Recommendations:"
echo ""
echo "   1. FOCUS NOW: pmo-ticket-commands (implement list & view)"
echo "   2. TEST NEXT: pmo-board-commands (verify all features work)"
echo "   3. DEFER: pmo-work-commands, pmo-local-sync (move to future/)"
echo ""
echo "Legend: ✅ Done | 🟡 In Progress | ❌ Not Started"
echo "        MUST=Critical | SHOULD=Important | COULD=Nice-to-have | FUTURE=Later"
echo ""
