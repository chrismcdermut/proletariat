/**
 * Dashboard HTML Template
 *
 * Returns a complete self-contained HTML page for the web dashboard.
 * Dark theme, responsive layout with kanban board, agents, sessions, and PRs.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function getDashboardHTML(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>prlt dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --green: #3fb950;
      --red: #f85149;
      --yellow: #d29922;
      --orange: #db6d28;
      --purple: #bc8cff;
      --pink: #f778ba;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
    }

    /* Header */
    .header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header h1 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
    }

    .header h1 span {
      color: var(--accent);
    }

    .project-name {
      font-size: 13px;
      color: var(--text-muted);
      padding: 2px 8px;
      background: var(--bg-tertiary);
      border-radius: 4px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }

    .status-dot.connected { background: var(--green); }
    .status-dot.disconnected { background: var(--red); }

    /* Main layout */
    .main {
      padding: 24px;
      max-width: 1600px;
      margin: 0 auto;
    }

    .section {
      margin-bottom: 32px;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .section-header .count {
      font-size: 11px;
      background: var(--bg-tertiary);
      color: var(--text-muted);
      padding: 1px 6px;
      border-radius: 10px;
      font-weight: 500;
    }

    /* Kanban Board */
    .kanban {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      padding-bottom: 8px;
    }

    .kanban-column {
      min-width: 240px;
      max-width: 300px;
      flex: 1;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      max-height: 500px;
    }

    .kanban-column-header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }

    .kanban-column-header .ticket-count {
      font-size: 11px;
      color: var(--text-muted);
      background: var(--bg-tertiary);
      padding: 1px 6px;
      border-radius: 10px;
    }

    .kanban-column-body {
      padding: 8px;
      overflow-y: auto;
      flex: 1;
    }

    .ticket-card {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 6px;
      cursor: default;
      transition: border-color 0.15s;
    }

    .ticket-card:hover {
      border-color: var(--accent);
    }

    .ticket-id {
      font-size: 11px;
      font-weight: 600;
      color: var(--accent);
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
    }

    .ticket-title {
      font-size: 13px;
      margin-top: 4px;
      line-height: 1.4;
    }

    .ticket-meta {
      display: flex;
      gap: 6px;
      margin-top: 6px;
      flex-wrap: wrap;
    }

    .badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      font-weight: 500;
    }

    .badge-priority { background: #1f1d2e; }
    .badge-priority.P0 { color: var(--red); border: 1px solid var(--red); }
    .badge-priority.P1 { color: var(--orange); border: 1px solid var(--orange); }
    .badge-priority.P2 { color: var(--yellow); border: 1px solid var(--yellow); }
    .badge-priority.P3 { color: var(--text-muted); border: 1px solid var(--border); }

    .badge-category {
      color: var(--purple);
      border: 1px solid rgba(188, 140, 255, 0.3);
    }

    .badge-assignee {
      color: var(--pink);
      border: 1px solid rgba(247, 120, 186, 0.3);
    }

    .badge-label {
      color: var(--text-muted);
      border: 1px solid var(--border);
    }

    /* Agent Cards */
    .agent-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 12px;
    }

    .agent-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      transition: border-color 0.15s;
    }

    .agent-card:hover {
      border-color: var(--accent);
    }

    .agent-card.active {
      border-left: 3px solid var(--green);
    }

    .agent-card.idle {
      border-left: 3px solid var(--text-muted);
    }

    .agent-name {
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .agent-status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .agent-status-indicator.active { background: var(--green); }
    .agent-status-indicator.idle { background: var(--text-muted); }

    .agent-detail {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 6px;
    }

    .agent-tickets {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .agent-ticket-badge {
      font-size: 10px;
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
      color: var(--accent);
      background: rgba(88, 166, 255, 0.1);
      border: 1px solid rgba(88, 166, 255, 0.2);
      padding: 1px 6px;
      border-radius: 4px;
    }

    /* Sessions Table */
    .table-wrapper {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th {
      text-align: left;
      padding: 10px 14px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
    }

    td {
      padding: 10px 14px;
      font-size: 13px;
      border-bottom: 1px solid var(--border);
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background: var(--bg-tertiary);
    }

    .session-id {
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
      font-size: 12px;
      color: var(--text-muted);
    }

    .status-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 500;
    }

    .status-badge.running { background: rgba(63, 185, 80, 0.15); color: var(--green); }
    .status-badge.starting { background: rgba(210, 153, 34, 0.15); color: var(--yellow); }
    .status-badge.orphan { background: rgba(219, 109, 40, 0.15); color: var(--orange); }

    /* PR List */
    .pr-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .pr-item {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: border-color 0.15s;
    }

    .pr-item:hover {
      border-color: var(--accent);
    }

    .pr-number {
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
      font-size: 13px;
      color: var(--accent);
      font-weight: 600;
      min-width: 50px;
    }

    .pr-title {
      flex: 1;
      font-size: 13px;
    }

    .pr-branch {
      font-size: 11px;
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
      color: var(--text-muted);
      background: var(--bg-tertiary);
      padding: 2px 8px;
      border-radius: 4px;
      max-width: 250px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ci-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 500;
      white-space: nowrap;
    }

    .ci-badge.success { background: rgba(63, 185, 80, 0.15); color: var(--green); }
    .ci-badge.failure { background: rgba(248, 81, 73, 0.15); color: var(--red); }
    .ci-badge.pending { background: rgba(210, 153, 34, 0.15); color: var(--yellow); }
    .ci-badge.unknown { background: var(--bg-tertiary); color: var(--text-muted); }

    .draft-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      background: var(--bg-tertiary);
      color: var(--text-muted);
      border: 1px solid var(--border);
    }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 32px;
      color: var(--text-muted);
      font-size: 13px;
    }

    /* Link styling */
    a {
      color: var(--accent);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1><span>prlt</span> dashboard</h1>
      <span class="project-name" id="project-name">loading...</span>
    </div>
    <div class="header-right">
      <span class="status-dot disconnected" id="status-dot"></span>
      <span id="status-text">Connecting...</span>
      <span id="last-updated"></span>
    </div>
  </div>

  <div class="main">
    <!-- Board Section -->
    <div class="section" id="board-section">
      <div class="section-header">Board <span class="count" id="board-count">0</span></div>
      <div class="kanban" id="kanban"></div>
    </div>

    <!-- Agents Section -->
    <div class="section" id="agents-section">
      <div class="section-header">Agents <span class="count" id="agents-count">0</span></div>
      <div class="agent-grid" id="agents-grid"></div>
    </div>

    <!-- Sessions Section -->
    <div class="section" id="sessions-section">
      <div class="section-header">Sessions <span class="count" id="sessions-count">0</span></div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th>Ticket</th>
              <th>Agent</th>
              <th>Environment</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="sessions-body"></tbody>
        </table>
      </div>
    </div>

    <!-- PRs Section -->
    <div class="section" id="prs-section">
      <div class="section-header">Pull Requests <span class="count" id="prs-count">0</span></div>
      <div class="pr-list" id="pr-list"></div>
    </div>
  </div>

  <script>
    // Escape helper
    function esc(str) {
      if (!str) return '';
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    // Render functions
    function renderBoard(board) {
      const kanban = document.getElementById('kanban');
      const cols = board.columns || [];
      let totalTickets = 0;
      cols.forEach(c => totalTickets += (c.tickets || []).length);
      document.getElementById('board-count').textContent = totalTickets;

      if (cols.length === 0) {
        kanban.innerHTML = '<div class="empty-state">No board data</div>';
        return;
      }

      kanban.innerHTML = cols.map(col => {
        const tickets = col.tickets || [];
        return '<div class="kanban-column">' +
          '<div class="kanban-column-header">' +
            '<span>' + esc(col.name) + '</span>' +
            '<span class="ticket-count">' + tickets.length + '</span>' +
          '</div>' +
          '<div class="kanban-column-body">' +
            (tickets.length === 0 ? '' : tickets.map(t => {
              let meta = '';
              if (t.priority) meta += '<span class="badge badge-priority ' + esc(t.priority) + '">' + esc(t.priority) + '</span>';
              if (t.category) meta += '<span class="badge badge-category">' + esc(t.category) + '</span>';
              if (t.assignee) meta += '<span class="badge badge-assignee">' + esc(t.assignee) + '</span>';
              (t.labels || []).forEach(l => { meta += '<span class="badge badge-label">' + esc(l) + '</span>'; });
              return '<div class="ticket-card">' +
                '<div class="ticket-id">' + esc(t.id) + '</div>' +
                '<div class="ticket-title">' + esc(t.title) + '</div>' +
                (meta ? '<div class="ticket-meta">' + meta + '</div>' : '') +
              '</div>';
            }).join('')) +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderAgents(agents) {
      const grid = document.getElementById('agents-grid');
      document.getElementById('agents-count').textContent = agents.length;

      if (agents.length === 0) {
        grid.innerHTML = '<div class="empty-state">No agents found</div>';
        return;
      }

      grid.innerHTML = agents.map(a => {
        const isActive = a.hasActiveSessions;
        const cls = isActive ? 'active' : 'idle';
        let tickets = '';
        if (a.assignedTickets.length > 0) {
          tickets = '<div class="agent-tickets">' +
            a.assignedTickets.map(t => '<span class="agent-ticket-badge">' + esc(t) + '</span>').join('') +
          '</div>';
        }
        return '<div class="agent-card ' + cls + '">' +
          '<div class="agent-name">' +
            '<span class="agent-status-indicator ' + cls + '"></span>' +
            esc(a.name) +
          '</div>' +
          (a.branch ? '<div class="agent-detail">' + esc(a.branch) + '</div>' : '') +
          tickets +
        '</div>';
      }).join('');
    }

    function renderSessions(sessions) {
      const body = document.getElementById('sessions-body');
      document.getElementById('sessions-count').textContent = sessions.length;

      if (sessions.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="empty-state">No active sessions</td></tr>';
        return;
      }

      body.innerHTML = sessions.map(s => {
        const envIcon = s.environment === 'container' ? '&#x1F433;' : '&#x1F4BB;';
        return '<tr>' +
          '<td class="session-id">' + esc(s.sessionId) + '</td>' +
          '<td>' + esc(s.ticketId) + '</td>' +
          '<td>' + esc(s.agentName) + '</td>' +
          '<td>' + envIcon + ' ' + esc(s.environment) + '</td>' +
          '<td><span class="status-badge ' + esc(s.status) + '">' + esc(s.status) + '</span></td>' +
        '</tr>';
      }).join('');
    }

    function renderPRs(prs) {
      const list = document.getElementById('pr-list');
      document.getElementById('prs-count').textContent = prs.length;

      if (prs.length === 0) {
        list.innerHTML = '<div class="empty-state">No open pull requests</div>';
        return;
      }

      list.innerHTML = prs.map(pr => {
        const ciClass = pr.ciStatus || 'unknown';
        const ciLabel = { success: 'CI passed', failure: 'CI failed', pending: 'CI running', unknown: 'CI unknown' }[ciClass] || 'CI unknown';
        return '<div class="pr-item">' +
          '<span class="pr-number"><a href="' + esc(pr.url) + '" target="_blank">#' + pr.number + '</a></span>' +
          '<span class="pr-title">' + esc(pr.title) + '</span>' +
          (pr.isDraft ? '<span class="draft-badge">draft</span>' : '') +
          '<span class="pr-branch">' + esc(pr.headBranch) + '</span>' +
          '<span class="ci-badge ' + ciClass + '">' + ciLabel + '</span>' +
        '</div>';
      }).join('');
    }

    function renderAll(data) {
      document.getElementById('project-name').textContent = data.projectName || data.projectId;
      const ts = new Date(data.timestamp);
      document.getElementById('last-updated').textContent = 'Updated ' + ts.toLocaleTimeString();
      renderBoard(data.board);
      renderAgents(data.agents);
      renderSessions(data.sessions);
      renderPRs(data.prs);
    }

    // Initial fetch
    fetch('/api/data')
      .then(r => r.json())
      .then(data => renderAll(data))
      .catch(err => console.error('Initial fetch failed:', err));

    // SSE for live updates
    const dot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    function connectSSE() {
      const es = new EventSource('/api/events');

      es.onopen = () => {
        dot.className = 'status-dot connected';
        statusText.textContent = 'Live';
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          renderAll(data);
        } catch (e) {
          console.error('SSE parse error:', e);
        }
      };

      es.onerror = () => {
        dot.className = 'status-dot disconnected';
        statusText.textContent = 'Reconnecting...';
        es.close();
        setTimeout(connectSSE, 3000);
      };
    }

    connectSSE();
  </script>
</body>
</html>`
}
