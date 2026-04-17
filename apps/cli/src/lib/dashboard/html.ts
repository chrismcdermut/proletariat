/**
 * Dashboard HTML Template
 *
 * Returns a complete self-contained HTML page for the web dashboard.
 * Styled to match the proletariat marketing site — Switzer font,
 * JetBrains Mono, pink-600 accents, clean white cards, Tailwind CDN.
 */

export function getDashboardHTML(_port: number): string {
  return `<!DOCTYPE html>
<html lang="en" class="antialiased">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>prlt dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://api.fontshare.com/css?f[]=switzer@400,500,600,700&display=swap">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Switzer', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace'],
          },
          colors: {
            pink: {
              600: '#D15052',
            },
            gray: {
              750: '#2a2a2e',
            },
          },
        },
      },
    }
  </script>
  <style>
    /* Scrollbar */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
  </style>
</head>
<body class="bg-white text-gray-950 font-sans min-h-screen">

  <!-- Header -->
  <header class="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
    <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <h1 class="text-lg font-semibold tracking-tight text-gray-950">
          <span class="text-pink-600">prlt</span> dashboard
        </h1>
        <span id="project-name" class="font-mono text-xs uppercase tracking-widest text-gray-500 bg-gray-100 px-3 py-1 rounded-full">loading...</span>
      </div>
      <div class="flex items-center gap-3 text-xs text-gray-400">
        <span id="status-dot" class="w-2 h-2 rounded-full bg-gray-300"></span>
        <span id="status-text">Connecting...</span>
        <span id="last-updated" class="text-gray-400"></span>
      </div>
    </div>
  </header>

  <!-- Main -->
  <main class="max-w-7xl mx-auto px-6 py-8 space-y-10">

    <!-- Board Section -->
    <section id="board-section">
      <div class="flex items-center gap-3 mb-4">
        <h2 class="font-mono text-xs uppercase tracking-widest text-gray-500">Board</h2>
        <span id="board-count" class="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">0</span>
      </div>
      <div id="kanban" class="flex gap-3 overflow-x-auto pb-2"></div>
    </section>

    <!-- Agents Section -->
    <section id="agents-section">
      <div class="flex items-center gap-3 mb-4">
        <h2 class="font-mono text-xs uppercase tracking-widest text-gray-500">Agents</h2>
        <span id="agents-count" class="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">0</span>
      </div>
      <div id="agents-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"></div>
    </section>

    <!-- Sessions Section -->
    <section id="sessions-section">
      <div class="flex items-center gap-3 mb-4">
        <h2 class="font-mono text-xs uppercase tracking-widest text-gray-500">Sessions</h2>
        <span id="sessions-count" class="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">0</span>
      </div>
      <div class="bg-white rounded-2xl shadow-sm ring-1 ring-gray-200 overflow-hidden">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-100">
              <th class="text-left px-4 py-3 font-mono text-xs uppercase tracking-widest text-gray-400 font-medium">Session</th>
              <th class="text-left px-4 py-3 font-mono text-xs uppercase tracking-widest text-gray-400 font-medium">Ticket</th>
              <th class="text-left px-4 py-3 font-mono text-xs uppercase tracking-widest text-gray-400 font-medium">Agent</th>
              <th class="text-left px-4 py-3 font-mono text-xs uppercase tracking-widest text-gray-400 font-medium">Environment</th>
              <th class="text-left px-4 py-3 font-mono text-xs uppercase tracking-widest text-gray-400 font-medium">Status</th>
            </tr>
          </thead>
          <tbody id="sessions-body"></tbody>
        </table>
      </div>
    </section>

    <!-- PRs Section -->
    <section id="prs-section">
      <div class="flex items-center gap-3 mb-4">
        <h2 class="font-mono text-xs uppercase tracking-widest text-gray-500">Pull Requests</h2>
        <span id="prs-count" class="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">0</span>
      </div>
      <div id="pr-list" class="space-y-2"></div>
    </section>

  </main>

  <script>
    // Escape helper
    function esc(str) {
      if (!str) return '';
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    // Priority colors
    function priorityClasses(p) {
      switch (p) {
        case 'P0': return 'text-red-600 ring-red-200 bg-red-50';
        case 'P1': return 'text-orange-600 ring-orange-200 bg-orange-50';
        case 'P2': return 'text-yellow-600 ring-yellow-200 bg-yellow-50';
        case 'P3': return 'text-gray-500 ring-gray-200 bg-gray-50';
        default: return 'text-gray-500 ring-gray-200 bg-gray-50';
      }
    }

    // Render functions
    function renderBoard(board) {
      const kanban = document.getElementById('kanban');
      const cols = board.columns || [];
      let totalTickets = 0;
      cols.forEach(c => totalTickets += (c.tickets || []).length);
      document.getElementById('board-count').textContent = totalTickets;

      if (cols.length === 0) {
        kanban.innerHTML = '<p class="text-sm text-gray-400 py-8 text-center w-full">No board data</p>';
        return;
      }

      kanban.innerHTML = cols.map(col => {
        const tickets = col.tickets || [];
        return '<div class="min-w-[240px] max-w-[300px] flex-1 bg-white rounded-2xl shadow-sm ring-1 ring-gray-200 flex flex-col max-h-[500px]">' +
          '<div class="px-4 py-3 border-b border-gray-100 flex justify-between items-center flex-shrink-0">' +
            '<span class="text-sm font-medium text-gray-950">' + esc(col.name) + '</span>' +
            '<span class="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">' + tickets.length + '</span>' +
          '</div>' +
          '<div class="p-2 overflow-y-auto flex-1 space-y-1.5">' +
            (tickets.length === 0 ? '' : tickets.map(t => {
              let meta = '';
              if (t.priority) meta += '<span class="inline-flex text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-lg ring-1 ' + priorityClasses(t.priority) + '">' + esc(t.priority) + '</span>';
              if (t.category) meta += '<span class="inline-flex text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-lg ring-1 ring-purple-200 text-purple-600 bg-purple-50">' + esc(t.category) + '</span>';
              if (t.assignee) meta += '<span class="inline-flex text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-lg ring-1 ring-pink-600/20 text-pink-600 bg-pink-50">' + esc(t.assignee) + '</span>';
              (t.labels || []).forEach(l => { meta += '<span class="inline-flex text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-lg ring-1 ring-gray-200 text-gray-500 bg-gray-50">' + esc(l) + '</span>'; });
              return '<div class="bg-gray-50 rounded-xl p-3 transition-all hover:ring-1 hover:ring-pink-600/30 cursor-default">' +
                '<div class="font-mono text-[11px] font-semibold text-pink-600">' + esc(t.id) + '</div>' +
                '<div class="text-sm text-gray-950 mt-1 leading-snug">' + esc(t.title) + '</div>' +
                (meta ? '<div class="flex gap-1.5 mt-2 flex-wrap">' + meta + '</div>' : '') +
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
        grid.innerHTML = '<p class="text-sm text-gray-400 py-8 text-center col-span-full">No agents found</p>';
        return;
      }

      grid.innerHTML = agents.map(a => {
        const isActive = a.hasActiveSessions;
        const borderClass = isActive ? 'border-l-[3px] border-l-green-400' : 'border-l-[3px] border-l-gray-300';
        const dotClass = isActive ? 'bg-green-400' : 'bg-gray-300';
        let tickets = '';
        if (a.assignedTickets.length > 0) {
          tickets = '<div class="flex gap-1.5 flex-wrap mt-3">' +
            a.assignedTickets.map(t => '<span class="font-mono text-[10px] font-medium text-pink-600 bg-pink-50 ring-1 ring-pink-600/20 px-2 py-0.5 rounded-lg">' + esc(t) + '</span>').join('') +
          '</div>';
        }
        return '<div class="bg-white rounded-2xl shadow-sm ring-1 ring-gray-200 p-4 transition-all hover:ring-pink-600/30 ' + borderClass + '">' +
          '<div class="flex items-center gap-2">' +
            '<span class="w-2 h-2 rounded-full flex-shrink-0 ' + dotClass + '"></span>' +
            '<span class="text-sm font-semibold text-gray-950">' + esc(a.name) + '</span>' +
          '</div>' +
          (a.branch ? '<div class="font-mono text-xs text-gray-400 mt-1.5 truncate">' + esc(a.branch) + '</div>' : '') +
          tickets +
        '</div>';
      }).join('');
    }

    function renderSessions(sessions) {
      const body = document.getElementById('sessions-body');
      document.getElementById('sessions-count').textContent = sessions.length;

      if (sessions.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="text-sm text-gray-400 text-center py-8">No active sessions</td></tr>';
        return;
      }

      body.innerHTML = sessions.map(s => {
        const envLabel = s.environment === 'container' ? 'container' : 'host';
        let statusCls = 'text-gray-500 bg-gray-50 ring-gray-200';
        if (s.status === 'running') statusCls = 'text-green-600 bg-green-50 ring-green-200';
        else if (s.status === 'starting') statusCls = 'text-yellow-600 bg-yellow-50 ring-yellow-200';
        else if (s.status === 'orphan') statusCls = 'text-orange-600 bg-orange-50 ring-orange-200';
        return '<tr class="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">' +
          '<td class="px-4 py-3 font-mono text-xs text-gray-400">' + esc(s.sessionId) + '</td>' +
          '<td class="px-4 py-3 font-mono text-xs font-medium text-pink-600">' + esc(s.ticketId) + '</td>' +
          '<td class="px-4 py-3 text-sm text-gray-950">' + esc(s.agentName) + '</td>' +
          '<td class="px-4 py-3"><span class="font-mono text-[10px] uppercase tracking-widest text-gray-400">' + esc(envLabel) + '</span></td>' +
          '<td class="px-4 py-3"><span class="font-mono text-[10px] font-medium px-2 py-0.5 rounded-full ring-1 ' + statusCls + '">' + esc(s.status) + '</span></td>' +
        '</tr>';
      }).join('');
    }

    function renderPRs(prs) {
      const list = document.getElementById('pr-list');
      document.getElementById('prs-count').textContent = prs.length;

      if (prs.length === 0) {
        list.innerHTML = '<p class="text-sm text-gray-400 py-8 text-center">No open pull requests</p>';
        return;
      }

      list.innerHTML = prs.map(pr => {
        const ciClass = pr.ciStatus || 'unknown';
        let ciCls = 'text-gray-500 bg-gray-50 ring-gray-200';
        let ciLabel = 'unknown';
        if (ciClass === 'success') { ciCls = 'text-green-600 bg-green-50 ring-green-200'; ciLabel = 'passed'; }
        else if (ciClass === 'failure') { ciCls = 'text-red-600 bg-red-50 ring-red-200'; ciLabel = 'failed'; }
        else if (ciClass === 'pending') { ciCls = 'text-yellow-600 bg-yellow-50 ring-yellow-200'; ciLabel = 'running'; }
        return '<div class="bg-white rounded-2xl shadow-sm ring-1 ring-gray-200 px-5 py-3.5 flex items-center gap-4 transition-all hover:ring-pink-600/30">' +
          '<a href="' + esc(pr.url) + '" target="_blank" class="font-mono text-sm font-semibold text-pink-600 hover:underline min-w-[50px]">#' + pr.number + '</a>' +
          '<span class="text-sm text-gray-950 flex-1">' + esc(pr.title) + '</span>' +
          (pr.isDraft ? '<span class="font-mono text-[10px] uppercase tracking-widest text-gray-400 ring-1 ring-gray-200 px-2 py-0.5 rounded-full">draft</span>' : '') +
          '<span class="font-mono text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-lg max-w-[220px] truncate">' + esc(pr.headBranch) + '</span>' +
          '<span class="font-mono text-[10px] font-medium px-2 py-0.5 rounded-full ring-1 whitespace-nowrap ' + ciCls + '">' + ciLabel + '</span>' +
        '</div>';
      }).join('');
    }

    function renderAll(data) {
      document.getElementById('project-name').textContent = data.projectName || data.projectId;
      const ts = new Date(data.timestamp);
      document.getElementById('last-updated').textContent = ts.toLocaleTimeString();
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
        dot.className = 'w-2 h-2 rounded-full bg-green-400';
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
        dot.className = 'w-2 h-2 rounded-full bg-red-400';
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
